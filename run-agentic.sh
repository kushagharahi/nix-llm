#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"

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
trap cleanup EXIT INT TERM

# Usage check
parse_args "$@" || exit 1
load_model_config || exit 1

PORT="8080"
echo "🚀 Starting $DESC API Server on http://127.0.0.1:$PORT (AMD mode: $USE_AMD)"

# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --no-webui --port $PORT &> llama.log &
LLAMA_PID=$!

echo "⏳ Waiting for llama server (see llama.log)" 

until curl -s http://127.0.0.1:$PORT/health | grep -q 'ok'; do
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
        echo ""
        tail "llama.log" >&2 
        exit 1
    fi
    sleep 3
done

echo "🟢 llama server ready!"

mkdir -p ~/.pi/agent
cp "$PI_JSON" ~/.pi/agent/models.json
pi --model "$PI_MODEL"

cleanup
