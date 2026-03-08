# Local LLM for NixOS

Optimized for RX 6800XT / 7900X / 32GB of RAM
Runs QWEN 3.5 35B and OpenCode

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

### QWEN 27B

Dense, slow, but smart
// TODO: Also explain 4 bit quant
// TODO: HF link

```
nix shell nixpkgs#python313Packages.huggingface-hub -c huggingface-cli download \  
  unsloth/Qwen3.5-27B-GGUF \
  Qwen3.5-27B-Q4_K_M.gguf  \
  --local-dir ./models
```


### Run the LLM 

```
nix develop
```

This starts a llama server on `:8001` and runs opencode pointing to that llama server

### Environment Variables

| Flag | Function | Benefit for Setup |
| :--- | :---:| :---:|
| `HIP_VISIBLE_DEVICES=0` | Selects discrete GPU only, ignores iGPU of 7900X (Ryzen integrated graphics) on RX 6800 XT with 16GB VRAM to avoid resource conflicts and ensure full memory available for model weights. |
| `GPU_ENABLE_WGP_MODE=0` | Forces scheduling at individual Compute Unit level rather than Workgroup Processors, more efficient math utilization on RDNA2 architecture (RX 6800 XT). Enables better GPU layer distribution across 16GB VRAM. |
| `HSA_OVERRIDE_GFX_VERSION=10.3.0` | Treats RX 6800 XT as Radeon Pro V620 (gfx103v), enabling use of Vega/Pro driver optimizations on RDNA2 hardware for stable ROCm execution and improved VRAM management during long context inference at :8001 server port.

### Parameters

| Flag                              | Function                    | Benefit for Setup                                                                                   |
|:----------------------------------|:----------------------------|:----------------------------------------------------------------------------------------------------|
| `-m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`  | Model path                  | Q4_K_XL quantization fits in VRAM with room for context             |
| `--ctx-size 32768`                | Context window size         | Sets context length for inference at :8001 server port.                             |
| `--n-gpu-layers 16`               | GPU layers                  | Offload 16 layers to GPU for faster inference on RX 6800 XT with ROCm backend support   |
| `--ubatch-size 512`               | Physical batch size         | Optimized for RDNA2 architecture, balances throughput and memory                                    |
| `--batch-size 512`                | Logical batch size            | Handles concurrent requests without memory pressure                                                 |
| `--n-cpu-moe 20`                  | CPU MoE layers                | Offloads Mixture-of-Expert layers to CPU when GPU is full                                           |
| `--fit-target 1024`               | Memory fit target             | Optimizes layer placement for available VRAM                                                        |
| `--flash-attn off`                | Flash attention toggle        | Disabled due to ROCm driver limitations on AMD GPUs (RDNA2)                                         |
| `--parallel 1`                    | Request parallelism           | Single slot prevents queue buildup and memory spikes under load                                     |
| `--threads 11`                    | CPU threads                   | Uses all available CPU cores for inference                                                          |
| `--mlock`                         | Memory locking                | Pins model to physical RAM to prevent SSD swap/wear                                                 |
| `--no-mmap`                       | No memory mapping             | Forces full memory load instead of mmap, more stable on AMD GPUs                                    |
| `--temp 0.6`                      | Sampling temperature          | Balanced creativity for code generation and technical writing                                       |
| `--top-p 0.95`                    | Nucleus sampling threshold    | Focuses on high-probability tokens while maintaining diversity                                      |
| `--top-k 20`                      | Top-k sampling limit          | Restricts token candidates to most likely options for coherence                                     |
| `--min-p 0.00`                    | Minimum probability threshold | Allows full token distribution without floor constraint                                             |
| `--presence_penalty 0.0`          | Presence penalty score        | No repetition bias applied, allows diverse responses                                                |
| `--frequency_penalty 1.0`         | Frequency penalty score       | Strongly discourages repeated tokens for variety                                                    |
| `--repeat_penalty 1.1`            | Repeat penalty multiplier     | Moderate reinforcement against token repetition                                                     |
| `--no-webui`                      | Web UI toggle                 | CLI-only mode reduces resource overhead when using opencode interface                               |
