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

If on nixos -- run it with memlock unlimited to prevent writing to disk and keep everything in memory
```
sudo prlimit --memlock=unlimited:unlimited 
nix develop ~/path/to/this/repo/nix-llm
```

This starts a llama server on `:8001` and runs opencode pointing to that llama server


### What do the different inputs to `llama.cpp` mean?

| Flag | Function | Benefit for Setup |
| :--- | :--- | :--- |
| `-m` | **Model Path** | Loads the 22GB file directly from the file system. |
| `--ctx-size 16384` | **Context Window** | Sets short-term memory; uses ~2-4GB VRAM for 16k tokens. |
| `--n-gpu-layers 22` | **GPU Offload** | Offload 22 layers to GPU for faster inference. |
| `--ubatch-size 512` | **Physical Batch** | Size of data chunks sent to GPU cores at once. |
| `--batch-size 512` | **Logical Batch** | Max tokens processed in parallel during prompt ingestion. |
| `--flash-attn off` | **Flash Attention** | Disabled to prevent the `GGML_ASSERT` crash on ROCm/RDNA2. |
| `--mlock` | **Memory Locking** | Pins model to physical RAM to prevent SSD swap/wear. |
| `--threads` | **CPU Threads** | Uses all available CPU cores. |
| `--temp 0.6` | **Temperature** | Controls randomness of output. |
| `--top-p 0.95` | **Top-P** | Nucleus sampling threshold. |
| `--top-k 20` | **Top-K** | Limits sampling to top 20 tokens. |
| `--min-p 0.00` | **Min P** | Independent parameterization of tokens. |
| `--no-webui` | **No Web UI** | Disables web interface. |