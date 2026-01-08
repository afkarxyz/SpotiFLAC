package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// iTunesSearchResponse represents the response from iTunes Search API
type iTunesSearchResponse struct {
	ResultCount int `json:"resultCount"`
	Results     []struct {
		TrackName         string `json:"trackName"`
		ArtistName        string `json:"artistName"`
		CollectionName    string `json:"collectionName"`
		ArtworkUrl100     string `json:"artworkUrl100"`
		ArtworkUrl600     string `json:"artworkUrl60"`
		CollectionViewURL string `json:"collectionViewUrl"`
	} `json:"results"`
}

// MusicBrainzSearchResponse represents the response from MusicBrainz API
type MusicBrainzSearchResponse struct {
	Recordings []struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Releases []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"releases"`
	} `json:"recordings"`
}

// SearchITunesForCover searches iTunes API for album cover
func SearchITunesForCover(trackName, artistName string) (string, error) {
	if trackName == "" || artistName == "" {
		return "", fmt.Errorf("track name and artist name are required")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Build search query
	query := fmt.Sprintf("%s %s", trackName, artistName)
	encodedQuery := url.QueryEscape(query)

	// iTunes Search API - free, no authentication needed
	apiURL := fmt.Sprintf("https://itunes.apple.com/search?term=%s&media=music&entity=song&limit=5", encodedQuery)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "SpotiFLAC/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("iTunes API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("iTunes API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	var searchResp iTunesSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if searchResp.ResultCount == 0 || len(searchResp.Results) == 0 {
		return "", fmt.Errorf("no results found")
	}

	// Get the first result and convert to high resolution
	artworkURL := searchResp.Results[0].ArtworkUrl100
	if artworkURL == "" {
		return "", fmt.Errorf("no artwork URL in response")
	}

	// Replace 100x100 with 3000x3000 for maximum quality
	artworkURL = strings.Replace(artworkURL, "100x100bb", "3000x3000bb", 1)

	fmt.Printf("[iTunes] Found cover for '%s - %s': %s\n", trackName, artistName, artworkURL)
	return artworkURL, nil
}

// SearchMusicBrainzForCover searches MusicBrainz + Cover Art Archive for album cover
func SearchMusicBrainzForCover(trackName, artistName string) (string, error) {
	if trackName == "" || artistName == "" {
		return "", fmt.Errorf("track name and artist name are required")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Build search query
	query := fmt.Sprintf("recording:\"%s\" AND artist:\"%s\"", trackName, artistName)
	encodedQuery := url.QueryEscape(query)

	// MusicBrainz API - free, no authentication needed
	apiURL := fmt.Sprintf("https://musicbrainz.org/ws/2/recording/?query=%s&fmt=json&limit=1", encodedQuery)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	// MusicBrainz requires User-Agent
	req.Header.Set("User-Agent", "SpotiFLAC/1.0 (https://github.com/spotflac)")

	// Rate limiting - MusicBrainz allows 1 request per second
	time.Sleep(1100 * time.Millisecond)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("MusicBrainz API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("MusicBrainz API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	var searchResp MusicBrainzSearchResponse
	if err := json.Unmarshal(body, &searchResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if len(searchResp.Recordings) == 0 {
		return "", fmt.Errorf("no recordings found")
	}

	recording := searchResp.Recordings[0]
	if len(recording.Releases) == 0 {
		return "", fmt.Errorf("no releases found for recording")
	}

	releaseID := recording.Releases[0].ID

	// Get cover from Cover Art Archive
	coverURL := fmt.Sprintf("https://coverartarchive.org/release/%s/front", releaseID)

	// Verify the cover exists
	headReq, err := http.NewRequest("HEAD", coverURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create HEAD request: %w", err)
	}

	headResp, err := client.Do(headReq)
	if err != nil {
		return "", fmt.Errorf("failed to verify cover: %w", err)
	}
	defer headResp.Body.Close()

	if headResp.StatusCode != 200 {
		return "", fmt.Errorf("cover not available (status %d)", headResp.StatusCode)
	}

	fmt.Printf("[MusicBrainz] Found cover for '%s - %s': %s\n", trackName, artistName, coverURL)
	return coverURL, nil
}

// SearchDeezerForCover searches Deezer API for album cover
func SearchDeezerForCover(trackName, artistName string) (string, error) {
	if trackName == "" || artistName == "" {
		return "", fmt.Errorf("track name and artist name are required")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Build search query
	query := fmt.Sprintf("%s %s", trackName, artistName)
	encodedQuery := url.QueryEscape(query)

	// Deezer Search API - free, no authentication needed
	apiURL := fmt.Sprintf("https://api.deezer.com/search?q=%s&limit=1", encodedQuery)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("Deezer API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Deezer API returned status %d", resp.StatusCode)
	}

	var searchResp struct {
		Data []struct {
			Title  string `json:"title"`
			Artist struct {
				Name string `json:"name"`
			} `json:"artist"`
			Album struct {
				Title   string `json:"title"`
				CoverXL string `json:"cover_xl"` // 1000x1000
			} `json:"album"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&searchResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if len(searchResp.Data) == 0 {
		return "", fmt.Errorf("no results found")
	}

	coverURL := searchResp.Data[0].Album.CoverXL
	if coverURL == "" {
		return "", fmt.Errorf("no cover URL in response")
	}

	fmt.Printf("[Deezer] Found cover for '%s - %s': %s\n", trackName, artistName, coverURL)
	return coverURL, nil
}
