/**
 * Extension: Show tokens/second from llama.cpp server timing data.
 * 
 * llama.cpp's /v1/chat/completions returns a "timings" field in the final
 * streaming chunk: { timings: { predicted_per_second, predicted_ms, ... } }
 * 
 * This extension registers a custom provider wrapper that:
 * 1. Intercepts requests to llama.cpp servers
 * 2. Adds timings_per_token: true to the request
 * 3. Captures timing data from the response body
 * 4. Exposes it via pi.events and ctx.ui.setStatus() in the footer
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model as PiModel,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
const LOG_FILE = "/tmp/llama-cpp-tps.log";
function log(...args: any[]) {
	fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
}


const downArrow = "↓";

const LLAMA_CPP_URL = process.env.LLAMA_CPP_URL ?? "http://localhost:8080";
const LLAMA_CPP_SERVERS = [LLAMA_CPP_URL.replace(/^https?:\/\//, "")];

interface LlamaCppTimings {
	predicted_n?: number;
	predicted_ms?: number;
	predicted_per_second?: number;
	prompt_n?: number;
	prompt_ms?: number;
}

// Store latest timing data per model
const latestTimings = new Map<string, LlamaCppTimings>();
let lastTpsDisplay: string | null = null;

function isLlamaCpp(baseUrl: string): boolean {
	return LLAMA_CPP_SERVERS.some((s) => baseUrl?.includes(s));
}

function formatTps(data: LlamaCppTimings): string | null {
	const predicted = data.predicted_per_second;

	if (!predicted || predicted <= 0) return null;
	return `${downArrow}${Number(predicted).toFixed(1)} tok/s`;
}

// ─── Custom streamSimple for llama.cpp ─────────────
function createLlamaCppStream(
	model: PiModel,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {

	// Create a minimal event stream
	const events: Array<any> = [];
	let resolveDone: () => void;
	const donePromise = new Promise<void>((r) => (resolveDone = r));

	// Build the request
	log("[llama-cpp-tps] createLlamaCppStream CALLED for:", model.id, "provider:", model.provider, "baseUrl:", model.baseUrl);
	const baseUrl = model.baseUrl || "http://localhost:8080/v1";
	const apiKey = options?.apiKey ?? "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		...(options?.headers || {}),
	};

	log("[llama-cpp-tps] Requesting model:", model.id);

	const messages = (context.messages || []).map((m) => {
		let content: any = m.content;
		if (typeof content !== 'string' && Array.isArray(content)) {
			// Convert array of objects to a plain text string for llama-server compatibility
			content = content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
		} else if (typeof content !== "string") {
			content = JSON.stringify(m.content);
		}

		const msg: any = { role: m.role, content };
		if ('tool_calls' in m && m.tool_calls) msg.tool_calls = m.tool_calls;
		return msg;
	});
	const systemPrompt = (context as any).systemPrompt;
	if (systemPrompt) {
		messages.unshift({ role: "system", content: systemPrompt });
	}

	const payload: Record<string, unknown> = {
		model: model.id,
		messages,
		stream: true,
		timings_per_token: true,
	};

	log("[llama-cpp-tps] Payload prepared for:", model.id);

	if (options?.maxTokens) {
		payload.max_tokens = options.maxTokens;
	}

	let output: AssistantMessage | undefined;
	let timings: LlamaCppTimings | null = null;
	(async () => {
		try {
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${await response.text()}`);
			}

			// Create output message
			output = {
				role: "assistant",
				content: [],
				api: model.api as Api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0, own_output_tokens_count: 0, // dummy to avoid issues if types are strict but we'll use output below
					output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			};

			// Emit start
			events.push({ type: "start", partial: output });

			// Read SSE stream
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			let buffer = "";
			// Track text content
			let textContent = "";

			while (true) {
				const { done: streamDone, value } = await reader.read();
				if (streamDone) break;
				buffer += new TextDecoder().decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith("data: ")) continue;
					const dataStr = trimmed.slice(6);
					if (dataStr === "[DONE]") break; log("[llama-cpp-tps] dataStr:", dataStr);

					try {
						const chunk: any = JSON.parse(dataStr); log("[llama-cpp-tps] Chunk:", JSON.stringify(chunk));
						if (chunk.timings) {
							timings = chunk.timings;
							latestTimings.set(model.id, timings);
						}
						if (chunk.usage?.completion_tokens !== undefined) {
							output!.usage.output = chunk.usage.completion_tokens;
							output!.usage.totalTokens = output!.usage.output;
						}

						const delta: any = chunk.choices?.[0]?.delta;
						if (delta) {
							if (delta.content) {
								if (!output!.content.length || output!.content[0].type !== "text") {
									output!.content.push({ type: "text", text: "" });
								}
								(output!.content[0] as any).text += delta.content;
								events.push({ type: "text_delta", contentIndex: 0, delta: delta.content, partial: output! });
							} else if (delta.tool_calls) {
								// Pass tool calls through to the event stream so the agent can handle them
								events.push({ type: "tool_call", ...delta });
							}
						}

						const finish: any = chunk.choices?.[0]?.finish_reason;
						if (finish) { output!.stopReason = finish === "stop" ? "stop" : "length"; }
					} catch (err) {
						// console.error("[llama-cpp-tps] Error parsing chunk:", err, dataStr); 
					}
				}

				if (dataStr === "[DONE]") break;
			}
			if (!output.content.length) { output.content.push({ type: "text", text: "" }); }
		} catch (error: any) {
			// Handle error
			if (!output) {
				output = {
					role: "assistant",
					content: [],
					api: model.api as Api,
					provider: model.provider,
					model: model.id,
					stopReason: "error",
					timestamp: Date.now(),
				};
			}

			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error.message;
		} finally {
			if (output) {
				events.push({ type: "done", reason: output.stopReason as any, message: output });
			}
			resolveDone();
		}
	})();

	return {
		push(event) { events.push(event); },
		end() { resolveDone(); },
		result() { return Promise.resolve({} as any); },
		async *[Symbol.asyncIterator]() {
			for (const e of events) yield e;
			await donePromise;
			return;
		},
	} as AssistantMessageEventStream;
}

// ─── Extension Entry Point ─────────────────────
export default function (pi: ExtensionAPI) {
	let currentModelId: string | undefined;
	let lastTpsDisplay: string | null = null;
	let messageStartMs: number | undefined;

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			messageStartMs = Date.now();
		}
	});

	pi.on("message_end", (event, ctx) => {
		log("[llama-cpp-tps] EVENT: message_end role:", event.message?.role, "currentModelId:", currentModelId);
		if (event.message.role !== "assistant" || !currentModelId) return;

		let display: string | null = null;

		const timings = latestTimings.get(currentModelId);
		log("[llama-cpp-tps] message_end for", currentModelId, "timings:", timings);
		log("[llama-cpp-tps] message_end message.usage:", JSON.stringify(event.message.usage));
		log("[llama-cpp-tps] message_end message keys:", Object.keys(event.message));

		if (timings && timings.predicted_per_second) {
			display = formatTps(timings);
		} else if (messageStartMs && event.message.usage?.output) {
			const elapsedSec = (Date.now() - messageStartMs) / 1000;
			if (elapsedSec > 0) {
				const tps = Math.round((event.message.usage!.output / elapsedSec) * 10) / 10;
				if (tps > 0) display = `${downArrow}${tps.toFixed(1)} tok/s`;
			}
		}

		messageStartMs = undefined;

		log("[llama-cpp-tps] message_end debug - display:", display, "lastTpsDisplay:", lastTpsDisplay, "ctx.hasUI:", ctx.hasUI);
		if (ctx.hasUI && display) {
			ctx.ui.notify(`[debug] TPS: ${display}`);
		}

		if (display && display !== lastTpsDisplay && ctx.hasUI) {
			lastTpsDisplay = display;
			ctx.ui.setStatus("llama-cpp-tps", display);
			log("[llama-cpp-tps] Setting status:", display);
		} else if (!display && lastTpsDisplay) {
			lastTpsDisplay = null;
			ctx.ui.setStatus("llama-cpp-tps", undefined);
			log("[llama-cpp-tps] Clearing status");
		}
	});

	async function discoverModels(): Promise<void> {
		try {
			const response = await fetch(`${LLAMA_CPP_URL}/v1/models`);
			if (!response.ok) return;
			const data: any = await response.json();
			if (!data.data || !Array.isArray(data.data)) return;

			const models = data.data.map((m: any) => ({
				id: m.id,
				name: m.id.split("/").pop() ?? m.id,
				api: "openai-completions" as Api,
				provider: "llama-cpp",
				baseUrl: `${LLAMA_CPP_URL}/v1`,
				reasoning: false,
				input: ["text"] as ("text" | "image")[],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: m.context_length ?? 131072,
				maxTokens: Math.min(m.max_tokens ?? 8192, m.context_length ?? 131072),
			}));

			if (models.length > 0) {
				log(`[llama-cpp-tps] registering provider: ${models.length} model(s)`);
				pi.registerProvider("llama-cpp", {
					baseUrl: `${LLAMA_CPP_URL}/v1`,
					apiKey: "none",
					authHeader: false,
					api: "openai-completions" as Api,
					models,
					streamSimple: createLlamaCppStream as any,
				});
			}
		} catch (err) {
			log(`[llama-cpp-tps] discoverModels error: ${err}`);
		}
	}

	discoverModels();

	// Track current model when selected
	pi.on("model_select", (event) => {
		log("[llama-cpp-tps] Model selected:", event.model.id, "Provider:", event.model.provider);
		if (event.model.provider === "llama-cpp") {
			currentModelId = event.model.id;
		}
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;

		const newPayload = { ...payload, timings_per_token: true };
		return newPayload;
	});

	pi.on("after_provider_response", (event) => {
		log("[llama-cpp-tps] after_provider_response status:", (event as any).status, "headers:", JSON.stringify((event as any).headers));
	});

	pi.on("session_shutdown", () => {
		latestTimings.clear();
		currentModelId = undefined;
		lastTpsDisplay = null;
	});

	log("llama-cpp-tps: extension loaded");
}
