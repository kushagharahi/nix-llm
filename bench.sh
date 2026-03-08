#!/usr/bin/env bash 

# HIP_VISIBLE_DEVICES=0 GPU_ENABLE_WGP_MODE=0 \
# llama-bench \
#     -m ./models/Qwen3.5-27B-Q4_K_M.gguf \
#     --n-gpu-layers 26 \
#     --ubatch-size 128 \
#     --batch-size 128 \
#     --flash-attn off \
#     --threads 11


HIP_VISIBLE_DEVICES=0 GPU_ENABLE_WGP_MODE=0 HSA_OVERRIDE_GFX_VERSION=10.3.0 \
llama-bench \
    -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
    --n-gpu-layers 16 \
    --n-cpu-moe 20 \
    --ubatch-size 512 \
    --batch-size 512 \
    --flash-attn off \
    --threads 11

