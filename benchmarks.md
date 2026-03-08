## 27B
```
HIP_VISIBLE_DEVICES=0 GPU_ENABLE_WGP_MODE=0 \
llama-bench \
    -m ./models/Qwen3.5-27B-Q4_K_M.gguf \
    --n-gpu-layers 26 \
    --ubatch-size 128 \
    --batch-size 128 \
    --flash-attn off \
    --threads 11
```

ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon RX 6800 XT, gfx1030 (0x1030), VMM: no, Wave Size: 32
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | --------------: | -------------------: |
| qwen35 27B Q4_K - Medium       |  15.58 GiB |    26.90 B | ROCm       |  26 |      11 |     128 |      128 |           pp512 |        139.59 ± 0.22 |
| qwen35 27B Q4_K - Medium       |  15.58 GiB |    26.90 B | ROCm       |  26 |      11 |     128 |      128 |           tg128 |          3.02 ± 0.02 |

## 35B-3B


```
HIP_VISIBLE_DEVICES=0 GPU_ENABLE_WGP_MODE=0 HSA_OVERRIDE_GFX_VERSION=10.3.0 \
llama-bench \
    -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
    --n-gpu-layers 16 \
    --n-cpu-moe 20 \
    --ubatch-size 512 \
    --batch-size 512 \
    --flash-attn off \
    --threads 11
```

ggml_cuda_init: found 1 ROCm devices:
  Device 0: AMD Radeon RX 6800 XT, gfx1030 (0x1030), VMM: no, Wave Size: 32
| model                          |       size |     params | backend    | ngl | threads | n_batch |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | --------------: | -------------------: |
| qwen35moe 35B.A3B Q4_K - Medium |  20.70 GiB |    34.66 B | ROCm       |  16 |      11 |     512 |           pp512 |        609.82 ± 4.90 |
| qwen35moe 35B.A3B Q4_K - Medium |  20.70 GiB |    34.66 B | ROCm       |  16 |      11 |     512 |           tg128 |         14.49 ± 0.24 |
