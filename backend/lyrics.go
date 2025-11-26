package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LyricsLine represents a single line of lyrics
type LyricsLine struct {
	StartTimeMs string `json:"startTimeMs"`
	Words       string `json:"words"`
	EndTimeMs   string `json:"endTimeMs"`
}

// LyricsResponse represents the API response
type LyricsResponse struct {
	Error    bool         `json:"error"`
	SyncType string       `json:"syncType"`
	Lines    []LyricsLine `json:"lines"`
}

// LyricsDownloadRequest represents a request to download lyrics
type LyricsDownloadRequest struct {
	SpotifyID           string `json:"spotify_id"`
	TrackName           string `json:"track_name"`
	ArtistName          string `json:"artist_name"`
	OutputDir           string `json:"output_dir"`
	FilenameFormat      string `json:"filename_format"`
	TrackNumber         bool   `json:"track_number"`
	Position            int    `json:"position"`
	UseAlbumTrackNumber bool   `json:"use_album_track_number"`
}

// LyricsDownloadResponse represents the response from lyrics download
type LyricsDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

// LyricsClient handles lyrics fetching
type LyricsClient struct {
	httpClient *http.Client
}

// NewLyricsClient creates a new lyrics client
func NewLyricsClient() *LyricsClient {
	return &LyricsClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// FetchLyrics fetches lyrics from the Spotify Lyrics API
func (c *LyricsClient) FetchLyrics(spotifyID string) (*LyricsResponse, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9zcG90aWZ5LWx5cmljcy1hcGktcGkudmVyY2VsLmFwcC8/dHJhY2tpZD0=")
	url := fmt.Sprintf("%s%s", string(apiBase), spotifyID)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch lyrics: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %v", err)
	}

	var lyricsResp LyricsResponse
	if err := json.Unmarshal(body, &lyricsResp); err != nil {
		return nil, fmt.Errorf("failed to parse lyrics response: %v", err)
	}

	if lyricsResp.Error {
		return nil, fmt.Errorf("lyrics not found for this track")
	}

	return &lyricsResp, nil
}

// ConvertToLRC converts lyrics response to LRC format
func (c *LyricsClient) ConvertToLRC(lyrics *LyricsResponse, trackName, artistName string) string {
	var sb strings.Builder

	// Add metadata
	sb.WriteString(fmt.Sprintf("[ti:%s]\n", trackName))
	sb.WriteString(fmt.Sprintf("[ar:%s]\n", artistName))
	sb.WriteString("[by:SpotiFlac]\n")
	sb.WriteString("\n")

	// Add lyrics lines
	for _, line := range lyrics.Lines {
		if line.Words == "" {
			continue
		}

		// Convert milliseconds to LRC timestamp format [mm:ss.xx]
		timestamp := msToLRCTimestamp(line.StartTimeMs)
		sb.WriteString(fmt.Sprintf("%s%s\n", timestamp, line.Words))
	}

	return sb.String()
}

// msToLRCTimestamp converts milliseconds string to LRC timestamp format [mm:ss.xx]
func msToLRCTimestamp(msStr string) string {
	var ms int64
	fmt.Sscanf(msStr, "%d", &ms)

	totalSeconds := ms / 1000
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	centiseconds := (ms % 1000) / 10

	return fmt.Sprintf("[%02d:%02d.%02d]", minutes, seconds, centiseconds)
}

// buildLyricsFilename builds the lyrics filename based on settings (same as track filename)
func buildLyricsFilename(trackName, artistName, filenameFormat string, includeTrackNumber bool, position int) string {
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

	return filename + ".lrc"
}

// DownloadLyrics downloads lyrics for a single track
func (c *LyricsClient) DownloadLyrics(req LyricsDownloadRequest) (*LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	// Create output directory if it doesn't exist
	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	// Generate filename using same format as track
	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist" // default
	}
	filename := buildLyricsFilename(req.TrackName, req.ArtistName, filenameFormat, req.TrackNumber, req.Position)
	filePath := filepath.Join(outputDir, filename)

	// Check if file already exists
	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &LyricsDownloadResponse{
			Success:       true,
			Message:       "Lyrics file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	// Fetch lyrics
	lyrics, err := c.FetchLyrics(req.SpotifyID)
	if err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	// Convert to LRC format
	lrcContent := c.ConvertToLRC(lyrics, req.TrackName, req.ArtistName)

	// Write LRC file
	if err := os.WriteFile(filePath, []byte(lrcContent), 0644); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write LRC file: %v", err),
		}, err
	}

	return &LyricsDownloadResponse{
		Success: true,
		Message: "Lyrics downloaded successfully",
		File:    filePath,
	}, nil
}
