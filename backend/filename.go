package backend

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// BuildExpectedFilename builds the expected filename based on track metadata and settings
func BuildExpectedFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat string, includeTrackNumber bool, position, discNumber int, useAlbumTrackNumber bool) string {
	// Sanitize track name and artist name
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)
	safeAlbum := sanitizeFilename(albumName)
	safeAlbumArtist := sanitizeFilename(albumArtist)

	// Extract year from release date (format: YYYY-MM-DD or YYYY)
	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	// Check if format is a template (contains {})
	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		// Handle disc number
		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

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
	// Replace forward slash with space (more natural than underscore)
	sanitized := strings.ReplaceAll(name, "/", " ")

	// Remove other invalid filesystem characters (replace with space)
	re := regexp.MustCompile(`[<>:"\\|?*]`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	// Remove control characters (0x00-0x1F, 0x7F)
	var result strings.Builder
	for _, r := range sanitized {
		// Keep printable characters and valid Unicode characters
		// Remove control characters, but keep spaces, tabs, newlines for now
		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r == 0x7F {
			continue
		}
		// Remove emoji and other symbols that might cause issues
		// Keep letters, numbers, and common punctuation
		if unicode.IsControl(r) && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		// Remove emoji ranges (most emoji are in these ranges)
		if (r >= 0x1F300 && r <= 0x1F9FF) || // Miscellaneous Symbols and Pictographs, Emoticons
			(r >= 0x2600 && r <= 0x26FF) || // Miscellaneous Symbols
			(r >= 0x2700 && r <= 0x27BF) || // Dingbats
			(r >= 0xFE00 && r <= 0xFE0F) || // Variation Selectors
			(r >= 0x1F900 && r <= 0x1F9FF) || // Supplemental Symbols and Pictographs
			(r >= 0x1F600 && r <= 0x1F64F) || // Emoticons
			(r >= 0x1F680 && r <= 0x1F6FF) || // Transport and Map Symbols
			(r >= 0x1F1E0 && r <= 0x1F1FF) { // Regional Indicator Symbols (flags)
			continue
		}
		result.WriteRune(r)
	}

	sanitized = result.String()
	sanitized = strings.TrimSpace(sanitized)

	// Remove leading/trailing dots and spaces (Windows doesn't allow these)
	sanitized = strings.Trim(sanitized, ". ")

	// Normalize consecutive spaces to single space
	re = regexp.MustCompile(`\s+`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	// Normalize consecutive underscores to single underscore
	re = regexp.MustCompile(`_+`)
	sanitized = re.ReplaceAllString(sanitized, "_")

	// Remove leading/trailing underscores and spaces
	sanitized = strings.Trim(sanitized, "_ ")

	if sanitized == "" {
		return "Unknown"
	}

	// Ensure the result is valid UTF-8
	if !utf8.ValidString(sanitized) {
		// If invalid UTF-8, try to fix it
		sanitized = strings.ToValidUTF8(sanitized, "_")
	}

	return sanitized
}

// NormalizePath only normalizes path separators without modifying folder names
// Use this for user-provided paths that already exist on the filesystem
func NormalizePath(folderPath string) string {
	// Normalize all forward slashes to backslashes on Windows
	return strings.ReplaceAll(folderPath, "/", string(filepath.Separator))
}

// SanitizeFolderPath sanitizes each component of a folder path and normalizes separators
// Use this only for NEW folders being created (artist names, album names, etc.)
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

		// Keep empty first part for absolute paths on Unix (e.g., "/Users/...")
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
	// Use the same sanitization as filename
	return sanitizeFilename(name)
}
