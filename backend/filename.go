package backend

import (
	"fmt"
	"regexp"
	"strings"
)

// BuildExpectedFilename builds the expected filename based on track metadata and settings
func BuildExpectedFilename(trackName, artistName, filenameFormat string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	// Sanitize track name and artist name
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)

	var filename string

	// Build base filename based on format
	switch filenameFormat {
	case "artist-title":
		filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
	case "title":
		filename = safeTitle
	default: // "title-artist"
		filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
	}

	// Add track number prefix if enabled
	// Note: We can't determine the exact track number without fetching from API
	// So we only add it if position > 0 (bulk download)
	if includeTrackNumber && position > 0 {
		filename = fmt.Sprintf("%02d. %s", position, filename)
	}

	return filename + ".flac"
}

// sanitizeFilename removes invalid characters from filename
func sanitizeFilename(name string) string {
	re := regexp.MustCompile(`[<>:"/\\|?*]`)
	sanitized := re.ReplaceAllString(name, "_")
	sanitized = strings.TrimSpace(sanitized)
	if sanitized == "" {
		return "Unknown"
	}
	return sanitized
}
