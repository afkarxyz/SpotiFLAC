package backend

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

// BuildExpectedFilename builds the expected filename based on track metadata and settings
func BuildExpectedFilename(trackName, artistName, filenameFormat string, includeTrackNumber bool, position int, useAlbumTrackNumber bool) string {
	// Sanitize track name and artist name
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)

	var filename string

	// Check if format is a template (contains {})
	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)

		// Handle track number - if position is 0, remove {track} and surrounding separators
		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {
			// Remove {track} with common separators like ". " or " - " or ". "
			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {
		// Legacy format support
		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title":
			filename = safeTitle
		default: // "title-artist"
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		}

		// Add track number prefix if enabled (legacy behavior)
		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", position, filename)
		}
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

// SanitizeFolderPath sanitizes each component of a folder path and normalizes separators
func SanitizeFolderPath(folderPath string) string {
	// Normalize all forward slashes to backslashes on Windows
	normalizedPath := strings.ReplaceAll(folderPath, "/", string(filepath.Separator))

	// Detect separator
	sep := string(filepath.Separator)

	// Split path into components
	parts := strings.Split(normalizedPath, sep)
	sanitizedParts := make([]string, 0, len(parts))

	for i, part := range parts {
		// Keep drive letter intact on Windows (e.g., "C:")
		if i == 0 && len(part) == 2 && part[1] == ':' {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		// Keep empty string at the start for absolute paths on Unix
		if i == 0 && part == "" {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}


		// Sanitize each folder name (but don't replace / or \ since we already normalized)
		sanitized := sanitizeFolderName(part)
		if sanitized != "" {
			sanitizedParts = append(sanitizedParts, sanitized)
		}
	}

	return strings.Join(sanitizedParts, sep)
}

// sanitizeFolderName removes invalid characters from a single folder name
func sanitizeFolderName(name string) string {
	// Remove or replace invalid characters for folder names (excluding path separators)
	re := regexp.MustCompile(`[<>:"|?*]`)
	sanitized := re.ReplaceAllString(name, "_")
	sanitized = strings.TrimSpace(sanitized)
	if sanitized == "" {
		return "Unknown"
	}
	return sanitized
}
