package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"spotiflac/backend"
	"strings"
	"time"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SpotifyMetadataRequest represents the request structure for fetching Spotify metadata
type SpotifyMetadataRequest struct {
	URL     string  `json:"url"`
	Batch   bool    `json:"batch"`
	Delay   float64 `json:"delay"`
	Timeout float64 `json:"timeout"`
}

// DownloadRequest represents the request structure for downloading tracks
type DownloadRequest struct {
	ISRC                string `json:"isrc"`
	Service             string `json:"service"`
	Query               string `json:"query,omitempty"`
	TrackName           string `json:"track_name,omitempty"`
	ArtistName          string `json:"artist_name,omitempty"`
	AlbumName           string `json:"album_name,omitempty"`
	ApiURL              string `json:"api_url,omitempty"`
	OutputDir           string `json:"output_dir,omitempty"`
	AudioFormat         string `json:"audio_format,omitempty"`
	FilenameFormat      string `json:"filename_format,omitempty"`
	TrackNumber         bool   `json:"track_number,omitempty"`
	Position            int    `json:"position,omitempty"`               // Position in playlist/album (1-based)
	UseAlbumTrackNumber bool   `json:"use_album_track_number,omitempty"` // Use album track number instead of playlist position
	SpotifyID           string `json:"spotify_id,omitempty"`             // Spotify track ID
	ServiceURL          string `json:"service_url,omitempty"`            // Direct service URL (Tidal/Deezer/Amazon) to skip song.link API call
}

// DownloadResponse represents the response structure for download operations
type DownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

// GetStreamingURLs fetches all streaming URLs from song.link API
func (a *App) GetStreamingURLs(spotifyTrackID string) (string, error) {
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required")
	}

	fmt.Printf("[GetStreamingURLs] Called for track ID: %s\n", spotifyTrackID)
	client := backend.NewSongLinkClient()
	urls, err := client.GetAllURLsFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	jsonData, err := json.Marshal(urls)
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// GetSpotifyMetadata fetches metadata from Spotify
func (a *App) GetSpotifyMetadata(req SpotifyMetadataRequest) (string, error) {
	if req.URL == "" {
		return "", fmt.Errorf("URL parameter is required")
	}

	if req.Delay == 0 {
		req.Delay = 1.0
	}
	if req.Timeout == 0 {
		req.Timeout = 300.0
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(req.Timeout*float64(time.Second)))
	defer cancel()

	data, err := backend.GetFilteredSpotifyData(ctx, req.URL, req.Batch, time.Duration(req.Delay*float64(time.Second)))
	if err != nil {
		return "", fmt.Errorf("failed to fetch metadata: %v", err)
	}

	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// DownloadTrack downloads a track by ISRC
func (a *App) DownloadTrack(req DownloadRequest) (DownloadResponse, error) {
	if req.ISRC == "" {
		return DownloadResponse{
			Success: false,
			Error:   "ISRC is required",
		}, fmt.Errorf("ISRC is required")
	}

	if req.Service == "" {
		req.Service = "deezer"
	}

	if req.OutputDir == "" {
		req.OutputDir = "."
	}

	if req.AudioFormat == "" {
		req.AudioFormat = "LOSSLESS"
	}

	var err error
	var filename string

	// Set default filename format if not provided
	if req.FilenameFormat == "" {
		req.FilenameFormat = "title-artist"
	}

	// Early check: Check if file with same ISRC already exists
	if existingFile, exists := backend.CheckISRCExists(req.OutputDir, req.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", req.ISRC, existingFile)
		return DownloadResponse{
			Success:       true,
			Message:       "File with same ISRC already exists",
			File:          existingFile,
			AlreadyExists: true,
		}, nil
	}

	// Fallback: if we have track metadata, check if file already exists by filename
	if req.TrackName != "" && req.ArtistName != "" {
		expectedFilename := backend.BuildExpectedFilename(req.TrackName, req.ArtistName, req.FilenameFormat, req.TrackNumber, req.Position, req.UseAlbumTrackNumber)
		expectedPath := filepath.Join(req.OutputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
			return DownloadResponse{
				Success:       true,
				Message:       "File already exists",
				File:          expectedPath,
				AlreadyExists: true,
			}, nil
		}
	}

	// Set downloading state
	backend.SetDownloading(true)
	defer backend.SetDownloading(false)

	switch req.Service {
	case "amazon":
		downloader := backend.NewAmazonDownloader()
		if req.ServiceURL != "" {
			// Use provided URL directly
			filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
		} else {
			if req.SpotifyID == "" {
				return DownloadResponse{
					Success: false,
					Error:   "Spotify ID is required for Amazon Music",
				}, fmt.Errorf("spotify ID is required for Amazon Music")
			}
			filename, err = downloader.DownloadBySpotifyID(req.SpotifyID, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
		}

	case "tidal":
		if req.ApiURL == "" || req.ApiURL == "auto" {
			downloader := backend.NewTidalDownloader("")
			if req.ServiceURL != "" {
				// Use provided URL directly with fallback to multiple APIs
				filename, err = downloader.DownloadByURLWithFallback(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
			} else {
				if req.SpotifyID == "" {
					return DownloadResponse{
						Success: false,
						Error:   "Spotify ID is required for Tidal",
					}, fmt.Errorf("spotify ID is required for Tidal")
				}
				filename, err = downloader.DownloadWithFallback(req.SpotifyID, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
			}
		} else {
			downloader := backend.NewTidalDownloader(req.ApiURL)
			if req.ServiceURL != "" {
				// Use provided URL directly with specific API
				filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
			} else {
				if req.SpotifyID == "" {
					return DownloadResponse{
						Success: false,
						Error:   "Spotify ID is required for Tidal",
					}, fmt.Errorf("spotify ID is required for Tidal")
				}
				filename, err = downloader.Download(req.SpotifyID, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
			}
		}

	case "qobuz":
		downloader := backend.NewQobuzDownloader()
		filename, err = downloader.DownloadByISRC(req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)

	default: // deezer
		downloader := backend.NewDeezerDownloader()
		if req.ServiceURL != "" {
			// Use provided URL directly
			filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
		} else {
			if req.SpotifyID == "" {
				return DownloadResponse{
					Success: false,
					Error:   "Spotify ID is required for Deezer",
				}, fmt.Errorf("spotify ID is required for Deezer")
			}
			filename, err = downloader.DownloadBySpotifyID(req.SpotifyID, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.UseAlbumTrackNumber)
		}
	}

	if err != nil {
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Download failed: %v", err),
		}, err
	}

	// Check if file already existed
	alreadyExists := false
	if strings.HasPrefix(filename, "EXISTS:") {
		alreadyExists = true
		filename = strings.TrimPrefix(filename, "EXISTS:")
	}

	message := "Download completed successfully"
	if alreadyExists {
		message = "File already exists"
	}

	return DownloadResponse{
		Success:       true,
		Message:       message,
		File:          filename,
		AlreadyExists: alreadyExists,
	}, nil
}

// OpenFolder opens a folder in the file explorer
func (a *App) OpenFolder(path string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}

	err := backend.OpenFolderInExplorer(path)
	if err != nil {
		return fmt.Errorf("failed to open folder: %v", err)
	}

	return nil
}

// SelectFolder opens a folder selection dialog and returns the selected path
func (a *App) SelectFolder(defaultPath string) (string, error) {
	return backend.SelectFolderDialog(a.ctx, defaultPath)
}

// SelectFile opens a file selection dialog and returns the selected file path
func (a *App) SelectFile() (string, error) {
	return backend.SelectFileDialog(a.ctx)
}

// GetDefaults returns the default configuration
func (a *App) GetDefaults() map[string]string {
	return map[string]string{
		"downloadPath": backend.GetDefaultMusicPath(),
	}
}

// GetDownloadProgress returns current download progress
func (a *App) GetDownloadProgress() backend.ProgressInfo {
	return backend.GetDownloadProgress()
}

// Quit closes the application
func (a *App) Quit() {
	// You can add cleanup logic here if needed
	panic("quit") // This will trigger Wails to close the app
}

// AnalyzeTrack analyzes audio quality of a FLAC file
func (a *App) AnalyzeTrack(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("file path is required")
	}

	result, err := backend.AnalyzeTrack(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to analyze track: %v", err)
	}

	jsonData, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// AnalyzeMultipleTracks analyzes multiple FLAC files
func (a *App) AnalyzeMultipleTracks(filePaths []string) (string, error) {
	if len(filePaths) == 0 {
		return "", fmt.Errorf("at least one file path is required")
	}

	results := make([]*backend.AnalysisResult, 0, len(filePaths))

	for _, filePath := range filePaths {
		result, err := backend.AnalyzeTrack(filePath)
		if err != nil {
			// Skip failed analyses
			continue
		}
		results = append(results, result)
	}

	jsonData, err := json.Marshal(results)
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}
