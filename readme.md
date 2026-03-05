# Local LLM for NixOS

Optimized for RX 6800XT / 7900X / 16GB of RAM
Runs QWEN 3.5 35B and OpenCode

![image](./image.png)

### Download QWEN 3.5 35B Unsloth Dynamic Q4 K-Quant Extra Large

Model: https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF 

First, download the model to `/models`:
```
nix shell nixpkgs#huggingface-hub -c huggingface-cli download \
  unsloth/Qwen3.5-35B-A3B-GGUF \
  Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
  --local-dir ./models
```

### Run the LLM 

```
sudo prlimit --memlock=unlimited:unlimited 
nix develop ~/path/to/this/repo/nix-llm
```


We run it with memlock unlimited to prevent writing to disk and keep everything in memory

This starts a llama server on `:8001` and runs opencode pointing to that llama server


### What do the different inputs to `llama.cpp` mean?

| Flag | Function | Benefit for Setup |
| :--- | :--- | :--- |
| `-m` | **Model Path** | Loads the 22GB file directly from the file system. |
| `--ctx-size 16384` | **Context Window** | Sets short-term memory; uses ~2-4GB VRAM for 16k tokens. |
| `--n-gpu-layers 20` | **GPU Offload** | Reduced to 20 to prevent VRAM overflow and driver timeout on 16GB cards. |
| `--flash-attn off` | **Flash Attention** | Disabled to prevent the `GGML_ASSERT` crash on ROCm/RDNA2. |
| `--ubatch-size 1024` | **Physical Batch** | Size of data chunks sent to GPU cores at once. |
| `--batch-size 1024` | **Logical Batch** | Max tokens processed in parallel during prompt ingestion. |
| `--mlock` | **Memory Locking** | Pins model to physical RAM to prevent SSD swap/wear. |
| `--threads 12` | **CPU Threads** | Matches the 12 CPU cores for hybrid processing. |