import type {
	Api,
	AssistantMessageEventStream,
	Context,
	Model as PiModel,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { getApiProvider } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
const LOG_FILE = "/tmp/llama-cpp-tps.log";
function log(...args: any[]) {
	fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
}

const downArrow = "↓";
const upArrow = "↑";
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
	const prompt = data.prompt_per_second;

	if (!predicted || predicted <= 0) return null;

	if (prompt && prompt > 0) {
		return `${downArrow}${Number(predicted).toFixed(1)} tok/s | ${upArrow}${Number(prompt).toFixed(1)} tok/s prompt`;
	}
	return `${downArrow}${Number(predicted).toFixed(1)} tok/s`;
}

let _pi: ExtensionAPI | undefined;

// ─── Save original openai-completions streamSimple BEFORE we override it ───
const originalOpenAIStreamSimple = getApiProvider("openai-completions")?.streamSimple;
log("[llama-cpp-tps] Original openai-completions streamSimple:", originalOpenAIStreamSimple ? "found" : "NOT FOUND");

function scheduleTpsDisplay(modelId: string) {
	log("[llama-cpp-tps] scheduleTpsDisplay:", modelId);

	// Initial display after 200ms
	setTimeout(() => {
		if (!_pi) return;
		const timings = latestTimings.get(modelId);
		if (!timings || !timings.predicted_per_second) {
			log("[llama-cpp-tps] scheduleTpsDisplay: no valid timings for", modelId);
			return;
		}
		const display = formatTps(timings);
		if (display && display !== lastTpsDisplay) {
			lastTpsDisplay = display;
			_pi.ui.setStatus("llama-cpp-tps", display);
			log("[llama-cpp-tps] scheduleTpsDisplay: Set status to:", display);
		}
	}, 200);

	// Keep updating every second with latest timings
	let lastUpdate = 0;
	const refreshInterval = setInterval(() => {
		if (!_pi) { clearInterval(refreshInterval); return; }
		const now = Date.now();
		if (now - lastUpdate < 1000) return;
		lastUpdate = now;
		const currentTimings = latestTimings.get(modelId);
		if (!currentTimings || !currentTimings.predicted_per_second) {
			clearInterval(refreshInterval);
			return;
		}
		const newDisplay = formatTps(currentTimings);
		if (newDisplay && newDisplay !== lastTpsDisplay) {
			lastTpsDisplay = newDisplay;
			_pi.ui.setStatus("llama-cpp-tps", newDisplay);
			log("[llama-cpp-tps] scheduleTpsDisplay: Updated status to:", newDisplay);
		}
	}, 1000);
}

function createLlamaCppStream(
	model: PiModel,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {

	// DEBUG: Log every call to understand routing
	log("[llama-cpp-tps] createLlamaCppStream CALLED - model.id:", model.id, "provider:", model.provider, "api:", model.api, "baseUrl:", model.baseUrl);

	const isLlama = model.provider === "llama-cpp";
	log("[llama-cpp-tps] isLlama (model.provider === 'llama-cpp'):", isLlama);

	// If this is NOT a llama-cpp provider, delegate to the original built-in handler
	if (!isLlama) {
		log("[llama-cpp-tps] Delegating non-llama-cpp model to original provider");
		if (originalOpenAIStreamSimple) {
			return originalOpenAIStreamSimple(model, context, options);
		}
		throw new Error("[llama-cpp-tps] No original provider for non-llama-cpp model " + model.id);
	}

	log("[llama-cpp-tps] Using custom llama.cpp SSE stream");

	const baseUrl = model.baseUrl || `${LLAMA_CPP_URL}/v1`;
	const apiKey = options?.apiKey ?? "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		...(options?.headers || {}),
	};

	log("[llama-cpp-tps] Requesting model:", model.id, "from baseUrl:", baseUrl);
	log("[llama-cpp-tps] Headers:", JSON.stringify(headers));

	const messages = (context.messages || []).map((m) => {
		let content: any = m.content;
		if (typeof content !== 'string' && Array.isArray(content)) {
			content = content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n');
		} else if (typeof content !== "string") {
			content = JSON.stringify(m.content);
		}

		const msg: any = { role: m.role, content };
		if ('tool_calls' in m && m.tool_calls) msg.tool_calls = m.tool_calls;
		return msg;
	});
	log("[llama-cpp-tps] Messages count:", messages.length);

	const systemPrompt = (context as any).systemPrompt;
	if (systemPrompt) {
		messages.unshift({ role: "system", content: systemPrompt });
		log("[llama-cpp-tps] System prompt added, total messages:", messages.length);
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

	let output: any = {
		role: "assistant",
		content: [],
		api: model.api as Api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0, own_output_tokens_count: 0,
			output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};

	let timingsData = null;
	const events: Array<any> = [];
	let resolveDone: () => void;
	const donePromise = new Promise<void>((r) => (resolveDone = r));

	(async () => {
		try {
			log("[llama-cpp-tps] Sending fetch request to:", baseUrl + "/chat/completions");
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			});

			log("[llama-cpp-tps] Fetch response status:", response.status);

			if (!response.ok) {
				const errorText = await response.text();
				log("[llama-cpp-tps] Fetch error body:", errorText);
				throw new Error(`HTTP ${response.status}: ${errorText}`);
			}

			// Emit start
			events.push({ type: "start", partial: output });
			log("[llama-cpp-tps] Emitted 'start' event");

			// Read SSE stream
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body");
			}

			let buffer = "";
			let chunkCount = 0;

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

					log("[llama-cpp-tps] SSE chunk:", dataStr.substring(0, 200));
					chunkCount++;

					if (dataStr === "[DONE]") {
						log("[llama-cpp-tps] Received [DONE], total chunks:", chunkCount);
						break;
					}

					try {
						const chunk: any = JSON.parse(dataStr);

						if (chunk.timings) {
							timingsData = chunk.timings;
							latestTimings.set(model.id, timingsData);
							log("[llama-cpp-tps] TIMINGS set for model:", model.id);
							log("[llama-cpp-tps] TIMINGS captured:", JSON.stringify(chunk.timings));
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
								events.push({ type: "tool_call", ...delta });
							}
						}

						const finish: any = chunk.choices?.[0]?.finish_reason;
						if (finish) {
							output!.stopReason = finish === "stop" ? "stop" : "length";
							log("[llama-cpp-tps] Stop reason:", output!.stopReason);
						}
					} catch (err) {
						log("[llama-cpp-tps] Error parsing chunk:", err, dataStr.substring(0, 100));
					}
					if (dataStr === "[DONE]") break;
				}
			}

			log("[llama-cpp-tps] Stream complete. Final output content length:", output.content.length);
			log("[llama-cpp-tps] Final timings:", JSON.stringify(timingsData));

			// Set a short timeout to display TPS after stream completes
			scheduleTpsDisplay(model.id);
			if (!output.content.length) {
				output.content.push({ type: "text", text: "" });
			}
		} catch (error: any) {
			log("[llama-cpp-tps] Stream error:", error.message);
			console.error("[llama-cpp-tps CATCH BLOCK]", "model.id=", model.id);
			scheduleTpsDisplay(model.id);

			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error.message;
		} finally {
			events.push({ type: "done", reason: output.stopReason as any, message: output });
			log("[llama-cpp-tps] Emitted 'done' event, resolving donePromise");
			resolveDone();

		}
	})();

	return {
		push(event: any) { events.push(event); },
		end() { resolveDone(); },
		result() { return Promise.resolve({} as any); },
		async *[Symbol.asyncIterator]() {
			log("[llama-cpp-tps] Async iterator started");
			for (const e of events) yield e;
			await donePromise;
		},
	} as any;
}

// ─── Extension Entry Point ─────────────────────
export default function (pi: ExtensionAPI) {
	_pi = pi;
	log("[llama-cpp-tps] Extension loaded. LLAMA_CPP_URL:", LLAMA_CPP_URL);
	log("[llama-cpp-tps] Current registered providers:", Array.from(pi.events.listeners ? [] : []).join(", "));

	// No model_select handler - user never switches models.
	// Get model info directly from event.message in message_end instead.

	pi.on("message_end", (event, ctx) => {
		log("[llama-cpp-tps] message_end fired - role:", event.message.role, "hasUI:", ctx.hasUI);

		// message_end message object is empty for assistant messages (pi bug).
		// Just check if we have captured timings and display the latest.
		const keys = Array.from(latestTimings.keys());

		if (keys.length === 0) {
			log("[llama-cpp-tps] message_end - no timings, nothing to display");
			return;
		}

		const latestModelId = keys[keys.length - 1];
		const timings = latestTimings.get(latestModelId);

		if (!timings || !timings.predicted_per_second) {
			log("[llama-cpp-tps] message_end - no valid timings for", latestModelId);
			return;
		}

		const display = formatTps(timings);

		if (display && ctx.hasUI) {
			if (display !== lastTpsDisplay) {
				lastTpsDisplay = display;
				ctx.ui.setStatus("llama-cpp-tps", display);
				ctx.ui.notify(`[footer] TPS: ${display}`);
				log("[llama-cpp-tps] message_end - Set status:", display);
			}
		}
	});

	async function discoverModels(): Promise<void> {
		try {
			log("[llama-cpp-tps] discoverModels: fetching models from", LLAMA_CPP_URL + "/v1/models");
			const response = await fetch(`${LLAMA_CPP_URL}/v1/models`);
			log("[llama-cpp-tps] discoverModels: response status:", response.status);
			if (!response.ok) {
				log("[llama-cpp-tps] discoverModels: non-OK status, skipping provider registration");
				return;
			}
			const data: any = await response.json();
			log("[llama-cpp-tps] discoverModels: models data:", JSON.stringify(data));
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

			log("[llama-cpp-tps] discoverModels: registering provider with", models.length, "model(s)");
			for (const m of models) {
				log("[llama-cpp-tps]   Model: id=", m.id, "provider=", m.provider, "api=", m.api, "baseUrl=", m.baseUrl);
			}
			pi.registerProvider("llama-cpp", {
				baseUrl: `${LLAMA_CPP_URL}/v1`,
				apiKey: "none",
				authHeader: false,
				api: "openai-completions" as Api,
				models,
				streamSimple: createLlamaCppStream as any,
			});
			log("[llama-cpp-tps] discoverModels: provider registered successfully");
		} catch (err: any) {
			log(`[llama-cpp-tps] discoverModels error: ${err.message}`);
		}
	}

	discoverModels();

	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;
		log("[llama-cpp-tps] before_provider_request: adding timings_per_token to payload");
		const newPayload: any = { ...payload, timings_per_token: true };
		return newPayload;
	});

	pi.on("after_provider_response", (event) => {
		log("[llama-cpp-tps] after_provider_response: status:", (event as any).status, "headers:", JSON.stringify((event as any).headers));
	});

	pi.on("session_shutdown", () => {
		log("[llama-cpp-tps] session_shutdown: clearing state");
		latestTimings.clear();
		lastTpsDisplay = null;
	});

	log("[llama-cpp-tps] extension loaded successfully");
}
