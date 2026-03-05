{
  description = "AMD Optimized Qwen 3.5 (Official Nixpkgs ROCm)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    opencode.url = "github:anomalyco/opencode/v1.2.17";
  };

  outputs = {
    self,
    nixpkgs,
    opencode,
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
      buildInputs = [
        llama-amd
        opencode.packages.${system}.default
        pkgs.curl
      ];

      shellHook = "source ./run.sh";
    };
  };
}
