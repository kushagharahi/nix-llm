{
  description = "AMD Optimized Qwen 3.5 35B";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    opencode.url = "github:anomalyco/opencode/v1.2.17";
    # Change back to llama.cpp once https://github.com/ggml-org/llama.cpp/pull/20158 is merged
    # llama-cpp-repo.url = "github:ggml-org/llama.cpp/b8212";
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
        rocmSupport = true;
      }).overrideAttrs (oldAttrs: {
        src = llama-cpp-repo;

        cmakeFlags =
          oldAttrs.cmakeFlags
          ++ [
            "-DAMDGPU_TARGETS=gfx1030" # rt6800xt architecture aka RDNA2
            "-DGGML_HIP_ROCWMMA=ON" # rocWMMA (Radeon Open Compute Wavefront Matrix Multiply-Accumulate)
            "-DGGML_HIP_ROCWMMA_FATTN=OFF" # flash attention. Not for RDNA2 :(
            "-DCMAKE_HIP_ARCHITECTURES=gfx1030"
            "-DAMDGPU_TARGETS=gfx1030"
            "-DCMAKE_HIP_FLAGS=-I${pkgs.rocmPackages.rocwmma}/include"
            # Wont work on official llama.cpp until https://github.com/ggml-org/llama.cpp/pull/20158 is merged
            "-DLLAMA_BUILD_WEBUI=OFF"
          ];

        # Ensure all necessary ROCm libraries are present
        buildInputs =
          oldAttrs.buildInputs
          ++ [
            pkgs.rocmPackages.clr
            pkgs.rocmPackages.hipblas
            pkgs.rocmPackages.rocblas
            pkgs.rocmPackages.rocwmma
          ];

        # skip other architectures when building
        preConfigure = ''
          export GPU_TARGETS="gfx1030"
          export AMDGPU_TARGETS="gfx1030"
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
