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
	const predicted =
		data.predicted_per_second ??
		(data.predicted_ms && data.predicted_n
			? Math.round((data.predicted_n / data.predicted_ms) * 1000 * 10) / 10
			: undefined);

	if (!predicted || predicted <= 0) return null;
	return `↓${predicted.toFixed(1)} tok/s`;
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
	const baseUrl = model.baseUrl || "http://localhost:8080/v1";
	const apiKey = options?.apiKey ?? "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		...(options?.headers || {}),
	};

	const messages = (context.messages || []).map((m) => ({
		role: m.role,
		content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
	}));
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
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
					if (dataStr === "[DONE]") break;
				try {
				const chunk: any = JSON.parse(dataStr);
				if (chunk.timings) { timings = chunk.timings; latestTimings.set(model.id, timings); }
				if (chunk.usage?.completion_tokens) { output.usage.output = chunk.usage.completion_tokens; output.usage.totalTokens = output.usage.output; }
				const delta: any = chunk.choices?.[0]?.delta?.content;
				if (delta) {
				if (!output.content.length || output.content[0].type !== "text") {
					output.content.push({ type: "text", text: "" });
				}
				(output.content[0] as any).text += delta;
				events.push({ type: "text_delta", contentIndex: 0, delta, partial: output });
				}
				const finish: any = chunk.choices?.[0]?.finish_reason;
				if (finish) { output.stopReason = finish === "stop" ? "stop" : "length"; }
				} catch { /* skip malformed chunks */ }
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
	let lastTps: string | null = null;
	let messageStartMs: number | undefined;

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			messageStartMs = Date.now();
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant" || !currentModelId) return;

		let display: string | null = null;

		const timings = latestTimings.get(currentModelId);
		if (timings) {
			display = formatTps(timings);
		} else if (messageStartMs) {
			const elapsedSec = (Date.now() - messageStartMs) / 1000;
			if (elapsedSec > 0 && event.message.usage?.output) {
				const tps = Math.round((event.message.usage.output / elapsedSec) * 10) / 10;
				if (tps > 0) display = `${downArrow}${tps.toFixed(1)} tok/s`;
			}
		}

		messageStartMs = undefined;

		if (display && display !== lastTps && ctx.hasUI) {
			lastTps = display;
			ctx.ui.setStatus("llama-cpp-tps", display);
		} else if (!display && lastTps) {
			lastTps = null;
			ctx.ui.setStatus("llama-cpp-tps", undefined);
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
		if (isLlamaCpp(event.model.baseUrl ?? "")) {
			currentModelId = event.model.id;
			latestTimings.set(event.model.id, {});
			lastTps = null;
		} else {
			currentModelId = undefined;
		}
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;
		const model = (event as any).model;
		if (!model || !isLlamaCpp(model.baseUrl ?? "")) return;
		return { ...payload, timings_per_token: true };
	});

	discoverModels();

	pi.on("session_shutdown", () => {
		latestTimings.clear();
		currentModelId = undefined;
		lastTps = null;
	});

	console.log("llama-cpp-tps: extension loaded");
}
