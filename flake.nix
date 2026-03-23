{
  description = "6800 xt Optimized llama.cpp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llama-cpp-repo.url = "path:/home/kusha/projects/llama.cpp";
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

    llama-amd =
      (llama-cpp-repo.packages.${system}.default.override {
        useVulkan = true;
        useRocm = false;
        useCuda = false;
        # Wont work on official llama.cpp until https://github.com/ggml-org/llama.cpp/pull/20158 is merged
        useWebUi = false;
      }).overrideAttrs (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            "-DCMAKE_BUILD_TYPE=Release"
            "-DGGML_VULKAN_PERF_PROFILING=OFF"
            # Native CPU optimizations
            "-DGGML_NATIVE=ON"
          ];

        # Ensure all necessary Vulkan libraries are present
        buildInputs =
          oldAttrs.buildInputs
          ++ [
            pkgs.vulkan-headers # Provides Vulkan_INCLUDE_DIR
            pkgs.vulkan-loader # Provides Vulkan_LIBRARY
          ];

        appendRunpaths = ["${placeholder "out"}/lib"];
      });
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        llama-amd
        pkgs.nodejs
        pkgs.curl
      ];

      shellHook = ''
        export NPM_CONFIG_PREFIX=~/.npm-global
        export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
        if ! command -v pi &> /dev/null; then
          echo "📦 Installing pi coding agent..."
          npm install -g @mariozechner/pi-coding-agent@0.62.0
        fi
        source ./run27b.sh
      '';
    };
  };
}
