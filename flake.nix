{
  description = "6800 xt Optimized llama.cpp";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llama-cpp-repo.url = "github:ggml-org/llama.cpp/b8589";
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
        useWebUi = false;
      }).overrideAttrs (oldAttrs: {
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

    piVersion = "0.62.0";
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

        source ./run.sh 27b
      '';
    };
  };
}
