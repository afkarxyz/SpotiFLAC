package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	spotifySessionTokenURL = "https://open.spotify.com/api/token"
	spotifyGIDMetadataURL  = "https://spclient.wg.spotify.com/metadata/4/%s/%s?market=from_token"
	spotifyBase62Alphabet  = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	spotifyTokenCacheFile  = ".isrc-finder-token.json"
)

var spotifyAnonymousTokenMu sync.Mutex

type spotifyAnonymousToken struct {
	AccessToken                      string `json:"accessToken"`
	AccessTokenExpirationTimestampMs int64  `json:"accessTokenExpirationTimestampMs"`
}

type spotifyTrackRawData struct {
	Album struct {
		GID string `json:"gid"`
	} `json:"album"`
	ExternalID []struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"external_id"`
}

type spotifyAlbumRawData struct {
	ExternalID []struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	} `json:"external_id"`
}

type SpotifyTrackIdentifiers struct {
	ISRC string `json:"isrc,omitempty"`
	UPC  string `json:"upc,omitempty"`
}

func GetSpotifyTrackIdentifiersDirect(spotifyTrackID string) (SpotifyTrackIdentifiers, error) {
	normalizedTrackID, err := extractSpotifyTrackID(spotifyTrackID)
	if err != nil {
		return SpotifyTrackIdentifiers{}, err
	}

	identifiers := SpotifyTrackIdentifiers{}

	cachedISRC, err := GetCachedISRC(normalizedTrackID)
	if err != nil {
		fmt.Printf("Warning: failed to read ISRC cache: %v\n", err)
	} else if cachedISRC != "" {
		fmt.Printf("Found ISRC in cache: %s\n", cachedISRC)
		identifiers.ISRC = cachedISRC
	}

	httpClient := &http.Client{Timeout: 30 * time.Second}

	payload, metadataErr := fetchSpotifyTrackRawData(httpClient, normalizedTrackID)
	if metadataErr == nil {
		metadataIdentifiers, extractErr := extractSpotifyTrackIdentifiers(httpClient, payload)
		if extractErr == nil {
			mergeSpotifyTrackIdentifiers(&identifiers, metadataIdentifiers)
			if identifiers.ISRC != "" {
				fmt.Printf("Found identifiers via Spotify metadata: isrc=%s upc=%s\n", identifiers.ISRC, identifiers.UPC)
				cacheResolvedSpotifyTrackISRC(normalizedTrackID, "", identifiers.ISRC)
			}
			if identifiers.ISRC != "" && identifiers.UPC != "" {
				return identifiers, nil
			}
		}
		metadataErr = extractErr
	}

	if metadataErr != nil {
		fmt.Printf("Warning: Spotify metadata identifier lookup failed, falling back to Soundplate: %v\n", metadataErr)
	}

	if identifiers.ISRC == "" {
		client := NewSongLinkClient()
		isrc, resolvedTrackID, soundplateErr := client.lookupSpotifyISRCViaSoundplate(normalizedTrackID)
		if soundplateErr == nil && isrc != "" {
			identifiers.ISRC = isrc
			fmt.Printf("Found ISRC via Soundplate: %s\n", isrc)
			cacheResolvedSpotifyTrackISRC(normalizedTrackID, resolvedTrackID, isrc)
			return identifiers, nil
		}

		if metadataErr != nil && soundplateErr != nil {
			return identifiers, fmt.Errorf("spotify metadata lookup failed: %v | soundplate lookup failed: %w", metadataErr, soundplateErr)
		}
		if soundplateErr != nil && identifiers.UPC == "" {
			return identifiers, soundplateErr
		}
	}

	if identifiers.ISRC != "" || identifiers.UPC != "" {
		return identifiers, nil
	}
	if metadataErr != nil {
		return identifiers, metadataErr
	}

	return identifiers, fmt.Errorf("no Spotify identifiers found for track %s", normalizedTrackID)
}

func (s *SongLinkClient) lookupSpotifyISRC(spotifyTrackID string) (string, error) {
	identifiers, err := GetSpotifyTrackIdentifiersDirect(spotifyTrackID)
	if err != nil {
		return "", err
	}
	if identifiers.ISRC == "" {
		return "", fmt.Errorf("no Spotify ISRC found for track %s", strings.TrimSpace(spotifyTrackID))
	}

	return identifiers.ISRC, nil
}

func cacheResolvedSpotifyTrackISRC(trackID string, resolvedTrackID string, isrc string) {
	if err := PutCachedISRC(trackID, isrc); err != nil {
		fmt.Printf("Warning: failed to write ISRC cache: %v\n", err)
	}
	if resolvedTrackID != "" && resolvedTrackID != trackID {
		if err := PutCachedISRC(resolvedTrackID, isrc); err != nil {
			fmt.Printf("Warning: failed to write ISRC cache for resolved track ID: %v\n", err)
		}
	}
}

func mergeSpotifyTrackIdentifiers(target *SpotifyTrackIdentifiers, incoming SpotifyTrackIdentifiers) {
	if incoming.ISRC != "" {
		target.ISRC = strings.TrimSpace(incoming.ISRC)
	}
	if incoming.UPC != "" {
		target.UPC = strings.TrimSpace(incoming.UPC)
	}
}

func lookupSpotifyAlbumUPC(albumID string) (string, error) {
	normalizedAlbumID := strings.TrimSpace(albumID)
	if normalizedAlbumID == "" {
		return "", fmt.Errorf("spotify album ID is required")
	}

	httpClient := &http.Client{Timeout: 30 * time.Second}
	payload, err := fetchSpotifyAlbumRawData(httpClient, normalizedAlbumID)
	if err != nil {
		return "", err
	}

	return extractSpotifyAlbumUPC(payload)
}

func requestSpotifyBytes(client *http.Client, targetURL string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, targetURL, nil)
	if err != nil {
		return nil, err
	}

	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		details := strings.TrimSpace(string(body))
		if details == "" {
			details = resp.Status
		}
		return nil, fmt.Errorf("request failed: %s", details)
	}

	return body, nil
}

func requestSpotifyJSON(client *http.Client, targetURL string, headers map[string]string, target interface{}) error {
	body, err := requestSpotifyBytes(client, targetURL, headers)
	if err != nil {
		return err
	}

	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("failed to parse JSON response: %w", err)
	}

	return nil
}

func loadSpotifyCachedToken() (*spotifyAnonymousToken, error) {
	cachePath, err := spotifyTokenCachePath()
	if err != nil {
		return nil, err
	}

	body, err := os.ReadFile(cachePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read token cache: %w", err)
	}

	var token spotifyAnonymousToken
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, fmt.Errorf("failed to read token cache: %w", err)
	}

	return &token, nil
}

func saveSpotifyCachedToken(token *spotifyAnonymousToken) error {
	cachePath, err := spotifyTokenCachePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return fmt.Errorf("failed to create token cache directory: %w", err)
	}

	body, err := json.MarshalIndent(token, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(cachePath, body, 0o644); err != nil {
		return fmt.Errorf("failed to write token cache: %w", err)
	}

	return nil
}

func spotifyTokenCachePath() (string, error) {
	appDir, err := EnsureAppDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(appDir, spotifyTokenCacheFile), nil
}

func spotifyTokenIsValid(token *spotifyAnonymousToken) bool {
	if token == nil || token.AccessToken == "" || token.AccessTokenExpirationTimestampMs == 0 {
		return false
	}

	return time.Now().UnixMilli() < token.AccessTokenExpirationTimestampMs-30_000
}

func requestSpotifyAnonymousAccessToken(client *http.Client) (string, error) {
	spotifyAnonymousTokenMu.Lock()
	defer spotifyAnonymousTokenMu.Unlock()

	cachedToken, err := loadSpotifyCachedToken()
	if err != nil {
		return "", err
	}

	if spotifyTokenIsValid(cachedToken) {
		return cachedToken.AccessToken, nil
	}

	generatedTOTP, version, err := generateSpotifyTOTP(time.Now())
	if err != nil {
		return "", fmt.Errorf("failed to generate Spotify TOTP: %w", err)
	}

	query := url.Values{
		"reason":      {"init"},
		"productType": {"web-player"},
		"totp":        {generatedTOTP},
		"totpServer":  {generatedTOTP},
		"totpVer":     {strconv.Itoa(version)},
	}

	var token spotifyAnonymousToken
	if err := requestSpotifyJSON(client, spotifySessionTokenURL+"?"+query.Encode(), nil, &token); err != nil {
		return "", err
	}

	if err := saveSpotifyCachedToken(&token); err != nil {
		return "", err
	}

	return token.AccessToken, nil
}

func extractSpotifyTrackID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("track input is required")
	}

	if strings.HasPrefix(value, "spotify:track:") {
		return value[strings.LastIndex(value, ":")+1:], nil
	}

	parsed, err := url.Parse(value)
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) >= 2 && parts[0] == "track" {
			return parts[1], nil
		}
		return "", errors.New("expected URL like https://open.spotify.com/track/<id>")
	}

	if len(value) == 22 {
		return value, nil
	}

	return "", errors.New("track must be a Spotify track ID, URL, or URI")
}

func spotifyTrackIDToGID(trackID string) (string, error) {
	return spotifyEntityIDToGID(trackID)
}

func spotifyEntityIDToGID(entityID string) (string, error) {
	if entityID == "" {
		return "", errors.New("entity ID is empty")
	}

	value := big.NewInt(0)
	base := big.NewInt(62)

	for _, char := range entityID {
		index := strings.IndexRune(spotifyBase62Alphabet, char)
		if index < 0 {
			return "", fmt.Errorf("invalid base62 character: %q", string(char))
		}

		value.Mul(value, base)
		value.Add(value, big.NewInt(int64(index)))
	}

	hexValue := value.Text(16)
	if len(hexValue) < 32 {
		hexValue = strings.Repeat("0", 32-len(hexValue)) + hexValue
	}

	return hexValue, nil
}

func fetchSpotifyTrackRawData(client *http.Client, trackID string) ([]byte, error) {
	gid, err := spotifyTrackIDToGID(trackID)
	if err != nil {
		return nil, err
	}

	return fetchSpotifyRawMetadataByGID(client, "track", gid)
}

func fetchSpotifyAlbumRawData(client *http.Client, albumID string) ([]byte, error) {
	gid, err := spotifyEntityIDToGID(albumID)
	if err != nil {
		return nil, err
	}

	return fetchSpotifyRawMetadataByGID(client, "album", gid)
}

func fetchSpotifyRawMetadataByGID(client *http.Client, entityType string, gid string) ([]byte, error) {
	accessToken, err := requestSpotifyAnonymousAccessToken(client)
	if err != nil {
		return nil, err
	}

	return requestSpotifyBytes(
		client,
		fmt.Sprintf(spotifyGIDMetadataURL, entityType, gid),
		map[string]string{
			"authorization": "Bearer " + accessToken,
			"accept":        "application/json",
			"user-agent":    songLinkUserAgent,
		},
	)
}

func extractSpotifyTrackIdentifiers(client *http.Client, payload []byte) (SpotifyTrackIdentifiers, error) {
	var track spotifyTrackRawData
	if err := json.Unmarshal(payload, &track); err != nil {
		return SpotifyTrackIdentifiers{}, fmt.Errorf("failed to decode Spotify track metadata: %w", err)
	}

	identifiers := SpotifyTrackIdentifiers{}
	for _, externalID := range track.ExternalID {
		if strings.EqualFold(strings.TrimSpace(externalID.Type), "isrc") {
			if isrc := firstISRCMatch(externalID.ID); isrc != "" {
				identifiers.ISRC = isrc
				break
			}
		}
	}

	if identifiers.ISRC == "" {
		identifiers.ISRC = firstISRCMatch(string(payload))
	}

	albumGID := strings.TrimSpace(track.Album.GID)
	if client != nil && albumGID != "" {
		albumPayload, err := fetchSpotifyRawMetadataByGID(client, "album", albumGID)
		if err == nil {
			if upc, upcErr := extractSpotifyAlbumUPC(albumPayload); upcErr == nil {
				identifiers.UPC = upc
			}
		}
	}

	return identifiers, nil
}

func extractSpotifyTrackISRC(payload []byte) (string, error) {
	identifiers, err := extractSpotifyTrackIdentifiers(nil, payload)
	if err != nil {
		return "", err
	}
	if identifiers.ISRC != "" {
		return identifiers.ISRC, nil
	}

	return "", fmt.Errorf("ISRC not found in Spotify track metadata")
}

func extractSpotifyAlbumUPC(payload []byte) (string, error) {
	var album spotifyAlbumRawData
	if err := json.Unmarshal(payload, &album); err != nil {
		return "", fmt.Errorf("failed to decode Spotify album metadata: %w", err)
	}

	for _, externalID := range album.ExternalID {
		if strings.EqualFold(strings.TrimSpace(externalID.Type), "upc") {
			upc := strings.TrimSpace(externalID.ID)
			if upc != "" {
				return upc, nil
			}
		}
	}

	return "", fmt.Errorf("UPC not found in Spotify album metadata")
}
