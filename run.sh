#!/usr/bin/env bash

# Graceful shutdown
cleanup() {
    # Kill the trap to prevent double-execution
    trap - EXIT INT TERM

    echo -e "\n\n🛑 OpenCode closed. Cleaning up GPU resources..."
    # Kill the llama server specifically
    [ -n "$LLAMA_PID" ] && kill $LLAMA_PID 2>/dev/null
    exit 0
}
# Trap exit signals (Ctrl+C, script end, etc.)
trap cleanup INT EXIT TERM

echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001"
    # HIP_VISIBLE_DEVICES=0 -- Ignore iGPU of 7900x
    # GPU_ENABLE_WGP_MODE=0 -- On RDNA2, compute units are grouped into "Workgroup Processors." Disabling this forces the compiler to schedule tasks at the individual Compute Unit (CU) level. For LLMs, this usually results in more granular, efficient math.
    # HSA_OVERRIDE_GFX_VERSION=10.3.0 -- Tell the driver to treat 6800 XT like a professional Radeon Pro V620, which uses the same gfx1030 architecture.
HIP_VISIBLE_DEVICES=0 GPU_ENABLE_WGP_MODE=0 HSA_OVERRIDE_GFX_VERSION=10.3.0 \
llama-server \
    -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
    --ctx-size 16384 \
    --n-gpu-layers 22 \
    --n-cpu-moe 18 \
    --ubatch-size 512 \
    --batch-size 512 \
    --flash-attn off \
    --parallel 1 \
    --fit-target 1024 \
    --mlock \
    --threads 11 \
    --temp 0.6 \
    --top-p 0.95 \
    --top-k 20 \
    --min-p 0.00 \
    --presence_penalty 0.0 \
    --frequency_penalty 1.0 \
    --repeat_penalty 1.1 \
    --no-webui \
    --host 127.0.0.1 \
    --port 8001 &> llama.log &
LLAMA_PID=$!

echo -n "⏳ Waiting for llama server (see llama.log)"
until curl -s http://127.0.0.1:8001/health | grep -q 'ok'; do
    echo -n "."
    sleep 1
done
echo -e "\n🟢 llama server ready!"

# --- OpenCode Config (Pointing to Localhost) ---
export OPENCODE_CONFIG_CONTENT=$(cat ./opencode.json)
opencode --model llama-local/qwen3.5-35b

cleanup