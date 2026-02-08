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

	safeTitle := SanitizeFilename(trackName)
	safeArtist := SanitizeFilename(artistName)
	safeAlbum := SanitizeFilename(albumName)
	safeAlbumArtist := SanitizeFilename(albumArtist)

	safePlaylist := SanitizeFilename(playlistName)
	safeCreator := SanitizeFilename(playlistOwner)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)
		filename = strings.ReplaceAll(filename, "{playlist}", safePlaylist)
		filename = strings.ReplaceAll(filename, "{creator}", safeCreator)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title":
			filename = safeTitle
		default:
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
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
