#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"


parse_args "$@" || exit 1
load_model_config || exit 1
PORT="8080"

# Graceful shutdown 
cleanup() {
    # Kill the trap to prevent double-execution
    trap - EXIT INT TERM

    # Remove firewall rule if added
    if [[ "$OPEN_FIREWALL" = true ]]; then
        echo "🔒 Closing port $PORT..."
        sudo iptables -D INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null
    fi

    [ -n "$MCP_PID" ] && kill $DDGMCP_PID 2>/dev/null

    # Kill the llama server specifically  
    [ -n "$LLAMA_PID" ] && kill $LLAMA_PID 2>/dev/null

    exit 0
}
# Trap exit signals (Ctrl+C, script end, etc.)
trap cleanup EXIT INT TERM


# Firewall management section (requires sudo)
read -p "⚠️  Open port $PORT in the firewall to access llama-ui remotely? (y/N, requires sudo): " confirm_firewall
if [[ $confirm_firewall =~ ^[Yy]$ ]]; then
    OPEN_FIREWALL=true
else
    OPEN_FIREWALL=false
fi

if [[ "$OPEN_FIREWALL" = true ]]; then
    if ! sudo iptables -C INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null; then
        echo "🔓 Opening port $PORT in iptables..."
        sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT
        echo "🔓 Port $PORT open."
    else
        echo "Port $PORT is already open in iptables. (it probably shouldn't be). It will get closed on exit."
    fi
else
    echo "⏭️  Skipping firewall management. Note: You may not be able to access the server remotely if port $PORT is blocked."
fi

# 1. Ensure the venv exists
if [ ! -d ".venv" ]; then
    echo "Creating new virtual environment..."
    uv venv --python $(which python3)
fi

# 2. Check if the package is already installed
# We check for the folder in site-packages to be sure
if ! ./.venv/bin/python -c "import duckduckgo_mcp_server" &> /dev/null; then
    echo "Package not found. Installing..."
    uv pip install --break-system-packages \
        --no-cache \
        git+https://github.com/nickclyde/duckduckgo-mcp-server@72140a7136a52d51ec9fdccdd7ff504959d0a5cf
else
    echo "DuckDuckGo MCP is already installed. Skipping install."
fi
./.venv/bin/duckduckgo-mcp-server --transport streamable-http &
MCP_PID=$!


# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
if [[ "$OPEN_FIREWALL" = true ]]; then
    ADDR=$(hostname -I | awk '{print $1}')
else
    ADDR="0.0.0.0"
fi

# TODO: Make image gen optional
if [[ "$MODEL_ARG" = "26b" ]]; then 
    MMPROJ_PATH="./models/mmproj-BF16.gguf"
    # Check if the multimodal projection file actually exists
    if [[ -f "$MMPROJ_PATH" ]]; then
        LLAMA_ARGS+=(
            --mmproj .$MMPROJ_PATH \
            --image-min-tokens 300 \
            --image-max-tokens 512
        )
    else
        echo "⚠️ Warning: Model is set to '26b', but '$MMPROJ_PATH' was not found. Image generation will be disabled."
    fi
fi

echo "🚀 Starting $DESC API Server on http://$ADDR:$PORT (AMD mode: $USE_AMD)"
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --host $ADDR --port $PORT --webui-mcp-proxy --webui-config-file ./uiConfig.json

cleanup