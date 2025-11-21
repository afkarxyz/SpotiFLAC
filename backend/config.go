package backend

import (
	"os"
	"path/filepath"
)

func GetDefaultMusicPath() string {
	// Get user's home directory
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// Fallback to Public Music if can't get home dir
		return "C:\\Users\\Public\\Music"
	}

	// Return path to user's Music folder
	return filepath.Join(homeDir, "Music")
}
