{
  description = "6800 xt Optimized llama.cpp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llama-cpp-repo = {
      url = "github:ggml-org/llama.cpp/b8683";
      # Force llama.cpp's flake to use OUR nixpkgs version
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    llama-cpp-repo,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    # llama-vulkan =
    #   (llama-cpp-repo.packages.${system}.default.override {
    #     useVulkan = true;
    #     useRocm = false;
    #     useCuda = false;
    #     useWebUi = false;
    #   }).overrideAttrs (oldAttrs: {
    #     src = llama-cpp-repo;

    #     # version must be an integer string for C++ LLAMA_BUILD_NUMBER
    #     version = "0";

    #     cmakeFlags =
    #       oldAttrs.cmakeFlags
    #       ++ [
    #         "-DCMAKE_BUILD_TYPE=Release"
    #         # Link Time Optimization (5-15% speedup, slower build)
    #         "-DGGML_LTO=ON"
    #         # Native CPU optimizations
    #         "-DGGML_NATIVE=ON"
    #       ];
    #     appendRunpaths = ["${placeholder "out"}/lib"];
    #   });

    llama-amd =
      (llama-cpp-repo.packages.${system}.default.override {
        useVulkan = false;
        useRocm = true;
        useCuda = false;
        useWebUi = false;
        # Set GPU target to 6800 xt
        rocmGpuTargets = "gfx1030";
      }).overrideAttrs (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        buildInputs = oldAttrs.buildInputs ++ [pkgs.rocmPackages.rocwmma];

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            # Explicitly route the Nix headers to the compilers
            "-DCMAKE_CXX_FLAGS=-I${pkgs.rocmPackages.rocwmma}/include"
            "-DCMAKE_HIP_FLAGS=-I${pkgs.rocmPackages.rocwmma}/include"

            "-DCMAKE_BUILD_TYPE=Release"
            # Link Time Optimization (5-15% speedup, slower build)
            "-DGGML_LTO=ON"
            # Native CPU optimizations
            "-DGGML_NATIVE=ON"
            # --- RDNA2 / gfx1030 specific flags ---
            # Enable rocWMMA flash attention for AMD GPUs
            "-DGGML_HIP_ROCWMMA_FATTN=ON"

            # Force Matrix Multiply Quantized kernels (lowers VRAM for quantized models)
            "-DGGML_CUDA_FORCE_MMQ=ON"

            # Optional: Disable Virtual Memory Management (stabilizes RDNA2 cards in Linux)
            "-DGGML_HIP_NO_VMM=ON"

            # Optional: Enable all KV Cache quantization permutations (warning: increases compile time)
            "-DGGML_CUDA_FA_ALL_QUANTS=ON"
            # --------------------------------------
          ];
        appendRunpaths = ["${placeholder "out"}/lib"];
      });

    piVersion = "0.65.2";
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        llama-amd
        pkgs.nodejs
        pkgs.curl
      ];

      shellHook = ''
        # Define a local path for NPM to install things into
        export PROJECT_ROOT=$(pwd)
        # The version is baked into the folder name.
        # Changing the variable automatically 'installs' a new one.
        export NPM_CONFIG_PREFIX="$PROJECT_ROOT/.nix-node/v${piVersion}"

        # Add that local bin to your PATH
        export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

        # Handle the C-Libraries for 'canvas'
        export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [
          pkgs.pixman
          pkgs.cairo
          pkgs.pango
        ]}:$LD_LIBRARY_PATH"

        # Check if the SPECIFIC version is installed locally
        if [ ! -f "$NPM_CONFIG_PREFIX/bin/pi" ]; then
          echo "📦 Installing pi-coding-agent @${piVersion} locally to .nix-node..."
          # We use -g but because of the PREFIX above, it stays in this folder
          npm install -g @mariozechner/pi-coding-agent@${piVersion}
        fi

        source ./run-amd.sh 26b
      '';
    };
  };
}
