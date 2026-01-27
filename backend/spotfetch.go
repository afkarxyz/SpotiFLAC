package backend

import (
	"bytes"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"sort"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

var SpotifyError = errors.New("spotify error")

type SpotifyClient struct {
	client        *http.Client
	accessToken   string
	clientToken   string
	clientID      string
	deviceID      string
	clientVersion string
	cookies       map[string]string
}

func NewSpotifyClient() *SpotifyClient {
	return &SpotifyClient{
		client:  &http.Client{Timeout: 30 * time.Second},
		cookies: make(map[string]string),
	}
}

func (c *SpotifyClient) getTOTPSecret() (int, []byte) {
	secrets := map[int][]byte{
		59: {123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86, 63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72},
		60: {79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85, 122, 63, 91, 64, 87, 87},
		61: {44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78},
	}

	version := 61
	secretList := secrets[version]
	return version, secretList
}

func (c *SpotifyClient) generateTOTP() (string, int, error) {
	version, secretList := c.getTOTPSecret()

	transformed := make([]byte, len(secretList))
	for i, b := range secretList {
		transformed[i] = b ^ byte((i%33)+9)
	}

	var joined strings.Builder
	for _, b := range transformed {
		joined.WriteString(strconv.Itoa(int(b)))
	}

	hexStr := hex.EncodeToString([]byte(joined.String()))
	hexBytes, err := hex.DecodeString(hexStr)
	if err != nil {
		return "", 0, err
	}

	secret := base32Encode(hexBytes)
	secret = strings.TrimRight(secret, "=")

	key, err := otp.NewKeyFromURL(fmt.Sprintf("otpauth://totp/secret?secret=%s", secret))
	if err != nil {
		return "", 0, err
	}

	totpCode, err := totp.GenerateCode(key.Secret(), time.Now())
	if err != nil {
		return "", 0, err
	}

	return totpCode, version, nil
}

func base32Encode(data []byte) string {
	b32 := base32.StdEncoding.WithPadding(base32.NoPadding)
	return b32.EncodeToString(data)
}

func (c *SpotifyClient) getAccessToken() error {
	totpCode, version, err := c.generateTOTP()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("GET", "https://open.spotify.com/api/token", nil)
	if err != nil {
		return err
	}

	q := req.URL.Query()
	q.Add("reason", "init")
	q.Add("productType", "web-player")
	q.Add("totp", totpCode)
	q.Add("totpVer", strconv.Itoa(version))
	q.Add("totpServer", totpCode)
	req.URL.RawQuery = q.Encode()

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("%w: access token request failed: HTTP %d", SpotifyError, resp.StatusCode)
	}

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return err
	}

	c.accessToken = getString(data, "accessToken")
	c.clientID = getString(data, "clientId")

	for _, cookie := range resp.Cookies() {
		if cookie.Name == "sp_t" {
			c.deviceID = cookie.Value
		}
		c.cookies[cookie.Name] = cookie.Value
	}

	return nil
}

func (c *SpotifyClient) getSessionInfo() error {
	req, err := http.NewRequest("GET", "https://open.spotify.com", nil)
	if err != nil {
		return err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	for name, value := range c.cookies {
		req.AddCookie(&http.Cookie{Name: name, Value: value})
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("%w: session initialization failed: HTTP %d", SpotifyError, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	re := regexp.MustCompile(`<script id="appServerConfig" type="text/plain">([^<]+)</script>`)
	matches := re.FindStringSubmatch(string(body))
	if len(matches) > 1 {
		decoded, err := base64.StdEncoding.DecodeString(matches[1])
		if err == nil {
			var cfg map[string]interface{}
			if json.Unmarshal(decoded, &cfg) == nil {
				c.clientVersion = getString(cfg, "clientVersion")
			}
		}
	}

	for _, cookie := range resp.Cookies() {
		if cookie.Name == "sp_t" {
			c.deviceID = cookie.Value
		}
		c.cookies[cookie.Name] = cookie.Value
	}

	return nil
}

func (c *SpotifyClient) getClientToken() error {
	if c.clientID == "" || c.deviceID == "" || c.clientVersion == "" {
		if err := c.getSessionInfo(); err != nil {
			return err
		}
		if err := c.getAccessToken(); err != nil {
			return err
		}
	}

	payload := map[string]interface{}{
		"client_data": map[string]interface{}{
			"client_version": c.clientVersion,
			"client_id":      c.clientID,
			"js_sdk_data": map[string]interface{}{
				"device_brand": "unknown",
				"device_model": "unknown",
				"os":           "windows",
				"os_version":   "NT 10.0",
				"device_id":    c.deviceID,
				"device_type":  "computer",
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://clienttoken.spotify.com/v1/clienttoken", bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	req.Header.Set("Authority", "clienttoken.spotify.com")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("%w: client token request failed: HTTP %d", SpotifyError, resp.StatusCode)
	}

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return err
	}

	if getString(data, "response_type") != "RESPONSE_GRANTED_TOKEN_RESPONSE" {
		return fmt.Errorf("%w: invalid client token response type", SpotifyError)
	}

	grantedToken := getMap(data, "granted_token")
	c.clientToken = getString(grantedToken, "token")

	return nil
}

func (c *SpotifyClient) Initialize() error {
	if err := c.getSessionInfo(); err != nil {
		return err
	}
	if err := c.getAccessToken(); err != nil {
		return err
	}
	return c.getClientToken()
}

func (c *SpotifyClient) Query(payload map[string]interface{}) (map[string]interface{}, error) {
	if c.accessToken == "" || c.clientToken == "" {
		if err := c.Initialize(); err != nil {
			return nil, err
		}
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", "https://api-partner.spotify.com/pathfinder/v2/query", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Client-Token", c.clientToken)
	req.Header.Set("Spotify-App-Version", c.clientVersion)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		errorText := string(body)
		if len(errorText) > 200 {
			errorText = errorText[:200]
		}
		return nil, fmt.Errorf("%w: API query failed: HTTP %d | %s", SpotifyError, resp.StatusCode, errorText)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	return result, nil
}

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return ""
}

func getMap(m map[string]interface{}, key string) map[string]interface{} {
	if val, ok := m[key].(map[string]interface{}); ok {
		return val
	}
	return make(map[string]interface{})
}

func getSlice(m map[string]interface{}, key string) []interface{} {
	if val, ok := m[key].([]interface{}); ok {
		return val
	}
	return nil
}

func getFloat64(m map[string]interface{}, key string) float64 {
	if val, ok := m[key].(float64); ok {
		return val
	}
	return 0
}

func getInt(m map[string]interface{}, key string) int {
	if val, ok := m[key].(int); ok {
		return val
	}
	if val, ok := m[key].(float64); ok {
		return int(val)
	}
	return 0
}

func getBool(m map[string]interface{}, key string) bool {
	if val, ok := m[key].(bool); ok {
		return val
	}
	return false
}

func extractArtists(artistsData map[string]interface{}) []map[string]interface{} {
	items := getSlice(artistsData, "items")
	if items == nil {
		return []map[string]interface{}{}
	}

	artists := []map[string]interface{}{}
	for _, item := range items {
		itemMap, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		profile := getMap(itemMap, "profile")
		artistInfo := map[string]interface{}{
			"name": getString(profile, "name"),
		}
		artists = append(artists, artistInfo)
	}
	return artists
}

func extractCoverImage(coverData map[string]interface{}) map[string]interface{} {
	if coverData == nil || len(coverData) == 0 {
		return nil
	}

	var sources []interface{}
	if srcs, ok := coverData["sources"].([]interface{}); ok {
		sources = srcs
	} else if squareImg, ok := coverData["squareCoverImage"].(map[string]interface{}); ok {
		if img, ok := squareImg["image"].(map[string]interface{}); ok {
			if data, ok := img["data"].(map[string]interface{}); ok {
				if srcs, ok := data["sources"].([]interface{}); ok {
					sources = srcs
				}
			}
		}
	}

	if sources == nil || len(sources) == 0 {
		return nil
	}

	type sourceInfo struct {
		url    string
		width  float64
		height float64
	}

	filteredSources := []sourceInfo{}
	for _, s := range sources {
		sMap, ok := s.(map[string]interface{})
		if !ok {
			continue
		}
		url := getString(sMap, "url")
		if url == "" {
			continue
		}

		width := getFloat64(sMap, "width")
		if width == 0 {
			width = getFloat64(sMap, "maxWidth")
		}
		height := getFloat64(sMap, "height")
		if height == 0 {
			height = getFloat64(sMap, "maxHeight")
		}

		if (width > 64 && height > 64) || (width == 0 && height == 0 && url != "") {
			filteredSources = append(filteredSources, sourceInfo{url: url, width: width, height: height})
		}
	}

	if len(filteredSources) == 0 {
		return nil
	}

	sort.Slice(filteredSources, func(i, j int) bool {
		return filteredSources[i].width < filteredSources[j].width
	})

	var smallURL, mediumURL, imageID, fallbackURL string

	for _, source := range filteredSources {
		if source.width == 300 {
			smallURL = source.url
		} else if source.width == 640 {
			mediumURL = source.url
		} else if source.width == 0 {
			fallbackURL = source.url
		}

		if imageID == "" && source.url != "" {
			if strings.Contains(source.url, "ab67616d0000b273") {
				parts := strings.Split(source.url, "ab67616d0000b273")
				if len(parts) > 1 {
					imageID = parts[len(parts)-1]
				}
			} else if strings.Contains(source.url, "ab67616d00001e02") {
				parts := strings.Split(source.url, "ab67616d00001e02")
				if len(parts) > 1 {
					imageID = parts[len(parts)-1]
				}
			} else if strings.Contains(source.url, "/image/") {
				parts := strings.Split(source.url, "/image/")
				if len(parts) > 1 {
					imagePart := strings.Split(parts[len(parts)-1], "?")[0]
					if len(imagePart) > 20 {
						prefixes := []string{"ab67616d0000b273", "ab67616d00001e02", "ab67616d00004851"}
						for _, prefix := range prefixes {
							if strings.Contains(imagePart, prefix) {
								subParts := strings.Split(imagePart, prefix)
								if len(subParts) > 1 {
									imageID = subParts[len(subParts)-1]
									break
								}
							}
						}
					}
				}
			}
		}
	}

	largeURL := ""
	if imageID != "" {
		largeURL = "https://i.scdn.co/image/ab67616d000082c1" + imageID
	}

	result := map[string]interface{}{}
	if smallURL != "" {
		result["small"] = smallURL
	}
	if mediumURL != "" {
		result["medium"] = mediumURL
	}
	if largeURL != "" {
		result["large"] = largeURL
	}

	if len(result) == 0 && fallbackURL != "" {
		result["small"] = fallbackURL
		result["medium"] = fallbackURL
		result["large"] = fallbackURL
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

func extractDuration(ms float64) map[string]interface{} {
	totalSeconds := int(ms) / 1000
	minutes := totalSeconds / 60
	seconds := totalSeconds % 60
	return map[string]interface{}{
		"formatted": fmt.Sprintf("%d:%02d", minutes, seconds),
	}
}

func FilterTrack(data map[string]interface{}, albumFetchData ...map[string]interface{}) map[string]interface{} {
	dataMap := getMap(data, "data")
	trackData := getMap(dataMap, "trackUnion")
	if len(trackData) == 0 {
		return make(map[string]interface{})
	}

	var albumFetchDataMap map[string]interface{}
	if len(albumFetchData) > 0 && albumFetchData[0] != nil {
		albumFetchDataMap = albumFetchData[0]
	}

	artists := extractArtists(getMap(trackData, "artists"))

	if len(artists) == 0 {
		artists = []map[string]interface{}{}
		firstArtistItems := getSlice(getMap(trackData, "firstArtist"), "items")
		if firstArtistItems != nil {
			for _, item := range firstArtistItems {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				if profile, exists := itemMap["profile"]; exists {
					profileMap, ok := profile.(map[string]interface{})
					if ok {
						artistInfo := map[string]interface{}{
							"name": getString(profileMap, "name"),
						}
						artists = append(artists, artistInfo)
					}
				}
			}
		}

		otherArtistItems := getSlice(getMap(trackData, "otherArtists"), "items")
		if otherArtistItems != nil {
			for _, item := range otherArtistItems {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				if profile, exists := itemMap["profile"]; exists {
					profileMap, ok := profile.(map[string]interface{})
					if ok {
						artistInfo := map[string]interface{}{
							"name": getString(profileMap, "name"),
						}
						artists = append(artists, artistInfo)
					}
				}
			}
		}
	}

	if len(artists) == 0 {
		albumData := getMap(trackData, "albumOfTrack")
		if len(albumData) > 0 {
			artists = extractArtists(getMap(albumData, "artists"))
		}
	}

	albumData := getMap(trackData, "albumOfTrack")
	var albumInfo map[string]interface{}
	copyrightInfo := []map[string]interface{}{}
	discInfo := map[string]interface{}{
		"discNumber": getFloat64(trackData, "discNumber"),
		"totalDiscs": nil,
	}

	if len(albumData) > 0 {
		copyrightData := getMap(albumData, "copyright")
		if len(copyrightData) > 0 {
			copyrightItems := getSlice(copyrightData, "items")
			if copyrightItems != nil {
				for _, item := range copyrightItems {
					itemMap, ok := item.(map[string]interface{})
					if !ok {
						continue
					}
					if getString(itemMap, "type") != "P" {
						copyrightInfo = append(copyrightInfo, map[string]interface{}{
							"text": getString(itemMap, "text"),
						})
					}
				}
			}
		}

		tracksData := getMap(albumData, "tracks")
		if len(tracksData) > 0 {
			discNumbers := make(map[int]bool)
			trackItems := getSlice(tracksData, "items")
			if trackItems != nil {
				for _, item := range trackItems {
					itemMap, ok := item.(map[string]interface{})
					if !ok {
						continue
					}
					trackItem := getMap(itemMap, "track")
					if len(trackItem) > 0 {
						discNum := int(getFloat64(trackItem, "discNumber"))
						if discNum == 0 {
							discNum = 1
						}
						discNumbers[discNum] = true
					}
				}
			}
			if len(discNumbers) > 0 {
				maxDisc := 1
				for discNum := range discNumbers {
					if discNum > maxDisc {
						maxDisc = discNum
					}
				}
				discInfo["totalDiscs"] = maxDisc
			}
		}

		dateInfo := getMap(albumData, "date")
		releaseDate := getString(dateInfo, "isoString")
		var releaseYear interface{}
		if releaseDate == "" && len(dateInfo) > 0 {
			yearStr := getString(dateInfo, "year")
			monthStr := getString(dateInfo, "month")
			dayStr := getString(dateInfo, "day")
			if yearStr != "" {
				year, err := strconv.Atoi(yearStr)
				if err == nil {
					releaseYear = year
					if monthStr != "" && dayStr != "" {
						month, _ := strconv.Atoi(monthStr)
						day, _ := strconv.Atoi(dayStr)
						releaseDate = fmt.Sprintf("%s-%02d-%02d", yearStr, month, day)
					} else {
						releaseDate = yearStr
					}
				}
			}
		} else if releaseDate != "" {
			parts := strings.Split(releaseDate, "T")
			if len(parts) > 0 {
				releaseDate = parts[0]
			} else {
				parts = strings.Split(releaseDate, " ")
				if len(parts) > 0 {
					releaseDate = parts[0]
				}
			}
			dateParts := strings.Split(releaseDate, "-")
			if len(dateParts) > 0 && dateParts[0] != "" {
				year, err := strconv.Atoi(dateParts[0])
				if err == nil {
					releaseYear = year
				}
			}
		}

		tracksTotalCount := float64(0)
		if len(tracksData) > 0 {
			tracksTotalCount = getFloat64(tracksData, "totalCount")
		}

		albumID := getString(albumData, "id")
		if albumID == "" {
			albumURI := getString(albumData, "uri")
			if strings.Contains(albumURI, ":") {
				parts := strings.Split(albumURI, ":")
				albumID = parts[len(parts)-1]
			}
		}

		albumArtistsString := ""
		albumLabel := ""
		if albumFetchDataMap != nil && len(albumFetchDataMap) > 0 {
			albumUnionData := getMap(getMap(albumFetchDataMap, "data"), "albumUnion")
			if len(albumUnionData) > 0 {
				albumArtists := extractArtists(getMap(albumUnionData, "artists"))
				if len(albumArtists) > 0 {
					albumArtistNames := []string{}
					for _, artist := range albumArtists {
						albumArtistNames = append(albumArtistNames, getString(artist, "name"))
					}
					albumArtistsString = strings.Join(albumArtistNames, ", ")
				}
				albumLabel = getString(albumUnionData, "label")
			}
		}

		if albumArtistsString == "" {
			albumArtists := extractArtists(getMap(albumData, "artists"))
			if len(albumArtists) > 0 {
				albumArtistNames := []string{}
				for _, artist := range albumArtists {
					albumArtistNames = append(albumArtistNames, getString(artist, "name"))
				}
				albumArtistsString = strings.Join(albumArtistNames, ", ")
			}
		}

		albumInfo = map[string]interface{}{
			"id":       albumID,
			"name":     getString(albumData, "name"),
			"released": releaseDate,
			"year":     releaseYear,
			"tracks":   int(tracksTotalCount),
		}

		if albumArtistsString != "" {
			albumInfo["artists"] = albumArtistsString
		}

		if albumLabel != "" {
			albumInfo["label"] = albumLabel
		}
	}

	cover := extractCoverImage(getMap(trackData, "visualIdentity"))
	if cover == nil && len(albumData) > 0 {
		cover = extractCoverImage(getMap(albumData, "coverArt"))
	}

	durationMs := getFloat64(getMap(trackData, "duration"), "totalMilliseconds")
	durationObj := extractDuration(durationMs)
	durationString := getString(durationObj, "formatted")

	artistNames := []string{}
	for _, artist := range artists {
		artistNames = append(artistNames, getString(artist, "name"))
	}
	artistsString := strings.Join(artistNames, ", ")

	copyrightTexts := []string{}
	for _, item := range copyrightInfo {
		copyrightTexts = append(copyrightTexts, getString(item, "text"))
	}
	copyrightString := strings.Join(copyrightTexts, ", ")

	discNumber := int(getFloat64(trackData, "discNumber"))
	if discNumber == 0 {
		discNumber = 1
	}
	totalDiscs := 1
	if discInfo["totalDiscs"] != nil {
		totalDiscs = discInfo["totalDiscs"].(int)
	}

	contentRating := getMap(trackData, "contentRating")
	isExplicit := getString(contentRating, "label") == "EXPLICIT"

	filtered := map[string]interface{}{
		"id":          getString(trackData, "id"),
		"name":        getString(trackData, "name"),
		"artists":     artistsString,
		"album":       albumInfo,
		"duration":    durationString,
		"track":       int(getFloat64(trackData, "trackNumber")),
		"disc":        discNumber,
		"discs":       totalDiscs,
		"copyright":   copyrightString,
		"plays":       getString(trackData, "playcount"),
		"cover":       cover,
		"is_explicit": isExplicit,
	}

	return filtered
}

func FilterAlbum(data map[string]interface{}) map[string]interface{} {
	dataMap := getMap(data, "data")
	albumData := getMap(dataMap, "albumUnion")
	if len(albumData) == 0 {
		return make(map[string]interface{})
	}

	artists := extractArtists(getMap(albumData, "artists"))
	artistNames := []string{}
	for _, artist := range artists {
		artistNames = append(artistNames, getString(artist, "name"))
	}
	albumArtistsString := strings.Join(artistNames, ", ")

	coverObj := extractCoverImage(getMap(albumData, "coverArt"))
	var cover interface{}
	if coverObj != nil {

		cover = getString(coverObj, "small")
		if cover == "" {
			cover = getString(coverObj, "medium")
		}
		if cover == "" {
			cover = getString(coverObj, "large")
		}
	}

	tracks := []map[string]interface{}{}
	tracksData := getMap(albumData, "tracksV2")
	trackItems := getSlice(tracksData, "items")
	if trackItems != nil {
		for _, item := range trackItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			track := getMap(itemMap, "track")
			if len(track) == 0 {
				continue
			}

			artistsData := getMap(track, "artists")
			trackArtists := extractArtists(artistsData)
			trackDurationMs := getFloat64(getMap(track, "duration"), "totalMilliseconds")
			durationObj := extractDuration(trackDurationMs)
			durationString := getString(durationObj, "formatted")

			trackArtistNames := []string{}
			artistIDs := []string{}

			artistItems := getSlice(artistsData, "items")
			if artistItems != nil {
				for _, artistItem := range artistItems {
					artistItemMap, ok := artistItem.(map[string]interface{})
					if !ok {
						continue
					}
					artistURI := getString(artistItemMap, "uri")
					if artistURI != "" && strings.Contains(artistURI, ":") {
						parts := strings.Split(artistURI, ":")
						if len(parts) > 0 {
							artistID := parts[len(parts)-1]
							if artistID != "" {
								artistIDs = append(artistIDs, artistID)
							}
						}
					}
				}
			}

			for _, artist := range trackArtists {
				trackArtistNames = append(trackArtistNames, getString(artist, "name"))
			}
			trackArtistsString := strings.Join(trackArtistNames, ", ")

			trackURI := getString(track, "uri")
			trackID := ""
			if strings.Contains(trackURI, ":") {
				parts := strings.Split(trackURI, ":")
				trackID = parts[len(parts)-1]
			}

			contentRating := getMap(track, "contentRating")
			isExplicit := getString(contentRating, "label") == "EXPLICIT"

			trackInfo := map[string]interface{}{
				"id":          trackID,
				"name":        getString(track, "name"),
				"artists":     trackArtistsString,
				"artistIds":   artistIDs,
				"duration":    durationString,
				"plays":       getString(track, "playcount"),
				"is_explicit": isExplicit,
			}
			tracks = append(tracks, trackInfo)
		}
	}

	dateInfo := getMap(albumData, "date")
	releaseDate := getString(dateInfo, "isoString")
	if releaseDate != "" && strings.Contains(releaseDate, "T") {
		parts := strings.Split(releaseDate, "T")
		releaseDate = parts[0]
	}

	albumURI := getString(albumData, "uri")
	albumID := ""
	if strings.Contains(albumURI, ":") {
		parts := strings.Split(albumURI, ":")
		albumID = parts[len(parts)-1]
	}

	filtered := map[string]interface{}{
		"id":          albumID,
		"name":        getString(albumData, "name"),
		"artists":     albumArtistsString,
		"cover":       cover,
		"releaseDate": releaseDate,
		"count":       len(tracks),
		"tracks":      tracks,
	}

	return filtered
}

func FilterPlaylist(data map[string]interface{}) map[string]interface{} {
	dataMap := getMap(data, "data")
	playlistData := getMap(dataMap, "playlistV2")
	if len(playlistData) == 0 {
		return make(map[string]interface{})
	}

	ownerData := getMap(getMap(playlistData, "ownerV2"), "data")
	var ownerInfo map[string]interface{}
	if len(ownerData) > 0 {
		var avatarURL interface{}
		avatarData := getMap(ownerData, "avatar")
		if len(avatarData) > 0 {
			sources := getSlice(avatarData, "sources")
			if sources != nil {
				for _, source := range sources {
					sourceMap, ok := source.(map[string]interface{})
					if !ok {
						continue
					}
					if getFloat64(sourceMap, "width") == 300 {
						avatarURL = getString(sourceMap, "url")
						break
					}
				}
				if avatarURL == nil && len(sources) > 0 {
					if firstSource, ok := sources[0].(map[string]interface{}); ok {
						avatarURL = getString(firstSource, "url")
					}
				}
			}
		}

		ownerInfo = map[string]interface{}{
			"name":   getString(ownerData, "name"),
			"avatar": avatarURL,
		}
	}

	imagesData := getMap(playlistData, "images")
	if len(imagesData) == 0 {
		imagesData = getMap(playlistData, "imagesV2")
	}
	var cover interface{}
	if len(imagesData) > 0 {
		imageItems := getSlice(imagesData, "items")
		if imageItems != nil && len(imageItems) > 0 {
			if firstImage, ok := imageItems[0].(map[string]interface{}); ok {
				firstSources := getSlice(firstImage, "sources")
				if firstSources != nil && len(firstSources) > 0 {
					if firstSource, ok := firstSources[0].(map[string]interface{}); ok {
						sourceURL := getString(firstSource, "url")
						if sourceURL != "" {
							cover = sourceURL
						}
					}
				}
			}
		}
		if cover == nil {
			imageSources := getSlice(imagesData, "sources")
			if imageSources != nil && len(imageSources) > 0 {
				if firstSource, ok := imageSources[0].(map[string]interface{}); ok {
					sourceURL := getString(firstSource, "url")
					if sourceURL != "" {
						cover = sourceURL
					}
				}
			}
		}
	}

	tracks := []map[string]interface{}{}
	content := getMap(playlistData, "content")
	contentItems := getSlice(content, "items")
	if contentItems != nil {
		for _, item := range contentItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			trackData := getMap(getMap(itemMap, "itemV2"), "data")
			if len(trackData) == 0 {
				continue
			}

			var rank interface{}
			var status interface{}
			attributes := getSlice(itemMap, "attributes")
			if attributes != nil {
				for _, attr := range attributes {
					attrMap, ok := attr.(map[string]interface{})
					if !ok {
						continue
					}
					key := getString(attrMap, "key")
					if key == "rank" {
						rank = getString(attrMap, "value")
					} else if key == "status" {
						status = getString(attrMap, "value")
					}
				}
			}

			artistsData := getMap(trackData, "artists")
			trackArtists := extractArtists(artistsData)
			trackArtistNames := []string{}
			artistIDs := []string{}

			artistItems := getSlice(artistsData, "items")
			if artistItems != nil {
				for _, artistItem := range artistItems {
					artistItemMap, ok := artistItem.(map[string]interface{})
					if !ok {
						continue
					}
					artistURI := getString(artistItemMap, "uri")
					if artistURI != "" && strings.Contains(artistURI, ":") {
						parts := strings.Split(artistURI, ":")
						if len(parts) > 0 {
							artistID := parts[len(parts)-1]
							if artistID != "" {
								artistIDs = append(artistIDs, artistID)
							}
						}
					}
				}
			}

			for _, artist := range trackArtists {
				trackArtistNames = append(trackArtistNames, getString(artist, "name"))
			}
			artistsString := strings.Join(trackArtistNames, ", ")

			trackDurationMs := getFloat64(getMap(trackData, "trackDuration"), "totalMilliseconds")
			durationObj := extractDuration(trackDurationMs)
			durationString := getString(durationObj, "formatted")

			trackURI := getString(trackData, "uri")
			trackID := getString(trackData, "id")
			if trackID == "" {
				if strings.Contains(trackURI, ":") {
					parts := strings.Split(trackURI, ":")
					trackID = parts[len(parts)-1]
				}
			}

			albumData := getMap(trackData, "albumOfTrack")
			albumName := ""
			albumID := ""
			albumArtistsString := ""
			var trackCover interface{}

			if len(albumData) > 0 {
				albumName = getString(albumData, "name")
				albumURI := getString(albumData, "uri")
				if strings.Contains(albumURI, ":") {
					parts := strings.Split(albumURI, ":")
					albumID = parts[len(parts)-1]
				}
				coverObj := extractCoverImage(getMap(albumData, "coverArt"))
				if coverObj != nil {

					trackCover = getString(coverObj, "small")
					if trackCover == "" {
						trackCover = getString(coverObj, "medium")
					}
					if trackCover == "" {
						trackCover = getString(coverObj, "large")
					}
				}

				albumArtists := extractArtists(getMap(albumData, "artists"))
				if len(albumArtists) > 0 {
					albumArtistNames := []string{}
					for _, artist := range albumArtists {
						albumArtistNames = append(albumArtistNames, getString(artist, "name"))
					}
					albumArtistsString = strings.Join(albumArtistNames, ", ")
				}
			}

			contentRating := getMap(trackData, "contentRating")
			isExplicit := getString(contentRating, "label") == "EXPLICIT"

			trackInfo := map[string]interface{}{
				"id":          trackID,
				"cover":       trackCover,
				"title":       getString(trackData, "name"),
				"artist":      artistsString,
				"artistIds":   artistIDs,
				"plays":       rank,
				"status":      status,
				"album":       albumName,
				"albumArtist": albumArtistsString,
				"albumId":     albumID,
				"duration":    durationString,
				"is_explicit": isExplicit,
			}
			tracks = append(tracks, trackInfo)
		}
	}

	followersData, exists := playlistData["followers"]
	var followersCount interface{}
	if exists {
		if followersMap, ok := followersData.(map[string]interface{}); ok {
			followersCount = getFloat64(followersMap, "totalCount")
		} else if count, ok := followersData.(float64); ok {
			followersCount = count
		} else if count, ok := followersData.(int); ok {
			followersCount = float64(count)
		} else {
			followersCount = float64(0)
		}
	} else {
		followersCount = float64(0)
	}

	playlistURI := getString(playlistData, "uri")
	playlistID := ""
	if strings.Contains(playlistURI, ":") {
		parts := strings.Split(playlistURI, ":")
		playlistID = parts[len(parts)-1]
	}

	totalCount := getFloat64(content, "totalCount")
	count := len(tracks)
	if totalCount > 0 {
		count = int(totalCount)
	}

	filtered := map[string]interface{}{
		"id":          playlistID,
		"name":        getString(playlistData, "name"),
		"description": getString(playlistData, "description"),
		"owner":       ownerInfo,
		"cover":       cover,
		"count":       count,
		"tracks":      tracks,
		"followers":   followersCount,
	}

	return filtered
}

func extractRelease(release map[string]interface{}) map[string]interface{} {
	if len(release) == 0 {
		return nil
	}

	dateInfo := getMap(release, "date")
	releaseDate := getString(dateInfo, "isoString")
	if releaseDate == "" && len(dateInfo) > 0 {
		yearStr := getString(dateInfo, "year")
		monthStr := getString(dateInfo, "month")
		dayStr := getString(dateInfo, "day")
		if yearStr != "" {
			if monthStr != "" && dayStr != "" {
				month, _ := strconv.Atoi(monthStr)
				day, _ := strconv.Atoi(dayStr)
				releaseDate = fmt.Sprintf("%s-%02d-%02d", yearStr, month, day)
			} else {
				releaseDate = yearStr
			}
		}
	} else if releaseDate != "" && strings.Contains(releaseDate, "T") {
		parts := strings.Split(releaseDate, "T")
		releaseDate = parts[0]
	}

	coverObj := extractCoverImage(getMap(release, "coverArt"))
	var cover interface{}
	if coverObj != nil {
		cover = getString(coverObj, "medium")
	}

	releaseID := getString(release, "id")
	if releaseID == "" {
		releaseURI := getString(release, "uri")
		if strings.Contains(releaseURI, ":") {
			parts := strings.Split(releaseURI, ":")
			releaseID = parts[len(parts)-1]
		}
	}

	var year interface{}
	if yearVal, exists := dateInfo["year"]; exists {
		year = yearVal
	}

	var totalTracks int
	tracksInfo := getMap(release, "tracks")
	if tracksInfo != nil {
		totalTracks = int(getFloat64(tracksInfo, "totalCount"))
	}

	return map[string]interface{}{
		"id":           releaseID,
		"name":         getString(release, "name"),
		"cover":        cover,
		"date":         releaseDate,
		"year":         year,
		"total_tracks": totalTracks,
		"type":         getString(release, "type"),
	}
}

func extractDiscographyItems(itemsData map[string]interface{}) []map[string]interface{} {
	items := []map[string]interface{}{}
	dataItems := getSlice(itemsData, "items")
	if dataItems != nil {
		for _, item := range dataItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			releases := getMap(itemMap, "releases")
			var release map[string]interface{}
			if len(releases) > 0 {
				releaseItems := getSlice(releases, "items")
				if releaseItems != nil && len(releaseItems) > 0 {
					if releaseMap, ok := releaseItems[0].(map[string]interface{}); ok {
						release = releaseMap
					}
				}
			} else {
				release = getMap(itemMap, "album")
			}

			if len(release) > 0 {
				extracted := extractRelease(release)
				if extracted != nil {
					items = append(items, extracted)
				}
			}
		}
	}
	return items
}

func stripHTMLTags(s string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	return re.ReplaceAllString(s, "")
}

func FilterArtist(data map[string]interface{}) map[string]interface{} {
	dataMap := getMap(data, "data")
	artistData := getMap(dataMap, "artistUnion")
	if len(artistData) == 0 {
		return make(map[string]interface{})
	}

	profileRaw := getMap(artistData, "profile")
	profile := make(map[string]interface{})
	if len(profileRaw) > 0 {
		if biography, exists := profileRaw["biography"]; exists {
			biographyMap, ok := biography.(map[string]interface{})
			if ok {
				biographyText := getString(biographyMap, "text")
				if biographyText != "" {
					profile["biography"] = html.UnescapeString(stripHTMLTags(biographyText))
				}
			}
		}
		if _, exists := profileRaw["name"]; exists {
			profile["name"] = getString(profileRaw, "name")
		}
		if _, exists := profileRaw["verified"]; exists {
			profile["verified"] = getBool(profileRaw, "verified")
		}
	}

	headerImageData := getMap(artistData, "headerImage")
	var headerImage interface{}
	if len(headerImageData) > 0 {
		headerData := getMap(headerImageData, "data")
		if len(headerData) > 0 {
			sources := getSlice(headerData, "sources")
			if sources != nil && len(sources) > 0 {
				if firstSource, ok := sources[0].(map[string]interface{}); ok {
					headerImage = getString(firstSource, "url")
				}
			}
		}
	}

	statsRaw := getMap(artistData, "stats")
	stats := make(map[string]interface{})
	if len(statsRaw) > 0 {
		if _, exists := statsRaw["followers"]; exists {
			stats["followers"] = getFloat64(statsRaw, "followers")
		}
		if _, exists := statsRaw["monthlyListeners"]; exists {
			stats["listeners"] = getFloat64(statsRaw, "monthlyListeners")
		}
		if _, exists := statsRaw["worldRank"]; exists {
			stats["rank"] = getFloat64(statsRaw, "worldRank")
		}
	}

	discography := getMap(artistData, "discography")
	discographyResult := make(map[string]interface{})

	allData := getMap(discography, "all")
	if len(allData) > 0 {
		discographyResult["all"] = extractDiscographyItems(allData)
		if totalCount, exists := allData["totalCount"]; exists {
			var total float64
			if tc, ok := totalCount.(float64); ok {
				total = tc
			} else if tc, ok := totalCount.(int); ok {
				total = float64(tc)
			} else if tc, ok := totalCount.(int64); ok {
				total = float64(tc)
			}
			discographyResult["total"] = total
		}
	}

	visualsData := getMap(artistData, "visuals")
	galleryData := getMap(visualsData, "gallery")
	gallery := []interface{}{}
	if len(galleryData) > 0 {
		galleryItems := getSlice(galleryData, "items")
		if galleryItems != nil {
			for _, item := range galleryItems {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				sources := getSlice(itemMap, "sources")
				if sources != nil && len(sources) > 0 {
					if firstSource, ok := sources[0].(map[string]interface{}); ok {
						galleryURL := getString(firstSource, "url")
						if galleryURL != "" {
							gallery = append(gallery, galleryURL)
						}
					}
				}
			}
		}
	}

	avatarObj := extractCoverImage(getMap(visualsData, "avatarImage"))
	var avatar interface{}
	if avatarObj != nil {
		if mediumURL, ok := avatarObj["medium"].(string); ok && mediumURL != "" {
			avatar = mediumURL
		} else if smallURL, ok := avatarObj["small"].(string); ok && smallURL != "" {
			avatar = smallURL
		}
	}

	artistURI := getString(artistData, "uri")
	artistID := ""
	if strings.Contains(artistURI, ":") {
		parts := strings.Split(artistURI, ":")
		artistID = parts[len(parts)-1]
	}

	filtered := map[string]interface{}{
		"id":          artistID,
		"name":        getString(profile, "name"),
		"profile":     profile,
		"avatar":      avatar,
		"header":      headerImage,
		"stats":       stats,
		"gallery":     gallery,
		"discography": discographyResult,
	}

	return filtered
}

func FilterSearch(data map[string]interface{}) map[string]interface{} {
	dataMap := getMap(data, "data")
	searchData := getMap(dataMap, "searchV2")
	if len(searchData) == 0 {
		return make(map[string]interface{})
	}

	results := map[string]interface{}{
		"tracks":    []map[string]interface{}{},
		"albums":    []map[string]interface{}{},
		"artists":   []map[string]interface{}{},
		"playlists": []map[string]interface{}{},
	}

	tracksData := getMap(searchData, "tracksV2")
	if len(tracksData) == 0 {
		tracksData = getMap(searchData, "tracks")
	}
	trackItems := getSlice(tracksData, "items")
	if trackItems != nil {
		for _, item := range trackItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			var track map[string]interface{}
			if itemData, exists := itemMap["item"]; exists {
				itemDataMap, ok := itemData.(map[string]interface{})
				if ok {
					track = getMap(itemDataMap, "data")
				}
			} else if trackData, exists := itemMap["track"]; exists {
				if trackMap, ok := trackData.(map[string]interface{}); ok {
					track = trackMap
				}
			}

			if len(track) == 0 {
				continue
			}

			trackArtists := extractArtists(getMap(track, "artists"))
			trackDurationMs := getFloat64(getMap(track, "duration"), "totalMilliseconds")
			if trackDurationMs == 0 {
				trackDurationMs = getFloat64(getMap(track, "trackDuration"), "totalMilliseconds")
			}
			trackDuration := extractDuration(trackDurationMs)

			albumData := getMap(track, "albumOfTrack")
			var albumInfo map[string]interface{}
			if len(albumData) > 0 {
				albumURI := getString(albumData, "uri")
				albumID := getString(albumData, "id")
				if albumID == "" {
					if strings.Contains(albumURI, ":") {
						parts := strings.Split(albumURI, ":")
						albumID = parts[len(parts)-1]
					}
				}
				albumInfo = map[string]interface{}{
					"name": getString(albumData, "name"),
					"uri":  albumURI,
					"id":   albumID,
				}
			}

			trackURI := getString(track, "uri")
			trackID := getString(track, "id")
			if trackID == "" {
				if strings.Contains(trackURI, ":") {
					parts := strings.Split(trackURI, ":")
					trackID = parts[len(parts)-1]
				}
			}

			coverObj := extractCoverImage(getMap(albumData, "coverArt"))
			var cover interface{}
			if coverObj != nil {
				cover = getString(coverObj, "medium")
			}

			trackName := getString(track, "name")
			if trackName == "" {
				continue
			}

			trackArtistNames := []string{}
			for _, artist := range trackArtists {
				trackArtistNames = append(trackArtistNames, getString(artist, "name"))
			}
			trackArtistsString := strings.Join(trackArtistNames, ", ")

			durationString := getString(trackDuration, "formatted")

			albumName := ""
			if albumInfo != nil {
				albumName = getString(albumInfo, "name")
			}

			contentRating := getMap(track, "contentRating")
			isExplicit := getString(contentRating, "label") == "EXPLICIT"

			trackResults := results["tracks"].([]map[string]interface{})
			trackResults = append(trackResults, map[string]interface{}{
				"id":          trackID,
				"name":        trackName,
				"artists":     trackArtistsString,
				"album":       albumName,
				"duration":    durationString,
				"cover":       cover,
				"is_explicit": isExplicit,
			})
			results["tracks"] = trackResults
		}
	}

	albumsData := getMap(searchData, "albumsV2")
	if len(albumsData) == 0 {
		albumsData = getMap(searchData, "albums")
	}
	albumItems := getSlice(albumsData, "items")
	if albumItems != nil {
		for _, item := range albumItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			var album map[string]interface{}
			if itemData, exists := itemMap["data"]; exists {
				if albumMap, ok := itemData.(map[string]interface{}); ok {
					album = albumMap
				}
			} else if albumData, exists := itemMap["album"]; exists {
				if albumMap, ok := albumData.(map[string]interface{}); ok {
					album = albumMap
				}
			}

			if len(album) == 0 {
				continue
			}

			albumArtists := extractArtists(getMap(album, "artists"))
			albumURI := getString(album, "uri")
			albumID := getString(album, "id")
			if albumID == "" {
				if strings.Contains(albumURI, ":") {
					parts := strings.Split(albumURI, ":")
					albumID = parts[len(parts)-1]
				}
			}

			coverObj := extractCoverImage(getMap(album, "coverArt"))
			var cover interface{}
			if coverObj != nil {
				cover = getString(coverObj, "medium")
			}

			albumArtistNames := []string{}
			for _, artist := range albumArtists {
				albumArtistNames = append(albumArtistNames, getString(artist, "name"))
			}
			albumArtistsString := strings.Join(albumArtistNames, ", ")

			dateInfo := getMap(album, "date")
			var year interface{}
			if len(dateInfo) > 0 {
				if yearVal, exists := dateInfo["year"]; exists {
					year = yearVal
				}
			}

			albumName := getString(album, "name")
			if albumName == "" || albumArtistsString == "" {
				continue
			}

			albumResult := map[string]interface{}{
				"id":      albumID,
				"name":    albumName,
				"artists": albumArtistsString,
				"cover":   cover,
			}

			if year != nil {
				albumResult["year"] = year
			}

			albumResults := results["albums"].([]map[string]interface{})
			albumResults = append(albumResults, albumResult)
			results["albums"] = albumResults
		}
	}

	artistsData := getMap(searchData, "artistsV2")
	if len(artistsData) == 0 {
		artistsData = getMap(searchData, "artists")
	}
	artistItems := getSlice(artistsData, "items")
	if artistItems != nil {
		for _, item := range artistItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			var artist map[string]interface{}
			if itemData, exists := itemMap["data"]; exists {
				if artistMap, ok := itemData.(map[string]interface{}); ok {
					artist = artistMap
				}
			} else if artistData, exists := itemMap["artist"]; exists {
				if artistMap, ok := artistData.(map[string]interface{}); ok {
					artist = artistMap
				}
			}

			if len(artist) == 0 {
				continue
			}

			artistURI := getString(artist, "uri")
			artistID := ""
			if strings.Contains(artistURI, ":") {
				parts := strings.Split(artistURI, ":")
				artistID = parts[len(parts)-1]
			}

			coverObj := extractCoverImage(getMap(artist, "visualIdentity"))
			if coverObj == nil {
				visuals := getMap(artist, "visuals")
				if len(visuals) > 0 {
					coverObj = extractCoverImage(getMap(visuals, "avatarImage"))
				}
			}

			var cover interface{}
			if coverObj != nil {
				cover = getString(coverObj, "medium")
			}

			artistName := getString(getMap(artist, "profile"), "name")
			if artistName == "" {
				artistName = getString(artist, "name")
			}

			if artistName == "" {
				continue
			}

			artistResults := results["artists"].([]map[string]interface{})
			artistResults = append(artistResults, map[string]interface{}{
				"id":    artistID,
				"name":  artistName,
				"cover": cover,
			})
			results["artists"] = artistResults
		}
	}

	playlistsData := getMap(searchData, "playlistsV2")
	if len(playlistsData) == 0 {
		playlistsData = getMap(searchData, "playlists")
	}
	playlistItems := getSlice(playlistsData, "items")
	if playlistItems != nil {
		for _, item := range playlistItems {
			itemMap, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			var playlist map[string]interface{}
			if itemData, exists := itemMap["data"]; exists {
				if playlistMap, ok := itemData.(map[string]interface{}); ok {
					playlist = playlistMap
				}
			} else if playlistData, exists := itemMap["playlist"]; exists {
				if playlistMap, ok := playlistData.(map[string]interface{}); ok {
					playlist = playlistMap
				}
			}

			if len(playlist) == 0 {
				continue
			}

			playlistURI := getString(playlist, "uri")
			playlistID := ""
			if strings.Contains(playlistURI, ":") {
				parts := strings.Split(playlistURI, ":")
				playlistID = parts[len(parts)-1]
			}

			playlistImages := getMap(playlist, "images")
			if len(playlistImages) == 0 {
				playlistImages = getMap(playlist, "imagesV2")
			}
			var playlistCoverObj map[string]interface{}
			if len(playlistImages) > 0 {
				imageItems := getSlice(playlistImages, "items")
				if imageItems != nil && len(imageItems) > 0 {
					if firstImage, ok := imageItems[0].(map[string]interface{}); ok {
						firstSources := getSlice(firstImage, "sources")
						if firstSources != nil {
							playlistCoverObj = extractCoverImage(map[string]interface{}{"sources": firstSources})
						}
					}
				}
				if playlistCoverObj == nil {
					playlistCoverObj = extractCoverImage(playlistImages)
				}
			}

			var playlistCover interface{}
			if playlistCoverObj != nil {
				playlistCover = getString(playlistCoverObj, "medium")
			}

			ownerData := getMap(getMap(playlist, "ownerV2"), "data")
			ownerName := getString(ownerData, "name")

			playlistName := getString(playlist, "name")
			if playlistName == "" {
				continue
			}

			playlistResult := map[string]interface{}{
				"id":    playlistID,
				"name":  playlistName,
				"cover": playlistCover,
			}

			if ownerName != "" {
				playlistResult["owner"] = ownerName
			}

			playlistResults := results["playlists"].([]map[string]interface{})
			playlistResults = append(playlistResults, playlistResult)
			results["playlists"] = playlistResults
		}
	}

	tracks := results["tracks"].([]map[string]interface{})
	albums := results["albums"].([]map[string]interface{})
	artists := results["artists"].([]map[string]interface{})
	playlists := results["playlists"].([]map[string]interface{})

	return map[string]interface{}{
		"results": results,
		"totalResults": map[string]interface{}{
			"tracks":    len(tracks),
			"albums":    len(albums),
			"artists":   len(artists),
			"playlists": len(playlists),
		},
	}
}
