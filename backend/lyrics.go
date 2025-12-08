package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LRCLibResponse represents the LRCLIB API response
type LRCLibResponse struct {
	ID            int     `json:"id"`
	Name          string  `json:"name"`
	TrackName     string  `json:"trackName"`
	ArtistName    string  `json:"artistName"`
	AlbumName     string  `json:"albumName"`
	Duration      float64 `json:"duration"`
	Instrumental  bool    `json:"instrumental"`
	PlainLyrics   string  `json:"plainLyrics"`
	SyncedLyrics  string  `json:"syncedLyrics"`
}

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

// FetchLyricsWithMetadata fetches lyrics using track name and artist (for LRCLIB fallback)
func (c *LyricsClient) FetchLyricsWithMetadata(trackName, artistName string) (*LyricsResponse, error) {
	// Try LRCLIB API
	apiURL := fmt.Sprintf("https://lrclib.net/api/get?artist_name=%s&track_name=%s",
		url.QueryEscape(artistName),
		url.QueryEscape(trackName))

	resp, err := c.httpClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from LRCLIB: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("LRCLIB returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read LRCLIB response: %v", err)
	}

	var lrcLibResp LRCLibResponse
	if err := json.Unmarshal(body, &lrcLibResp); err != nil {
		return nil, fmt.Errorf("failed to parse LRCLIB response: %v", err)
	}

	// Convert LRCLIB response to our LyricsResponse format
	return c.convertLRCLibToLyricsResponse(&lrcLibResp), nil
}

// convertLRCLibToLyricsResponse converts LRCLIB response to our standard format
func (c *LyricsClient) convertLRCLibToLyricsResponse(lrcLib *LRCLibResponse) *LyricsResponse {
	resp := &LyricsResponse{
		Error:    false,
		SyncType: "LINE_SYNCED",
		Lines:    []LyricsLine{},
	}

	// Prefer synced lyrics, fall back to plain
	lyricsText := lrcLib.SyncedLyrics
	if lyricsText == "" {
		lyricsText = lrcLib.PlainLyrics
		resp.SyncType = "UNSYNCED"
	}

	if lyricsText == "" {
		resp.Error = true
		return resp
	}

	// Parse synced lyrics format [mm:ss.xx] text
	lines := strings.Split(lyricsText, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Check if line has timestamp [mm:ss.xx]
		if strings.HasPrefix(line, "[") && len(line) > 10 {
			closeBracket := strings.Index(line, "]")
			if closeBracket > 0 {
				timestamp := line[1:closeBracket]
				words := strings.TrimSpace(line[closeBracket+1:])

				// Convert [mm:ss.xx] to milliseconds
				ms := lrcTimestampToMs(timestamp)
				resp.Lines = append(resp.Lines, LyricsLine{
					StartTimeMs: fmt.Sprintf("%d", ms),
					Words:       words,
				})
				continue
			}
		}

		// Plain lyrics line (no timestamp)
		resp.Lines = append(resp.Lines, LyricsLine{
			StartTimeMs: "0",
			Words:       line,
		})
	}

	return resp
}

// lrcTimestampToMs converts LRC timestamp [mm:ss.xx] to milliseconds
func lrcTimestampToMs(timestamp string) int64 {
	var minutes, seconds, centiseconds int64
	// Try parsing mm:ss.xx format
	n, _ := fmt.Sscanf(timestamp, "%d:%d.%d", &minutes, &seconds, &centiseconds)
	if n >= 2 {
		return minutes*60*1000 + seconds*1000 + centiseconds*10
	}
	return 0
}

// FetchLyricsFromLRCLibSearch fetches lyrics using LRCLIB search API
func (c *LyricsClient) FetchLyricsFromLRCLibSearch(trackName, artistName string) (*LyricsResponse, error) {
	query := fmt.Sprintf("%s %s", artistName, trackName)
	apiURL := fmt.Sprintf("https://lrclib.net/api/search?q=%s", url.QueryEscape(query))

	resp, err := c.httpClient.Get(apiURL)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read failed: %v", err)
	}

	var results []LRCLibResponse
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("parse failed: %v", err)
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("no results found")
	}

	// Find best match - prefer one with synced lyrics
	var best *LRCLibResponse
	for i := range results {
		if results[i].SyncedLyrics != "" {
			best = &results[i]
			break
		}
		if best == nil && results[i].PlainLyrics != "" {
			best = &results[i]
		}
	}

	if best == nil {
		best = &results[0]
	}

	return c.convertLRCLibToLyricsResponse(best), nil
}

// simplifyTrackName removes common suffixes like "(feat. X)", "(Remastered)", etc.
func simplifyTrackName(name string) string {
	// Remove content in parentheses
	if idx := strings.Index(name, "("); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}
	// Remove content after " - " (like "From the Motion Picture")
	if idx := strings.Index(name, " - "); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}
	return name
}

// FetchLyricsAllSources tries all sources to get lyrics
func (c *LyricsClient) FetchLyricsAllSources(spotifyID, trackName, artistName string) (*LyricsResponse, string, error) {
	// 1. Try Spotify API
	if spotifyID != "" {
		resp, err := c.FetchLyrics(spotifyID)
		if err == nil && resp != nil && len(resp.Lines) > 0 {
			return resp, "Spotify", nil
		}
		fmt.Printf("   ↳ Spotify API: %v\n", err)
	}

	// 2. Try LRCLIB exact match
	resp, err := c.FetchLyricsWithMetadata(trackName, artistName)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB", nil
	}
	fmt.Printf("   ↳ LRCLIB exact: %v\n", err)

	// 3. Try LRCLIB search
	resp, err = c.FetchLyricsFromLRCLibSearch(trackName, artistName)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB Search", nil
	}
	fmt.Printf("   ↳ LRCLIB search: %v\n", err)

	// 4. Try with simplified track name (remove parentheses, subtitles)
	simplifiedTrack := simplifyTrackName(trackName)
	if simplifiedTrack != trackName {
		fmt.Printf("   ↳ Trying simplified name: %s\n", simplifiedTrack)
		
		resp, err = c.FetchLyricsWithMetadata(simplifiedTrack, artistName)
		if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
			return resp, "LRCLIB (simplified)", nil
		}

		resp, err = c.FetchLyricsFromLRCLibSearch(simplifiedTrack, artistName)
		if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
			return resp, "LRCLIB Search (simplified)", nil
		}
	}

	return nil, "", fmt.Errorf("lyrics not found in any source")
}

// FetchLyrics fetches lyrics from the Spotify Lyrics API with LRCLIB fallback
func (c *LyricsClient) FetchLyrics(spotifyID string) (*LyricsResponse, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9zcG90aWZ5LWx5cmljcy1hcGktcGkudmVyY2VsLmFwcC8/dHJhY2tpZD0=")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), spotifyID)

	resp, err := c.httpClient.Get(apiURL)
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
