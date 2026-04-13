#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"

#!/usr/bin/env bash 

# Get the directory where run.sh is located 
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/llama-common.sh"

parse_args "$@" || exit 1
load_model_config || exit 1

# Run llama-server. Using "${LLAMA_ARGS[@]}" preserves individual arguments.
echo "🚀 Starting $DESC API Server on http://0.0.0.0:8001 (AMD mode: $USE_AMD)"
llama-server -m "$MODEL" "${LLAMA_ARGS[@]}" --host 0.0.0.0 --port 8001 