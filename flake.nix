{
  description = "AMD Optimized Qwen 3.5 (Official Nixpkgs ROCm)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    # Use the standard rocmPackages attribute provided by nixpkgs
    llama-amd = pkgs.llama-cpp.override {
      rocmSupport = true;
      # This pulls the default ROCm stack (e.g., 6.0 or 6.1)
      rocmPackages = pkgs.rocmPackages;
    };
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [llama-amd];

      shellHook = ''
          # Tell the driver to treat 6800 XT like a professional Radeon Pro V620, which uses the same gfx1030 architecture.
          export HSA_OVERRIDE_GFX_VERSION=10.3.0

          # Optimization: On RDNA2, compute units are grouped into "Workgroup Processors." Disabling this forces the compiler to schedule tasks at the individual Compute Unit (CU) level. For LLMs, this usually results in more granular, efficient math.
          export GPU_ENABLE_WGP_MODE=0

          # Ignore iGPU of 7900x
          export HIP_VISIBLE_DEVICES=0

        echo "🚀 Starting Qwen 3.5 API Server on http://127.0.0.1:8001"

          exec llama-server \
            -m ./models/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
            --ctx-size 16384 \
            --n-gpu-layers 20 \
            --ubatch-size 1024 \
            --batch-size 1024 \
            --flash-attn off \
            --mlock \
            --threads 12 \
            --host 127.0.0.1 \
            --port 8001
      '';
    };
  };
}
