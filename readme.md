# Local LLM for NixOS

Optimized for **AMD RX 6800XT / Ryzen 7900X** with 32GB RAM.

![image](./image.png)

## 🚀 Quick Start

### Agentic workflows 
To start the LLM server and the Pi agent:
```bash
nix-develop .#agentic
```
This starts a `llama-server` on `http://127.0.0.1:8001` and launches the `pi.dev` TUI pointing to it.

### llama.cpp chat interface 
```bash
nix-develop .#ui
```
This starts a `llama-server` on `http://0.0.0.0:8001`

---

## 📥 Model Installation

Download models into the `./models` directory using `huggingface-cli`.

### Gemma 4 26B (MoE)
*Active parameters: ~4B. High speed, efficient reasoning.*
```bash
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \
  unsloth/gemma-4-26B-A4B-it-GGUF \
  gemma-4-26B-A4B-it-Q8_0.gguf \
  --local-dir ./models
```

### Qwen 3.5 35B (MoE)
*Active parameters: ~3B. Extremely fast Mixture of Experts model.*
[Hugging Face Link](https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF)
```bash
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \
  unsloth/Qwen3.5-35B-A3B-GGUF \
  Qwen3.5-35B-A3B-Q8_0.gguf \
  --local-dir ./models
```

### Qwen 3.5 27B (Dense)
*Full parameter computation for consistent depth and reasoning.*
[Hugging Face Link](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF)
```bash
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \
  unsloth/Qwen3.5-27B-GGUF \
  Qwen3.5-27B-Q4_K_M.gguf \
  --local-dir ./models
```

---

## ⚙️ Hardware Optimization (AMD GPU)

These environment variables are configured in `run.sh` to optimize performance on RDNA2 architectures:

| Variable | Purpose | Benefit |
| :--- | :--- | :--- |
| `HIP_VISIBLE_DEVICES=0` | Selects discrete GPU only, ignores iGPU of 7900X (Ryzen integrated graphics) on RX 6800 XT with 16GB VRAM to avoid resource conflicts and ensure full memory available for model weights. | Prevents resource conflicts and ensures full memory availability. |
| `GPU_ENABLE_WGP_MODE=0` | Forces scheduling at individual Compute Unit level rather than Workgroup Processors, more efficient math utilization on RDNA2 architecture (RX 6800 XT). Enables better GPU layer distribution across 16GB VRAM. | Improved math utilization and layer distribution. |
| `AMD_VULKAN_ICD=RADV` | Uses RADV Vulkan ICD instead of AMDs proprietary ICD, better compatibility with llama.cpp on Linux | Better compatibility/performance with `llama.cpp`. |

---

## 🛠️ Implementation Details (`run.sh`)

The following core optimizations are applied to all models:

| Flag | Description | Optimization Goal |
| :--- | :--- | :--- |
| `--flash-attn on` | Enables Flash Attention. | Faster inference and reduced memory overhead. |
| `--mlock` | Locks model in RAM. | Prevents OS swapping; ensures consistent latency. |
| `--cache-type-k/v q8_0`*| Quantized KV Cache. | Significantly reduces VRAM usage for large contexts ($*$varies by model). |
| `--threads 11` | Fixed CPU thread count. | Optimized for the host's physical core architecture. |
| `--no-webui` | Disables Web UI. | Minimizes overhead, focusing resources on the API and Agent. |
