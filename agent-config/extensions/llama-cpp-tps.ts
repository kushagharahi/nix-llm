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
const DEBUG = process.env.LLAMA_CPP_EXTENSION_DEBUG === "1";
function log(...args: any[]) {
	if (!DEBUG) return;
	fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
}

const downArrow = "↓";
const upArrow = "↑";
const LLAMA_CPP_URL = process.env.LLAMA_CPP_URL ?? "http://localhost:8080";

interface LlamaCppTimings {
	predicted_n?: number;
	predicted_ms?: number;
	predicted_per_second?: number;
	prompt_n?: number;
	prompt_ms?: number;
	prompt_per_second?: number;
}

// Store latest timing data per model
const latestTimings = new Map<string, LlamaCppTimings>();
let lastTpsDisplay: string | null = null;

// Progress tracking
interface ProgressData {
	total?: number;
	cache?: number;
	processed?: number;
	time_ms?: number;
	pct?: number;
}
let latestProgress: ProgressData | undefined;
let pctProgress: number | undefined;

// Store ctx from turn_start for use in SSE parsing loop (must be before captureTimings)
let turnCtx: Context | null = null;

function formatTps(data: LlamaCppTimings): string | null {
	const predicted = data.predicted_per_second;
	const prompt = data.prompt_per_second;
	const predictedMs = data.predicted_ms;
	const promptMs = data.prompt_ms;

	if (!predicted || predicted <= 0) return null;

	if (prompt && prompt > 0) {
		return `Out: ${downArrow}${Number(predicted).toFixed(1)} tok/s${fmtTime(predictedMs) ? ` (${fmtTime(predictedMs)})` : ""} | In: ${upArrow}${Number(prompt).toFixed(1)} tok/s${fmtTime(promptMs) ? ` (${fmtTime(promptMs)})` : ""}`;
	}
	return `${downArrow}${Number(predicted).toFixed(1)} tok/s${fmtTime(predictedMs) ? ` (${fmtTime(predictedMs)})` : ""}`;
}

function fmtTime(ms: number | undefined): string {
	if (!ms || ms <= 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

let _pi: ExtensionAPI | undefined;

// ─── Save original openai-completions streamSimple BEFORE we override it ───
const originalOpenAIStreamSimple = getApiProvider("openai-completions")?.streamSimple;
log("[llama-cpp-tps] Original openai-completions streamSimple:", originalOpenAIStreamSimple ? "found" : "NOT FOUND");

// ─── Intercept fetch to capture llama.cpp timing data from SSE chunks ───
function captureTimings(
	modelId: string,
	body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
	const reader = body.getReader();
	let buffer = "";

	return new ReadableStream({
		async start(controller) {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += new TextDecoder().decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const jsonStr = line.slice(6);
					if (jsonStr === "[DONE]") break;

					try {
						const chunk = JSON.parse(jsonStr);
						if (chunk.timings) {
							latestTimings.set(modelId, chunk.timings);
							log("[llama-cpp-tps] TIMINGS captured:", JSON.stringify(chunk.timings));
						}
						if (chunk.prompt_progress) {
							latestProgress = chunk.prompt_progress;
							const prog = chunk.prompt_progress;

							pctProgress = prog.total && prog.total > 0
								? Math.round(((prog.processed - (prog.cache ?? 0)) / (prog.total - (prog.cache ?? 0))) * 100)
								: Math.round((prog.processed / prog.total) * 100);
							latestProgress.pct = pctProgress;

							log("[llama-cpp-tps] PROGRESS:", prog.processed, "/", prog.total, "cache:", prog.cache ?? 0, "pct:", pctProgress + "%");
							fs.appendFileSync("/tmp/llama-cpp-tps-progress.log", JSON.stringify({ ...prog, pct: pctProgress }) + "\n");
							if (turnCtx && turnCtx.hasUI) {
								turnCtx.ui.setWorkingMessage(`Working... | Prompt Processing ${pctProgress}%`);
							}
						}
					} catch {
						// ignore parse errors for non-JSON SSE lines
					}
				}

				controller.enqueue(value);
			}

			controller.close();
		},
		cancel(reason?: any) {
			reader.cancel(reason);
		},
	});
}

// ─── Extension Entry Point ─────────────────────
export default function (pi: ExtensionAPI) {
	_pi = pi;
	log("[llama-cpp-tps] Extension loaded. LLAMA_CPP_URL:", LLAMA_CPP_URL);
	log("[llama-cpp-tps] Current registered providers:", Array.from(pi.events.listeners ? [] : []).join(", "));

	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: any, init?: any) => {
		const url = typeof input === "string" ? input : input.url;
		if (typeof url !== "string" || !url.includes("/v1/chat/completions")) {
			return originalFetch(input, init);
		}
		const response = await originalFetch(input, init);
		if (response.ok && response.body) {
			return new Response(captureTimings("llama-cpp-model", response.body), {
				status: response.status,
				headers: Object.fromEntries(response.headers),
			});
		}
		return response;
	};

	function createLlamaCppStream(
		model: PiModel,
		context: Context,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream {
		log("[llama-cpp-tps] createLlamaCppStream CALLED - model.id:", model.id, "provider:", model.provider);
		const origStream = originalOpenAIStreamSimple?.(model, context, options);
		if (!origStream) {
			throw new Error("[llama-cpp-tps] No original stream for model " + model.id);
		}

		return origStream;
	}

	function fmtProgress(p?: number): string {
		if (!p || p <= 0) return "";
		if (p >= 100) return "100%";
		return `${Math.round(p)}%`;
	}

	// ─── Listen for message_update to show progress during streaming ───
	// This fires repeatedly as tokens are generated, allowing real-time progress updates
	const lastProgressDisplay = { value: "" };
	function updateProgressDisplay(ctx: Context) {
		if (!latestProgress || !latestProgress.total) return;
		const display = pctProgress !== undefined
			? `Working... | Prompt Processing ${pctProgress}%`
			: `Working... | Prompt Processing ${latestProgress.processed}/${latestProgress.total}`;

		if (display !== lastProgressDisplay.value && ctx.hasUI) {
			lastProgressDisplay.value = display;
			ctx.ui.setWorkingMessage(display);
		}
	}

	pi.on("message_update", (event, ctx) => {
		updateProgressDisplay(ctx);
	});

	// This is more reliable than message_end because by the time it fires,
	// all SSE chunks have been fully consumed and timings are captured.
	pi.on("turn_end", (event, ctx) => {
		log("[llama-cpp-tps] turn_end fired - hasUI:", ctx.hasUI);
		latestProgress = undefined;
		pctProgress = undefined;
		lastProgressDisplay.value = "";

		const keys = Array.from(latestTimings.keys());
		if (keys.length === 0) {
			log("[llama-cpp-tps] turn_end - no timings, nothing to display");
			return;
		}

		const latestModelId = keys[keys.length - 1];
		const timings = latestTimings.get(latestModelId);

		if (!timings || !timings.predicted_per_second) {
			log("[llama-cpp-tps] turn_end - no valid timings for", latestModelId);
			return;
		}

		const display = formatTps(timings);

		if (display && ctx.hasUI) {
			if (display !== lastTpsDisplay) {
				lastTpsDisplay = display;
				ctx.ui.setStatus("llama-cpp-tps", display);
				ctx.ui.notify(`TPS: ${display}`);
				log("[llama-cpp-tps] turn_end - Set status:", display);
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

	// Store ctx from after_provider_response for real-time progress updates
	let providerCtx: Context | null = null;

	pi.on("turn_start", (event, ctx) => {
		turnCtx = ctx;
		log("[llama-cpp-tps] turn_start fired, hasUI:", ctx.hasUI);
	});

	pi.on("after_provider_response", (event, ctx) => {
		providerCtx = ctx;
		log("[llama-cpp-tps] after_provider_response: providerCtx set, hasUI:", ctx.hasUI);
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;
		log("[llama-cpp-tps] before_provider_request: adding timings_per_token + return_progress to payload");
		const newPayload: any = { ...payload, timings_per_token: true, return_progress: true };
		return newPayload;
	});

	pi.on("session_shutdown", () => {
		log("[llama-cpp-tps] session_shutdown: clearing state");
		latestTimings.clear();
		lastTpsDisplay = null;

		globalThis.fetch = originalFetch;
	});

	log("[llama-cpp-tps] extension loaded successfully");
}
