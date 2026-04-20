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

const downArrow = "↓";

const LLAMA_CPP_SERVERS = ["localhost:8080", "127.0.0.1:8080"];

interface LlamaCppTimings {
	predicted_per_second?: number;
	prompt_eval_count?: number;
	prompt_eval_ms?: number;
	eval_count?: number;
	eval_ms?: number;
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

	let details = "";
	if (data.prompt_eval_ms && data.prompt_eval_count && data.prompt_eval_count > 0) {
		const pMsPerToken = data.prompt_eval_ms / data.prompt_eval_count;
		details += ` [P:${pMsPerToken.toFixed(1)}ms/t]`;
	}

	if (data.eval_ms && data.eval_count && data.eval_count > 0) {
		const eMsPerToken = data.eval_ms / data.eval_count;
		details += ` [E:${eMsPerToken.toFixed(1)}ms/t]`;
	}

	return `${downArrow}${Number(predicted).toFixed(1)} tok/s${details}`;
}

// ─── Custom streamSimple for llama.cpp ─────────────
function createLlamaCppStream(
	model: PiModel,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {

	console.log("[llama-cpp-tps] Using custom stream handler for model:", model.id);

	// Create a minimal event stream
	const events: Array<any> = [];
	let resolveDone: () => void;
	const donePromise = new Promise<void>((r) => (resolveDone = r));

	// Build the request
	const baseUrl = model.baseUrl || "http://localhost:8080/v1";
	const apiKey = options?.apiKey ?? "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		...(options?.headers || {}),
	};

	console.log("[llama-cpp-tps] Requesting model:", model.id);

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

	console.log("[llama-cpp-tps] Payload prepared for:", model.id);

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
					if (dataStr === "[DONE]") break; console.log("[llama-cpp-tps] dataStr:", dataStr);

					try {
						const chunk: any = JSON.parse(dataStr); console.log("[llama-cpp-tps] Chunk:", JSON.stringify(chunk));
						if (chunk.timings) {
							console.log("[llama-cpp-tps] Received chunk timings:", JSON.stringify(chunk.timings));
							const updated = { ...(latestTimings.get(model.id) || {}), ...chunk.timings };
							timings = updated;
							latestTimings.set(model.id, updated);
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

	pi.on("message_start", (event: any, ctx: any) => {
		const model = event?.model || ctx?.model;
		console.log("[llama-cpp-tps] EVENT: message_start for model:", model?.id, "BaseURL:", model?.baseUrl);

        if (model && isLlamaCpp(model.baseUrl ?? "")) {
            console.log("[llama-cpp-tps] Detected llama-cpp model on message_start via context/event. Overriding provider...");
            const providerName = event?.provider || ctx?.provider || model?.provider; 
            if (providerName) {
                pi.registerProvider(providerName, {
                    baseUrl: model.baseUrl,
                    api: model.api,
                    streamSimple: createLlamaCppStream,
                });
                currentModelId = model.id; // Track it for the end event! 
            } else {
                console.log("[llama-cpp-tps] Could not find provider name on message_start.");
            }
        }

		if (event?.message?.role === "assistant") {
			currentModelId = model?.id; // Track it for the end event! 
		}
	});

	pi.on("message_end", (event, ctx) => {
		console.log("[llama-cpp-tps] EVENT: message_end role:", event.message?.role, "currentModelId:", currentModelId);
		if (event.message.role !== "assistant" || !currentModelId) return;

		let display: string | null = null;

		const timings = latestTimings.get(currentModelId);
		console.log("[llama-cpp-tps] message_end for", currentModelId, "timings:", timings);

		if (timings && timings.predicted_per_second) {
			display = formatTps(timings);
		}

		console.log("[llama-cpp-tps] message_end debug - display:", display, "lastTpsDisplay:", lastTpsDisplay, "ctx.hasUI:", ctx.hasUI);
		if (ctx.hasUI && display) {
			ctx.ui.notify(`[debug] TPS: ${display}`);
		}

		if (display && display !== lastTpsDisplay && ctx.hasUI) {
			lastTpsDisplay = display;
			ctx.ui.setStatus("llama-cpp-tps", display);
			console.log("[llama-cpp-tps] Setting status:", display);
		} else if (!display && lastTpsDisplay) {
			lastTpsDisplay = null;
			ctx.ui.setStatus("llama-cpp-tps", undefined);
			console.log("[llama-cpp-tps] Clearing status");
		}
	});

	async function discoverModels(): Promise<void> {
		try {
			const response = await fetch("http://localhost:8080/v1/models");
			if (!response.ok) return;
			const data: any = await response.json();
		} catch {
		}
	}

	pi.on("model_select", (event) => {
		console.log("[llama-cpp-tps] EVENT: model_select:", JSON.stringify(event, null, 2));
		if (isLlamaCpp(event.model.baseUrl ?? "")) {
			currentModelId = event.model.id;
			latestTimings.set(event.model.id, {});
			lastTpsDisplay = null;

			const providerName = (event as any).provider || (event.model as any).provider;
			if (providerName) {
				console.log("[llama-cpp-tps] Attempting to override provider:", providerName);
				pi.registerProvider(providerName, {
					baseUrl: event.model.baseUrl,
					api: event.model.api,
					streamSimple: createLlamaCppStream,
				});
			} else {
				console.log("[llama-cpp-tps] Could not find provider name on model object.");
			}

			console.log("[llama-cpp-tps] Model selected (is llama-cpp):", currentModelId);
		} else {
			currentModelId = undefined;
			console.log("[llama-cpp-tps] Non-llama model selected:", event.model.id);
		}
	});

	pi.on("before_provider_request", (event) => {
		console.log("[llama-cpp-tps] EVENT: before_provider_request");
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;
		const model = (event as any).model;
		if (!model || !isLlamaCpp(model.baseUrl ?? "")) return;

		console.log("[llama-cpp-tps] Intercepting request for:", model.id, "Payload before:", JSON.stringify(payload));

		const newPayload = { ...payload, timings_per_token: true };
		console.log("[llama-cpp-tps] Payload after adding timings_per_token:", JSON.stringify(newPayload));
		return newPayload;
	});

	discoverModels();

	pi.on("session_shutdown", () => {
		latestTimings.clear();
		currentModelId = undefined;
		lastTpsDisplay = null;
	});

	console.log("llama-cpp-tps: extension loaded");
}