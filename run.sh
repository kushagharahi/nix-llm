#!/usr/bin/env bash

# Tell the driver to treat 6800 XT like a professional Radeon Pro V620, which uses the same gfx1030 architecture.
export HSA_OVERRIDE_GFX_VERSION=10.3.0

# Optimization: On RDNA2, compute units are grouped into "Workgroup Processors." Disabling this forces the compiler to schedule tasks at the individual Compute Unit (CU) level. For LLMs, this usually results in more granular, efficient math.
export GPU_ENABLE_WGP_MODE=0

# Ignore iGPU of 7900x
export HIP_VISIBLE_DEVICES=0

echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001"

llama-server \
    -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
    --ctx-size 16384 \
    --n-gpu-layers 20 \
    --ubatch-size 1024 \
    --batch-size 1024 \
    --flash-attn off \
    --mlock \
    --threads 12 \
    --host 127.0.0.1 \
    --port 8001 > llama.log 2>&1 &

echo -n "⏳ Waiting for llama server (see llama.log)"
until curl -s http://127.0.0.1:8001/health | grep -q 'ok'; do
    echo -n "."
    sleep 2
done
echo -e "\n🟢 llama server ready!"

# --- OpenCode Config (Pointing to Localhost) ---
export OPENCODE_CONFIG_CONTENT=$(cat ./opencode.json)
opencode --model llama-local/qwen3.5-35b