package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const recentFetchesFileName = "recent_fetches.json"

type RecentFetchItem struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Artist    string `json:"artist"`
	Image     string `json:"image"`
	Timestamp int64  `json:"timestamp"`
}

var (
	recentFetchesMu          sync.Mutex
	recentFetchesDirResolver = GetFFmpegDir
)

func recentFetchesFilePath() (string, error) {
	baseDir, err := recentFetchesDirResolver()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(baseDir, recentFetchesFileName), nil
}

func LoadRecentFetches() ([]RecentFetchItem, error) {
	recentFetchesMu.Lock()
	defer recentFetchesMu.Unlock()

	filePath, err := recentFetchesFilePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []RecentFetchItem{}, nil
		}
		return nil, err
	}

	if strings.TrimSpace(string(data)) == "" {
		return []RecentFetchItem{}, nil
	}

	var items []RecentFetchItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}

	if items == nil {
		return []RecentFetchItem{}, nil
	}

	return items, nil
}

func SaveRecentFetches(items []RecentFetchItem) error {
	recentFetchesMu.Lock()
	defer recentFetchesMu.Unlock()

	filePath, err := recentFetchesFilePath()
	if err != nil {
		return err
	}

	if items == nil {
		items = []RecentFetchItem{}
	}

	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0o644)
}
