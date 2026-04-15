#!/usr/bin/env bash 

# Function to parse arguments and set up common variables
parse_args() {
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 <2b|26b|35b|27b> [--amd] [--metal]" >&2
        return 1
    fi

    MODEL_ARG=$1
    USE_AMD=false
    USE_METAL=false

    if [[ "$2" == "--amd" ]]; then
        USE_AMD=true
    elif [[ "$2" == "--metal" ]]; then
        USE_METAL=true
    fi
}
# Function to load model configuration
load_model_config() {
    case "$MODEL_ARG" in
        2b)
            MODEL="./models/gemma-4-E2B-it-Q4_K_M.gguf"
            LLAMA_ARGS=(
                --ctx-size 4096 \
                --fit-target 512 \
                --flash-attn on \
                --cache-type-k q4_0 \
                --cache-type-v q4_0 \
                --parallel 1 \
                --temp 0.3 \
                --top-k 64 \
                --top-p 0.95 \
                --frequency-penalty 1.0 \
                --repeat-penalty 1.1 \
            )
            DESC="(Gemma 4 E2B)"
            ;;
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
            return 1
            ;;
    esac

    # Set environment variables based on GPU mode if USE_AMD is set (passed from caller)
    if [[ "$USE_AMD" == true ]]; then
        export GPU_ENABLE_WGP_MODE=0
        export HIP_VISIBLE_DEVICES=0
    elif [[ "$USE_METAL" == false ]]; then
        export AMD_VULKAN_ICD=RADV
    fi
}