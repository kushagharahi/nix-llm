# Qwen 3.5 NIX

## Llama-Server Parameters

### GPU Configuration
- `HIP_VISIBLE_DEVICES=0` - Ignore iGPU of 7900x
- `GPU_ENABLE_WGP_MODE=0` - On RDNA2, compute units are grouped into "Workgroup Processors." Disabling this forces the compiler to schedule tasks at the individual Compute Unit (CU) level. For LLMs, this usually results in more granular, efficient math.
- `HSA_OVERRIDE_GFX_VERSION=10.3.0` - Tell the driver to treat 6800 XT like a professional Radeon Pro V620, which uses the same gfx1030 architecture.

### Model & Layers
- `-m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` - Model file path
- `--n-gpu-layers 22` - Number of layers to offload to GPU

### Context & Batch
- `--ctx-size 16384` - Context window size
- `--ubatch-size 1024` - Upper batch size
- `--batch-size 1024` - Request batch size

### Performance
- `--n-cpu-moe 18` - CPU threads for MoE operations
- `--threads 11` - CPU threads
- `--parallel 1` - Number of parallel sequences
- `--flash-attn off` - Flash attention (disabled for compatibility)
- `--mlock` - Lock model in memory

### Generation Parameters
- `--temp 0.6` - Temperature (0.0-2.0)
- `--top-p 0.95` - Top-p (nucleus) sampling
- `--top-k 20` - Top-k sampling
- `--min-p 0.00` - Minimum probability

### Server Configuration
- `--no-webui` - Disable web UI
- `--host 127.0.0.1` - Server host
- `--port 8001` - Server port

## Usage

```bash
./run.sh
```

The server will start on `http://127.0.0.1:8001` and OpenCode will launch automatically.