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
	"regexp"
	"strings"
	"time"
)

type LRCLibResponse struct {
	ID           int     `json:"id"`
	Name         string  `json:"name"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	AlbumName    string  `json:"albumName"`
	Duration     float64 `json:"duration"`
	Instrumental bool    `json:"instrumental"`
	PlainLyrics  string  `json:"plainLyrics"`
	SyncedLyrics string  `json:"syncedLyrics"`
}

type LyricsLine struct {
	StartTimeMs string `json:"startTimeMs"`
	Words       string `json:"words"`
	EndTimeMs   string `json:"endTimeMs"`
}

type LyricsResponse struct {
	Error    bool         `json:"error"`
	SyncType string       `json:"syncType"`
	Lines    []LyricsLine `json:"lines"`
}

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

type LyricsDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

type LyricsClient struct {
	httpClient *http.Client
}

func NewLyricsClient() *LyricsClient {
	return &LyricsClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *LyricsClient) FetchLyricsWithMetadata(trackName, artistName string, duration int) (*LyricsResponse, error) {

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9scmNsaWIubmV0L2FwaS9nZXQ/YXJ0aXN0X25hbWU9")
	apiURL := fmt.Sprintf("%s%s&track_name=%s",
		string(apiBase),
		url.QueryEscape(artistName),
		url.QueryEscape(trackName))

	if duration > 0 {
		apiURL = fmt.Sprintf("%s&duration=%d", apiURL, duration)
	}

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

	return c.convertLRCLibToLyricsResponse(&lrcLibResp), nil
}

func (c *LyricsClient) convertLRCLibToLyricsResponse(lrcLib *LRCLibResponse) *LyricsResponse {
	resp := &LyricsResponse{
		Error:    false,
		SyncType: "LINE_SYNCED",
		Lines:    []LyricsLine{},
	}

	lyricsText := lrcLib.SyncedLyrics
	if lyricsText == "" {
		lyricsText = lrcLib.PlainLyrics
		resp.SyncType = "UNSYNCED"
	}

	if lyricsText == "" {
		resp.Error = true
		return resp
	}

	lines := strings.Split(lyricsText, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "[") && len(line) > 10 {
			closeBracket := strings.Index(line, "]")
			if closeBracket > 0 {
				timestamp := line[1:closeBracket]
				words := strings.TrimSpace(line[closeBracket+1:])

				ms := lrcTimestampToMs(timestamp)
				resp.Lines = append(resp.Lines, LyricsLine{
					StartTimeMs: fmt.Sprintf("%d", ms),
					Words:       words,
				})
				continue
			}
		}

		resp.Lines = append(resp.Lines, LyricsLine{
			StartTimeMs: "",
			Words:       line,
		})
	}

	return resp
}

func lrcTimestampToMs(timestamp string) int64 {
	var minutes, seconds, centiseconds int64

	n, _ := fmt.Sscanf(timestamp, "%d:%d.%d", &minutes, &seconds, &centiseconds)
	if n >= 2 {
		return minutes*60*1000 + seconds*1000 + centiseconds*10
	}
	return 0
}

func (c *LyricsClient) FetchLyricsFromLRCLibSearch(trackName, artistName string) (*LyricsResponse, error) {
	query := fmt.Sprintf("%s %s", artistName, trackName)
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9scmNsaWIubmV0L2FwaS9zZWFyY2g/cT0=")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(query))

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

func simplifyTrackName(name string) string {

	if idx := strings.Index(name, "("); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}

	if idx := strings.Index(name, " - "); idx > 0 {
		name = strings.TrimSpace(name[:idx])
	}
	return name
}

func (c *LyricsClient) FetchLyricsAllSources(spotifyID, trackName, artistName string, duration int) (*LyricsResponse, string, error) {

	resp, err := c.FetchLyricsWithMetadata(trackName, artistName, duration)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB", nil
	}
	fmt.Printf("   LRCLIB exact: %v\n", err)

	resp, err = c.FetchLyricsFromLRCLibSearch(trackName, artistName)
	if err == nil && resp != nil && !resp.Error && len(resp.Lines) > 0 {
		return resp, "LRCLIB Search", nil
	}
	fmt.Printf("   LRCLIB search: %v\n", err)

	simplifiedTrack := simplifyTrackName(trackName)
	if simplifiedTrack != trackName {
		fmt.Printf("   Trying simplified name: %s\n", simplifiedTrack)

		resp, err = c.FetchLyricsWithMetadata(simplifiedTrack, artistName, duration)
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

func (c *LyricsClient) ConvertToLRC(lyrics *LyricsResponse, trackName, artistName string) string {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("[ti:%s]\n", trackName))
	sb.WriteString(fmt.Sprintf("[ar:%s]\n", artistName))
	sb.WriteString("[by:SpotiFlac]\n")
	sb.WriteString("\n")

	for _, line := range lyrics.Lines {
		if line.Words == "" {
			continue
		}

		if line.StartTimeMs == "" {
			sb.WriteString(fmt.Sprintf("%s\n", line.Words))
		} else {

			timestamp := msToLRCTimestamp(line.StartTimeMs)
			sb.WriteString(fmt.Sprintf("%s%s\n", timestamp, line.Words))
		}
	}

	return sb.String()
}

func msToLRCTimestamp(msStr string) string {
	var ms int64
	fmt.Sscanf(msStr, "%d", &ms)

	totalSeconds := ms / 1000
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	centiseconds := (ms % 1000) / 10

	return fmt.Sprintf("[%02d:%02d.%02d]", minutes, seconds, centiseconds)
}

func buildLyricsFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat string, includeTrackNumber bool, position, discNumber int) string {
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)
	safeAlbum := sanitizeFilename(albumName)
	safeAlbumArtist := sanitizeFilename(albumArtist)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title":
			filename = safeTitle
		default:
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", position, filename)
		}
	}

	return filename + ".lrc"
}

func findAudioFileForLyrics(dir, trackName, artistName string) string {

	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)

	audioExts := []string{".flac", ".mp3", ".m4a", ".FLAC", ".MP3", ".M4A"}

	patterns := []string{
		fmt.Sprintf("%s - %s", safeTitle, safeArtist),
		fmt.Sprintf("%s - %s", safeArtist, safeTitle),
		safeTitle,
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filename := entry.Name()
		baseName := strings.TrimSuffix(filename, filepath.Ext(filename))

		for _, pattern := range patterns {
			if strings.HasPrefix(baseName, pattern) || strings.Contains(baseName, pattern) {
				ext := strings.ToLower(filepath.Ext(filename))
				for _, audioExt := range audioExts {
					if ext == strings.ToLower(audioExt) {
						return filepath.Join(dir, filename)
					}
				}
			}
		}
	}

	return ""
}

func (c *LyricsClient) DownloadLyrics(req LyricsDownloadRequest) (*LyricsDownloadResponse, error) {
	if req.SpotifyID == "" {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   "Spotify ID is required",
		}, fmt.Errorf("spotify ID is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	safeArtist := sanitizeFilename(req.AlbumArtist)
	if safeArtist == "" {
		safeArtist = sanitizeFilename(req.ArtistName)
	}
	safeAlbum := sanitizeFilename(req.AlbumName)

	if safeArtist != "" && safeAlbum != "" {
		artistAlbumPath := filepath.Join(outputDir, safeArtist, safeAlbum)
		if info, err := os.Stat(artistAlbumPath); err == nil && info.IsDir() {
			outputDir = artistAlbumPath
		} else {

			artistPath := filepath.Join(outputDir, safeArtist)
			if info, err := os.Stat(artistPath); err == nil && info.IsDir() {
				outputDir = artistPath
			}
		}
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist"
	}
	filename := buildLyricsFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, filenameFormat, req.TrackNumber, req.Position, req.DiscNumber)
	filePath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &LyricsDownloadResponse{
			Success:       true,
			Message:       "Lyrics file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	audioDuration := 0
	audioFile := findAudioFileForLyrics(outputDir, req.TrackName, req.ArtistName)
	if audioFile != "" {
		duration, err := GetAudioDuration(audioFile)
		if err == nil && duration > 0 {
			audioDuration = int(duration)
			fmt.Printf("[DownloadLyrics] Found audio file, duration: %d seconds\n", audioDuration)
		}
	}

	lyrics, _, err := c.FetchLyricsAllSources(req.SpotifyID, req.TrackName, req.ArtistName, audioDuration)
	if err != nil {
		return &LyricsDownloadResponse{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	lrcContent := c.ConvertToLRC(lyrics, req.TrackName, req.ArtistName)

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
