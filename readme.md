# Local LLM for NixOS

Optimized for RX 6800XT / 7900X / 16GB of RAM
Runs QWEN 3.5 35B and OpenCode

![image](./image.png)

### Download QWEN 3.5 35B Unsloth Dynamic Q4 K-Quant Extra Large

Model: https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF 

First, download the model to `/models`:
```
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \
  unsloth/Qwen3.5-35B-A3B-GGUF \
  Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
  --local-dir ./models
```

### Run the LLM 

```
nix develop ~/path/to/this/repo/nix-llm
```

This starts a llama server on `:8001` and runs opencode pointing to that llama server

### Environment Variables

| Variable | Function |
| :--- | :--- |
| `HIP_VISIBLE_DEVICES=0` | Ignore iGPU of 7900X |
| `GPU_ENABLE_WGP_MODE=0` | Forces scheduling at individual Compute Unit level for more efficient math |
| `HSA_OVERRIDE_GFX_VERSION=10.3.0` | Treats 6800 XT like Radeon Pro V620 (same gfx1030 architecture) |

### Cleanup

The script handles graceful shutdown on Ctrl+C, killing the llama server and cleaning up GPU resources.


### What do the different inputs to `llama.cpp` mean?

| Flag | Function | Benefit for Setup |
| :--- | :--- | :--- |
| `-m` | **Model Path** | Loads the 22GB file directly from the file system. |
| `--ctx-size 16384` | **Context Window** | Sets short-term memory; uses ~2-4GB VRAM for 16k tokens. |
| `--n-gpu-layers 22` | **GPU Offload** | Offload 22 layers to GPU for faster inference. |
| `--ubatch-size 1024` | **Physical Batch** | Size of data chunks sent to GPU cores at once. |
| `--batch-size 1024` | **Logical Batch** | Max tokens processed in parallel during prompt ingestion. |
| `--flash-attn off` | **Flash Attention** | Disabled to prevent the `GGML_ASSERT` crash on ROCm/RDNA2. |
| `--mlock` | **Memory Locking** | Pins model to physical RAM to prevent SSD swap/wear. |
| `--threads` | **CPU Threads** | Uses all available CPU cores. |
| `--temp 0.6` | **Temperature** | Controls randomness of output. |
| `--top-p 0.95` | **Top-P** | Nucleus sampling threshold. |
| `--top-k 20` | **Top-K** | Limits sampling to top 20 tokens. |
| `--min-p 0.00` | **Min P** | Independent parameterization of tokens. |
| `--no-webui` | **No Web UI** | Disables web interface. |