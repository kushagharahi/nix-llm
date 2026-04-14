#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"


parse_args "$@" || exit 1
load_model_config || exit 1

cleanup_firewall() {
    echo "🔒 Closing port 8001..."
    sudo iptables -D INPUT -p tcp --dport 8001 -j ACCEPT 2>/dev/null
}

# Firewall management section (requires sudo)
read -p "⚠️  Open port 8001 in the firewall to access llama-ui remotely? (y/N, requires sudo): " confirm_firewall
if [[ $confirm_firewall =~ ^[Yy]$ ]]; then
    if ! sudo iptables -C INPUT -p tcp --dport 8001 -j ACCEPT 2>/dev/null; then
        echo "🔓 Opening port 8001 in iptables..."
        sudo iptables -I INPUT -p tcp --dport 8001 -j ACCEPT
        # Set a trap to remove the rule when the script exits or is interrupted
        trap cleanup_firewall EXIT INT TERM
        echo "🔓 Port 8001 open."
    else
        # Set a trap to remove the rule when the script exits or is interrupted
        trap cleanup_firewall EXIT INT TERM
        echo "Port 8001 is already open in iptables. (it probably shouldn't be). It will get closed on exit."
    fi
else
    echo "⏭️  Skipping firewall management. Note: You may not be able to access the server remotely if port 8001 is blocked."
fi

# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
echo "🚀 Starting $DESC API Server on http://0.0.0.0:8001 (AMD mode: $USE_AMD)"
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --host 0.0.0.0 --port 8001 