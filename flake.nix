{
  description = "AMD Optimized Qwen 3.5 35B";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    opencode.url = "github:anomalyco/opencode/v1.2.20";
    llama-cpp-repo.url = "path:/home/kusha/projects/llama.cpp";
  };

  outputs = {
    self,
    nixpkgs,
    opencode,
    llama-cpp-repo,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    llama-amd =
      (pkgs.llama-cpp.override {
        rocmSupport = false;
        vulkanSupport = true;
      }).overrideAttrs (oldAttrs: {
        src = llama-cpp-repo;

        # version must be an integer string for C++ LLAMA_BUILD_NUMBER
        version = "0";

        # Disable WebUI build and npm dependencies to fix local source hash mismatch
        npmDeps = null;
        nativeBuildInputs = pkgs.lib.filter (
          p:
            !(p ? pname && (p.pname == "nodejs" || p.pname == "npm-config-hook"))
        ) (oldAttrs.nativeBuildInputs or [pkgs.shaderc]);

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            "-DCMAKE_BUILD_TYPE=Release"
            "-DGGML_VULKAN=ON"
            "-DGGML_VULKAN_PERF_PROFILING=OFF"
            "-DGGML_NATIVE=ON"
            # Wont work on official llama.cpp until https://github.com/ggml-org/llama.cpp/pull/20158 is merged
            "-DLLAMA_BUILD_WEBUI=OFF" # Don't bundle webui
          ];

        # Ensure all necessary Vulkan libraries are present
        buildInputs =
          oldAttrs.buildInputs
          ++ [
            pkgs.vulkan-headers # Provides Vulkan_INCLUDE_DIR
            pkgs.vulkan-loader # Provides Vulkan_LIBRARY
          ];

        preConfigure = ''
          echo "0000000" > COMMIT
        '';

        appendRunpaths = ["${placeholder "out"}/lib"];
      });
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        llama-amd
        opencode.packages.${system}.default
        pkgs.curl
      ];

      shellHook = "source ./run.sh";
    };
  };
}
