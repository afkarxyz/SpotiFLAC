package main

import (
	"context"
	"encoding/json"
	"fmt"
	"spotiflac/backend"
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
	ISRC           string `json:"isrc"`
	Service        string `json:"service"`
	Query          string `json:"query,omitempty"`
	TrackName      string `json:"track_name,omitempty"`
	ArtistName     string `json:"artist_name,omitempty"`
	AlbumName      string `json:"album_name,omitempty"`
	ApiURL         string `json:"api_url,omitempty"`
	OutputDir      string `json:"output_dir,omitempty"`
	AudioFormat    string `json:"audio_format,omitempty"`
	FilenameFormat string `json:"filename_format,omitempty"`
	TrackNumber    bool   `json:"track_number,omitempty"`
	Position       int    `json:"position,omitempty"` // Position in playlist/album (1-based)
}

// DownloadResponse represents the response structure for download operations
type DownloadResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	File    string `json:"file,omitempty"`
	Error   string `json:"error,omitempty"`
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

	// Set downloading state
	backend.SetDownloading(true)
	defer backend.SetDownloading(false)

	if req.Service == "tidal" {
		searchQuery := req.Query
		if searchQuery == "" {
			searchQuery = req.ISRC
		}

		if req.ApiURL == "" || req.ApiURL == "auto" {
			downloader := backend.NewTidalDownloader("")
			filename, err = downloader.DownloadWithFallback(searchQuery, req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName)
		} else {
			downloader := backend.NewTidalDownloader(req.ApiURL)
			filename, err = downloader.Download(searchQuery, req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName)
		}
	} else if req.Service == "qobuz" {
		downloader := backend.NewQobuzDownloader()
		err = downloader.DownloadByISRC(req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName)
		if err == nil {
			filename = "Downloaded via Qobuz"
		}
	} else {
		downloader := backend.NewDeezerDownloader()
		err = downloader.DownloadByISRC(req.ISRC, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName)
		if err == nil {
			filename = "Downloaded via Deezer"
		}
	}

	if err != nil {
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Download failed: %v", err),
		}, err
	}

	return DownloadResponse{
		Success: true,
		Message: "Download completed successfully",
		File:    filename,
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
