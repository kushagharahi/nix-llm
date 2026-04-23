/**
 * Extension: Auto-discover models from llama.cpp router server.
 * 
 * Replaces the "models" array in models.json. The user only needs to specify
 * baseUrl and api at the provider level - the extension queries /v1/models for
 * the list, then /props?model=<name> for each to get runtime config,
 * and registers them.
 * 
 * Minimal models.json:
 * {
 *   "providers": {
 *     "llama-cpp": {
 *       "baseUrl": "http://127.0.0.1:8080",
 *       "api": "openai-completions"
 *     }
 *   }
 * }
 */

import type {
	Api,
	ExtensionContext,
	ExtensionAPI,
	Model,
	ProviderModelConfig,
	ProviderConfigInput
} from "@mariozechner/pi-coding-agent";
import fs from "node:fs";

const LOG_FILE = "/tmp/llama-cpp-auto.log";
const DEBUG = process.env.LLAMA_CPP_EXTENSION_DEBUG === "1";
function log(...args: any[]) {
	if (!DEBUG) return;
	fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] [llama-cpp-auto] ${args.join(" ")}\n`);
}

const PROVIDER = "llama-cpp"
const MODEL_ID = "llama-cpp-discover"

interface modelStatus {
	value: string;
	args: string[];
	preset: string;
}

interface modelData {
	id: string;
	aliases: string[];
	tags: string[];
	object: string;
	owned_by: string;
	created: number; // Unix timestamp
	status: modelStatus;
}

interface llamaCppModels {
	data: modelData[];
	object: "list";
}

/** 
 * A generic utility to convert a flat array of CLI-style arguments 
 * into a searchable key-value dictionary.
 */
function parseArgsToMap(args: string[]): Record<string, string> {
	const map: Record<string, string> = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Check if the item is a flag (starts with --)
		if (arg.startsWith("--")) {
			const key = arg.replace(/^--/, ""); // Remove the '--' prefix
			const nextValue = args[i + 1];

			// If the next element exists and isn't another flag, it's our value
			if (nextValue !== undefined && !nextValue.startsWith("--")) {
				map[key] = nextValue;
				i++; // Skip the next index because we just consumed it as a value
			} else {
				// It's a boolean flag (e.g., "--flash-attn") with no explicit value provided
				map[key] = "true";
			}
		}
	}

	return map;
}

/** 
 * Helper: Converts kebab-case ID into Title Case name.
 */
function formatModelName(id: string): string {
	return id.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** 
 * Main Transformation Function 
 */
function transformLlamaCppModels(input: llamaCppModels): ProviderModelConfig.models[] {
	return input.data.map((model) => {
		// Use the generic parser once per model
		const args = parseArgsToMap(model.status.args);

		return {
			id: model.id,
			name: formatModelName(model.id),
			// Access values from the map using their flag names (without --)
			contextWindow: args["ctx-size"] ? parseInt(args["ctx-size"], 10) : 0,
			maxTokens: (args["n_predict"] || args["ctx-size"])
				? parseInt(args["n_predict"] || args["ctx-size"], 10)
				: 0,

			// reasoning not set because llama.cpp defines this
			// input, cost, compat not supported at this time
		};
	});
}

export default function (pi: ExtensionAPI) {
	let currentCtx: ExtensionContext | undefined;

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		discoverAndRegister();
	});

	async function discoverAndRegister(): Promise<void> {
		try {
			let registeredModels: Model<Api>[] = currentCtx.modelRegistry.getAvailable()
			log("registered models", JSON.stringify(registeredModels))

			let llamaProvider = registeredModels.filter(m => m.provider == PROVIDER && m.id == MODEL_ID)

			if (llamaProvider.length != 1) {
				throw new Error(`Found ${llamaProvider.length} llama-cpp providers/models. Only one should be specified in the shape of:
{
	"providers": {
		"${PROVIDER}": { <--- key
		"baseUrl": "http://127.0.0.1:8080",
		"api": "openai-completions",
		"apiKey": "local",
		"models": [
			{
			"id": "${MODEL_ID}" <--- key
			}
		]
		}
	}
}`)
			}

			const url = `${llamaProvider[0].baseUrl}/models`;
			log(`Querying ${url}`);

			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const llamaCppModels: llamaCppModels = await response.json();
			if (!llamaCppModels.data || !Array.isArray(llamaCppModels.data)) {
				throw new Error("Invalid response format from llama.cpp server");
			}

			if (llamaCppModels.data.length === 0) {
				log(`Server returned no models`);
				return;
			}

			log(`Got models from llama-cpp: ${JSON.stringify(llamaCppModels)}`)

			let autoDiscoveredModels = transformLlamaCppModels(llamaCppModels)
			log(`autoDiscoveredModels ${JSON.stringify(autoDiscoveredModels)}`)

			let apiKeyAndHeaders = await currentCtx.modelRegistry.getApiKeyAndHeaders({ provider: PROVIDER, id: MODEL_ID })

			let updatedProvider: ProviderConfigInput = {
				baseUrl: llamaProvider[0]?.baseUrl,
				apiKey: apiKeyAndHeaders?.apiKey,
				api: llamaProvider[0]?.api,
				headers: apiKeyAndHeaders?.headers,
				// //AUTHHEADER NOT SUPPORTED
				// //OAUTH NOT SUPPORTED
				models: autoDiscoveredModels
			}

			pi.registerProvider(PROVIDER, updatedProvider)

		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`Failed to discover models: ${msg}`);
		}
	}
}
