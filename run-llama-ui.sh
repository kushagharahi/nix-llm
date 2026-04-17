#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/env-setup.sh"
source "$SCRIPT_DIR/mcp.sh"

parse_args "$@" || exit 1

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

    # Kill all MCP servers via shared helper
    stop_all_mcp_servers

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

# Start all MCP servers (installs deps, starts DDG + Playwright)
start_all_mcp_servers

# Determine address based on firewall
if [[ "$OPEN_FIREWALL" = true ]]; then
    ADDR=$(hostname -I | awk '{print $1}')
else
    ADDR="0.0.0.0"
fi

echo "🚀 Starting llama API Server (Router Mode) on http://$ADDR:$PORT (AMD mode: $USE_AMD, Metal mode: $USE_METAL)"

# Run llama-server in Router Mode using the preset file for all models
llama-server $LLAMA_COMMON_ARGS --host $ADDR --port $PORT --webui-mcp-proxy --webui-config-file ./uiConfig.json &

LLAMA_PID=$!

wait $LLAMA_PID