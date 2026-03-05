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

    opencode-latest = pkgs.stdenv.mkDerivation {
      pname = "opencode";
      version = "1.2.17";
      src = pkgs.fetchurl {
        url = "https://github.com/anomalyco/opencode/releases/download/v1.2.17/opencode-linux-x64";
        sha256 = "sha256-715b844c2a88810b6178d7a2467c7d36ea8fb764"; # See Step 2 below
      };
      phases = ["installPhase"];
      installPhase = ''
        mkdir -p $out/bin
        cp $src $out/bin/opencode
        chmod +x $out/bin/opencode
      '';
    };
  in {
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        llama-amd
        opencode-latest
        pkgs.curl
      ];

      shellHook = "source ./run.sh";
    };
  };
}
