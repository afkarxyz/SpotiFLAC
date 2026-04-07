package backend

import (
	"crypto/cipher"
	"crypto/md5"
	"encoding/hex"
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

	"golang.org/x/crypto/blowfish"
)

const (
	deezerMethodLucida = "lucida"
	deezerMethodARL    = "arl"

	lucidaBaseURL    = "https://lucida.to"
	lucidaRateDelay  = 3 * time.Second
	deezerChunkSize  = 2048
	deezerBlowfishIV = "\x00\x01\x02\x03\x04\x05\x06\x07"
	deezerSecretKey  = "g4el58wc0zvf9na1"
	deezerGWAPI      = "https://www.deezer.com/ajax/gw-light.php"
	deezerMediaAPI   = "https://media.deezer.com/v1/get_url"
	deezerCoverURL   = "https://e-cdn-images.dzcdn.net/images/cover/%s/500x500-000000-80-0-0.jpg"
	deezerUserAgent  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
)

type DeezerDownloader struct {
	client *http.Client
	method string
	arl    string
}

type lucidaTokenData struct {
	Token       string `json:"token"`
	TokenExpiry int64  `json:"tokenExpiry"`
}

type lucidaLoadResponse struct {
	Server  string `json:"server"`
	Handoff string `json:"handoff"`
	Error   string `json:"error,omitempty"`
}

type lucidaStatusResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type deezerGWResponse struct {
	Results map[string]interface{} `json:"results"`
	Error   []interface{}          `json:"error"`
}

type deezerMediaResponse struct {
	Data []struct {
		Media []struct {
			Sources []struct {
				URL      string `json:"url"`
				Provider string `json:"provider"`
			} `json:"sources"`
		} `json:"media"`
		Errors []struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
	} `json:"data"`
}

type deezerTrackInfo struct {
	SongID     string
	TrackToken string
	Title      string
	Artist     string
	Album      string
	CoverID    string
	Duration   int
	MD5Origin  string
}

func NewDeezerDownloader(method, arl string) *DeezerDownloader {
	if method == "" {
		method = deezerMethodLucida
	}
	return &DeezerDownloader{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
		method: method,
		arl:    arl,
	}
}

// ---- Lucida Method ----

func (d *DeezerDownloader) lucidaFetchToken(deezerURL string) (*lucidaTokenData, error) {
	reqURL := fmt.Sprintf("%s/?url=%s", lucidaBaseURL, url.QueryEscape(deezerURL))
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", deezerUserAgent)

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Lucida page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Lucida returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read Lucida response: %w", err)
	}

	bodyStr := string(body)

	// Extract SvelteKit page data JSON embedded in the HTML
	// Look for the data section containing token and tokenExpiry
	dataMarker := `{"type":"data","data":`
	dataIdx := strings.Index(bodyStr, dataMarker)
	if dataIdx == -1 {
		return nil, fmt.Errorf("could not find SvelteKit data marker in Lucida page")
	}

	// Extract the data JSON object
	dataStart := dataIdx + len(dataMarker)
	// Find the matching closing brace by counting braces
	braceCount := 0
	dataEnd := dataStart
	for i := dataStart; i < len(bodyStr); i++ {
		if bodyStr[i] == '{' {
			braceCount++
		} else if bodyStr[i] == '}' {
			braceCount--
			if braceCount == 0 {
				dataEnd = i + 1
				break
			}
		}
	}

	if dataEnd <= dataStart {
		return nil, fmt.Errorf("could not parse SvelteKit data from Lucida page")
	}

	dataJSON := bodyStr[dataStart:dataEnd]

	// Parse token and tokenExpiry from the data
	var pageData struct {
		Token       string `json:"token"`
		TokenExpiry int64  `json:"tokenExpiry"`
	}
	if err := json.Unmarshal([]byte(dataJSON), &pageData); err != nil {
		// Fallback: try regex extraction
		tokenRegex := regexp.MustCompile(`"token"\s*:\s*"([^"]+)"`)
		matches := tokenRegex.FindStringSubmatch(dataJSON)
		expiryRegex := regexp.MustCompile(`"tokenExpiry"\s*:\s*(\d+)`)
		expiryMatches := expiryRegex.FindStringSubmatch(dataJSON)

		if len(matches) < 2 {
			return nil, fmt.Errorf("could not find CSRF token in Lucida page")
		}

		tokenData := &lucidaTokenData{Token: matches[1]}
		if len(expiryMatches) >= 2 {
			fmt.Sscanf(expiryMatches[1], "%d", &tokenData.TokenExpiry)
		}
		return tokenData, nil
	}

	return &lucidaTokenData{
		Token:       pageData.Token,
		TokenExpiry: pageData.TokenExpiry,
	}, nil
}

func (d *DeezerDownloader) lucidaRequestDownload(tokenData *lucidaTokenData, deezerURL string) (*lucidaLoadResponse, error) {
	payload := map[string]interface{}{
		"url": deezerURL,
		"token": map[string]interface{}{
			"expiry":  tokenData.TokenExpiry,
			"primary": tokenData.Token,
		},
		"account": map[string]string{
			"id":   "auto",
			"type": "country",
		},
		"compat":    false,
		"downscale": "original",
		"handoff":   true,
		"metadata":  true,
		"private":   false,
		"upload": map[string]bool{
			"enabled": false,
		},
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	reqURL := fmt.Sprintf("%s/api/load?url=%s", lucidaBaseURL, url.QueryEscape("/api/fetch/stream/v2"))
	req, err := http.NewRequest("POST", reqURL, strings.NewReader(string(payloadBytes)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", deezerUserAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Referer", lucidaBaseURL+"/")

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to request Lucida download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyPreview, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return nil, fmt.Errorf("Lucida load API returned status %d: %s", resp.StatusCode, string(bodyPreview))
	}

	var loadResp lucidaLoadResponse
	if err := json.NewDecoder(resp.Body).Decode(&loadResp); err != nil {
		return nil, fmt.Errorf("failed to decode Lucida load response: %w", err)
	}

	if loadResp.Error != "" {
		return nil, fmt.Errorf("Lucida error: %s", loadResp.Error)
	}

	return &loadResp, nil
}

func (d *DeezerDownloader) lucidaPollStatus(server, handoff string) error {
	statusURL := fmt.Sprintf("https://%s.lucida.to/api/fetch/request/%s", server, handoff)

	maxAttempts := 60
	for i := 0; i < maxAttempts; i++ {
		req, err := http.NewRequest("GET", statusURL, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", deezerUserAgent)

		resp, err := d.client.Do(req)
		if err != nil {
			time.Sleep(2 * time.Second)
			continue
		}

		if resp.StatusCode == 500 {
			resp.Body.Close()
			time.Sleep(2 * time.Second)
			continue
		}

		var statusResp lucidaStatusResponse
		json.NewDecoder(resp.Body).Decode(&statusResp)
		resp.Body.Close()

		if statusResp.Status == "completed" || statusResp.Status == "done" {
			return nil
		}
		if statusResp.Status == "failed" || statusResp.Status == "error" {
			return fmt.Errorf("Lucida download failed: %s", statusResp.Message)
		}

		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("Lucida download timed out after %d attempts", maxAttempts)
}

func (d *DeezerDownloader) lucidaDownloadFile(server, handoff, filepath string) error {
	downloadURL := fmt.Sprintf("https://%s.lucida.to/api/fetch/request/%s/download", server, handoff)

	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", deezerUserAgent)

	dlClient := &http.Client{
		Timeout: 5 * time.Minute,
	}
	resp, err := dlClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download from Lucida: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("Lucida download returned status %d", resp.StatusCode)
	}

	out, err := os.Create(filepath)
	if err != nil {
		return err
	}
	defer out.Close()

	pw := NewProgressWriter(out)
	_, err = io.Copy(pw, resp.Body)
	if err != nil {
		out.Close()
		os.Remove(filepath)
		return err
	}

	fmt.Printf("\rDownloaded: %.2f MB (Complete)\n", float64(pw.GetTotal())/(1024*1024))
	return nil
}

func (d *DeezerDownloader) downloadViaLucida(deezerURL, outputDir string) (string, error) {
	fmt.Println("Downloading via Lucida (no account needed)...")

	fmt.Println("Fetching Lucida token...")
	token, err := d.lucidaFetchToken(deezerURL)
	if err != nil {
		return "", fmt.Errorf("failed to get Lucida token: %w", err)
	}

	fmt.Println("Requesting download from Lucida...")
	loadResp, err := d.lucidaRequestDownload(token, deezerURL)
	if err != nil {
		return "", fmt.Errorf("failed to request Lucida download: %w", err)
	}

	if loadResp.Server == "" || loadResp.Handoff == "" {
		return "", fmt.Errorf("Lucida returned incomplete response (no server/handoff)")
	}

	fmt.Println("Waiting for Lucida to process track...")
	if err := d.lucidaPollStatus(loadResp.Server, loadResp.Handoff); err != nil {
		return "", err
	}

	trackID, _ := extractDeezerTrackID(deezerURL)
	if trackID == "" {
		trackID = "unknown"
	}

	fileName := fmt.Sprintf("deezer_%s.flac", trackID)
	filePath := filepath.Join(outputDir, fileName)

	fmt.Println("Downloading track from Lucida...")
	if err := d.lucidaDownloadFile(loadResp.Server, loadResp.Handoff, filePath); err != nil {
		return "", err
	}

	recordProviderSuccess("deezer", "lucida")
	return filePath, nil
}

// ---- ARL Method ----

func (d *DeezerDownloader) arlAuthenticate() (string, string, error) {
	if d.arl == "" {
		return "", "", fmt.Errorf("ARL token is required for ARL method")
	}

	payload := `{"sng_id":"0"}`
	apiURL := fmt.Sprintf("%s?method=deezer.getUserData&input=3&api_version=1.0&api_token=", deezerGWAPI)

	req, err := http.NewRequest("POST", apiURL, strings.NewReader(payload))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("User-Agent", deezerUserAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", fmt.Sprintf("arl=%s", d.arl))

	resp, err := d.client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("failed to authenticate with Deezer: %w", err)
	}
	defer resp.Body.Close()

	var gwResp deezerGWResponse
	if err := json.NewDecoder(resp.Body).Decode(&gwResp); err != nil {
		return "", "", fmt.Errorf("failed to decode auth response: %w", err)
	}

	if len(gwResp.Error) > 0 {
		return "", "", fmt.Errorf("Deezer auth error: %v", gwResp.Error)
	}

	results := gwResp.Results
	checkForm, _ := results["checkForm"].(string)
	if checkForm == "" {
		return "", "", fmt.Errorf("failed to get API token from Deezer (ARL may be expired)")
	}

	user, _ := results["USER"].(map[string]interface{})
	if user == nil {
		return "", "", fmt.Errorf("failed to get user data from Deezer")
	}

	options, _ := user["OPTIONS"].(map[string]interface{})
	if options == nil {
		return "", "", fmt.Errorf("failed to get user options from Deezer")
	}

	licenseToken, _ := options["license_token"].(string)
	if licenseToken == "" {
		return "", "", fmt.Errorf("failed to get license token from Deezer")
	}

	return checkForm, licenseToken, nil
}

func (d *DeezerDownloader) arlGetTrackInfo(apiToken, trackID string) (*deezerTrackInfo, error) {
	payload := fmt.Sprintf(`{"sng_id":"%s"}`, trackID)
	apiURL := fmt.Sprintf("%s?method=song.getData&input=3&api_version=1.0&api_token=%s", deezerGWAPI, apiToken)

	req, err := http.NewRequest("POST", apiURL, strings.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", deezerUserAgent)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", fmt.Sprintf("arl=%s", d.arl))

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to get track info: %w", err)
	}
	defer resp.Body.Close()

	var gwResp deezerGWResponse
	if err := json.NewDecoder(resp.Body).Decode(&gwResp); err != nil {
		return nil, fmt.Errorf("failed to decode track info: %w", err)
	}

	results := gwResp.Results
	info := &deezerTrackInfo{
		SongID: trackID,
	}

	if v, ok := results["TRACK_TOKEN"].(string); ok {
		info.TrackToken = v
	}
	if v, ok := results["SNG_TITLE"].(string); ok {
		info.Title = v
	}
	if v, ok := results["ART_NAME"].(string); ok {
		info.Artist = v
	}
	if v, ok := results["ALB_TITLE"].(string); ok {
		info.Album = v
	}
	if v, ok := results["ALB_PICTURE"].(string); ok {
		info.CoverID = v
	}
	if v, ok := results["MD5_ORIGIN"].(string); ok {
		info.MD5Origin = v
	}

	if info.TrackToken == "" {
		return nil, fmt.Errorf("no track token found for track %s", trackID)
	}

	return info, nil
}

func (d *DeezerDownloader) arlGetMediaURL(licenseToken, trackToken, quality string) (string, error) {
	format := "FLAC"
	switch quality {
	case "128":
		format = "MP3_128"
	case "320":
		format = "MP3_320"
	default:
		format = "FLAC"
	}

	payload := map[string]interface{}{
		"license_token": licenseToken,
		"media": []map[string]interface{}{
			{
				"type": "FULL",
				"formats": []map[string]string{
					{"cipher": "BF_CBC_STRIPE", "format": format},
				},
			},
		},
		"track_tokens": []string{trackToken},
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", deezerMediaAPI, strings.NewReader(string(payloadBytes)))
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", deezerUserAgent)
	req.Header.Set("Content-Type", "application/json")

	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get media URL: %w", err)
	}
	defer resp.Body.Close()

	var mediaResp deezerMediaResponse
	if err := json.NewDecoder(resp.Body).Decode(&mediaResp); err != nil {
		return "", fmt.Errorf("failed to decode media response: %w", err)
	}

	if len(mediaResp.Data) == 0 {
		return "", fmt.Errorf("no media data returned")
	}

	if len(mediaResp.Data[0].Errors) > 0 {
		return "", fmt.Errorf("Deezer media error: %s (code %d)", mediaResp.Data[0].Errors[0].Message, mediaResp.Data[0].Errors[0].Code)
	}

	if len(mediaResp.Data[0].Media) == 0 || len(mediaResp.Data[0].Media[0].Sources) == 0 {
		return "", fmt.Errorf("no media sources returned")
	}

	return mediaResp.Data[0].Media[0].Sources[0].URL, nil
}

func deezerGetBlowfishKey(songID string) ([]byte, error) {
	hash := md5.Sum([]byte(songID))
	hashHex := hex.EncodeToString(hash[:])

	key := make([]byte, 16)
	for i := 0; i < 16; i++ {
		key[i] = hashHex[i] ^ hashHex[i+16] ^ deezerSecretKey[i]
	}

	return key, nil
}

func deezerDecryptChunk(data, key []byte) ([]byte, error) {
	block, err := blowfish.NewCipher(key)
	if err != nil {
		return nil, err
	}

	iv := []byte(deezerBlowfishIV)
	mode := cipher.NewCBCDecrypter(block, iv)

	decrypted := make([]byte, len(data))
	mode.CryptBlocks(decrypted, data)

	return decrypted, nil
}

func (d *DeezerDownloader) arlDownloadAndDecrypt(mediaURL, filePath, songID string) error {
	key, err := deezerGetBlowfishKey(songID)
	if err != nil {
		return fmt.Errorf("failed to derive decryption key: %w", err)
	}

	dlClient := &http.Client{
		Timeout: 5 * time.Minute,
	}
	req, err := http.NewRequest("GET", mediaURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", deezerUserAgent)

	resp, err := dlClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download encrypted track: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("Deezer media server returned status %d", resp.StatusCode)
	}

	out, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer out.Close()

	chunk := 0
	buf := make([]byte, deezerChunkSize)
	var totalWritten int64

	for {
		n, readErr := io.ReadFull(resp.Body, buf)
		if n > 0 {
			data := buf[:n]

			if chunk%3 == 0 && n == deezerChunkSize {
				data, err = deezerDecryptChunk(data, key)
				if err != nil {
					out.Close()
					os.Remove(filePath)
					return fmt.Errorf("decryption failed at chunk %d: %w", chunk, err)
				}
			}

			written, writeErr := out.Write(data)
			if writeErr != nil {
				out.Close()
				os.Remove(filePath)
				return writeErr
			}
			totalWritten += int64(written)
			chunk++
		}

		if readErr != nil {
			if readErr == io.EOF || readErr == io.ErrUnexpectedEOF {
				break
			}
			out.Close()
			os.Remove(filePath)
			return fmt.Errorf("error reading stream: %w", readErr)
		}
	}

	fmt.Printf("\rDownloaded and decrypted: %.2f MB\n", float64(totalWritten)/(1024*1024))
	return nil
}

func (d *DeezerDownloader) downloadViaARL(deezerURL, outputDir, quality string) (string, error) {
	fmt.Println("Downloading via ARL token...")

	trackID, err := extractDeezerTrackID(deezerURL)
	if err != nil {
		return "", fmt.Errorf("failed to extract Deezer track ID: %w", err)
	}

	fmt.Println("Authenticating with Deezer...")
	apiToken, licenseToken, err := d.arlAuthenticate()
	if err != nil {
		return "", fmt.Errorf("Deezer authentication failed: %w", err)
	}
	fmt.Println("Authenticated successfully")

	fmt.Printf("Getting track info for ID: %s\n", trackID)
	trackInfo, err := d.arlGetTrackInfo(apiToken, trackID)
	if err != nil {
		return "", fmt.Errorf("failed to get track info: %w", err)
	}
	fmt.Printf("Track: %s - %s\n", trackInfo.Artist, trackInfo.Title)

	fmt.Println("Getting media URL...")
	mediaURL, err := d.arlGetMediaURL(licenseToken, trackInfo.TrackToken, quality)
	if err != nil {
		return "", fmt.Errorf("failed to get media URL: %w", err)
	}

	ext := ".flac"
	switch quality {
	case "128", "320":
		ext = ".mp3"
	}

	fileName := fmt.Sprintf("deezer_%s%s", trackID, ext)
	filePath := filepath.Join(outputDir, fileName)

	fmt.Println("Downloading and decrypting track...")
	if err := d.arlDownloadAndDecrypt(mediaURL, filePath, trackInfo.SongID); err != nil {
		return "", err
	}

	recordProviderSuccess("deezer", "arl")
	return filePath, nil
}

// ---- Common Download Methods ----

func (d *DeezerDownloader) DownloadFromService(deezerURL, outputDir, quality string) (string, error) {
	if d.method == deezerMethodARL && d.arl != "" {
		filePath, err := d.downloadViaARL(deezerURL, outputDir, quality)
		if err == nil {
			return filePath, nil
		}
		fmt.Printf("ARL download failed: %v\n", err)
		recordProviderFailure("deezer", "arl")
		return "", err
	}

	filePath, err := d.downloadViaLucida(deezerURL, outputDir)
	if err != nil {
		recordProviderFailure("deezer", "lucida")
		return "", err
	}
	return filePath, nil
}

func (d *DeezerDownloader) DownloadByURL(deezerURL, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {

	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	if spotifyTrackName != "" && spotifyArtistName != "" {
		filenameArtist := spotifyArtistName
		filenameAlbumArtist := spotifyAlbumArtist
		if useFirstArtistOnly {
			filenameArtist = GetFirstArtist(spotifyArtistName)
			filenameAlbumArtist = GetFirstArtist(spotifyAlbumArtist)
		}
		expectedFilename := BuildExpectedFilename(spotifyTrackName, filenameArtist, spotifyAlbumName, filenameAlbumArtist, spotifyReleaseDate, filenameFormat, playlistName, playlistOwner, includeTrackNumber, position, spotifyDiscNumber, false)
		expectedPath := filepath.Join(outputDir, expectedFilename)

		if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 0 {
			fmt.Printf("File already exists: %s (%.2f MB)\n", expectedPath, float64(fileInfo.Size())/(1024*1024))
			return "EXISTS:" + expectedPath, nil
		}
	}

	type mbResult struct {
		ISRC     string
		Metadata Metadata
	}

	metaChan := make(chan mbResult, 1)
	if embedGenre && spotifyURL != "" {
		go func() {
			res := mbResult{}
			var isrc string
			parts := strings.Split(spotifyURL, "/")
			if len(parts) > 0 {
				sID := strings.Split(parts[len(parts)-1], "?")[0]
				if sID != "" {
					client := NewSongLinkClient()
					if val, err := client.GetISRC(sID); err == nil {
						isrc = val
					}
				}
			}
			res.ISRC = isrc
			if isrc != "" {
				fmt.Println("Fetching MusicBrainz metadata...")
				if fetchedMeta, err := FetchMusicBrainzMetadata(isrc, spotifyTrackName, spotifyArtistName, spotifyAlbumName, useSingleGenre, embedGenre); err == nil {
					res.Metadata = fetchedMeta
					fmt.Println("MusicBrainz metadata fetched")
				} else {
					fmt.Printf("Warning: Failed to fetch MusicBrainz metadata: %v\n", err)
				}
			}
			metaChan <- res
		}()
	} else {
		close(metaChan)
	}

	fmt.Printf("Using Deezer URL: %s\n", deezerURL)

	filePath, err := d.DownloadFromService(deezerURL, outputDir, quality)
	if err != nil {
		return "", err
	}

	var isrc string
	var mbMeta Metadata
	if spotifyURL != "" {
		result := <-metaChan
		isrc = result.ISRC
		mbMeta = result.Metadata
	}

	originalFileDir := filepath.Dir(filePath)
	originalFileBase := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))

	if spotifyTrackName != "" && spotifyArtistName != "" {
		safeArtist := sanitizeFilename(spotifyArtistName)
		safeAlbumArtist := sanitizeFilename(spotifyAlbumArtist)

		if useFirstArtistOnly {
			safeArtist = sanitizeFilename(GetFirstArtist(spotifyArtistName))
			safeAlbumArtist = sanitizeFilename(GetFirstArtist(spotifyAlbumArtist))
		}

		safeTitle := sanitizeFilename(spotifyTrackName)
		safeAlbum := sanitizeFilename(spotifyAlbumName)

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
			newFilename = strings.ReplaceAll(newFilename, "{date}", SanitizeFilename(spotifyReleaseDate))

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

		ext := filepath.Ext(filePath)
		if ext == "" {
			ext = ".flac"
		}
		newFilename = newFilename + ext
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
		Comment:     spotifyURL,
		Copyright:   spotifyCopyright,
		Publisher:   spotifyPublisher,
		Description: "https://github.com/afkarxyz/SpotiFLAC",
		ISRC:        isrc,
		Genre:       mbMeta.Genre,
	}

	if err := EmbedMetadataToConvertedFile(filePath, metadata, coverPath); err != nil {
		fmt.Printf("Warning: Failed to embed metadata: %v\n", err)
	} else {
		fmt.Println("Metadata embedded successfully")
	}

	_ = originalFileDir
	_ = originalFileBase

	fmt.Println("Done")
	fmt.Println("Downloaded successfully from Deezer")
	return filePath, nil
}

func (d *DeezerDownloader) DownloadBySpotifyID(spotifyTrackID, outputDir, quality, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL string, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, embedMaxQualityCover bool, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyURL string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {

	fmt.Println("Getting Deezer URL from Spotify...")
	client := NewSongLinkClient()
	deezerURL, err := client.GetDeezerURLFromSpotify(spotifyTrackID)
	if err != nil {
		return "", fmt.Errorf("failed to get Deezer URL: %w", err)
	}

	return d.DownloadByURL(deezerURL, outputDir, quality, filenameFormat, playlistName, playlistOwner, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, embedMaxQualityCover, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyURL, useFirstArtistOnly, useSingleGenre, embedGenre)
}
