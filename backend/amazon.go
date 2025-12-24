package backend

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type AmazonDownloader struct {
	client           *http.Client
	regions          []string
	lastAPICallTime  time.Time
	apiCallCount     int
	apiCallResetTime time.Time
}

type SongLinkResponse struct {
	LinksByPlatform map[string]struct {
		URL string `json:"url"`
	} `json:"linksByPlatform"`
}

type DoubleDoubleSubmitResponse struct {
	Success bool   `json:"success"`
	ID      string `json:"id"`
}

type DoubleDoubleStatusResponse struct {
	Status         string `json:"status"`
	FriendlyStatus string `json:"friendlyStatus"`
	URL            string `json:"url"`
	Current        struct {
		Name   string `json:"name"`
		Artist string `json:"artist"`
	} `json:"current"`
}

func NewAmazonDownloader() *AmazonDownloader {
	return &AmazonDownloader{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
		regions:          []string{"us", "eu"},
		apiCallResetTime: time.Now(),
	}
}

func (a *AmazonDownloader) getRandomUserAgent() string {
	return fmt.Sprintf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_%d_%d) AppleWebKit/%d.%d (KHTML, like Gecko) Chrome/%d.0.%d.%d Safari/%d.%d",
		rand.Intn(4)+11, rand.Intn(5)+4,
		rand.Intn(7)+530, rand.Intn(7)+30,
		rand.Intn(25)+80, rand.Intn(1500)+3000, rand.Intn(65)+60,
		rand.Intn(7)+530, rand.Intn(6)+30)
}

func (a *AmazonDownloader) GetAmazonURLFromSpotify(spotifyTrackID string) (string, error) {
	// Rate limiting: max 10 requests per minute (song.link API limit)
	// Reset counter every minute
	now := time.Now()
	if now.Sub(a.apiCallResetTime) >= time.Minute {
		a.apiCallCount = 0
		a.apiCallResetTime = now
	}

	// If we've hit the limit, wait until the next minute
	if a.apiCallCount >= 9 { // Use 9 to be safe (limit is 10)
		waitTime := time.Minute - now.Sub(a.apiCallResetTime)
		if waitTime > 0 {
			fmt.Printf("Rate limit reached, waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
			a.apiCallCount = 0
			a.apiCallResetTime = time.Now()
		}
	}

	// Add delay between requests (6 seconds = 10 requests per minute)
	if !a.lastAPICallTime.IsZero() {
		timeSinceLastCall := now.Sub(a.lastAPICallTime)
		minDelay := 7 * time.Second // 7 seconds to be safe
		if timeSinceLastCall < minDelay {
			waitTime := minDelay - timeSinceLastCall
			fmt.Printf("Rate limiting: waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
		}
	}

	// Decode base64 API URL
	spotifyBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tL3RyYWNrLw==")
	spotifyURL := fmt.Sprintf("%s%s", string(spotifyBase), spotifyTrackID)

	apiBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9hcGkuc29uZy5saW5rL3YxLWFscGhhLjEvbGlua3M/dXJsPQ==")
	apiURL := fmt.Sprintf("%s%s", string(apiBase), url.QueryEscape(spotifyURL))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", a.getRandomUserAgent())

	fmt.Println("Getting Amazon URL...")

	// Retry logic for rate limit errors
	maxRetries := 3
	var resp *http.Response
	for i := 0; i < maxRetries; i++ {
		resp, err = a.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to get Amazon URL: %w", err)
		}

		// Update rate limit tracking
		a.lastAPICallTime = time.Now()
		a.apiCallCount++

		if resp.StatusCode == 429 { // Too Many Requests
			resp.Body.Close()
			if i < maxRetries-1 {
				waitTime := 15 * time.Second
				fmt.Printf("Rate limited by API, waiting %v before retry...\n", waitTime)
				time.Sleep(waitTime)
				continue
			}
			return "", fmt.Errorf("API rate limit exceeded after %d retries", maxRetries)
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			return "", fmt.Errorf("API returned status %d", resp.StatusCode)
		}

		break
	}
	defer resp.Body.Close()

	// Read body first to handle encoding issues and provide better error messages
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return "", fmt.Errorf("API returned empty response")
	}

	var songLinkResp SongLinkResponse
	if err := json.Unmarshal(body, &songLinkResp); err != nil {
		// Truncate body for error message (max 200 chars)
		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		return "", fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	amazonLink, ok := songLinkResp.LinksByPlatform["amazonMusic"]
	if !ok || amazonLink.URL == "" {
		return "", fmt.Errorf("amazon Music link not found")
	}

	amazonURL := amazonLink.URL

	// Convert album URL to track URL if needed
	if strings.Contains(amazonURL, "trackAsin=") {
		parts := strings.Split(amazonURL, "trackAsin=")
		if len(parts) > 1 {
			trackAsin := strings.Split(parts[1], "&")[0]
			musicBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9tdXNpYy5hbWF6b24uY29tL3RyYWNrcy8=")
			amazonURL = fmt.Sprintf("%s%s?musicTerritory=US", string(musicBase), trackAsin)
		}
	}

	fmt.Printf("Found Amazon URL: %s\n", amazonURL)
	return amazonURL, nil
}

func (a *AmazonDownloader) DownloadFromService(amazonURL, outputDir string) (string, error) {
	var lastError error

	for _, region := range a.regions {
		fmt.Printf("\nTrying region: %s...\n", region)
		// Decode base64 service URL
		serviceBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly8=")
		serviceDomain, _ := base64.StdEncoding.DecodeString("LmRvdWJsZWRvdWJsZS50b3A=")
		baseURL := fmt.Sprintf("%s%s%s", string(serviceBase), region, string(serviceDomain))

		// Step 1: Submit download request
		encodedURL := url.QueryEscape(amazonURL)
		submitURL := fmt.Sprintf("%s/dl?url=%s", baseURL, encodedURL)

		req, err := http.NewRequest("GET", submitURL, nil)
		if err != nil {
			lastError = fmt.Errorf("failed to create request: %w", err)
			continue
		}

		req.Header.Set("User-Agent", a.getRandomUserAgent())

		fmt.Println("Submitting download request...")
		resp, err := a.client.Do(req)
		if err != nil {
			lastError = fmt.Errorf("failed to submit request: %w", err)
			continue
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			lastError = fmt.Errorf("submit failed with status %d", resp.StatusCode)
			continue
		}

		var submitResp DoubleDoubleSubmitResponse
		if err := json.NewDecoder(resp.Body).Decode(&submitResp); err != nil {
			resp.Body.Close()
			lastError = fmt.Errorf("failed to decode submit response: %w", err)
			continue
		}
		resp.Body.Close()

		if !submitResp.Success || submitResp.ID == "" {
			lastError = fmt.Errorf("submit request failed")
			continue
		}

		downloadID := submitResp.ID
		fmt.Printf("Download ID: %s\n", downloadID)

		// Step 2: Poll for completion
		statusURL := fmt.Sprintf("%s/dl/%s", baseURL, downloadID)
		fmt.Println("Waiting for download to complete...")

		maxWait := 300 * time.Second
		elapsed := time.Duration(0)
		pollInterval := 3 * time.Second

		for elapsed < maxWait {
			time.Sleep(pollInterval)
			elapsed += pollInterval

			statusReq, err := http.NewRequest("GET", statusURL, nil)
			if err != nil {
				continue
			}

			statusReq.Header.Set("User-Agent", a.getRandomUserAgent())

			statusResp, err := a.client.Do(statusReq)
			if err != nil {
				fmt.Printf("\rStatus check failed, retrying...")
				continue
			}

			if statusResp.StatusCode != 200 {
				statusResp.Body.Close()
				fmt.Printf("\rStatus check failed (status %d), retrying...", statusResp.StatusCode)
				continue
			}

			var status DoubleDoubleStatusResponse
			if err := json.NewDecoder(statusResp.Body).Decode(&status); err != nil {
				statusResp.Body.Close()
				fmt.Printf("\rInvalid JSON response, retrying...")
				continue
			}
			statusResp.Body.Close()

			if status.Status == "done" {
				fmt.Println("\nDownload ready!")

				// Build download URL
				fileURL := status.URL
				if strings.HasPrefix(fileURL, "./") {
					fileURL = fmt.Sprintf("%s/%s", baseURL, fileURL[2:])
				} else if strings.HasPrefix(fileURL, "/") {
					fileURL = fmt.Sprintf("%s%s", baseURL, fileURL)
				}

				trackName := status.Current.Name
				artist := status.Current.Artist

				fmt.Printf("Downloading: %s - %s\n", artist, trackName)

				// Download file
				downloadReq, err := http.NewRequest("GET", fileURL, nil)
				if err != nil {
					lastError = fmt.Errorf("failed to create download request: %w", err)
					break
				}

				downloadReq.Header.Set("User-Agent", a.getRandomUserAgent())

				fileResp, err := a.client.Do(downloadReq)
				if err != nil {
					lastError = fmt.Errorf("failed to download file: %w", err)
					break
				}
				defer fileResp.Body.Close()

				if fileResp.StatusCode != 200 {
					lastError = fmt.Errorf("download failed with status %d", fileResp.StatusCode)
					break
				}

				// Generate filename
				fileName := fmt.Sprintf("%s - %s.flac", artist, trackName)
				for _, char := range `<>:"/\|?*` {
					fileName = strings.ReplaceAll(fileName, string(char), "")
				}
				fileName = strings.TrimSpace(fileName)

				filePath := filepath.Join(outputDir, fileName)

				// Save file
				out, err := os.Create(filePath)
				if err != nil {
					lastError = fmt.Errorf("failed to create file: %w", err)
					break
				}
				defer out.Close()

				fmt.Println("Downloading...")
				// Use progress writer to track download
				pw := NewProgressWriter(out)
				_, err = io.Copy(pw, fileResp.Body)
				if err != nil {
					out.Close()
					return "", fmt.Errorf("failed to write file: %w", err)
				}

				// Print final size
				fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
				fmt.Println("Download complete!")
				return filePath, nil

			} else if status.Status == "error" {
				errorMsg := status.FriendlyStatus
				if errorMsg == "" {
					errorMsg = "Unknown error"
				}
				lastError = fmt.Errorf("processing failed: %s", errorMsg)
				break
			} else {
				// Still processing
				friendlyStatus := status.FriendlyStatus
				if friendlyStatus == "" {
					friendlyStatus = status.Status
				}
				fmt.Printf("\r%s...", friendlyStatus)
			}
		}

		if elapsed >= maxWait {
			lastError = fmt.Errorf("download timeout")
			fmt.Printf("\nError with %s region: %v\n", region, lastError)
			continue
		}

		if lastError != nil {
			fmt.Printf("\nError with %s region: %v\n", region, lastError)
		}
	}

	return "", fmt.Errorf("all regions failed. Last error: %v", lastError)
}

func (a *AmazonDownloader) DownloadByURL(amazonURL, outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyISRC string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool) (string, error) {
	// Create output directory if needed
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	// Check if file with expected name already exists (Amazon doesn't provide ISRC before download)
	if spotifyTrackName != "" && spotifyArtistName != "" {
		expectedFilename := BuildExpectedFilename(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, filenameFormat, includeTrackNumber, position, spotifyDiscNumber, false)
		expectedPath := filepath.Join(outputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
			fmt.Printf("File already exists: %s (%.2f MB)\n", expectedPath, float64(fileInfo.Size())/(1024*1024))
			return "EXISTS:" + expectedPath, nil
		}
	}

	fmt.Printf("Using Amazon URL: %s\n", amazonURL)

	// Download from service
	filePath, err := a.DownloadFromService(amazonURL, outputDir)
	if err != nil {
		return "", err
	}

	// Rename file based on Spotify metadata
	if spotifyTrackName != "" && spotifyArtistName != "" {
		safeArtist := sanitizeFilename(spotifyArtistName)
		safeTitle := sanitizeFilename(spotifyTrackName)
		safeAlbum := sanitizeFilename(spotifyAlbumName)
		safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

		// Extract year from release date
		year := ""
		if len(spotifyReleaseDate) >= 4 {
			year = spotifyReleaseDate[:4]
		}

		// Build filename based on format settings
		var newFilename string

		// Check if format is a template (contains {})
		if strings.Contains(filenameFormat, "{") {
			newFilename = filenameFormat
			newFilename = strings.ReplaceAll(newFilename, "{title}", safeTitle)
			newFilename = strings.ReplaceAll(newFilename, "{artist}", safeArtist)
			newFilename = strings.ReplaceAll(newFilename, "{album}", safeAlbum)
			newFilename = strings.ReplaceAll(newFilename, "{album_artist}", safeAlbumArtist)
			newFilename = strings.ReplaceAll(newFilename, "{year}", year)

			// Handle disc number
			if spotifyDiscNumber > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", fmt.Sprintf("%d", spotifyDiscNumber))
			} else {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", "")
			}

			// Handle track number - if position is 0, remove {track} and surrounding separators
			if position > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{track}", fmt.Sprintf("%02d", position))
			} else {
				// Remove {track} with common separators
				newFilename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(newFilename, "")
			}
		} else {
			// Legacy format support
			switch filenameFormat {
			case "artist-title":
				newFilename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
			case "title":
				newFilename = safeTitle
			default: // "title-artist"
				newFilename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
			}

			// Add track number prefix if enabled (legacy behavior)
			if includeTrackNumber && position > 0 {
				newFilename = fmt.Sprintf("%02d. %s", position, newFilename)
			}
		}

		newFilename = newFilename + ".flac"
		newFilePath := filepath.Join(outputDir, newFilename)

		// Rename file
		if err := os.Rename(filePath, newFilePath); err != nil {
			fmt.Printf("Warning: Failed to rename file: %v\n", err)
		} else {
			filePath = newFilePath
			fmt.Printf("Renamed to: %s\n", newFilename)
		}
	}

	// Embed Spotify metadata (replace Amazon's embedded metadata)
	fmt.Println("Embedding Spotify metadata...")

	coverPath := ""
	// Download Spotify cover (with max resolution if enabled)
	if spotifyCoverURL != "" {
		coverPath = filePath + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	// Determine track number to embed
	// Use Spotify track number (album track number) if available, otherwise use position
	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = position // Fallback to playlist position
	}
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1 // Default to track 1 for single track downloads without track number
	}

	// Build metadata from Spotify
	metadata := Metadata{
		Title:       spotifyTrackName,
		Artist:      spotifyArtistName,
		Album:       spotifyAlbumName,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate, // Recorded date (full date YYYY-MM-DD)
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks, // Total tracks in album from Spotify
		DiscNumber:  spotifyDiscNumber,  // Disc number from Spotify
		ISRC:        spotifyISRC,        // Use ISRC from Spotify
		Description: "https://github.com/afkarxyz/SpotiFLAC",
	}

	if err := EmbedMetadata(filePath, metadata, coverPath); err != nil {
		fmt.Printf("Warning: Failed to embed metadata: %v\n", err)
	} else {
		fmt.Println("Metadata embedded successfully")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Amazon Music")
	return filePath, nil
}

func (a *AmazonDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyISRC string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool) (string, error) {
	// Get Amazon URL from Spotify track ID
	amazonURL, err := a.GetAmazonURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return a.DownloadByURL(amazonURL, outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyISRC, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, embedMaxQualityCover)
}
