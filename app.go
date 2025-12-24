package main

import (
	"context"
	"encoding/base64"
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
	ISRC                 string `json:"isrc"`
	Service              string `json:"service"`
	Query                string `json:"query,omitempty"`
	TrackName            string `json:"track_name,omitempty"`
	ArtistName           string `json:"artist_name,omitempty"`
	AlbumName            string `json:"album_name,omitempty"`
	AlbumArtist          string `json:"album_artist,omitempty"`
	ReleaseDate          string `json:"release_date,omitempty"`
	CoverURL             string `json:"cover_url,omitempty"` // Spotify cover URL for embedding
	ApiURL               string `json:"api_url,omitempty"`
	OutputDir            string `json:"output_dir,omitempty"`
	AudioFormat          string `json:"audio_format,omitempty"`
	FilenameFormat       string `json:"filename_format,omitempty"`
	TrackNumber          bool   `json:"track_number,omitempty"`
	Position             int    `json:"position,omitempty"`                // Position in playlist/album (1-based)
	UseAlbumTrackNumber  bool   `json:"use_album_track_number,omitempty"`  // Use album track number instead of playlist position
	SpotifyID            string `json:"spotify_id,omitempty"`              // Spotify track ID
	EmbedLyrics          bool   `json:"embed_lyrics,omitempty"`            // Whether to embed lyrics into the audio file
	EmbedMaxQualityCover bool   `json:"embed_max_quality_cover,omitempty"` // Whether to embed max quality cover art
	ServiceURL           string `json:"service_url,omitempty"`             // Direct service URL (Tidal/Deezer/Amazon) to skip song.link API call
	Duration             int    `json:"duration,omitempty"`                // Track duration in seconds for better matching
	ItemID               string `json:"item_id,omitempty"`                 // Optional queue item ID for multi-service fallback tracking
	SpotifyTrackNumber   int    `json:"spotify_track_number,omitempty"`    // Track number from Spotify album
	SpotifyDiscNumber    int    `json:"spotify_disc_number,omitempty"`     // Disc number from Spotify album
	SpotifyTotalTracks   int    `json:"spotify_total_tracks,omitempty"`    // Total tracks in album from Spotify
}

// DownloadResponse represents the response structure for download operations
type DownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
	ItemID        string `json:"item_id,omitempty"` // Queue item ID for tracking
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

// SpotifySearchRequest represents the request structure for searching Spotify
type SpotifySearchRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit"`
}

// SearchSpotify searches for tracks, albums, artists, and playlists on Spotify
func (a *App) SearchSpotify(req SpotifySearchRequest) (*backend.SearchResponse, error) {
	if req.Query == "" {
		return nil, fmt.Errorf("search query is required")
	}

	if req.Limit <= 0 {
		req.Limit = 10
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return backend.SearchSpotify(ctx, req.Query, req.Limit)
}

// SpotifySearchByTypeRequest represents the request for searching by specific type with offset
type SpotifySearchByTypeRequest struct {
	Query      string `json:"query"`
	SearchType string `json:"search_type"` // track, album, artist, playlist
	Limit      int    `json:"limit"`
	Offset     int    `json:"offset"`
}

// SearchSpotifyByType searches for a specific type with offset support for pagination
func (a *App) SearchSpotifyByType(req SpotifySearchByTypeRequest) ([]backend.SearchResult, error) {
	if req.Query == "" {
		return nil, fmt.Errorf("search query is required")
	}

	if req.SearchType == "" {
		return nil, fmt.Errorf("search type is required")
	}

	if req.Limit <= 0 {
		req.Limit = 50
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return backend.SearchSpotifyByType(ctx, req.Query, req.SearchType, req.Limit, req.Offset)
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
		req.Service = "tidal"
	}

	if req.OutputDir == "" {
		req.OutputDir = "."
	} else {
		// Only normalize path separators, don't sanitize user's existing folder names
		req.OutputDir = backend.NormalizePath(req.OutputDir)
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

	// ItemID should always be provided by frontend (created via AddToDownloadQueue)
	// If not provided, generate one for backwards compatibility
	itemID := req.ItemID
	if itemID == "" {
		itemID = fmt.Sprintf("%s-%d", req.ISRC, time.Now().UnixNano())
		// Add to queue if no ItemID was provided (legacy support)
		backend.AddToQueue(itemID, req.TrackName, req.ArtistName, req.AlbumName, req.ISRC)
	}

	// Mark item as downloading immediately
	backend.SetDownloading(true)
	backend.StartDownloadItem(itemID)
	defer backend.SetDownloading(false)

	// Early check: Check if file with same ISRC already exists
	if existingFile, exists := backend.CheckISRCExists(req.OutputDir, req.ISRC); exists {
		fmt.Printf("File with ISRC %s already exists: %s\n", req.ISRC, existingFile)
		backend.SkipDownloadItem(itemID, existingFile)
		return DownloadResponse{
			Success:       true,
			Message:       "File with same ISRC already exists",
			File:          existingFile,
			AlreadyExists: true,
			ItemID:        itemID,
		}, nil
	}

	// Fallback: if we have track metadata, check if file already exists by filename
	if req.TrackName != "" && req.ArtistName != "" {
		expectedFilename := backend.BuildExpectedFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.FilenameFormat, req.TrackNumber, req.Position, req.SpotifyDiscNumber, req.UseAlbumTrackNumber)
		expectedPath := filepath.Join(req.OutputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 100*1024 {
			// Validate the file by checking if it has valid ISRC metadata
			if fileISRC, readErr := backend.ReadISRCFromFile(expectedPath); readErr == nil && fileISRC != "" {
				// File exists and has valid metadata - skip download
				backend.SkipDownloadItem(itemID, expectedPath)
				return DownloadResponse{
					Success:       true,
					Message:       "File already exists",
					File:          expectedPath,
					AlreadyExists: true,
					ItemID:        itemID,
				}, nil
			} else {
				// File exists but has no valid ISRC metadata - it's corrupted, delete it
				fmt.Printf("Removing corrupted file (no valid ISRC metadata): %s\n", expectedPath)
				if removeErr := os.Remove(expectedPath); removeErr != nil {
					fmt.Printf("Warning: Failed to remove corrupted file %s: %v\n", expectedPath, removeErr)
				}
			}
		}
	}

	switch req.Service {
	case "amazon":
		downloader := backend.NewAmazonDownloader()
		if req.ServiceURL != "" {
			// Use provided URL directly
			filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.CoverURL, req.ISRC, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.EmbedMaxQualityCover)
		} else {
			if req.SpotifyID == "" {
				return DownloadResponse{
					Success: false,
					Error:   "Spotify ID is required for Amazon Music",
				}, fmt.Errorf("spotify ID is required for Amazon Music")
			}
			filename, err = downloader.DownloadBySpotifyID(req.SpotifyID, req.OutputDir, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.CoverURL, req.ISRC, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.EmbedMaxQualityCover)
		}

	case "tidal":
		if req.ApiURL == "" || req.ApiURL == "auto" {
			downloader := backend.NewTidalDownloader("")
			if req.ServiceURL != "" {
				// Use provided URL directly with fallback to multiple APIs
				filename, err = downloader.DownloadByURLWithFallback(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.ISRC)
			} else {
				if req.SpotifyID == "" {
					return DownloadResponse{
						Success: false,
						Error:   "Spotify ID is required for Tidal",
					}, fmt.Errorf("spotify ID is required for Tidal")
				}
				// Use ISRC matching for search fallback
				filename, err = downloader.DownloadWithFallbackAndISRC(req.SpotifyID, req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.Duration, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks)
			}
		} else {
			downloader := backend.NewTidalDownloader(req.ApiURL)
			if req.ServiceURL != "" {
				// Use provided URL directly with specific API
				filename, err = downloader.DownloadByURL(req.ServiceURL, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks, req.ISRC)
			} else {
				if req.SpotifyID == "" {
					return DownloadResponse{
						Success: false,
						Error:   "Spotify ID is required for Tidal",
					}, fmt.Errorf("spotify ID is required for Tidal")
				}
				// Use ISRC matching for search fallback
				filename, err = downloader.DownloadWithISRC(req.SpotifyID, req.ISRC, req.OutputDir, req.AudioFormat, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.Duration, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks)
			}
		}

	case "qobuz":
		downloader := backend.NewQobuzDownloader()
		// Default to "6" (FLAC 16-bit) for Qobuz if not specified
		quality := req.AudioFormat
		if quality == "" {
			quality = "6"
		}
		filename, err = downloader.DownloadByISRC(req.ISRC, req.OutputDir, quality, req.FilenameFormat, req.TrackNumber, req.Position, req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, req.UseAlbumTrackNumber, req.CoverURL, req.EmbedMaxQualityCover, req.SpotifyTrackNumber, req.SpotifyDiscNumber, req.SpotifyTotalTracks)

	default:
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Unknown service: %s", req.Service),
		}, fmt.Errorf("unknown service: %s", req.Service)
	}

	if err != nil {
		// Clean up any partial/corrupted file that was created during failed download
		if filename != "" && !strings.HasPrefix(filename, "EXISTS:") {
			// Check if file exists and delete it
			if _, statErr := os.Stat(filename); statErr == nil {
				fmt.Printf("Removing corrupted/partial file after failed download: %s\n", filename)
				if removeErr := os.Remove(filename); removeErr != nil {
					fmt.Printf("Warning: Failed to remove corrupted file %s: %v\n", filename, removeErr)
				}
			}
		}

		// Don't mark as failed in backend - let the frontend handle it
		// Frontend will call MarkDownloadItemFailed after all services are tried
		return DownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("Download failed: %v", err),
			ItemID:  itemID,
		}, err
	}

	// Check if file already existed
	alreadyExists := false
	if strings.HasPrefix(filename, "EXISTS:") {
		alreadyExists = true
		filename = strings.TrimPrefix(filename, "EXISTS:")
	}

	// Embed lyrics after successful download (only for new downloads with Spotify ID and if embedLyrics is enabled)
	if !alreadyExists && req.SpotifyID != "" && req.EmbedLyrics && strings.HasSuffix(filename, ".flac") {
		go func(filePath, spotifyID, trackName, artistName string) {
			fmt.Printf("\n========== LYRICS FETCH START ==========\n")
			fmt.Printf("Spotify ID: %s\n", spotifyID)
			fmt.Printf("Track: %s\n", trackName)
			fmt.Printf("Artist: %s\n", artistName)
			fmt.Println("Searching all sources...")

			lyricsClient := backend.NewLyricsClient()

			// Try all sources with fallbacks
			lyricsResp, source, err := lyricsClient.FetchLyricsAllSources(spotifyID, trackName, artistName)
			if err != nil {
				fmt.Printf("All sources failed: %v\n", err)
				fmt.Printf("========== LYRICS FETCH END (FAILED) ==========\n\n")
				return
			}

			if lyricsResp == nil || len(lyricsResp.Lines) == 0 {
				fmt.Println("No lyrics content found")
				fmt.Printf("========== LYRICS FETCH END (FAILED) ==========\n\n")
				return
			}

			fmt.Printf("Lyrics found from: %s\n", source)
			fmt.Printf("Sync type: %s\n", lyricsResp.SyncType)
			fmt.Printf("Total lines: %d\n", len(lyricsResp.Lines))

			lyrics := lyricsClient.ConvertToLRC(lyricsResp, trackName, artistName)
			if lyrics == "" {
				fmt.Println("No lyrics content to embed")
				fmt.Printf("========== LYRICS FETCH END (FAILED) ==========\n\n")
				return
			}

			// Show full lyrics in console for debugging
			fmt.Printf("\n--- Full LRC Content ---\n")
			fmt.Println(lyrics)
			fmt.Printf("--- End LRC Content ---\n\n")

			fmt.Printf("Embedding into: %s\n", filePath)
			if err := backend.EmbedLyricsOnly(filePath, lyrics); err != nil {
				fmt.Printf("Failed to embed lyrics: %v\n", err)
				fmt.Printf("========== LYRICS FETCH END (FAILED) ==========\n\n")
			} else {
				fmt.Printf("Lyrics embedded successfully!\n")
				fmt.Printf("========== LYRICS FETCH END (SUCCESS) ==========\n\n")
			}
		}(filename, req.SpotifyID, req.TrackName, req.ArtistName)
	}

	message := "Download completed successfully"
	if alreadyExists {
		message = "File already exists"
		backend.SkipDownloadItem(itemID, filename)
	} else {
		// Get file size for completed download
		if fileInfo, statErr := os.Stat(filename); statErr == nil {
			finalSize := float64(fileInfo.Size()) / (1024 * 1024) // Convert to MB
			backend.CompleteDownloadItem(itemID, filename, finalSize)
		} else {
			// Fallback: mark as completed without size
			backend.CompleteDownloadItem(itemID, filename, 0)
		}
	}

	return DownloadResponse{
		Success:       true,
		Message:       message,
		File:          filename,
		AlreadyExists: alreadyExists,
		ItemID:        itemID,
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

// GetDownloadQueue returns the complete download queue state
func (a *App) GetDownloadQueue() backend.DownloadQueueInfo {
	return backend.GetDownloadQueue()
}

// ClearCompletedDownloads clears completed, failed, and skipped items from the queue
func (a *App) ClearCompletedDownloads() {
	backend.ClearDownloadQueue()
}

// ClearAllDownloads clears the entire queue and resets session stats
func (a *App) ClearAllDownloads() {
	backend.ClearAllDownloads()
}

// AddToDownloadQueue adds a new item to the download queue and returns its ID
func (a *App) AddToDownloadQueue(isrc, trackName, artistName, albumName string) string {
	itemID := fmt.Sprintf("%s-%d", isrc, time.Now().UnixNano())
	backend.AddToQueue(itemID, trackName, artistName, albumName, isrc)
	return itemID
}

// MarkDownloadItemFailed marks a download item as failed
func (a *App) MarkDownloadItemFailed(itemID, errorMsg string) {
	backend.FailDownloadItem(itemID, errorMsg)
}

// CancelAllQueuedItems marks all queued items as cancelled/skipped
func (a *App) CancelAllQueuedItems() {
	backend.CancelAllQueuedItems()
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

// LyricsDownloadRequest represents the request structure for downloading lyrics
type LyricsDownloadRequest struct {
	SpotifyID           string `json:"spotify_id"`
	TrackName           string `json:"track_name"`
	ArtistName          string `json:"artist_name"`
	AlbumName           string `json:"album_name"`
	AlbumArtist         string `json:"album_artist"`
	ReleaseDate         string `json:"release_date"`
	OutputDir           string `json:"output_dir"`
	FilenameFormat      string `json:"filename_format"`
	TrackNumber         bool   `json:"track_number"`
	Position            int    `json:"position"`
	UseAlbumTrackNumber bool   `json:"use_album_track_number"`
	DiscNumber          int    `json:"disc_number"`
}

// DownloadLyrics downloads lyrics for a single track
func (a *App) DownloadLyrics(req LyricsDownloadRequest) (backend.LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return backend.LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	client := backend.NewLyricsClient()
	backendReq := backend.LyricsDownloadRequest{
		SpotifyID:           req.SpotifyID,
		TrackName:           req.TrackName,
		ArtistName:          req.ArtistName,
		AlbumName:           req.AlbumName,
		AlbumArtist:         req.AlbumArtist,
		ReleaseDate:         req.ReleaseDate,
		OutputDir:           req.OutputDir,
		FilenameFormat:      req.FilenameFormat,
		TrackNumber:         req.TrackNumber,
		Position:            req.Position,
		UseAlbumTrackNumber: req.UseAlbumTrackNumber,
		DiscNumber:          req.DiscNumber,
	}

	resp, err := client.DownloadLyrics(backendReq)
	if err != nil {
		return backend.LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

// CoverDownloadRequest represents the request structure for downloading cover art
type CoverDownloadRequest struct {
	CoverURL       string `json:"cover_url"`
	TrackName      string `json:"track_name"`
	ArtistName     string `json:"artist_name"`
	AlbumName      string `json:"album_name"`
	AlbumArtist    string `json:"album_artist"`
	ReleaseDate    string `json:"release_date"`
	OutputDir      string `json:"output_dir"`
	FilenameFormat string `json:"filename_format"`
	TrackNumber    bool   `json:"track_number"`
	Position       int    `json:"position"`
	DiscNumber     int    `json:"disc_number"`
}

// DownloadCover downloads cover art for a single track
func (a *App) DownloadCover(req CoverDownloadRequest) (backend.CoverDownloadResponse, error) {
	if req.CoverURL == "" {
		return backend.CoverDownloadResponse{
			Success: false,
			Error:   "Cover URL is required",
		}, fmt.Errorf("cover URL is required")
	}

	client := backend.NewCoverClient()
	backendReq := backend.CoverDownloadRequest{
		CoverURL:       req.CoverURL,
		TrackName:      req.TrackName,
		ArtistName:     req.ArtistName,
		AlbumName:      req.AlbumName,
		AlbumArtist:    req.AlbumArtist,
		ReleaseDate:    req.ReleaseDate,
		OutputDir:      req.OutputDir,
		FilenameFormat: req.FilenameFormat,
		TrackNumber:    req.TrackNumber,
		Position:       req.Position,
		DiscNumber:     req.DiscNumber,
	}

	resp, err := client.DownloadCover(backendReq)
	if err != nil {
		return backend.CoverDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	return *resp, nil
}

// CheckTrackAvailability checks the availability of a track on different streaming platforms
func (a *App) CheckTrackAvailability(spotifyTrackID string, isrc string) (string, error) {
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required")
	}

	client := backend.NewSongLinkClient()
	availability, err := client.CheckTrackAvailability(spotifyTrackID, isrc)
	if err != nil {
		return "", err
	}

	jsonData, err := json.Marshal(availability)
	if err != nil {
		return "", fmt.Errorf("failed to encode response: %v", err)
	}

	return string(jsonData), nil
}

// IsFFmpegInstalled checks if ffmpeg is installed
func (a *App) IsFFmpegInstalled() (bool, error) {
	return backend.IsFFmpegInstalled()
}

// IsFFprobeInstalled checks if ffprobe is installed
func (a *App) IsFFprobeInstalled() (bool, error) {
	return backend.IsFFprobeInstalled()
}

// GetFFmpegPath returns the path to ffmpeg
func (a *App) GetFFmpegPath() (string, error) {
	return backend.GetFFmpegPath()
}

// DownloadFFmpegRequest represents a request to download ffmpeg
type DownloadFFmpegRequest struct{}

// DownloadFFmpegResponse represents the response from downloading ffmpeg
type DownloadFFmpegResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// DownloadFFmpeg downloads and installs ffmpeg
func (a *App) DownloadFFmpeg() DownloadFFmpegResponse {
	err := backend.DownloadFFmpeg(func(progress int) {
		fmt.Printf("[FFmpeg] Download progress: %d%%\n", progress)
	})
	if err != nil {
		return DownloadFFmpegResponse{
			Success: false,
			Error:   err.Error(),
		}
	}

	return DownloadFFmpegResponse{
		Success: true,
		Message: "FFmpeg installed successfully",
	}
}

// ConvertAudioRequest represents a request to convert audio files
type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"`
	Bitrate      string   `json:"bitrate"`
	Codec        string   `json:"codec"` // For m4a: "aac" (lossy) or "alac" (lossless)
}

// ConvertAudio converts audio files using ffmpeg
func (a *App) ConvertAudio(req ConvertAudioRequest) ([]backend.ConvertAudioResult, error) {
	backendReq := backend.ConvertAudioRequest{
		InputFiles:   req.InputFiles,
		OutputFormat: req.OutputFormat,
		Bitrate:      req.Bitrate,
		Codec:        req.Codec,
	}
	return backend.ConvertAudio(backendReq)
}

// SelectAudioFiles opens a file dialog to select audio files for conversion
func (a *App) SelectAudioFiles() ([]string, error) {
	files, err := backend.SelectMultipleFiles(a.ctx)
	if err != nil {
		return nil, err
	}
	return files, nil
}

// GetFileSizes returns file sizes for a list of file paths
func (a *App) GetFileSizes(files []string) map[string]int64 {
	return backend.GetFileSizes(files)
}

// ListDirectoryFiles lists files and folders in a directory
func (a *App) ListDirectoryFiles(dirPath string) ([]backend.FileInfo, error) {
	if dirPath == "" {
		return nil, fmt.Errorf("directory path is required")
	}
	return backend.ListDirectory(dirPath)
}

// ListAudioFilesInDir lists only audio files in a directory recursively
func (a *App) ListAudioFilesInDir(dirPath string) ([]backend.FileInfo, error) {
	if dirPath == "" {
		return nil, fmt.Errorf("directory path is required")
	}
	return backend.ListAudioFiles(dirPath)
}

// ReadFileMetadata reads metadata from an audio file
func (a *App) ReadFileMetadata(filePath string) (*backend.AudioMetadata, error) {
	if filePath == "" {
		return nil, fmt.Errorf("file path is required")
	}
	return backend.ReadAudioMetadata(filePath)
}

// PreviewRenameFiles generates a preview of rename operations
func (a *App) PreviewRenameFiles(files []string, format string) []backend.RenamePreview {
	return backend.PreviewRename(files, format)
}

// RenameFilesByMetadata renames files based on their metadata
func (a *App) RenameFilesByMetadata(files []string, format string) []backend.RenameResult {
	return backend.RenameFiles(files, format)
}

// ReadTextFile reads a text file and returns its content
func (a *App) ReadTextFile(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// RenameFileTo renames a file to a new name (keeping same directory)
func (a *App) RenameFileTo(oldPath, newName string) error {
	dir := filepath.Dir(oldPath)
	ext := filepath.Ext(oldPath)
	newPath := filepath.Join(dir, newName+ext)
	return os.Rename(oldPath, newPath)
}

// ReadImageAsBase64 reads an image file and returns it as base64 data URL
func (a *App) ReadImageAsBase64(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	
	ext := strings.ToLower(filepath.Ext(filePath))
	var mimeType string
	switch ext {
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".png":
		mimeType = "image/png"
	case ".gif":
		mimeType = "image/gif"
	case ".webp":
		mimeType = "image/webp"
	default:
		mimeType = "image/jpeg"
	}
	
	encoded := base64.StdEncoding.EncodeToString(content)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}

// CheckFileExistenceRequest represents a track to check for existence
type CheckFileExistenceRequest struct {
	ISRC       string `json:"isrc"`
	TrackName  string `json:"track_name"`
	ArtistName string `json:"artist_name"`
}

// CheckFilesExistence checks if multiple files already exist in the output directory
// This is done in parallel for better performance
func (a *App) CheckFilesExistence(outputDir string, tracks []CheckFileExistenceRequest) []backend.FileExistenceResult {
	// Convert to backend struct format
	backendTracks := make([]struct {
		ISRC       string
		TrackName  string
		ArtistName string
	}, len(tracks))

	for i, t := range tracks {
		backendTracks[i] = struct {
			ISRC       string
			TrackName  string
			ArtistName string
		}{
			ISRC:       t.ISRC,
			TrackName:  t.TrackName,
			ArtistName: t.ArtistName,
		}
	}

	return backend.CheckFilesExistParallel(outputDir, backendTracks)
}

// SkipDownloadItem marks a download item as skipped (file already exists)
func (a *App) SkipDownloadItem(itemID, filePath string) {
	backend.SkipDownloadItem(itemID, filePath)
}
