package backend

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/cookiejar"
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

type LucidaLoadResponse struct {
	Success bool   `json:"success"`
	Server  string `json:"server"`
	Handoff string `json:"handoff"`
	Error   string `json:"error"`
}

type LucidaStatusResponse struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	Progress struct {
		Current int64 `json:"current"`
		Total   int64 `json:"total"`
	} `json:"progress"`
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

	now := time.Now()
	if now.Sub(a.apiCallResetTime) >= time.Minute {
		a.apiCallCount = 0
		a.apiCallResetTime = now
	}

	if a.apiCallCount >= 9 {
		waitTime := time.Minute - now.Sub(a.apiCallResetTime)
		if waitTime > 0 {
			fmt.Printf("Rate limit reached, waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
			a.apiCallCount = 0
			a.apiCallResetTime = time.Now()
		}
	}

	if !a.lastAPICallTime.IsZero() {
		timeSinceLastCall := now.Sub(a.lastAPICallTime)
		minDelay := 7 * time.Second
		if timeSinceLastCall < minDelay {
			waitTime := minDelay - timeSinceLastCall
			fmt.Printf("Rate limiting: waiting %v...\n", waitTime.Round(time.Second))
			time.Sleep(waitTime)
		}
	}

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

	maxRetries := 3
	var resp *http.Response
	for i := 0; i < maxRetries; i++ {
		resp, err = a.client.Do(req)
		if err != nil {
			return "", fmt.Errorf("failed to get Amazon URL: %w", err)
		}

		a.lastAPICallTime = time.Now()
		a.apiCallCount++

		if resp.StatusCode == 429 {
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response body: %w", err)
	}

	if len(body) == 0 {
		return "", fmt.Errorf("API returned empty response")
	}

	var songLinkResp SongLinkResponse
	if err := json.Unmarshal(body, &songLinkResp); err != nil {

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

func (a *AmazonDownloader) extractData(html string, patterns []string) string {
	for _, p := range patterns {
		re := regexp.MustCompile(p)
		matches := re.FindStringSubmatch(html)
		if len(matches) > 1 {
			return matches[1]
		}
	}
	return ""
}

func (a *AmazonDownloader) DownloadFromLucida(amazonURL, outputDir, quality string) (string, error) {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{
		Transport: tr,
		Jar:       jar,
		Timeout:   120 * time.Second,
	}

	userAgent := a.getRandomUserAgent()

	fmt.Printf("Initializing lucida for Amazon Music... (Target: %s)\n", amazonURL)
	lucidaBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9sdWNpZGEudG8vP3VybD0lcyZjb3VudHJ5PWF1dG8=")
	lucidaURL := fmt.Sprintf(string(lucidaBase), url.QueryEscape(amazonURL))
	req, _ := http.NewRequest("GET", lucidaURL, nil)
	req.Header.Set("User-Agent", userAgent)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	html := string(bodyBytes)

	token := a.extractData(html, []string{`token:"([^"]+)"`, `"token"\s*:\s*"([^"]+)"`})
	streamURL := a.extractData(html, []string{`"url":"([^"]+)"`, `url:"([^"]+)"`})
	expiry := a.extractData(html, []string{`tokenExpiry:(\d+)`, `"tokenExpiry"\s*:\s*(\d+)`})

	if token == "" || streamURL == "" {
		errorMsg := a.extractData(html, []string{`error:"([^"]+)"`, `"error"\s*:\s*"([^"]+)"`})
		if errorMsg != "" {
			return "", fmt.Errorf("lucida error: %s", errorMsg)
		}
		return "", fmt.Errorf("could not extract required data from lucida")
	}

	decodedToken := token
	if secondBase64, err := base64.StdEncoding.DecodeString(token); err == nil {
		if firstBase64, err := base64.StdEncoding.DecodeString(string(secondBase64)); err == nil {
			decodedToken = string(firstBase64)
		}
	}

	streamURL = strings.ReplaceAll(streamURL, `\/`, `/`)
	fmt.Printf("Fetching Amazon stream via Lucida...\n")

	loadPayload := map[string]interface{}{
		"account": map[string]string{"id": "auto", "type": "country"},
		"compat":  "false", "downscale": "original", "handoff": true,
		"metadata": true, "private": true,
		"token":  map[string]interface{}{"primary": decodedToken, "expiry": expiry},
		"upload": map[string]bool{"enabled": false},
		"url":    streamURL,
	}

	payloadBytes, _ := json.Marshal(loadPayload)
	loadAPI, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly9sdWNpZGEudG8vYXBpL2xvYWQ/dXJsPS9hcGkvZmV0Y2gvc3RyZWFtL3Yy")
	req, _ = http.NewRequest("POST", string(loadAPI), bytes.NewBuffer(payloadBytes))
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Content-Type", "application/json")

	for _, cookie := range client.Jar.Cookies(req.URL) {
		if cookie.Name == "csrf_token" {
			req.Header.Set("X-CSRF-Token", cookie.Value)
		}
	}

	resp, err = client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var loadData LucidaLoadResponse
	json.NewDecoder(resp.Body).Decode(&loadData)

	if !loadData.Success {
		return "", fmt.Errorf("lucida load request failed: %s", loadData.Error)
	}

	serviceBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly8=")
	completionBase, _ := base64.StdEncoding.DecodeString("Lmx1Y2lkYS50by9hcGkvZmV0Y2gvcmVxdWVzdC8=")
	completionURL := fmt.Sprintf("%s%s%s%s", string(serviceBase), loadData.Server, string(completionBase), loadData.Handoff)
	fmt.Println("Processing on Lucida server...")

	var finalStatus LucidaStatusResponse
	for {
		req, _ = http.NewRequest("GET", completionURL, nil)
		req.Header.Set("User-Agent", userAgent)
		resp, err = client.Do(req)
		if err != nil {
			return "", err
		}

		json.NewDecoder(resp.Body).Decode(&finalStatus)
		resp.Body.Close()

		if finalStatus.Status == "completed" {
			fmt.Println("\nTrack processing completed!")
			break
		} else if finalStatus.Status == "error" {
			return "", fmt.Errorf("lucida processing failed: %s", finalStatus.Message)
		} else if finalStatus.Progress.Total > 0 {
			percent := (finalStatus.Progress.Current * 100) / finalStatus.Progress.Total
			fmt.Printf("\rLucida Progress: %d%%", percent)
		}
		time.Sleep(2 * time.Second)
	}

	downloadSuffix, _ := base64.StdEncoding.DecodeString("L2Rvd25sb2Fk")
	downloadURL := fmt.Sprintf("%s%s%s%s%s", string(serviceBase), loadData.Server, string(completionBase), loadData.Handoff, string(downloadSuffix))
	req, _ = http.NewRequest("GET", downloadURL, nil)
	req.Header.Set("User-Agent", userAgent)
	resp, err = client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("lucida download failed with status %d", resp.StatusCode)
	}

	fileName := "track.flac"
	contentDisp := resp.Header.Get("Content-Disposition")
	if contentDisp != "" {
		re := regexp.MustCompile(`filename[*]?=([^;]+)`)
		if matches := re.FindStringSubmatch(contentDisp); len(matches) > 1 {
			rawName := strings.Trim(matches[1], `"'`)
			if strings.HasPrefix(rawName, "UTF-8''") {
				decodedName, _ := url.PathUnescape(rawName[7:])
				fileName = decodedName
			} else {
				fileName = rawName
			}

			reg := regexp.MustCompile(`[<>:"/\\|?*]`)
			fileName = reg.ReplaceAllString(fileName, "")
		}
	}

	filePath := filepath.Join(outputDir, fileName)
	out, err := os.Create(filePath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	fmt.Printf("Downloading from Lucida: %s\n", fileName)

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		out.Close()
		os.Remove(filePath)
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
	return filePath, nil
}

func (a *AmazonDownloader) DownloadFromService(amazonURL, outputDir, quality string) (string, error) {
	fmt.Println("Attempting download via Lucida (Priority)...")
	filePath, err := a.DownloadFromLucida(amazonURL, outputDir, quality)
	if err == nil {
		return filePath, nil
	}
	fmt.Printf("Lucida failed: %v\nTrying Double-Double as fallback...\n", err)

	var lastError error
	lastError = err

	for _, region := range a.regions {
		fmt.Printf("\nTrying region: %s...\n", region)

		serviceBase, _ := base64.StdEncoding.DecodeString("aHR0cHM6Ly8=")
		serviceDomain, _ := base64.StdEncoding.DecodeString("LmRvdWJsZWRvdWJsZS50b3A=")
		baseURL := fmt.Sprintf("%s%s%s", string(serviceBase), region, string(serviceDomain))

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

				fileURL := status.URL
				if strings.HasPrefix(fileURL, "./") {
					fileURL = fmt.Sprintf("%s/%s", baseURL, fileURL[2:])
				} else if strings.HasPrefix(fileURL, "/") {
					fileURL = fmt.Sprintf("%s%s", baseURL, fileURL)
				}

				trackName := status.Current.Name
				artist := status.Current.Artist

				fmt.Printf("Downloading: %s - %s\n", artist, trackName)

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

				fileName := fmt.Sprintf("%s - %s.flac", artist, trackName)
				for _, char := range `<>:"/\|?*` {
					fileName = strings.ReplaceAll(fileName, string(char), "")
				}
				fileName = strings.TrimSpace(fileName)

				filePath := filepath.Join(outputDir, fileName)

				out, err := os.Create(filePath)
				if err != nil {
					lastError = fmt.Errorf("failed to create file: %w", err)
					break
				}
				defer out.Close()

				fmt.Println("Downloading...")

				pw := NewProgressWriter(out)
				_, err = io.Copy(pw, fileResp.Body)
				if err != nil {
					out.Close()
					return "", fmt.Errorf("failed to write file: %w", err)
				}

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

func (a *AmazonDownloader) DownloadByURL(amazonURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string) (string, error) {

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	if spotifyTrackName != "" && spotifyArtistName != "" {
		expectedFilename := BuildExpectedFilename(spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, filenameFormat, includeTrackNumber, position, spotifyDiscNumber, false)
		expectedPath := filepath.Join(outputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
			fmt.Printf("File already exists: %s (%.2f MB)\n", expectedPath, float64(fileInfo.Size())/(1024*1024))
			return "EXISTS:" + expectedPath, nil
		}
	}

	fmt.Printf("Using Amazon URL: %s\n", amazonURL)

	filePath, err := a.DownloadFromService(amazonURL, outputDir, quality)
	if err != nil {
		return "", err
	}

	if spotifyTrackName != "" && spotifyArtistName != "" {
		safeArtist := sanitizeFilename(spotifyArtistName)
		safeTitle := sanitizeFilename(spotifyTrackName)
		safeAlbum := sanitizeFilename(spotifyAlbumName)
		safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

		year := ""
		if len(spotifyReleaseDate) >= 4 {
			year = spotifyReleaseDate[:4]
		}

		var newFilename string

		if strings.Contains(filenameFormat, "{") {
			newFilename = filenameFormat
			newFilename = strings.ReplaceAll(newFilename, "{title}", safeTitle)
			newFilename = strings.ReplaceAll(newFilename, "{artist}", safeArtist)
			newFilename = strings.ReplaceAll(newFilename, "{album}", safeAlbum)
			newFilename = strings.ReplaceAll(newFilename, "{album_artist}", safeAlbumArtist)
			newFilename = strings.ReplaceAll(newFilename, "{year}", year)

			if spotifyDiscNumber > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", fmt.Sprintf("%d", spotifyDiscNumber))
			} else {
				newFilename = strings.ReplaceAll(newFilename, "{disc}", "")
			}

			if position > 0 {
				newFilename = strings.ReplaceAll(newFilename, "{track}", fmt.Sprintf("%02d", position))
			} else {

				newFilename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(newFilename, "")
				newFilename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(newFilename, "")
			}
		} else {

			switch filenameFormat {
			case "artist-title":
				newFilename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
			case "title":
				newFilename = safeTitle
			default:
				newFilename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
			}

			if includeTrackNumber && position > 0 {
				newFilename = fmt.Sprintf("%02d. %s", position, newFilename)
			}
		}

		newFilename = newFilename + ".flac"
		newFilePath := filepath.Join(outputDir, newFilename)

		if err := os.Rename(filePath, newFilePath); err != nil {
			fmt.Printf("Warning: Failed to rename file: %v\n", err)
		} else {
			filePath = newFilePath
			fmt.Printf("Renamed to: %s\n", newFilename)
		}
	}

	fmt.Println("Embedding Spotify metadata...")

	coverPath := ""

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

	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1
	}

	metadata := Metadata{
		Title:       spotifyTrackName,
		Artist:      spotifyArtistName,
		Album:       spotifyAlbumName,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate,
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks,
		DiscNumber:  spotifyDiscNumber,
		TotalDiscs:  spotifyTotalDiscs,
		URL:         spotifyURL,
		Copyright:   spotifyCopyright,
		Publisher:   spotifyPublisher,
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

func (a *AmazonDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string) (string, error) {

	amazonURL, err := a.GetAmazonURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", err
	}

	return a.DownloadByURL(amazonURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, embedMaxQualityCover, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyURL)
}
