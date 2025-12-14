package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var version = "0.1.0"

// addCommonFlags adds common download flags to a command
func addCommonFlags(cmd *cobra.Command) {
	cmd.Flags().StringP("output", "o", "", "Output directory")
	cmd.Flags().StringP("service", "s", "", "Preferred service (tidal/deezer/amazon/qobuz)")
	cmd.Flags().StringP("format", "f", "", "Audio format (LOSSLESS/HIGH/MEDIUM)")
	cmd.Flags().String("filename-format", "", "Filename format (title-artist/artist-title)")
	cmd.Flags().Bool("no-track-numbers", false, "Don't add track numbers")
	cmd.Flags().Bool("no-album-folders", false, "Don't create album subfolders")
}

func main() {
	// Root command
	var rootCmd = &cobra.Command{
		Use:   "spotiflac-cli",
		Short: "SpotiFLAC CLI - Download Spotify albums in FLAC",
		Long: `SpotiFLAC CLI allows you to download Spotify albums in FLAC quality
from Tidal, Deezer, Amazon Music or Qobuz.

The CLI automatically uses fallback between services if a track
is not available on the preferred service.`,
		Version: version,
	}

	// Album command
	var albumCmd = &cobra.Command{
		Use:   "album [spotify-url]",
		Short: "Download an album from a Spotify URL",
		Long: `Downloads all tracks from a Spotify album.

Example:
  spotiflac-cli album https://open.spotify.com/album/abc123

The CLI will automatically download all tracks from the album
using the configured preferred service (default: Tidal).`,
		Args: cobra.ExactArgs(1),
		RunE: runAlbumDownload,
	}

	// Playlist command
	var playlistCmd = &cobra.Command{
		Use:   "playlist [spotify-url]",
		Short: "Download a playlist from a Spotify URL",
		Long: `Downloads all tracks from a Spotify playlist.

Example:
  spotiflac-cli playlist https://open.spotify.com/playlist/abc123

The CLI will automatically download all tracks from the playlist
using the configured preferred service (default: Tidal).`,
		Args: cobra.ExactArgs(1),
		RunE: runPlaylistDownload,
	}

	// Discography command
	var discographyCmd = &cobra.Command{
		Use:   "discography [spotify-url]",
		Short: "Download an artist's discography from a Spotify URL",
		Long: `Downloads all albums from an artist's discography.

Examples:
  spotiflac-cli discography https://open.spotify.com/artist/abc123/discography/album
  spotiflac-cli discography https://open.spotify.com/artist/abc123/discography/single

The CLI will automatically download all albums/singles from the artist.
Each album will be organized in its own subfolder.`,
		Args: cobra.ExactArgs(1),
		RunE: runDiscographyDownload,
	}

	// Global flags
	rootCmd.PersistentFlags().StringP("config", "c", "", "Configuration file path (default: ~/.spotiflac/config.yaml)")

	// Add common flags to each command
	addCommonFlags(albumCmd)
	addCommonFlags(playlistCmd)
	addCommonFlags(discographyCmd)

	// Add commands to root
	rootCmd.AddCommand(albumCmd)
	rootCmd.AddCommand(playlistCmd)
	rootCmd.AddCommand(discographyCmd)

	// Execute
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
