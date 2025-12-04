package backend

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	// Spotify image size codes
	spotifySize640 = "ab67616d0000b273" // 640x640
	spotifySizeMax = "ab67616d000082c1" // Max resolution
)

// CoverDownloadRequest represents a request to download cover art
type CoverDownloadRequest struct {
	CoverURL       string `json:"cover_url"`
	TrackName      string `json:"track_name"`
	ArtistName     string `json:"artist_name"`
	OutputDir      string `json:"output_dir"`
	FilenameFormat string `json:"filename_format"`
	TrackNumber    bool   `json:"track_number"`
	Position       int    `json:"position"`
}

// CoverDownloadResponse represents the response from cover download
type CoverDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

// CoverClient handles cover art downloading
type CoverClient struct {
	httpClient *http.Client
}

// NewCoverClient creates a new cover client
func NewCoverClient() *CoverClient {
	return &CoverClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// buildCoverFilename builds the cover filename based on settings (same as track filename)
func buildCoverFilename(trackName, artistName, filenameFormat string, includeTrackNumber bool, position int) string {
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)

	var filename string

	// Build base filename based on format
	switch filenameFormat {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
	case "title":
		filename = safeTitle
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
	}

	// Add track number prefix if enabled
	if includeTrackNumber && position > 0 {
		filename = fmt.Sprintf("%02d. %s", position, filename)
	}

	return filename + ".jpg"
}

// getMaxResolutionURL converts a Spotify cover URL to max resolution
// Falls back to original URL if max resolution is not available
func (c *CoverClient) getMaxResolutionURL(coverURL string) string {
	// Try to convert to max resolution
	if strings.Contains(coverURL, spotifySize640) {
		maxURL := strings.Replace(coverURL, spotifySize640, spotifySizeMax, 1)
		// Check if max resolution URL is available
		resp, err := c.httpClient.Head(maxURL)
		if err == nil && resp.StatusCode == http.StatusOK {
			return maxURL
		}
	}
	// Return original URL as fallback
	return coverURL
}

// DownloadCover downloads cover art for a single track
func (c *CoverClient) DownloadCover(req CoverDownloadRequest) (*CoverDownloadResponse, error) {
	if req.CoverURL == "" {
		return &CoverDownloadResponse{
			Success: false,
			Error:   "Cover URL is required",
		}, fmt.Errorf("cover URL is required")
	}

	// Create output directory if it doesn't exist
	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	// Generate filename using same format as track
	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist" // default
	}
	filename := buildCoverFilename(req.TrackName, req.ArtistName, filenameFormat, req.TrackNumber, req.Position)
	filePath := filepath.Join(outputDir, filename)

	// Check if file already exists
	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &CoverDownloadResponse{
			Success:       true,
			Message:       "Cover file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	// Try to get max resolution URL, fallback to original
	downloadURL := c.getMaxResolutionURL(req.CoverURL)

	// Download cover image
	resp, err := c.httpClient.Get(downloadURL)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download cover: %v", err),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download cover: HTTP %d", resp.StatusCode),
		}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// Create file
	file, err := os.Create(filePath)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create file: %v", err),
		}, err
	}
	defer file.Close()

	// Write content to file
	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write cover file: %v", err),
		}, err
	}

	return &CoverDownloadResponse{
		Success: true,
		Message: "Cover downloaded successfully",
		File:    filePath,
	}, nil
}
