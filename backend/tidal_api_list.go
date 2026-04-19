package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	tidalAPIListGistURL   = "https://gist.githubusercontent.com/afkarxyz/2ce772b943321b9448b454f39403ce25/raw"
	tidalAPIListCacheFile = "tidal-api-urls.json"
)

type tidalAPIListCache struct {
	URLs        []string `json:"urls"`
	LastUsedURL string   `json:"last_used_url,omitempty"`
	UpdatedAt   int64    `json:"updated_at_unix"`
	Source      string   `json:"source,omitempty"`
}

var (
	tidalAPIListMu    sync.Mutex
	tidalAPIListState *tidalAPIListCache
)

func loadTidalAPIListStateLocked() (*tidalAPIListCache, error) {
	if tidalAPIListState != nil {
		return cloneTidalAPIListState(tidalAPIListState), nil
	}

	appDir, err := EnsureAppDir()
	if err != nil {
		return nil, err
	}

	cachePath := filepath.Join(appDir, tidalAPIListCacheFile)
	data, err := os.ReadFile(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			state := &tidalAPIListCache{}
			tidalAPIListState = cloneTidalAPIListState(state)
			return cloneTidalAPIListState(state), nil
		}
		return nil, fmt.Errorf("failed to read tidal api cache: %w", err)
	}

	var state tidalAPIListCache
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to parse tidal api cache: %w", err)
	}

	state.URLs = normalizeTidalAPIURLs(state.URLs)

	tidalAPIListState = cloneTidalAPIListState(&state)
	return cloneTidalAPIListState(&state), nil
}

func saveTidalAPIListStateLocked(state *tidalAPIListCache) error {
	appDir, err := EnsureAppDir()
	if err != nil {
		return err
	}

	cachePath := filepath.Join(appDir, tidalAPIListCacheFile)
	payload, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode tidal api cache: %w", err)
	}

	if err := os.WriteFile(cachePath, payload, 0o644); err != nil {
		return fmt.Errorf("failed to write tidal api cache: %w", err)
	}

	tidalAPIListState = cloneTidalAPIListState(state)
	return nil
}

func cloneTidalAPIListState(state *tidalAPIListCache) *tidalAPIListCache {
	if state == nil {
		return nil
	}

	return &tidalAPIListCache{
		URLs:        append([]string(nil), state.URLs...),
		LastUsedURL: state.LastUsedURL,
		UpdatedAt:   state.UpdatedAt,
		Source:      state.Source,
	}
}

func normalizeTidalAPIURLs(urls []string) []string {
	seen := make(map[string]struct{}, len(urls))
	normalized := make([]string, 0, len(urls))

	for _, rawURL := range urls {
		url := strings.TrimRight(strings.TrimSpace(rawURL), "/")
		if url == "" {
			continue
		}
		if _, exists := seen[url]; exists {
			continue
		}
		seen[url] = struct{}{}
		normalized = append(normalized, url)
	}

	return normalized
}

func fetchTidalAPIURLsFromGist() ([]string, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := NewRequestWithDefaultHeaders(http.MethodGet, tidalAPIListGistURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create tidal api gist request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tidal api gist: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		preview, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return nil, fmt.Errorf("tidal api gist returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(preview)))
	}

	var urls []string
	if err := json.NewDecoder(resp.Body).Decode(&urls); err != nil {
		return nil, fmt.Errorf("failed to decode tidal api gist: %w", err)
	}

	urls = normalizeTidalAPIURLs(urls)
	if len(urls) == 0 {
		return nil, fmt.Errorf("tidal api gist returned no valid urls")
	}

	return urls, nil
}

func PrimeTidalAPIList() error {
	_, err := RefreshTidalAPIList(true)
	if err != nil {
		fmt.Printf("Warning: failed to refresh Tidal API list from gist: %v\n", err)
	}

	tidalAPIListMu.Lock()
	defer tidalAPIListMu.Unlock()

	state, loadErr := loadTidalAPIListStateLocked()
	if loadErr != nil {
		return loadErr
	}

	if len(state.URLs) == 0 {
		return fmt.Errorf("tidal api cache is empty")
	}

	if state.UpdatedAt == 0 {
		state.UpdatedAt = time.Now().Unix()
		return saveTidalAPIListStateLocked(state)
	}

	return nil
}

func RefreshTidalAPIList(force bool) ([]string, error) {
	tidalAPIListMu.Lock()
	defer tidalAPIListMu.Unlock()

	state, err := loadTidalAPIListStateLocked()
	if err != nil {
		state = &tidalAPIListCache{}
	}

	if !force && len(state.URLs) > 0 {
		return append([]string(nil), state.URLs...), nil
	}

	urls, fetchErr := fetchTidalAPIURLsFromGist()
	if fetchErr != nil {
		if len(state.URLs) > 0 {
			return append([]string(nil), state.URLs...), fetchErr
		}
		return nil, fetchErr
	}

	state.URLs = urls
	state.UpdatedAt = time.Now().Unix()
	state.Source = "gist"

	if !containsString(state.URLs, state.LastUsedURL) {
		state.LastUsedURL = ""
	}

	if err := saveTidalAPIListStateLocked(state); err != nil {
		return append([]string(nil), state.URLs...), err
	}

	return append([]string(nil), state.URLs...), nil
}

func GetTidalAPIList() ([]string, error) {
	tidalAPIListMu.Lock()
	defer tidalAPIListMu.Unlock()

	state, err := loadTidalAPIListStateLocked()
	if err != nil {
		return nil, err
	}

	if len(state.URLs) == 0 {
		return nil, fmt.Errorf("no cached tidal api urls")
	}

	return append([]string(nil), state.URLs...), nil
}

func GetRotatedTidalAPIList() ([]string, error) {
	tidalAPIListMu.Lock()
	defer tidalAPIListMu.Unlock()

	state, err := loadTidalAPIListStateLocked()
	if err != nil {
		return nil, err
	}

	urls := state.URLs
	if len(urls) == 0 {
		return nil, fmt.Errorf("no cached tidal api urls")
	}

	return rotateTidalAPIURLs(urls, state.LastUsedURL), nil
}

func RememberTidalAPIUsage(apiURL string) error {
	tidalAPIListMu.Lock()
	defer tidalAPIListMu.Unlock()

	state, err := loadTidalAPIListStateLocked()
	if err != nil {
		return err
	}

	state.LastUsedURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if state.UpdatedAt == 0 {
		state.UpdatedAt = time.Now().Unix()
	}

	return saveTidalAPIListStateLocked(state)
}

func rotateTidalAPIURLs(urls []string, lastUsedURL string) []string {
	normalized := normalizeTidalAPIURLs(urls)
	if len(normalized) < 2 {
		return normalized
	}

	lastUsedURL = strings.TrimRight(strings.TrimSpace(lastUsedURL), "/")
	if lastUsedURL == "" {
		return normalized
	}

	lastIndex := -1
	for idx, candidate := range normalized {
		if candidate == lastUsedURL {
			lastIndex = idx
			break
		}
	}

	if lastIndex == -1 {
		return normalized
	}

	rotated := make([]string, 0, len(normalized))
	rotated = append(rotated, normalized[lastIndex+1:]...)
	rotated = append(rotated, normalized[:lastIndex+1]...)
	return rotated
}

func containsString(values []string, target string) bool {
	target = strings.TrimRight(strings.TrimSpace(target), "/")
	for _, value := range values {
		if strings.TrimRight(strings.TrimSpace(value), "/") == target {
			return true
		}
	}
	return false
}
