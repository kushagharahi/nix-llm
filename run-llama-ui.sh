#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Usage check
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <26b|35b|27b> [--amd]" >&2
    exit 1
fi

MODEL_ARG=$1
USE_AMD=false

if [[ "$2" == "--amd" ]]; then
    USE_AMD=true
fi

# Configuration mapping: model -> {model_path, llama_args, pi_model, pi_json, desc}
case "$MODEL_ARG" in
    26b)
        MODEL="./models/gemma-4-26B-A4B-it-Q8_0.gguf"
        LLAMA_ARGS=(
            --ctx-size 262144 \
            --fit-target 512 \
            --flash-attn on \
            --cache-type-k q8_0 \
            --cache-type-v q8_0 \
            --threads 11 \
            --parallel 1 \
            --temp 0.3 \
            --top-k 64 \
            --top-p 0.95 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1 \
            --chat-template-file ./chat-template-26b-4b.jinja 
        )
        PI_MODEL="llama-local/gemma4-26b-4b"
        PI_JSON="./models-26b-4b.json"
        DESC="(Gemma 4 26B)"
        ;;
    35b)
        MODEL="./models/Qwen3.5-35B-A3B-Q8_0.gguf"
        LLAMA_ARGS=(
            --ctx-size 262144 \
            --mlock \
            --fit-target 512 \
            --flash-attn on \
            --cache-type-k q8_0 \
            --cache-type-v q8_0 \
            --threads 11 \
            --parallel 1 \
            --temp 0.6 \
            --top-k 20 \
            --top-p 0.95 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1
        )
        PI_MODEL="llama-local/qwen3.5-35b-3b"
        PI_JSON="./models-35b-3b.json"
        DESC="(Qwen 3.5 35B)"
        ;;
    27b)
        MODEL="./models/Qwen3.5-27B-Q4_K_M.gguf"
        LLAMA_ARGS=(
            --ctx-size 65536 \
            --mlock \
            --fit-target 512 \
            --flash-attn on \
            --cache-type-k q8_0 \
            --cache-type-v q8_0 \
            --threads 11 \
            --parallel 1 \
            --temp 0.6 \
            --top-k 20 \
            --top-p 0.95 \
            --frequency-penalty 1.0 \
            --repeat-penalty 1.1
        )
        PI_MODEL="llama-local/qwen3.5-27b"
        PI_JSON="./models-27b.json"
        DESC="(Qwen 3.5 27B)"
        ;;
    *)
        echo "Unknown model: $MODEL_ARG" >&2
        exit 1
        ;;
esac

echo "🚀 Starting $DESC API Server on http://127.0.0.1:8001 (AMD mode: $USE_AMD)"

# Set environment variables based on GPU mode
if [ "$USE_AMD" = true ]; then
    export GPU_ENABLE_WGP_MODE=0
    export HIP_VISIBLE_DEVICES=0
else
    export AMD_VULKAN_ICD=RADV
fi

# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --host 0.0.0.0 --port 8001 