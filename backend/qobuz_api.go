package backend

import (
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
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	qobuzAPIBaseURL                = "https://www.qobuz.com/api.json/0.2"
	qobuzDefaultAPIAppID           = "712109809"
	qobuzDefaultAPIAppSecret       = "589be88e4538daea11f509d29e4a23b1"
	qobuzDefaultUA                 = DefaultDownloaderUserAgent
	qobuzCredentialsCacheFile      = "qobuz-api-credentials.json"
	qobuzCredentialsCacheTTL       = 24 * time.Hour
	qobuzCredentialsProbeTrackISRC = "USUM71703861"
	qobuzOpenTrackProbeURL         = "https://open.qobuz.com/track/1"
)

var (
	qobuzCredentialsMu           sync.Mutex
	qobuzCachedCredentials       *qobuzAPICredentials
	qobuzOpenBundleScriptPattern = regexp.MustCompile(`<script[^>]+src="([^"]+/js/main\.js|/resources/[^"]+/js/main\.js)"`)
	qobuzOpenAPIConfigPattern    = regexp.MustCompile(`app_id:"(?P<app_id>\d{9})",app_secret:"(?P<app_secret>[a-f0-9]{32})"`)
)

type qobuzAPICredentials struct {
	AppID         string `json:"app_id"`
	AppSecret     string `json:"app_secret"`
	Source        string `json:"source,omitempty"`
	FetchedAtUnix int64  `json:"fetched_at_unix"`
}

type qobuzCredentialProbeResponse struct {
	Tracks struct {
		Total int `json:"total"`
	} `json:"tracks"`
}

func defaultQobuzAPICredentials() *qobuzAPICredentials {
	return &qobuzAPICredentials{
		AppID:         qobuzDefaultAPIAppID,
		AppSecret:     qobuzDefaultAPIAppSecret,
		Source:        "embedded-default",
		FetchedAtUnix: time.Now().Unix(),
	}
}

func qobuzCredentialsCachePath() (string, error) {
	appDir, err := GetFFmpegDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(appDir, qobuzCredentialsCacheFile), nil
}

func loadQobuzCachedCredentials() (*qobuzAPICredentials, error) {
	cachePath, err := qobuzCredentialsCachePath()
	if err != nil {
		return nil, err
	}

	body, err := os.ReadFile(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read qobuz credentials cache: %w", err)
	}

	var creds qobuzAPICredentials
	if err := json.Unmarshal(body, &creds); err != nil {
		return nil, fmt.Errorf("failed to parse qobuz credentials cache: %w", err)
	}

	if strings.TrimSpace(creds.AppID) == "" || strings.TrimSpace(creds.AppSecret) == "" {
		return nil, fmt.Errorf("qobuz credentials cache is incomplete")
	}

	return &creds, nil
}

func saveQobuzCachedCredentials(creds *qobuzAPICredentials) error {
	if creds == nil {
		return fmt.Errorf("qobuz credentials are required")
	}

	cachePath, err := qobuzCredentialsCachePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return fmt.Errorf("failed to create qobuz credentials cache directory: %w", err)
	}

	body, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(cachePath, body, 0o644); err != nil {
		return fmt.Errorf("failed to write qobuz credentials cache: %w", err)
	}

	return nil
}

func qobuzCredentialsCacheIsFresh(creds *qobuzAPICredentials) bool {
	if creds == nil || creds.FetchedAtUnix == 0 || strings.TrimSpace(creds.AppID) == "" || strings.TrimSpace(creds.AppSecret) == "" {
		return false
	}
	return time.Since(time.Unix(creds.FetchedAtUnix, 0)) < qobuzCredentialsCacheTTL
}

func scrapeQobuzOpenCredentials(client *http.Client) (*qobuzAPICredentials, error) {
	req, err := http.NewRequest(http.MethodGet, qobuzOpenTrackProbeURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", qobuzDefaultUA)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch open.qobuz.com shell: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("open.qobuz.com returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
	}

	htmlBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read open.qobuz.com shell: %w", err)
	}

	scriptMatch := qobuzOpenBundleScriptPattern.FindStringSubmatch(string(htmlBody))
	if len(scriptMatch) < 2 {
		return nil, fmt.Errorf("qobuz open bundle URL not found")
	}

	bundleURL := strings.TrimSpace(scriptMatch[1])
	if strings.HasPrefix(bundleURL, "/") {
		bundleURL = "https://open.qobuz.com" + bundleURL
	}
	if bundleURL == "" {
		return nil, fmt.Errorf("qobuz open bundle URL is empty")
	}

	bundleReq, err := http.NewRequest(http.MethodGet, bundleURL, nil)
	if err != nil {
		return nil, err
	}
	bundleReq.Header.Set("User-Agent", qobuzDefaultUA)

	bundleResp, err := client.Do(bundleReq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch qobuz open bundle: %w", err)
	}
	defer bundleResp.Body.Close()

	if bundleResp.StatusCode != http.StatusOK {
		preview, _ := io.ReadAll(io.LimitReader(bundleResp.Body, 512))
		return nil, fmt.Errorf("qobuz open bundle returned status %d: %s", bundleResp.StatusCode, strings.TrimSpace(string(preview)))
	}

	bundleBody, err := io.ReadAll(bundleResp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read qobuz open bundle: %w", err)
	}

	configMatch := qobuzOpenAPIConfigPattern.FindStringSubmatch(string(bundleBody))
	if len(configMatch) < 3 {
		return nil, fmt.Errorf("qobuz api app_id/app_secret pair not found in open bundle")
	}

	return &qobuzAPICredentials{
		AppID:         strings.TrimSpace(configMatch[1]),
		AppSecret:     strings.TrimSpace(configMatch[2]),
		Source:        bundleURL,
		FetchedAtUnix: time.Now().Unix(),
	}, nil
}

func qobuzNormalizedPath(path string) string {
	return strings.Trim(strings.TrimSpace(path), "/")
}

func qobuzSignaturePayload(path string, params url.Values, timestamp string, secret string) string {
	normalizedPath := strings.ReplaceAll(qobuzNormalizedPath(path), "/", "")
	keys := make([]string, 0, len(params))
	for key := range params {
		switch key {
		case "app_id", "request_ts", "request_sig":
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var builder strings.Builder
	builder.WriteString(normalizedPath)
	for _, key := range keys {
		values := params[key]
		if len(values) == 0 {
			builder.WriteString(key)
			continue
		}
		for _, value := range values {
			builder.WriteString(key)
			builder.WriteString(value)
		}
	}
	builder.WriteString(timestamp)
	builder.WriteString(secret)
	return builder.String()
}

func qobuzRequestSignature(path string, params url.Values, timestamp string, secret string) string {
	sum := md5.Sum([]byte(qobuzSignaturePayload(path, params, timestamp, secret)))
	return hex.EncodeToString(sum[:])
}

func newQobuzSignedRequestWithCredentials(method string, path string, params url.Values, creds *qobuzAPICredentials) (*http.Request, error) {
	normalizedPath := qobuzNormalizedPath(path)
	if normalizedPath == "" {
		return nil, fmt.Errorf("qobuz request path is empty")
	}
	if creds == nil || strings.TrimSpace(creds.AppID) == "" || strings.TrimSpace(creds.AppSecret) == "" {
		return nil, fmt.Errorf("qobuz credentials are incomplete")
	}

	clonedParams := url.Values{}
	for key, values := range params {
		for _, value := range values {
			clonedParams.Add(key, value)
		}
	}

	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	clonedParams.Set("app_id", creds.AppID)
	clonedParams.Set("request_ts", timestamp)
	clonedParams.Set("request_sig", qobuzRequestSignature(normalizedPath, params, timestamp, creds.AppSecret))

	reqURL := fmt.Sprintf("%s/%s?%s", qobuzAPIBaseURL, normalizedPath, clonedParams.Encode())
	req, err := http.NewRequest(method, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", qobuzDefaultUA)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-App-Id", creds.AppID)

	return req, nil
}

func qobuzCredentialsSupportSignedMetadata(client *http.Client, creds *qobuzAPICredentials) bool {
	if creds == nil {
		return false
	}

	req, err := newQobuzSignedRequestWithCredentials(http.MethodGet, "track/search", url.Values{
		"query": {qobuzCredentialsProbeTrackISRC},
		"limit": {"1"},
	}, creds)
	if err != nil {
		return false
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false
	}

	var payload qobuzCredentialProbeResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false
	}

	return payload.Tracks.Total > 0
}

func getQobuzAPICredentials(forceRefresh bool) (*qobuzAPICredentials, error) {
	qobuzCredentialsMu.Lock()
	defer qobuzCredentialsMu.Unlock()

	if !forceRefresh && qobuzCredentialsCacheIsFresh(qobuzCachedCredentials) {
		return qobuzCachedCredentials, nil
	}

	cachedFromDisk, diskErr := loadQobuzCachedCredentials()
	if diskErr != nil {
		fmt.Printf("Warning: failed to read Qobuz credentials cache: %v\n", diskErr)
	}
	if !forceRefresh && qobuzCredentialsCacheIsFresh(cachedFromDisk) {
		qobuzCachedCredentials = cachedFromDisk
		return qobuzCachedCredentials, nil
	}

	client := &http.Client{Timeout: 30 * time.Second}
	scrapedCreds, scrapeErr := scrapeQobuzOpenCredentials(client)
	if scrapeErr == nil {
		if qobuzCredentialsSupportSignedMetadata(client, scrapedCreds) {
			qobuzCachedCredentials = scrapedCreds
			if err := saveQobuzCachedCredentials(scrapedCreds); err != nil {
				fmt.Printf("Warning: failed to write Qobuz credentials cache: %v\n", err)
			}
			fmt.Printf("Loaded fresh Qobuz credentials from %s (app_id=%s)\n", scrapedCreds.Source, scrapedCreds.AppID)
			return qobuzCachedCredentials, nil
		}
		scrapeErr = fmt.Errorf("scraped qobuz credentials did not pass validation")
	}

	if cachedFromDisk != nil {
		qobuzCachedCredentials = cachedFromDisk
		fmt.Printf("Warning: failed to refresh Qobuz credentials, using cached credentials: %v\n", scrapeErr)
		return qobuzCachedCredentials, nil
	}

	if qobuzCachedCredentials != nil {
		fmt.Printf("Warning: failed to refresh Qobuz credentials, using in-memory credentials: %v\n", scrapeErr)
		return qobuzCachedCredentials, nil
	}

	fallback := defaultQobuzAPICredentials()
	qobuzCachedCredentials = fallback
	if scrapeErr != nil {
		fmt.Printf("Warning: failed to refresh Qobuz credentials, using embedded fallback: %v\n", scrapeErr)
	}
	return qobuzCachedCredentials, nil
}

func qobuzShouldRefreshCredentials(statusCode int) bool {
	return statusCode == http.StatusBadRequest || statusCode == http.StatusUnauthorized
}

func newQobuzSignedRequest(method string, path string, params url.Values) (*http.Request, error) {
	creds, err := getQobuzAPICredentials(false)
	if err != nil {
		return nil, err
	}
	return newQobuzSignedRequestWithCredentials(method, path, params, creds)
}

func doQobuzSignedRequest(method string, path string, params url.Values, client *http.Client) (*http.Response, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}

	call := func(forceRefresh bool) (*http.Response, error) {
		creds, err := getQobuzAPICredentials(forceRefresh)
		if err != nil {
			return nil, err
		}
		req, err := newQobuzSignedRequestWithCredentials(method, path, params, creds)
		if err != nil {
			return nil, err
		}
		return client.Do(req)
	}

	resp, err := call(false)
	if err != nil {
		return nil, err
	}

	if qobuzShouldRefreshCredentials(resp.StatusCode) {
		resp.Body.Close()
		return call(true)
	}

	return resp, nil
}

func doQobuzSignedJSONRequest(path string, params url.Values, target interface{}) error {
	resp, err := doQobuzSignedRequest(http.MethodGet, path, params, &http.Client{Timeout: 20 * time.Second})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("qobuz request failed: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	return json.NewDecoder(resp.Body).Decode(target)
}
