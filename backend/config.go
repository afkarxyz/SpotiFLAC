package backend

import (
	"os"
	"path/filepath"
)

func GetDefaultMusicPath() string {
	// Try to get from config first
	if storedPath, err := GetConfiguration("downloadPath"); err == nil && storedPath != "" {
		return storedPath
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "Music"
	}

	return filepath.Join(homeDir, "Music")
}
