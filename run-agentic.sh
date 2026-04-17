#!/usr/bin/env bash

export PI_VERSION="0.65.2"
export NPM_CONFIG_PREFIX="$(pwd)/.nix-node/v${PI_VERSION}"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
# Install pi if not already present at this versioned prefix.
if [ ! -f "$NPM_CONFIG_PREFIX/bin/pi" ]; then
    echo "📦 Installing pi-coding-agent @${PI_VERSION} locally to .nix-node..."
    # We use -g but because of the PREFIX above, it stays in this folder
    npm install -g @mariozechner/pi-coding-agent@${PI_VERSION}
fi

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env-setup.sh"

parse_args "$@" || exit 1

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

echo "🚀 Starting llama API Server (Router Mode) (AMD mode: $USE_AMD, Metal mode: $USE_METAL)"

# Run llama-server in Router Mode using the preset file for all models
llama-server $LLAMA_COMMON_ARGS --port 8080 --no-webui &> llama.log &
LLAMA_PID=$!

echo "⏳ Waiting for llama server (see llama.log)" 

until curl -s http://127.0.0.1:8080/health | grep -q 'ok'; do
    if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
        echo ""
        tail "llama.log" >&2 
        exit 1
    fi
    sleep 3
done

echo "🟢 llama server ready!"

# Tell the agent to use this repo's local config and session storage (everything in agent-config)
export PI_CODING_AGENT_DIR="$SCRIPT_DIR/agent-config"
pi

cleanup
