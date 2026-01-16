{
  description = "SpotiFLAC Flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      # nixpkgs-stable,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        # pkgs-stable = import nixpkgs-stable { inherit system; };

        pname = "spotiflac";
        version = "7.0.6";

        src = pkgs.fetchurl {
          url = "https://github.com/afkarxyz/SpotiFLAC/releases/download/v${version}/SpotiFLAC.AppImage";
          sha256 = "sha256-y27eQYNi+ysScaOymPPJAW92uKAIQQLOSdwy7LaD5U4=";
        };

        iconSrc = pkgs.fetchurl {
          url = "https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/main/frontend/src/assets/icons/spotiflac.svg";
          sha256 = "sha256-TGHc8d/ASts0IF8oBahNJKxF0o5tyMujQcvr/RLtwnU=";
        };

        appimg = pkgs.appimageTools.wrapType2 {
          inherit pname version src;
          extraPkgs = pkgs: [
            pkgs.ffmpeg
            pkgs.librsvg
            pkgs.webkitgtk_4_1
          ];
        };

        desktopItem = pkgs.makeDesktopItem {
          name = "spotiflac";
          exec = "${appimg}/bin/spotiflac";
          icon = "${iconSrc}";
          desktopName = "SpotiFLAC";
          genericName = "Music Downloader";
          comment = "Get Spotify tracks in true FLAC from Tidal, Qobuz & Amazon Music — no account required.";
          categories = [
            "AudioVideo"
            "Audio"
            "Network"
          ];
          terminal = false;
        };
      in
      {
        packages.default = pkgs.symlinkJoin {
          name = pname;
          paths = [
            appimg
            desktopItem
          ];
        };

        apps.default = {
          type = "app";
          program = "${appimg}/bin/${pname}";
        };
      }
    );
}
