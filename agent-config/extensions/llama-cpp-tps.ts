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
	//if (!DEBUG) return;
	fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [llama-cpp-tps] ${args.join(" ")}\n`);
}

const downArrow = "↓";
const upArrow = "↑";

interface LlamaCppTimings {
	predicted_n?: number;
	predicted_ms?: number;
	predicted_per_second?: number;
	prompt_n?: number;
	prompt_ms?: number;
	prompt_per_second?: number;
}

// Progress tracking
interface ProgressData {
	total?: number;
	cache?: number;
	processed?: number;
	time_ms?: number;
	pct?: number;
}

// Store latest timing data per model
const latestTimings = new Map<string, LlamaCppTimings>();
let lastTpsDisplay: string | null = null;

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
	if (!ms || ms <= 0)
		return "";
	if (ms < 1000)
		return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

// ─── Save original openai-completions streamSimple BEFORE we override it ───
const originalOpenAIStreamSimple = getApiProvider("openai-completions")?.streamSimple;
log("Original openai-completions streamSimple:", originalOpenAIStreamSimple ? "found" : "NOT FOUND");

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
							log("TIMINGS captured:", JSON.stringify(chunk.timings));
						}
						if (chunk.prompt_progress) {
							latestProgress = chunk.prompt_progress;
							const prog = chunk.prompt_progress;

							pctProgress = prog.total && prog.total > 0
								? Math.round(((prog.processed - (prog.cache ?? 0)) / (prog.total - (prog.cache ?? 0))) * 100)
								: Math.round((prog.processed / prog.total) * 100);
							latestProgress.pct = pctProgress;

							log("PROGRESS:", prog.processed, "/", prog.total, "cache:", prog.cache ?? 0, "pct:", pctProgress + "%");
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

// ─── Extension Entry Point ─────────────────────
export default function (pi: ExtensionAPI) {
	log("Current registered providers:", Array.from(pi.events.listeners ? [] : []).join(", "));

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


	pi.on("message_update", (event, ctx) => {
		updateProgressDisplay(ctx);
	});

	// This is more reliable than message_end because by the time it fires,
	// all SSE chunks have been fully consumed and timings are captured.
	pi.on("turn_end", (event, ctx) => {
		log("turn_end fired - hasUI:", ctx.hasUI);
		latestProgress = undefined;
		pctProgress = undefined;
		lastProgressDisplay.value = "";

		const keys = Array.from(latestTimings.keys());
		if (keys.length === 0) {
			log("turn_end - no timings, nothing to display");
			return;
		}

		const latestModelId = keys[keys.length - 1];
		const timings = latestTimings.get(latestModelId);

		if (!timings || !timings.predicted_per_second) {
			log("turn_end - no valid timings for", latestModelId);
			return;
		}

		const display = formatTps(timings);

		if (display && ctx.hasUI) {
			if (display !== lastTpsDisplay) {
				lastTpsDisplay = display;
				ctx.ui.setStatus("llama-cpp-tps", display);
				ctx.ui.notify(`TPS: ${display}`);
				log("turn_end - Set status:", display);
			}
		}

	});

	pi.on("turn_start", (event, ctx) => {
		turnCtx = ctx;
		log("turn_start fired, hasUI:", ctx.hasUI);
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload as Record<string, unknown> | undefined;
		if (!payload || typeof payload !== "object") return;
		log("before_provider_request: adding timings_per_token + return_progress to payload");
		const newPayload: any = { ...payload, timings_per_token: true, return_progress: true };
		return newPayload;
	});

	pi.on("session_shutdown", () => {
		log("session_shutdown: clearing state");
		latestTimings.clear();
		lastTpsDisplay = null;

		globalThis.fetch = originalFetch;
	});

	log("extension loaded successfully");
}
