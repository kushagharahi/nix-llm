#!/usr/bin/env bash

# MCP server management functions for nix-llm

# Global PIDs (exported so callers can track them)
DDG_MCP_PID=""      # DuckDuckGo MCP server PID
PLAYWRIGHT_MCP_PID=""  # Playwright MCP server PID

# Install required MCP Python packages into the project venv
install_mcp_packages() {
    local VENV_DIR="${1:-.venv}"

    echo "📦 Setting up MCP Python dependencies..."

    # 1. Ensure the venv exists
    if [ ! -d "$VENV_DIR" ]; then
        echo "Creating new virtual environment..."
        uv venv --python "$(which python3)"
    fi

    # 2. Check if DuckDuckGo MCP is already installed
    if ! "$VENV_DIR/bin/python" -c "import duckduckgo_mcp_server" &> /dev/null; then
        echo "Installing DuckDuckGo MCP server..."
        uv pip install \
            --python "$VENV_DIR/bin/python" \
            git+https://github.com/nickclyde/duckduckgo-mcp-server@72140a7136a52d51ec9fdccdd7ff504959d0a5cf
    else
        echo "DuckDuckGo MCP is already installed. Skipping install."
    fi
}

# Start the DuckDuckGo MCP server (streamable-http transport)
start_ddg_mcp() {
    local VENV_DIR="${1:-.venv}"

    echo "🚀 Starting DuckDuckGo MCP server..."
    # setsid runs each MCP server in a detached session with redirected stdio, keeping your console tidy. Now Ctrl+C only stops the main script, triggering a clean shutdown for everything at once.
    setsid "$VENV_DIR/bin/duckduckgo-mcp-server" --transport streamable-http </dev/null &>/dev/null &
    DDG_MCP_PID=$!

    echo "  DuckDuckGo MCP started (PID: $DDG_MCP_PID)"
}

# Start the Playwright MCP server via npx
start_playwright_mcp() {
    local CHROME_PATH="$(nix eval --raw nixpkgs#playwright-driver.browsers.outPath)/chromium-1194/chrome-linux/chrome"

    echo "🚀 Starting Playwright MCP server..."
    # setsid runs each MCP server in a detached session with redirected stdio, keeping your console tidy. Now Ctrl+C only stops the main script, triggering a clean shutdown for everything at once.
    setsid npx @playwright/mcp@v0.0.70 --port 8931 --executable-path "$CHROME_PATH" </dev/null &>/dev/null &
    PLAYWRIGHT_MCP_PID=$!

    echo "  Playwright MCP started (PID: $PLAYWRIGHT_MCP_PID)"
}

# Start all configured MCP servers
start_all_mcp_servers() {
    local VENV_DIR="${1:-.venv}"

    install_mcp_packages "$VENV_DIR"
    start_ddg_mcp "$VENV_DIR"
    start_playwright_mcp

    echo "✅ All MCP servers started."
}

# Stop all running MCP servers (safe: no-ops if PIDs are unset)
stop_all_mcp_servers() {
    [ -n "$DDG_MCP_PID" ] && kill "$DDG_MCP_PID" 2>/dev/null && echo "🛑 Stopped DuckDuckGo MCP (PID: $DDG_MCP_PID)"
    [ -n "$PLAYWRIGHT_MCP_PID" ] && kill "$PLAYWRIGHT_MCP_PID" 2>/dev/null && echo "🛑 Stopped Playwright MCP (PID: $PLAYWRIGHT_MCP_PID)"
}
