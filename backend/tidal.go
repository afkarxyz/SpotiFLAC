package backend

import (
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type TidalDownloader struct {
	client     *http.Client
	timeout    time.Duration
	maxRetries int
	apiURL     string
}

type TidalAPIResponse struct {
	OriginalTrackURL string `json:"OriginalTrackUrl"`
}

type TidalAPIResponseV2 struct {
	Version string `json:"version"`
	Data    struct {
		TrackID           int64  `json:"trackId"`
		AssetPresentation string `json:"assetPresentation"`
		AudioMode         string `json:"audioMode"`
		AudioQuality      string `json:"audioQuality"`
		ManifestMimeType  string `json:"manifestMimeType"`
		ManifestHash      string `json:"manifestHash"`
		Manifest          string `json:"manifest"`
		BitDepth          int    `json:"bitDepth"`
		SampleRate        int    `json:"sampleRate"`
	} `json:"data"`
}

type TidalBTSManifest struct {
	MimeType       string   `json:"mimeType"`
	Codecs         string   `json:"codecs"`
	EncryptionType string   `json:"encryptionType"`
	URLs           []string `json:"urls"`
}

func NewTidalDownloader(apiURL string) *TidalDownloader {
	if apiURL == "" {
		downloader := &TidalDownloader{
			client: &http.Client{
				Timeout: 5 * time.Second,
			},
			timeout:    5 * time.Second,
			maxRetries: 3,
			apiURL:     "",
		}

		apis, err := downloader.GetAvailableAPIs()
		if err == nil && len(apis) > 0 {
			apiURL = apis[0]
		}
	}

	return &TidalDownloader{
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
		timeout:    5 * time.Second,
		maxRetries: 3,
		apiURL:     apiURL,
	}
}

func (t *TidalDownloader) GetAvailableAPIs() ([]string, error) {
	apis := []string{
		"https://triton.squid.wtf",
		"https://hifi-one.spotisaver.net",
		"https://hifi-two.spotisaver.net",
		"https://tidal.kinoplus.online",
		"https://tidal-api.binimum.org",
	}
	return apis, nil
}

func (t *TidalDownloader) GetTidalURLFromSpotify(spotifyTrackID string) (string, error) {

	spotifyBase := "https://open.spotify.com/track/"
	spotifyURL := fmt.Sprintf("%s%s", spotifyBase, spotifyTrackID)

	apiBase := "https://api.song.link/v1-alpha.1/links?url="
	apiURL := fmt.Sprintf("%s%s", apiBase, url.QueryEscape(spotifyURL))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	fmt.Println("Getting Tidal URL...")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get Tidal URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var songLinkResp struct {
		LinksByPlatform map[string]struct {
			URL string `json:"url"`
		} `json:"linksByPlatform"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&songLinkResp); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	tidalLink, ok := songLinkResp.LinksByPlatform["tidal"]
	if !ok || tidalLink.URL == "" {
		return "", fmt.Errorf("tidal link not found")
	}

	tidalURL := tidalLink.URL
	fmt.Printf("Found Tidal URL: %s\n", tidalURL)
	return tidalURL, nil
}

func (t *TidalDownloader) GetTrackIDFromURL(tidalURL string) (int64, error) {

	parts := strings.Split(tidalURL, "/track/")
	if len(parts) < 2 {
		return 0, fmt.Errorf("invalid tidal URL format")
	}

	trackIDStr := strings.Split(parts[1], "?")[0]
	trackIDStr = strings.TrimSpace(trackIDStr)

	var trackID int64
	_, err := fmt.Sscanf(trackIDStr, "%d", &trackID)
	if err != nil {
		return 0, fmt.Errorf("failed to parse track ID: %w", err)
	}

	return trackID, nil
}

func (t *TidalDownloader) GetDownloadURL(trackID int64, quality string) (string, error) {
	fmt.Println("Fetching URL...")

	url := fmt.Sprintf("%s/track/?id=%d&quality=%s", t.apiURL, trackID, quality)
	fmt.Printf("Tidal API URL: %s\n", url)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		fmt.Printf("✗ failed to create request: %v\n", err)
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	resp, err := t.client.Do(req)
	if err != nil {
		fmt.Printf("✗ Tidal API request failed: %v\n", err)
		return "", fmt.Errorf("failed to get download URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		fmt.Printf("✗ Tidal API returned status code: %d\n", resp.StatusCode)
		return "", fmt.Errorf("API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("✗ Failed to read response body: %v\n", err)
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	var v2Response TidalAPIResponseV2
	if err := json.Unmarshal(body, &v2Response); err == nil && v2Response.Data.Manifest != "" {
		fmt.Println("✓ Tidal manifest found (v2 API)")
		return "MANIFEST:" + v2Response.Data.Manifest, nil
	}

	var apiResponses []TidalAPIResponse
	if err := json.Unmarshal(body, &apiResponses); err != nil {

		bodyStr := string(body)
		if len(bodyStr) > 200 {
			bodyStr = bodyStr[:200] + "..."
		}
		fmt.Printf("✗ Failed to decode Tidal API response: %v (response: %s)\n", err, bodyStr)
		return "", fmt.Errorf("failed to decode response: %w (response: %s)", err, bodyStr)
	}

	if len(apiResponses) == 0 {
		fmt.Println("✗ Tidal API returned empty response")
		return "", fmt.Errorf("no download URL in response")
	}

	for _, item := range apiResponses {
		if item.OriginalTrackURL != "" {
			fmt.Println("✓ Tidal download URL found")
			return item.OriginalTrackURL, nil
		}
	}

	fmt.Println("✗ No valid download URL in Tidal API response")
	return "", fmt.Errorf("download URL not found in response")
}

func (t *TidalDownloader) DownloadFile(url, filepath string) error {

	if strings.HasPrefix(url, "MANIFEST:") {
		return t.DownloadFromManifest(strings.TrimPrefix(url, "MANIFEST:"), filepath)
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	resp, err := t.client.Do(req)

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

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	fmt.Println("Download complete")
	return nil
}

func (t *TidalDownloader) DownloadFromManifest(manifestB64, outputPath string) error {
	directURL, initURL, mediaURLs, mimeType, err := parseManifest(manifestB64)
	if err != nil {
		return fmt.Errorf("failed to parse manifest: %w", err)
	}

	client := &http.Client{
		Timeout: 120 * time.Second,
	}

	doRequest := func(url string) (*http.Response, error) {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")
		return client.Do(req)
	}

	if directURL != "" && (strings.Contains(strings.ToLower(mimeType), "flac") || mimeType == "") {
		fmt.Println("Downloading file...")

		resp, err := doRequest(directURL)
		if err != nil {
			return fmt.Errorf("failed to download file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		out, err := os.Create(outputPath)
		if err != nil {
			return fmt.Errorf("failed to create file: %w", err)
		}
		defer out.Close()

		pw := NewProgressWriter(out)
		_, err = io.Copy(pw, resp.Body)
		if err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
		fmt.Println("Download complete")
		return nil
	}

	tempPath := outputPath + ".m4a.tmp"

	if directURL != "" {
		fmt.Printf("Downloading non-FLAC file (%s)...\n", mimeType)

		resp, err := doRequest(directURL)
		if err != nil {
			return fmt.Errorf("failed to download file: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return fmt.Errorf("download failed with status %d", resp.StatusCode)
		}

		out, err := os.Create(tempPath)
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}

		pw := NewProgressWriter(out)
		_, err = io.Copy(pw, resp.Body)
		out.Close()

		if err != nil {
			os.Remove(tempPath)
			return fmt.Errorf("failed to write temp file: %w", err)
		}

		fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))

	} else {

		fmt.Printf("Downloading %d segments...\n", len(mediaURLs)+1)

		out, err := os.Create(tempPath)
		if err != nil {
			return fmt.Errorf("failed to create temp file: %w", err)
		}

		fmt.Print("Downloading init segment... ")
		resp, err := doRequest(initURL)
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to download init segment: %w", err)
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("init segment download failed with status %d", resp.StatusCode)
		}
		_, err = io.Copy(out, resp.Body)
		resp.Body.Close()
		if err != nil {
			out.Close()
			os.Remove(tempPath)
			return fmt.Errorf("failed to write init segment: %w", err)
		}
		fmt.Println("OK")

		totalSegments := len(mediaURLs)
		var totalBytes int64
		lastTime := time.Now()
		var lastBytes int64
		for i, mediaURL := range mediaURLs {
			resp, err := doRequest(mediaURL)
			if err != nil {
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("failed to download segment %d: %w", i+1, err)
			}
			if resp.StatusCode != 200 {
				resp.Body.Close()
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("segment %d download failed with status %d", i+1, resp.StatusCode)
			}
			n, err := io.Copy(out, resp.Body)
			totalBytes += n
			resp.Body.Close()
			if err != nil {
				out.Close()
				os.Remove(tempPath)
				return fmt.Errorf("failed to write segment %d: %w", i+1, err)
			}

			mbDownloaded := float64(totalBytes) / (1024 * 1024)
			now := time.Now()
			timeDiff := now.Sub(lastTime).Seconds()
			var speedMBps float64
			if timeDiff > 0.1 {
				bytesDiff := float64(totalBytes - lastBytes)
				speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
				SetDownloadSpeed(speedMBps)
				lastTime = now
				lastBytes = totalBytes
			}
			SetDownloadProgress(mbDownloaded)

			fmt.Printf("\rDownloading: %.2f MB (%d/%d segments)", mbDownloaded, i+1, totalSegments)
		}

		out.Close()

		tempInfo, _ := os.Stat(tempPath)
		fmt.Printf("\rDownloaded: %.2f MB (Complete)          \n", float64(tempInfo.Size())/(1024*1024))
	}

	fmt.Println("Converting to FLAC...")
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}

	if err := ValidateExecutable(ffmpegPath); err != nil {
		return fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	cmd := exec.Command(ffmpegPath, "-y", "-i", tempPath, "-vn", "-c:a", "flac", outputPath)
	setHideWindow(cmd)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {

		m4aPath := strings.TrimSuffix(outputPath, ".flac") + ".m4a"
		os.Rename(tempPath, m4aPath)
		return fmt.Errorf("ffmpeg conversion failed (M4A saved as %s): %w - %s", m4aPath, err, stderr.String())
	}

	os.Remove(tempPath)
	fmt.Println("Download complete")

	return nil
}

func (t *TidalDownloader) DownloadByURL(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, allowFallback bool) (string, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	fmt.Printf("Using Tidal URL: %s\n", tidalURL)

	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	if trackID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	artistName := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	artistNameForFile := sanitizeFilename(artistName)
	trackTitleForFile := sanitizeFilename(trackTitle)
	albumTitleForFile := sanitizeFilename(albumTitle)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)

	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	downloadURL, err := t.GetDownloadURL(trackID, quality)
	if err != nil {
		if quality == "HI_RES" && allowFallback {
			fmt.Println("⚠ HI_RES unavailable/failed, falling back to LOSSLESS...")
			downloadURL, err = t.GetDownloadURL(trackID, "LOSSLESS")
			if err != nil {
				return "", fmt.Errorf("failed to get download URL (HI_RES & LOSSLESS both failed): %w", err)
			}
		} else {
			return "", err
		}
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	if err := t.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", err
	}

	fmt.Println("Adding metadata...")

	coverPath := ""

	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
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
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
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

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, allowFallback bool) (string, error) {
	apis, err := t.GetAvailableAPIs()
	if err != nil {
		return "", fmt.Errorf("no APIs available for fallback: %w", err)
	}

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("directory error: %w", err)
		}
	}

	fmt.Printf("Using Tidal URL: %s\n", tidalURL)

	trackID, err := t.GetTrackIDFromURL(tidalURL)
	if err != nil {
		return "", err
	}

	if trackID == 0 {
		return "", fmt.Errorf("no track ID found")
	}

	artistName := spotifyArtistName
	trackTitle := spotifyTrackName
	albumTitle := spotifyAlbumName

	artistNameForFile := sanitizeFilename(artistName)
	trackTitleForFile := sanitizeFilename(trackTitle)
	albumTitleForFile := sanitizeFilename(albumTitle)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)

	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber)
	outputFilename := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(outputFilename); err == nil && fileInfo.Size() > 0 {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(fileInfo.Size())/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	successAPI, downloadURL, err := getDownloadURLRotated(apis, trackID, quality)
	if err != nil {
		if quality == "HI_RES" && allowFallback {
			fmt.Println("⚠ HI_RES unavailable/failed on all APIs, falling back to LOSSLESS...")
			successAPI, downloadURL, err = getDownloadURLRotated(apis, trackID, "LOSSLESS")
			if err != nil {
				return "", fmt.Errorf("failed to get download URL (HI_RES & LOSSLESS both failed): %w", err)
			}
		} else {
			return "", err
		}
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	downloader := NewTidalDownloader(successAPI)
	if err := downloader.DownloadFile(downloadURL, outputFilename); err != nil {
		return "", err
	}

	fmt.Println("Adding metadata...")

	coverPath := ""

	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
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
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
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

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal")
	return outputFilename, nil
}

func (t *TidalDownloader) Download(spotifyTrackID, outputDir, quality, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, allowFallback bool) (string, error) {

	tidalURL, err := t.GetTidalURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", fmt.Errorf("songlink couldn't find Tidal URL: %w", err)
	}

	return t.DownloadByURLWithFallback(tidalURL, outputDir, quality, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyURL, allowFallback)
}

type SegmentTemplate struct {
	Initialization string `xml:"initialization,attr"`
	Media          string `xml:"media,attr"`
	Timeline       struct {
		Segments []struct {
			Duration int64 `xml:"d,attr"`
			Repeat   int   `xml:"r,attr"`
		} `xml:"S"`
	} `xml:"SegmentTimeline"`
}

type MPD struct {
	XMLName xml.Name `xml:"MPD"`
	Period  struct {
		AdaptationSets []struct {
			MimeType        string `xml:"mimeType,attr"`
			Codecs          string `xml:"codecs,attr"`
			Representations []struct {
				ID              string           `xml:"id,attr"`
				Codecs          string           `xml:"codecs,attr"`
				Bandwidth       int              `xml:"bandwidth,attr"`
				SegmentTemplate *SegmentTemplate `xml:"SegmentTemplate"`
			} `xml:"Representation"`
			SegmentTemplate *SegmentTemplate `xml:"SegmentTemplate"`
		} `xml:"AdaptationSet"`
	} `xml:"Period"`
}

func parseManifest(manifestB64 string) (directURL string, initURL string, mediaURLs []string, mimeType string, err error) {
	manifestBytes, err := base64.StdEncoding.DecodeString(manifestB64)
	if err != nil {
		return "", "", nil, "", fmt.Errorf("failed to decode manifest: %w", err)
	}

	manifestStr := string(manifestBytes)

	if strings.HasPrefix(strings.TrimSpace(manifestStr), "{") {
		var btsManifest TidalBTSManifest
		if err := json.Unmarshal(manifestBytes, &btsManifest); err != nil {
			return "", "", nil, "", fmt.Errorf("failed to parse BTS manifest: %w", err)
		}

		if len(btsManifest.URLs) == 0 {
			return "", "", nil, "", fmt.Errorf("no URLs in BTS manifest")
		}

		fmt.Printf("Manifest: BTS format (%s, %s)\n", btsManifest.MimeType, btsManifest.Codecs)
		return btsManifest.URLs[0], "", nil, btsManifest.MimeType, nil
	}

	fmt.Println("Manifest: DASH format")

	var mpd MPD
	var segTemplate *SegmentTemplate

	if err := xml.Unmarshal(manifestBytes, &mpd); err == nil {
		var selectedBandwidth int
		var selectedCodecs string

		for _, as := range mpd.Period.AdaptationSets {

			if as.SegmentTemplate != nil {

				if segTemplate == nil {
					segTemplate = as.SegmentTemplate
					selectedCodecs = as.Codecs
				}
			}

			for _, rep := range as.Representations {
				if rep.SegmentTemplate != nil {
					if rep.Bandwidth > selectedBandwidth {
						selectedBandwidth = rep.Bandwidth
						segTemplate = rep.SegmentTemplate

						if rep.Codecs != "" {
							selectedCodecs = rep.Codecs
						} else {
							selectedCodecs = as.Codecs
						}
					}
				}
			}
		}

		if selectedBandwidth > 0 {
			fmt.Printf("Selected stream: Codec=%s, Bandwidth=%d bps\n", selectedCodecs, selectedBandwidth)
		}
	}

	var mediaTemplate string
	segmentCount := 0

	if segTemplate != nil {
		initURL = segTemplate.Initialization
		mediaTemplate = segTemplate.Media

		for _, seg := range segTemplate.Timeline.Segments {
			segmentCount += seg.Repeat + 1
		}
	}

	if segmentCount > 0 && initURL != "" && mediaTemplate != "" {
		initURL = strings.ReplaceAll(initURL, "&amp;", "&")
		mediaTemplate = strings.ReplaceAll(mediaTemplate, "&amp;", "&")

		fmt.Printf("Parsed manifest via XML: %d segments\n", segmentCount)

		for i := 1; i <= segmentCount; i++ {
			mediaURL := strings.ReplaceAll(mediaTemplate, "$Number$", fmt.Sprintf("%d", i))
			mediaURLs = append(mediaURLs, mediaURL)
		}
		return "", initURL, mediaURLs, "", nil
	}

	fmt.Println("Using regex fallback for DASH manifest...")

	initRe := regexp.MustCompile(`initialization="([^"]+)"`)
	mediaRe := regexp.MustCompile(`media="([^"]+)"`)

	if match := initRe.FindStringSubmatch(manifestStr); len(match) > 1 {
		initURL = match[1]
	}
	if match := mediaRe.FindStringSubmatch(manifestStr); len(match) > 1 {
		mediaTemplate = match[1]
	}

	if initURL == "" {
		return "", "", nil, "", fmt.Errorf("no initialization URL found in manifest")
	}

	initURL = strings.ReplaceAll(initURL, "&amp;", "&")
	mediaTemplate = strings.ReplaceAll(mediaTemplate, "&amp;", "&")

	segmentCount = 0

	segTagRe := regexp.MustCompile(`<S\s+[^>]*>`)
	matches := segTagRe.FindAllString(manifestStr, -1)

	for _, match := range matches {
		repeat := 0
		rRe := regexp.MustCompile(`r="(\d+)"`)
		if rMatch := rRe.FindStringSubmatch(match); len(rMatch) > 1 {
			fmt.Sscanf(rMatch[1], "%d", &repeat)
		}
		segmentCount += repeat + 1
	}

	if segmentCount == 0 {
		return "", "", nil, "", fmt.Errorf("no segments found in manifest (XML: %d, Regex: 0)", len(matches))
	}

	fmt.Printf("Parsed manifest via Regex: %d segments\n", segmentCount)

	for i := 1; i <= segmentCount; i++ {
		mediaURL := strings.ReplaceAll(mediaTemplate, "$Number$", fmt.Sprintf("%d", i))
		mediaURLs = append(mediaURLs, mediaURL)
	}

	return "", initURL, mediaURLs, "", nil
}

func getDownloadURLRotated(apis []string, trackID int64, quality string) (string, string, error) {
	if len(apis) == 0 {
		return "", "", fmt.Errorf("no APIs available")
	}

	rand.Seed(time.Now().UnixNano())
	rand.Shuffle(len(apis), func(i, j int) { apis[i], apis[j] = apis[j], apis[i] })

	fmt.Printf("Rotating through %d APIs...\n", len(apis))

	var lastError error
	var errors []string

	for _, apiURL := range apis {
		fmt.Printf("Trying API: %s\n", apiURL)

		client := &http.Client{
			Timeout: 15 * time.Second,
		}

		url := fmt.Sprintf("%s/track/?id=%d&quality=%s", apiURL, trackID, quality)
		resp, err := client.Get(url)
		if err != nil {
			lastError = err
			errors = append(errors, fmt.Sprintf("%s: %v", apiURL, err))
			continue
		}

		if resp.StatusCode != 200 {
			resp.Body.Close()
			lastError = fmt.Errorf("HTTP %d", resp.StatusCode)
			errors = append(errors, fmt.Sprintf("%s: %v", apiURL, lastError))
			continue
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastError = err
			errors = append(errors, fmt.Sprintf("%s: read body failed", apiURL))
			continue
		}

		var v2Response TidalAPIResponseV2
		if err := json.Unmarshal(body, &v2Response); err == nil && v2Response.Data.Manifest != "" {
			fmt.Printf("✓ Success with: %s\n", apiURL)
			return apiURL, "MANIFEST:" + v2Response.Data.Manifest, nil
		}

		var v1Responses []TidalAPIResponse
		if err := json.Unmarshal(body, &v1Responses); err == nil {
			for _, item := range v1Responses {
				if item.OriginalTrackURL != "" {
					fmt.Printf("✓ Success with: %s\n", apiURL)
					return apiURL, item.OriginalTrackURL, nil
				}
			}
		}

		lastError = fmt.Errorf("no download URL or manifest in response")
		errors = append(errors, fmt.Sprintf("%s: %v", apiURL, lastError))
	}

	fmt.Println("All APIs failed:")
	for _, e := range errors {
		fmt.Printf("  ✗ %s\n", e)
	}

	return "", "", fmt.Errorf("all %d APIs failed. Last error: %v", len(apis), lastError)
}

func buildTidalFilename(title, artist, album, albumArtist, releaseDate string, trackNumber, discNumber int, format string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	var filename string

	numberToUse := position
	if useAlbumTrackNumber && trackNumber > 0 {
		numberToUse = trackNumber
	}

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	if strings.Contains(format, "{") {
		filename = format
		filename = strings.ReplaceAll(filename, "{title}", title)
		filename = strings.ReplaceAll(filename, "{artist}", artist)
		filename = strings.ReplaceAll(filename, "{album}", album)
		filename = strings.ReplaceAll(filename, "{album_artist}", albumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if numberToUse > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", numberToUse))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch format {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", artist, title)
		case "title":
			filename = title
		default:
			filename = fmt.Sprintf("%s - %s", title, artist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", numberToUse, filename)
		}
	}

	return filename + ".flac"
}
