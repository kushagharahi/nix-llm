#!/usr/bin/env bash

# Graceful shutdown
cleanup() {
    # Kill the trap to prevent double-execution
    trap - EXIT INT TERM

    echo -e "\n\n🛑 Pi closed. Cleaning up GPU resources..."
    # Kill the llama server specifically  
    [ -n "$LLAMA_PID" ] && kill $LLAMA_PID 2>/dev/null
    exit 0
}
# Trap exit signals (Ctrl+C, script end, etc.)
trap cleanup INT EXIT TERM

echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001"

AMD_VULKAN_ICD=RADV \
llama-server \
    -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
    --ctx-size 65536 \
    --n-gpu-layers 25 \
    --n-cpu-moe 20 \

    --batch-size 512 \
    --threads 11 \
    --flash-attn 1 \
    --cache-type-k q8_0 \
    --cache-type-v q8_0 \
    --parallel 1 \
    --fit-target 1024 \
    --temp 0.6 \
    --top-k 20 \
    --frequency-penalty 1.0 \
    --repeat-penalty 1.1 \
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

# --- Pi Config (Pointing to Localhost) ---
mkdir -p ~/.pi/agent
cp ./models-35b-3b.json ~/.pi/agent/models.json
pi --model llama-local/qwen3.5-35b-3b

cleanup