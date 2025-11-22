package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type DeezerDownloader struct {
	client *http.Client
}

type DeezerTrack struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	TitleShort  string `json:"title_short"`
	Duration    int    `json:"duration"`
	TrackPos    int    `json:"track_position"`
	DiskNumber  int    `json:"disk_number"`
	ISRC        string `json:"isrc"`
	ReleaseDate string `json:"release_date"`
	Artist      struct {
		Name string `json:"name"`
		ID   int64  `json:"id"`
	} `json:"artist"`
	Album struct {
		Title    string `json:"title"`
		ID       int64  `json:"id"`
		CoverXL  string `json:"cover_xl"`
		CoverBig string `json:"cover_big"`
	} `json:"album"`
	Contributors []struct {
		Name string `json:"name"`
		Role string `json:"role"`
	} `json:"contributors"`
}

type DeezMateResponse struct {
	Success bool `json:"success"`
	Links   struct {
		FLAC string `json:"flac"`
	} `json:"links"`
}

func NewDeezerDownloader() *DeezerDownloader {
	return &DeezerDownloader{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (d *DeezerDownloader) GetTrackByISRC(isrc string) (*DeezerTrack, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuZGVlemVyLmNvbS8yLjAvdHJhY2svaXNyYzo=")
	url := fmt.Sprintf("%s%s", string(apiBase), isrc)

	resp, err := d.client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var track DeezerTrack
	if err := json.NewDecoder(resp.Body).Decode(&track); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if track.ID == 0 {
		return nil, fmt.Errorf("track not found for ISRC: %s", isrc)
	}

	return &track, nil
}

func (d *DeezerDownloader) GetDownloadURL(trackID int64) (string, error) {
	// Decode base64 API URL
	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuZGVlem1hdGUuY29tL2RsLw==")
	url := fmt.Sprintf("%s%d", string(apiBase), trackID)

	resp, err := d.client.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	var apiResp DeezMateResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		return "", fmt.Errorf("failed to decode API response: %w", err)
	}

	if !apiResp.Success || apiResp.Links.FLAC == "" {
		return "", fmt.Errorf("no FLAC download link available")
	}

	return apiResp.Links.FLAC, nil
}

func (d *DeezerDownloader) DownloadFile(url, filepath string) error {
	resp, err := d.client.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	fmt.Println("Downloading...")
	// Use progress writer to track download
	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	// Print final size
	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
	return nil
}

func (d *DeezerDownloader) DownloadCoverArt(coverURL, filepath string) error {
	if coverURL == "" {
		return fmt.Errorf("no cover URL provided")
	}

	resp, err := d.client.Get(coverURL)
	if err != nil {
		return fmt.Errorf("failed to download cover: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("cover download failed with status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return fmt.Errorf("failed to create cover file: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func sanitizeFilename(name string) string {
	re := regexp.MustCompile(`[<>:"/\\|?*]`)
	sanitized := re.ReplaceAllString(name, "_")
	sanitized = strings.TrimSpace(sanitized)
	if sanitized == "" {
		return "Unknown"
	}
	return sanitized
}

func buildFilename(title, artist string, trackNumber int, format string, includeTrackNumber bool) string {
	var filename string

	// Build base filename based on format
	switch format {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", artist, title)
	case "title":
		filename = title
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", title, artist)
	}

	// Add track number prefix if enabled
	if includeTrackNumber && trackNumber > 0 {
		filename = fmt.Sprintf("%02d. %s", trackNumber, filename)
	}

	return filename + ".flac"
}

func (d *DeezerDownloader) DownloadByISRC(isrc, outputDir, filenameFormat string, includeTrackNumber bool, spotifyTrackName, spotifyArtistName, spotifyAlbumName string) error {
	fmt.Printf("Fetching track info for ISRC: %s\n", isrc)

	track, err := d.GetTrackByISRC(isrc)
	if err != nil {
		return err
	}

	// Use Spotify metadata if provided, otherwise fallback to Deezer metadata
	artists := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	if artists == "" {
		artists = track.Artist.Name
		if len(track.Contributors) > 0 {
			var mainArtists []string
			for _, contrib := range track.Contributors {
				if contrib.Role == "Main" {
					mainArtists = append(mainArtists, contrib.Name)
				}
			}
			if len(mainArtists) > 0 {
				artists = strings.Join(mainArtists, ", ")
			}
		}
	}

	if trackTitle == "" {
		trackTitle = track.Title
	}

	if albumTitle == "" {
		albumTitle = track.Album.Title
	}

	fmt.Printf("Found track: %s - %s\n", artists, trackTitle)
	fmt.Printf("Album: %s\n", albumTitle)

	downloadURL, err := d.GetDownloadURL(track.ID)
	if err != nil {
		return err
	}

	safeArtist := sanitizeFilename(artists)
	safeTitle := sanitizeFilename(trackTitle)

	// Build filename based on format settings
	filename := buildFilename(safeTitle, safeArtist, track.TrackPos, filenameFormat, includeTrackNumber)
	filepath := filepath.Join(outputDir, filename)

	fmt.Println("Downloading FLAC file...")
	if err := d.DownloadFile(downloadURL, filepath); err != nil {
		return err
	}

	fmt.Printf("Downloaded: %s\n", filepath)

	coverPath := ""
	if track.Album.CoverXL != "" {
		coverPath = filepath + ".cover.jpg"
		fmt.Println("Downloading cover art...")
		if err := d.DownloadCoverArt(track.Album.CoverXL, coverPath); err != nil {
			fmt.Printf("Warning: Failed to download cover art: %v\n", err)
		} else {
			defer os.Remove(coverPath)
		}
	}

	fmt.Println("Embedding metadata and cover art...")
	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artists,
		Album:       albumTitle,
		Date:        track.ReleaseDate,
		TrackNumber: track.TrackPos,
		DiscNumber:  track.DiskNumber,
		ISRC:        track.ISRC,
	}

	if err := EmbedMetadata(filepath, metadata, coverPath); err != nil {
		return fmt.Errorf("failed to embed metadata: %w", err)
	}

	fmt.Println("Metadata embedded successfully!")
	return nil
}
