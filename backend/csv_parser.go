package backend

import (
	"encoding/csv"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unicode"
)

// CSVTrack represents a track parsed from CSV
type CSVTrack struct {
	TrackURI    string `json:"track_uri"`
	TrackName   string `json:"track_name"`
	AlbumName   string `json:"album_name"`
	ArtistName  string `json:"artist_name"`
	ReleaseDate string `json:"release_date"`
	DurationMs  int    `json:"duration_ms"`
	Popularity  int    `json:"popularity"`
	Explicit    bool   `json:"explicit"`
	SpotifyID   string `json:"spotify_id"`
}

// ParseCSVPlaylist parses a Spotify exported CSV file
func ParseCSVPlaylist(filePath string) ([]CSVTrack, error) {
	fmt.Printf("\n[CSV Parser] Opening file: %s\n", filePath)

	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("[CSV Parser] ERROR opening file: %v\n", err)
		return nil, fmt.Errorf("failed to open CSV file: %v", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.LazyQuotes = true       // Allow lazy quotes
	reader.TrimLeadingSpace = true // Trim leading space

	// Read header
	fmt.Println("[CSV Parser] Reading header...")
	header, err := reader.Read()
	if err != nil {
		fmt.Printf("[CSV Parser] ERROR reading header: %v\n", err)
		return nil, fmt.Errorf("failed to read CSV header: %v", err)
	}

	// Clean header columns - remove BOM, trim space, and remove non-printable characters
	for i, col := range header {
		// Remove BOM (UTF-8 BOM is EF BB BF)
		col = strings.TrimPrefix(col, "\uFEFF")
		// Trim spaces
		col = strings.TrimSpace(col)
		// Remove any non-printable characters
		col = strings.Map(func(r rune) rune {
			if unicode.IsPrint(r) {
				return r
			}
			return -1
		}, col)
		header[i] = col
	}

	fmt.Printf("[CSV Parser] Header columns (cleaned): %v\n", header)

	// Find column indices
	colMap := make(map[string]int)
	for i, col := range header {
		colMap[col] = i
	}

	// Verify required columns exist
	requiredCols := []string{"Track URI", "Track Name", "Artist Name(s)"}
	for _, col := range requiredCols {
		if _, ok := colMap[col]; !ok {
			fmt.Printf("[CSV Parser] ERROR: Missing required column: %s\n", col)
			fmt.Printf("[CSV Parser] Available columns: %v\n", header)
			return nil, fmt.Errorf("missing required column: %s", col)
		}
	}
	fmt.Println("[CSV Parser] All required columns found")

	var tracks []CSVTrack

	// Read all rows
	fmt.Println("[CSV Parser] Reading rows...")
	rowCount := 0
	for {
		record, err := reader.Read()
		if err != nil {
			if err.Error() != "EOF" {
				fmt.Printf("[CSV Parser] Error reading row %d: %v\n", rowCount+1, err)
			}
			break // EOF or error
		}

		rowCount++
		if len(record) == 0 {
			continue
		}

		track := CSVTrack{}

		// Track URI (e.g., "spotify:track:7LsYnC8kNpGZSDDDulmXph")
		if idx, ok := colMap["Track URI"]; ok && idx < len(record) {
			track.TrackURI = strings.TrimSpace(record[idx])
			// Extract Spotify ID from URI
			parts := strings.Split(track.TrackURI, ":")
			if len(parts) == 3 && parts[0] == "spotify" && parts[1] == "track" {
				track.SpotifyID = parts[2]
			}
		}

		// Skip if no valid Spotify ID
		if track.SpotifyID == "" {
			fmt.Printf("[CSV Parser] Row %d: Skipping - no valid Spotify ID\n", rowCount)
			continue
		}

		// Track Name
		if idx, ok := colMap["Track Name"]; ok && idx < len(record) {
			track.TrackName = strings.TrimSpace(record[idx])
		}

		// Album Name
		if idx, ok := colMap["Album Name"]; ok && idx < len(record) {
			track.AlbumName = strings.TrimSpace(record[idx])
		}

		// Artist Name(s)
		if idx, ok := colMap["Artist Name(s)"]; ok && idx < len(record) {
			track.ArtistName = strings.TrimSpace(record[idx])
		}

		// Release Date
		if idx, ok := colMap["Release Date"]; ok && idx < len(record) {
			track.ReleaseDate = strings.TrimSpace(record[idx])
		}

		// Duration (ms)
		if idx, ok := colMap["Duration (ms)"]; ok && idx < len(record) {
			if duration, err := strconv.Atoi(strings.TrimSpace(record[idx])); err == nil {
				track.DurationMs = duration
			}
		}

		// Popularity
		if idx, ok := colMap["Popularity"]; ok && idx < len(record) {
			if popularity, err := strconv.Atoi(strings.TrimSpace(record[idx])); err == nil {
				track.Popularity = popularity
			}
		}

		// Explicit
		if idx, ok := colMap["Explicit"]; ok && idx < len(record) {
			explicit := strings.ToLower(strings.TrimSpace(record[idx]))
			track.Explicit = explicit == "true"
		}

		tracks = append(tracks, track)
	}

	fmt.Printf("[CSV Parser] Processed %d rows, found %d valid tracks\n", rowCount, len(tracks))

	if len(tracks) == 0 {
		fmt.Println("[CSV Parser] ERROR: No valid tracks found")
		return nil, fmt.Errorf("no valid tracks found in CSV file")
	}

	fmt.Printf("[CSV Parser] Successfully parsed %d tracks\n", len(tracks))
	return tracks, nil
}

// CSVParseResult represents the result of parsing a CSV file
type CSVParseResult struct {
	Success    bool       `json:"success"`
	TrackCount int        `json:"track_count"`
	Tracks     []CSVTrack `json:"tracks"`
	Error      string     `json:"error,omitempty"`
}
