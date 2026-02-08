{
  description = "SpotiFLAC Flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-stable,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgs-stable = import nixpkgs-stable { inherit system; };

        pname = "spotiflac";
        version = "7.0.7";

        src = pkgs.fetchurl {
          url = "https://github.com/afkarxyz/SpotiFLAC/releases/download/v${version}/SpotiFLAC.AppImage";
          sha256 = "sha256-y27eQYNi+ysScaOymPPJAW92uKAIQQLOSdwy7LaD5U4=";
        };

        appContents = pkgs.appimageTools.extractType2 {
          inherit pname version src;
        };

        runtimeLibs = [
          pkgs.webkitgtk_4_1
          pkgs-stable.webkitgtk_4_0
          pkgs.gtk3
          pkgs.glib
          pkgs.libGL
          pkgs.librsvg
          pkgs.gdk-pixbuf
          pkgs.fontconfig
          pkgs.dbus
          pkgs.zlib
          pkgs.gst_all_1.gstreamer
          pkgs.gst_all_1.gst-plugins-base
          pkgs.gst_all_1.gst-plugins-good
          pkgs.gst_all_1.gst-plugins-bad
          pkgs.gst_all_1.gst-plugins-ugly
          pkgs.gst_all_1.gst-libav
          pkgs.openssl
          pkgs.glib-networking
          pkgs.shared-mime-info
        ];
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          inherit pname version;
          src = appContents;

          nativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.wrapGAppsHook3
          ];

          buildInputs = runtimeLibs;

          installPhase = ''
            runHook preInstall
            mkdir -p $out/bin $out/share/applications $out/share/icons/hicolor/256x256/apps

            cp usr/bin/SpotiFLAC $out/bin/spotiflac

            [ -f spotiflac.png ] && cp spotiflac.png $out/share/icons/hicolor/256x256/apps/spotiflac.png
            cp spotiflac.desktop $out/share/applications/spotiflac.desktop

            substituteInPlace $out/share/applications/spotiflac.desktop \
              --replace "Exec=SpotiFLAC" "Exec=spotiflac" \
              --replace "Icon=SpotiFLAC" "Icon=spotiflac"
            runHook postInstall
          '';

          preFixup = ''
            gappsWrapperArgs+=(
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath runtimeLibs}"
            )
          '';
        };
      }
    );
}
