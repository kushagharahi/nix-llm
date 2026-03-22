# Local LLM for NixOS

Optimized for RX 6800XT / 7900X / 32GB of RAM
Runs QWEN 3.5 35B and [pi.dev](https://pi.dev)

![image](./image.png)

### Download a model

First, download the model to `/models`:

### QWEN 3.5 35B 3B active parameter Unsloth Dynamic Q4 K-Quant Extra Large

Model: https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF 

Very fast, but only considers 3B params at a time (A3B = active params 3B) aka (Mixture of Experts) MoE. THe model tries to get the expert with the most relevant 3B params

//todo explain 4 bit quantization

```
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \
  unsloth/Qwen3.5-35B-A3B-GGUF \
  Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
  --local-dir ./models
```

### QWEN 3.5 27B (Dense)

Dense model, slower inference but smart  
Model: https://huggingface.co/unsloth/Qwen3.5-27B-GGUF
  
```nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \  
   unsloth/Qwen3.5-27B-GGUF \
   Qwen3.5-27B-Q4_K_M.gguf  \
   --local-dir ./models
```

nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \  
  unsloth/Qwen3.5-27B-GGUF \
  Qwen3.5-27B-Q4_K_M.gguf  \
  --local-dir ./models
```


### Run the LLM 

For Qwen 3.5 35B:
```bash
./run.sh
```

For Qwen 27B:
```bash
./run27b.sh
```

Both start a llama server on `http://127.0.0.1:8001` and run pi pointing to that llama server

### Environment Variables (AMD GPU)

| Flag | Function | Benefit for Setup |
| :--- | :---:| :---:|
| `HIP_VISIBLE_DEVICES=0` | Selects discrete GPU only, ignores iGPU of 7900X (Ryzen integrated graphics) on RX 6800 XT with 16GB VRAM to avoid resource conflicts and ensure full memory available for model weights. |
| `GPU_ENABLE_WGP_MODE=0` | Forces scheduling at individual Compute Unit level rather than Workgroup Processors, more efficient math utilization on RDNA2 architecture (RX 6800 XT). Enables better GPU layer distribution across 16GB VRAM. |
| `HSA_OVERRIDE_GFX_VERSION=10.3.0` | Treats RX 6800 XT as Radeon Pro V620 (gfx103v), enabling use of Vega/Pro driver optimizations on RDNA2 hardware for stable ROCm execution and improved VRAM management during long context inference at :8001 server port.

### Parameters

| Flag                              | Function                    | Benefit for Setup                                                                                   |
|:----------------------------------|:----------------------------|:----------------------------------------------------------------------------------------------------|

### Parameters for Qwen3.5 35B (run.sh)

| Flag                              | Function                    | Benefit for Setup                                                                                   |
|:----------------------------------|:----------------------------|:----------------------------------------------------------------------------------------------------|
| `-m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`  | Model path                  | Q4_K_XL quantization fits in VRAM with room for context                                             |
| `--ctx-size 65536`                | Context window size         | Maximum context length for long-form generation                                                   |
| `--n-gpu-layers 55`               | GPU layers                  | Offload more MoE experts to Vulkan backend on RX 6800 XT                                          |

### Parameters for Qwen35 27B (run27b.sh)

| Flag                              | Function                    | Benefit for Setup                                                                                   |
|:----------------------------------|:----------------------------|:----------------------------------------------------------------------------------------------------|
| `-m ./models/Qwen3.5-27B-Q4_K_M.gguf`   | Model path                  | Q4_K_M quantization of dense 27B model                                                              |
| `--ctx-size 25000`                | Context window size         | Sets context length for inference at :8001 server port.                                           |
| `--n-gpu-layers 50`               | GPU layers                  | Offload all dense layers to Vulkan backend on RX 6800 XT                                          |

### Shared Parameters (Both Scripts)

| Flag                              | Function                    | Benefit for Setup                                                                                   |
|:----------------------------------|:----------------------------|:----------------------------------------------------------------------------------------------------|
| `--batch-size 512`                | Logical batch size            | Handles concurrent requests without memory pressure                                                 |
| `--cache-type-k q8_0`             | KV cache type K               | Quantized key/value cache for reduced VRAM usage                                                    |
| `--cache-type-v q8_0`             | KV cache type V               | Quantized value/cache for reduced VRAM usage                                                        |
| `--flash-attn 1`                  | Flash attention toggle        | Enabled for improved performance on AMD GPUs with Vulkan                                          |
| `--frequency-penalty 1.0`         | Frequency penalty score       | Strongly discourages repeated tokens for variety                                                    |
| `--host 127.0.0.1`                | Server host                   | Localhost only prevents external access                                                             |
| `--no-webui`                      | Web UI toggle                 | CLI-only mode reduces resource overhead when using pi interface                                   |
| `--parallel 1`                    | Request parallelism           | Single slot prevents queue buildup and memory spikes under load                                   |
| `--port 8001`                     | Server port                   | llama server listening on standard API port                                                       |
| `--repeat-penalty 1.1`            | Repeat penalty multiplier     | Moderate reinforcement against token repetition                                                   |
| `--threads 11`                    | CPU threads                   | Uses all available CPU cores for inference                                                        |
