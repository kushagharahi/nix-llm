#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Usage check
if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <35b|27b>" >&2
    exit 1
fi

case "$1" in
    26b)
        echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001 (35B model)"

        AMD_VULKAN_ICD=RADV \
        llama-server \
            -m ./models/gemma-4-26B-A4B-it-UD-Q5_K_M.gguf \
            --ctx-size 262144 \
            --fit-target 512 \
            --flash-attn on \
            --cache-type-k q5_1 \
            --cache-type-v q5_1 \
            --threads 11 \
            --parallel 1 \
            --temp 1.0 \
            --top-k 64 \
            --top-p 0.95 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1 \
            --no-webui \
            --host 127.0.0.1 \
            --port 8001 &> llama.log &

        ;;

    35b)
        echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001 (35B model)"

        AMD_VULKAN_ICD=RADV \
        llama-server \
            -m ./models/Qwen3.5-35B-A3B-Q8_0.gguf \
            --ctx-size 262144 \
            --n-gpu-layers 99 \
            --n-cpu-moe 40 \
            --ubatch-size 2048 \
            --flash-attn on \
            --cache-type-k q8_0 \
            --cache-type-v q8_0 \
            --threads 11 \
            --parallel 1 \
            --temp 0.6 \
            --top-k 20 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1 \
            --no-webui \
            --host 127.0.0.1 \
            --port 8001 &> llama.log &

        ;;

    27b)
        echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001 (27B model)"

        AMD_VULKAN_ICD=RADV \
        llama-server \
            -m ./models/Qwen3.5-27B-Q4_K_M.gguf \
            --ctx-size 65536 \
            --n-gpu-layers 50 \
            --batch-size 512 \
            --flash-attn on \
            --cache-type-k q8_0 \
            --cache-type-v q8_0 \
            --threads 11 \
            --parallel 1 \
            --temp 0.6 \
            --top-k 20 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1 \
            --no-webui \
            --host 127.0.0.1 \
            --port 8001 &> llama.log &

        ;;

    *)
        echo "Unknown model: $1" >&2
        exit 1
        ;;
esac

LLAMA_PID=$!

echo "⏳ Waiting for llama server (see llama.log)" 


until curl -s http://127.0.0.1:8001/health | grep -q 'ok'; do
    # Exit loop if process died, print error and exit script  
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
        echo ""
        tail "llama.log" >&2 
        exit 1
    fi
    
    sleep 3
done

echo "🟢 llama server ready!"

# --- Pi Config (Pointing to Localhost) ---
mkdir -p ~/.pi/agent

case "$1" in
    26b)
        cp ./models-26b-4b.json ~/.pi/agent/models.json
        pi --model llama-local/gemma4-26b-4b
        ;;
    35b)
        cp ./models-35b-3b.json ~/.pi/agent/models.json
        pi --model llama-local/qwen3.5-35b-3b
        ;;
    27b)
        cp ./models-27b.json ~/.pi/agent/models.json
        pi --model llama-local/qwen3.5-27b
        ;;
esac

cleanup
