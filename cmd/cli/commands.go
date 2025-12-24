package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"spotiflac/backend/core"
	"spotiflac/pkg/config"

	"github.com/spf13/cobra"
)

// runAlbumDownload executes the album download command
func runAlbumDownload(cmd *cobra.Command, args []string) error {
	spotifyURL := args[0]

	// Validate Spotify URL
	if !isValidSpotifyURL(spotifyURL) {
		return fmt.Errorf("invalid Spotify URL. Expected album URL like: https://open.spotify.com/album/...")
	}

	// 1. Load configuration (file + flags)
	cfg, err := loadConfig(cmd)
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}

	// 2. Ensure output directory exists
	if err := os.MkdirAll(cfg.OutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Create the reporter CLI
	reporter := NewCliProgressReporter()

	// 4. Create the downloader
	downloader := core.NewAlbumDownloader(cfg, reporter)

	// 5. Launch the download
	if err := downloader.DownloadAlbum(spotifyURL); err != nil {
		reporter.PrintSummary()
		return fmt.Errorf("download failed: %w", err)
	}

	// 6. Print summary
	reporter.PrintSummary()

	return nil
}

// runPlaylistDownload executes the playlist download command
func runPlaylistDownload(cmd *cobra.Command, args []string) error {
	spotifyURL := args[0]

	// Validate Spotify URL
	if !isValidPlaylistURL(spotifyURL) {
		return fmt.Errorf("invalid Spotify URL. Expected playlist URL like: https://open.spotify.com/playlist/...")
	}

	// 1. Load configuration (file + flags)
	cfg, err := loadConfig(cmd)
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}

	// 2. Ensure output directory exists
	if err := os.MkdirAll(cfg.OutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Create the reporter CLI
	reporter := NewCliProgressReporter()

	// 4. Create the downloader
	downloader := core.NewAlbumDownloader(cfg, reporter)

	// 5. Launch the download
	if err := downloader.DownloadPlaylist(spotifyURL); err != nil {
		reporter.PrintSummary()
		return fmt.Errorf("download failed: %w", err)
	}

	// 6. Print summary
	reporter.PrintSummary()

	return nil
}

// runDiscographyDownload executes the discography download command
func runDiscographyDownload(cmd *cobra.Command, args []string) error {
	spotifyURL := args[0]

	// Validate Spotify URL
	if !isValidDiscographyURL(spotifyURL) {
		return fmt.Errorf("invalid Spotify URL. Expected discography URL like: https://open.spotify.com/artist/.../discography/album")
	}

	// 1. Load configuration (file + flags)
	cfg, err := loadConfig(cmd)
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}

	// 2. Ensure output directory exists
	if err := os.MkdirAll(cfg.OutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Create the reporter CLI
	reporter := NewCliProgressReporter()

	// 4. Create the downloader
	downloader := core.NewAlbumDownloader(cfg, reporter)

	// 5. Launch the download
	if err := downloader.DownloadDiscography(spotifyURL); err != nil {
		reporter.PrintSummary()
		return fmt.Errorf("download failed: %w", err)
	}

	// 6. Print summary
	reporter.PrintSummary()

	return nil
}

// loadConfig loads configuration from file and overrides with CLI flags
func loadConfig(cmd *cobra.Command) (*config.AppConfig, error) {
	// Load config file
	configPath, _ := cmd.Flags().GetString("config")
	if configPath == "" {
		configPath = config.GetDefaultConfigPath()
	}

	cfg := config.LoadOrDefault(configPath)

	// Override with CLI flags (flags take precedence over config file)
	if output, _ := cmd.Flags().GetString("output"); output != "" {
		// Expand ~ if present
		if strings.HasPrefix(output, "~") {
			home, _ := os.UserHomeDir()
			output = filepath.Join(home, output[1:])
		}
		cfg.OutputDir = output
	}

	if service, _ := cmd.Flags().GetString("service"); service != "" {
		cfg.PreferredService = service
	}

	if format, _ := cmd.Flags().GetString("format"); format != "" {
		cfg.AudioFormat = strings.ToUpper(format)
	}

	if filenameFormat, _ := cmd.Flags().GetString("filename-format"); filenameFormat != "" {
		cfg.FilenameFormat = filenameFormat
	}

	if noTrackNumbers, _ := cmd.Flags().GetBool("no-track-numbers"); noTrackNumbers {
		cfg.TrackNumbers = false
	}

	if noAlbumFolders, _ := cmd.Flags().GetBool("no-album-folders"); noAlbumFolders {
		cfg.AlbumFolders = false
	}

	// Validate configuration
	cfg.Validate()

	return cfg, nil
}

// isValidSpotifyURL checks if the URL is a valid Spotify album URL
func isValidSpotifyURL(url string) bool {
	return strings.Contains(url, "open.spotify.com/album/") ||
		strings.Contains(url, "spotify.com/album/") ||
		strings.Contains(url, "spotify:album:")
}

// isValidPlaylistURL checks if the URL is a valid Spotify playlist URL
func isValidPlaylistURL(url string) bool {
	return strings.Contains(url, "open.spotify.com/playlist/") ||
		strings.Contains(url, "spotify.com/playlist/") ||
		strings.Contains(url, "spotify:playlist:")
}

// isValidDiscographyURL checks if the URL is a valid Spotify artist discography URL
func isValidDiscographyURL(url string) bool {
	return strings.Contains(url, "/artist/") && strings.Contains(url, "/discography/")
}
