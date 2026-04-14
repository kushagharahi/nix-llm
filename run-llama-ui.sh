#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"


parse_args "$@" || exit 1
load_model_config || exit 1

# Graceful shutdown 
cleanup() {
    # Kill the trap to prevent double-execution
    trap - EXIT INT TERM

    # Remove firewall rule if added
    if [[ "$OPEN_FIREWALL" = true ]]; then
        echo "🔒 Closing port 8001..."
        sudo iptables -D INPUT -p tcp --dport 8001 -j ACCEPT 2>/dev/null
    fi

    # Kill the llama server specifically  
    [ -n "$LLAMA_PID" ] && kill $LLAMA_PID 2>/dev/null
    exit 0
}
# Trap exit signals (Ctrl+C, script end, etc.)
trap cleanup EXIT INT TERM


# Firewall management section (requires sudo)
read -p "⚠️  Open port 8001 in the firewall to access llama-ui remotely? (y/N, requires sudo): " confirm_firewall
if [[ $confirm_firewall =~ ^[Yy]$ ]]; then
    OPEN_FIREWALL=true
else
    OPEN_FIREWALL=false
fi

if [[ "$OPEN_FIREWALL" = true ]]; then
    if ! sudo iptables -C INPUT -p tcp --dport 8001 -j ACCEPT 2>/dev/null; then
        echo "🔓 Opening port 8001 in iptables..."
        sudo iptables -I INPUT -p tcp --dport 8001 -j ACCEPT
        echo "🔓 Port 8001 open."
    else
        echo "Port 8001 is already open in iptables. (it probably shouldn't be). It will get closed on exit."
    fi
else
    echo "⏭️  Skipping firewall management. Note: You may not be able to access the server remotely if port 8001 is blocked."
fi


# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
if [[ "$OPEN_FIREWALL" = true ]]; then
    ADDR=$(hostname -I | awk '{print $1}')
else
    ADDR="0.0.0.0"
fi

echo "🚀 Starting $DESC API Server on http://$ADDR:8001 (AMD mode: $USE_AMD)"
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --host $ADDR --port 8001 & 
LLAMA_PID=$!

wait