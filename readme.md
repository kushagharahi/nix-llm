# Local LLM with Nix Flakes

Optimized for **AMD RX 6800XT / Ryzen 7900X** with 32GB RAM.

![image](./image.png)

## 🚀 Quick Start - Linux

### Agentic workflows 
To start the LLM server and the Pi agent:
```bash
nix-develop .#agentic
```
This starts a `llama-server` on `http://127.0.0.1:8080` and launches the `pi.dev` TUI pointing to it.

### llama.cpp chat interface 
```bash
nix-develop .#ui
```
This starts a `llama.cpp` UI on `http://0.0.0.0:8080` or `http://<local_ipv4>:8080`

Additionally it runs 
- [DuckDuckGo-mcp-server](https://github.com/nickclyde/duckduckgo-mcp-server/)
- [Playwright-mcp](https://github.com/microsoft/playwright-mcp)

---

## Model Installation

Download models into organized subdirectories within `./models/`. This structure allows `llama-server` to automatically discover models when using `--models-dir ./models --models-preset models.ini`.

### Gemma 4 26B-4B (MoE)
*Active parameters: ~4B. High speed, efficient reasoning.*
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/gemma-4-26B-A4B-it-GGUF \
  gemma-4-26B-A4B-it-Q8_0.gguf \
  --local-dir ./models/gemma-4-26b
```

#### multimedia projector aka image gen additional download
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/gemma-4-26B-A4B-it-GGUF \
  mmproj-BF16.gguf \
  --local-dir ./models/gemma-4-26b/multimodal
```

### Qwen 3.6 35B-A3B (MoE)
#### We choose Q6_K_XL quant because it's the best quant according to unsloth's benchmarks. We can do Q8_0 if we wanted but it'll take up more space
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/Qwen3.6-35B-A3B-GGUF \
   Qwen3.6-35B-A3B-UD-Q6_K_XL.gguf \
  --local-dir ./models/qwen3.6-35b
```

#### multimedia projector aka image gen additional download
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/Qwen3.6-35B-A3B-GGUF \
  mmproj-BF16.gguf \
  --local-dir ./models/qwen3.6-35b
```

### Qwen 3.5 35B-A3B (MoE)
*Active parameters: ~3B. Extremely fast Mixture of Experts model.*
[Hugging Face Link](https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF)
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/Qwen3.5-35B-A3B-GGUF \
  Qwen3.5-35B-A3B-Q5_K_M.gguf \
  --local-dir ./models/qwen3.5-35b
```

### Qwen 3.6 27B (Dense)
*Full parameter computation for consistent depth and reasoning.*
[Hugging Face Link](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF)
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/Qwen3.6-27B-GGUF \
  Qwen3.6-27B-Q4_K_S.gguf \
  --local-dir ./models/qwen3.6-27b
```

### Qwen 3.5 27B (Dense)
*Full parameter computation for consistent depth and reasoning.*
[Hugging Face Link](https://huggingface.co/unsloth/Qwen3.5-27B-GGUF)
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/Qwen3.5-27B-GGUF \
  Qwen3.5-27B-Q4_K_M.gguf \
  --local-dir ./models/qwen3.5-27b
```

---

## Hardware Optimizations (AMD GPU)

To maximize performance on **AMD RDNA2** hardware, these configurations are applied via `llama-common.sh`:

### Environment Variables
#### ROCM
| Variable | Purpose | Benefit |
| :--- | :--- | :--- |
| `HIP_VISIBLE_DEVICES=0` | Selects discrete GPU only (ignores iGPU) to ensure full VRAM availability for model weights. | Prevents resource conflicts and ensures max memory usage. |
| `GPU_ENABLE_WGP_MODE=0` | Forces scheduling at individual Compute Unit level rather than Workgroup Processors. | Improved math utilization and better layer distribution on RDNA2. |

#### Vulkan
| Variable | Purpose | Benefit |
| :--- | :--- | :--- |
| `AMD_VULKAN_ICD=RADV`  | Uses RADV Vulkan ICD instead of AMD's proprietary driver. | Better compatibility/performance with `llama.cpp`. |


### M1 Mac 8gb

Install Nix via [Determinate](https://github.com/DeterminateSystems/determinate)

### Gemma 4 E2B
*TODO: What does the E mean*
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/gemma-4-E2B-it-GGUF \
  gemma-4-E2B-it-Q4_K_M.gguf \
  --local-dir ./models/gemma-4-e2b
```

#### multimedia projector aka image gen additional download
```bash
nix run nixpkgs#python313Packages.huggingface-hub -- download \
  unsloth/gemma-4-E2B-it-GGUF \
  mmproj-BF16.gguf \
  --local-dir ./models/gemma-4-e2b/multimodal
```

### Run for a llama-ui with Gemma E2B with image/audio support
```bash
nix develop
```