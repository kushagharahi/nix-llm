{
  description = "6800 xt Optimized llama.cpp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llama-cpp-repo = {
      #url = "/Users/kushag/Documents/Projects/llama.cpp";
      url = "github:ggml-org/llama.cpp/b8807";
      # Force llama.cpp's flake to use OUR nixpkgs version
      # (llama.cpp is pinned to 25.05)
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    llama-cpp-repo,
  }: let
    linux = "x86_64-linux";
    # Apple silicon won't build until https://github.com/ggml-org/llama.cpp/pull/21928
    # is merged
    mac = "aarch64-darwin";
    mkPkgs = system:
      import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
    pkgsLinux = mkPkgs linux;
    pkgsMac = mkPkgs mac;
    piVersion = "0.65.2";

    llama-vulkan = {useWebUi ? false}:
      (llama-cpp-repo.packages.${linux}.default.override {
        useVulkan = true;
        useRocm = false;
        useCuda = false;
        inherit useWebUi; # This passes the arg through
      }).overrideAttrs
      (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            "-DCMAKE_BUILD_TYPE=Release"
            # Link Time Optimization (5-15% speedup, slower build)
            "-DGGML_LTO=ON"
            # Native CPU optimizations
            "-DGGML_NATIVE=ON"
          ];
        appendRunpaths = ["${placeholder "out"}/lib"];
      });

    llama-amd = {useWebUi ? false}:
      (llama-cpp-repo.packages.${linux}.default.override {
        useVulkan = false;
        useRocm = true;
        useCuda = false;
        inherit useWebUi; # This passes the arg through
        # Set GPU target to 6800 xt
        rocmGpuTargets = "gfx1030";
      }).overrideAttrs
      (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        buildInputs = oldAttrs.buildInputs ++ [pkgsLinux.rocmPackages.rocwmma];

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            # Explicitly route the Nix headers to the compilers
            "-DCMAKE_CXX_FLAGS=-I${pkgsLinux.rocmPackages.rocwmma}/include"
            "-DCMAKE_HIP_FLAGS=-I${pkgsLinux.rocmPackages.rocwmma}/include"

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
          ];
        appendRunpaths = ["${placeholder "out"}/lib"];
      });

    llama-metal =
      (llama-cpp-repo.packages.${mac}.default.override {
        useMetalKit = true;
        useWebUi = true;
        useRocm = false;
        useCuda = false;
      }).overrideAttrs
      (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            "-DGGML_METAL=ON"
            "-DCMAKE_BUILD_TYPE=Release"
            # Link Time Optimization (5-15% speedup, slower build)
            "-DGGML_LTO=ON"
            # Native CPU optimizations
            "-DGGML_NATIVE=ON"
          ];
        appendRunpaths = ["${placeholder "out"}/lib"];
      });
  in {
    devShells.${linux} = {
      default = builtins.throw ''
        Error: Please specify which environment you want to use!
        Available options:
          - nix develop .#ui
          - nix develop .#agentic
      '';

      ui = pkgsLinux.mkShell {
        buildInputs = [
          # TODO: Make configurable between AMD and Vulkan
          #l(llama-amd { useWebUi = true; })
          (llama-vulkan {useWebUi = true;})
          pkgsLinux.uv
          pkgsLinux.python313
          pkgsLinux.nodejs
          pkgsLinux.playwright-driver.browsers
        ];
        shellHook = ''
          # Prevent uv from downloading its own unpatched pythons
          export UV_PYTHON_PREFERENCE=managed
          export UV_PYTHON=$(which python3)
          source ./run-llama-ui.sh 26b
        '';
      };

      agentic = pkgsLinux.mkShell {
        buildInputs = [
          # TODO: Make configurable between AMD and Vulkan
          #(llama-amd { useWebUi = false; })
          (llama-vulkan {useWebUi = false;})
          pkgsLinux.nodejs
          pkgsLinux.curl
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
          export LD_LIBRARY_PATH="${
            pkgsLinux.lib.makeLibraryPath [
              pkgsLinux.pixman
              pkgsLinux.cairo
              pkgsLinux.pango
            ]
          }:$LD_LIBRARY_PATH"

          # Check if the SPECIFIC version is installed locally
          if [ ! -f "$NPM_CONFIG_PREFIX/bin/pi" ]; then
            echo "📦 Installing pi-coding-agent @${piVersion} locally to .nix-node..."
            # We use -g but because of the PREFIX above, it stays in this folder
            npm install -g @mariozechner/pi-coding-agent@${piVersion}
          fi

          source ./run-agentic.sh 26b
        '';
      };
    };

    devShells.${mac} = {
      default = pkgsMac.mkShell {
        buildInputs = [
          llama-metal
          pkgsMac.uv
          pkgsMac.python313
          pkgsMac.nodejs
        ];
        shellHook = ''
          # Prevent uv from downloading its own unpatched pythons
          export UV_PYTHON_PREFERENCE=managed
          export UV_PYTHON=$(which python3)
          source ./run-llama-ui.sh 2b --metal
        '';
      };
    };
  };
}
