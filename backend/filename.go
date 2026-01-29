package backend

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

func BuildExpectedFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat, playlistName, playlistOwner string, includeTrackNumber bool, position, discNumber int, useAlbumTrackNumber bool) string {

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		
		// First, split by path separators to handle each part separately
		// Support both forward slash and backslash
		parts := []string{}
		current := ""
		for i, r := range filename {
			if r == '/' || r == '\\' {
				if current != "" {
					parts = append(parts, current)
					current = ""
				}
				// Preserve the separator type
				if i+1 < len(filename) {
					current = string(r)
				}
			} else {
				current += string(r)
			}
		}
		if current != "" {
			parts = append(parts, current)
		}
		
		// Process each part
		processedParts := []string{}
		for _, part := range parts {
			if part == "/" || part == "\\" {
				processedParts = append(processedParts, string(filepath.Separator))
				continue
			}
			
			// Skip separator markers
			if strings.HasPrefix(part, "/") || strings.HasPrefix(part, "\\") {
				processedParts = append(processedParts, string(filepath.Separator))
				part = part[1:]
			}
			
			// Sanitize the part but preserve path structure
			processed := part
			processed = strings.ReplaceAll(processed, "{title}", SanitizeFilename(trackName))
			processed = strings.ReplaceAll(processed, "{artist}", SanitizeFilename(artistName))
			processed = strings.ReplaceAll(processed, "{album}", SanitizeFilename(albumName))
			processed = strings.ReplaceAll(processed, "{album_artist}", SanitizeFilename(albumArtist))
			processed = strings.ReplaceAll(processed, "{year}", year)
			processed = strings.ReplaceAll(processed, "{playlist}", SanitizeFilename(playlistName))
			processed = strings.ReplaceAll(processed, "{creator}", SanitizeFilename(playlistOwner))

			if discNumber > 0 {
				processed = strings.ReplaceAll(processed, "{disc}", fmt.Sprintf("%d", discNumber))
			} else {
				processed = strings.ReplaceAll(processed, "{disc}", "")
			}

			if position > 0 {
				processed = strings.ReplaceAll(processed, "{track}", fmt.Sprintf("%02d", position))
			} else {
				processed = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(processed, "")
				processed = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(processed, "")
				processed = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(processed, "")
			}
			
			if processed != "" && processed != "/" && processed != "\\" {
				processedParts = append(processedParts, processed)
			}
		}
		
		// Join the parts back together using filepath.Join to handle OS-specific separators
		if len(processedParts) > 0 {
			filename = filepath.Join(processedParts...)
		} else {
			filename = fmt.Sprintf("%s - %s", SanitizeFilename(trackName), SanitizeFilename(artistName))
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", SanitizeFilename(artistName), SanitizeFilename(trackName))
		case "title":
			filename = SanitizeFilename(trackName)
		default:
			filename = fmt.Sprintf("%s - %s", SanitizeFilename(trackName), SanitizeFilename(artistName))
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d. %s", position, filename)
		}
	}

	return filename + ".flac"
}

func SanitizeFilename(name string) string {

	sanitized := strings.ReplaceAll(name, "/", " ")

	re := regexp.MustCompile(`[<>:"\\|?*]`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	var result strings.Builder
	for _, r := range sanitized {

		if r < 0x20 && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}
		if r == 0x7F {
			continue
		}

		if unicode.IsControl(r) && r != 0x09 && r != 0x0A && r != 0x0D {
			continue
		}

		result.WriteRune(r)
	}

	sanitized = result.String()
	sanitized = strings.TrimSpace(sanitized)

	sanitized = strings.Trim(sanitized, ". ")

	re = regexp.MustCompile(`\s+`)
	sanitized = re.ReplaceAllString(sanitized, " ")

	re = regexp.MustCompile(`_+`)
	sanitized = re.ReplaceAllString(sanitized, "_")

	sanitized = strings.Trim(sanitized, "_ ")

	if sanitized == "" {
		return "Unknown"
	}

	if !utf8.ValidString(sanitized) {

		sanitized = strings.ToValidUTF8(sanitized, "_")
	}

	return sanitized
}

func NormalizePath(folderPath string) string {

	return strings.ReplaceAll(folderPath, "/", string(filepath.Separator))
}

func SanitizeFolderPath(folderPath string) string {

	normalizedPath := strings.ReplaceAll(folderPath, "/", string(filepath.Separator))

	sep := string(filepath.Separator)

	parts := strings.Split(normalizedPath, sep)
	sanitizedParts := make([]string, 0, len(parts))

	for i, part := range parts {

		if i == 0 && len(part) == 2 && part[1] == ':' {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		if i == 0 && part == "" {
			sanitizedParts = append(sanitizedParts, part)
			continue
		}

		sanitized := sanitizeFolderName(part)
		if sanitized != "" {
			sanitizedParts = append(sanitizedParts, sanitized)
		}
	}

	return strings.Join(sanitizedParts, sep)
}

func sanitizeFolderName(name string) string { return SanitizeFilename(name) }

func sanitizeFilename(name string) string {
	return SanitizeFilename(name)
}
