package backend

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// GetISRCFromDatabase queries the local SQLite database for ISRC by Spotify ID
// Returns empty string if database is not configured, file doesn't exist, or ISRC not found
func GetISRCFromDatabase(databasePath string, spotifyID string) (string, error) {
	// If no database path configured, return empty (will fallback to API)
	if databasePath == "" {
		return "", nil
	}

	fmt.Printf("[Database] Querying database for Spotify ID: %s\n", spotifyID)

	// Open database connection
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return "", fmt.Errorf("failed to open database: %v", err)
	}
	defer db.Close()

	// Ping to verify connection
	if err := db.Ping(); err != nil {
		return "", fmt.Errorf("failed to connect to database: %v", err)
	}

	// Query for ISRC
	// Table structure: tracks table with columns id (Spotify ID) and external_id_isrc (ISRC)
	var isrc string
	query := "SELECT external_id_isrc FROM tracks WHERE id = ? LIMIT 1"
	err = db.QueryRow(query, spotifyID).Scan(&isrc)

	if err == sql.ErrNoRows {
		fmt.Printf("[Database] No ISRC found for Spotify ID: %s\n", spotifyID)
		return "", nil // Not found, will fallback to API
	}

	if err != nil {
		return "", fmt.Errorf("database query error: %v", err)
	}

	fmt.Printf("[Database] Found ISRC: %s for Spotify ID: %s\n", isrc, spotifyID)
	return isrc, nil
}

// TestDatabaseConnection tests if the database file is accessible and has the expected schema
func TestDatabaseConnection(databasePath string) error {
	if databasePath == "" {
		return fmt.Errorf("no database path provided")
	}

	fmt.Printf("[Database] Testing connection to: %s\n", databasePath)

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return fmt.Errorf("failed to connect to database: %v", err)
	}

	// Verify table exists
	var tableName string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'").Scan(&tableName)
	if err == sql.ErrNoRows {
		return fmt.Errorf("database does not contain 'tracks' table")
	}
	if err != nil {
		return fmt.Errorf("failed to verify table: %v", err)
	}

	// Verify columns exist
	rows, err := db.Query("PRAGMA table_info(tracks)")
	if err != nil {
		return fmt.Errorf("failed to get table info: %v", err)
	}
	defer rows.Close()

	hasSpotifyID := false
	hasISRC := false
	var columnNames []string

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var dfltValue interface{}
		var pk int

		if err := rows.Scan(&cid, &name, &dataType, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("failed to scan column info: %v", err)
		}

		columnNames = append(columnNames, name)

		if name == "id" {
			hasSpotifyID = true
		}
		if name == "external_id_isrc" {
			hasISRC = true
		}
	}

	if !hasSpotifyID {
		return fmt.Errorf("database 'tracks' table missing 'id' column. Available columns: %v", columnNames)
	}
	if !hasISRC {
		return fmt.Errorf("database 'tracks' table missing 'external_id_isrc' column. Available columns: %v", columnNames)
	}

	// Query a count to verify data exists
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM tracks").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to count rows: %v", err)
	}

	fmt.Printf("[Database] Connection successful! Database contains %d tracks\n", count)
	return nil
}

// GetAlbumCoverFromDatabase queries the album_images table for a cover URL
// Returns the highest quality (largest) cover URL for the given album name
func GetAlbumCoverFromDatabase(databasePath string, albumName string) (string, error) {
	if databasePath == "" {
		return "", nil
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return "", fmt.Errorf("failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return "", fmt.Errorf("failed to connect to database: %v", err)
	}

	// First, find the album_rowid from the albums table
	var albumRowID int
	albumQuery := "SELECT rowid FROM albums WHERE name = ? LIMIT 1"
	err = db.QueryRow(albumQuery, albumName).Scan(&albumRowID)

	if err == sql.ErrNoRows {
		// Album not found, return empty
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to query album: %v", err)
	}

	// Query for the largest cover image (highest width)
	var coverURL string
	imageQuery := `
		SELECT url 
		FROM album_images 
		WHERE album_rowid = ? 
		ORDER BY width DESC 
		LIMIT 1
	`
	err = db.QueryRow(imageQuery, albumRowID).Scan(&coverURL)

	if err == sql.ErrNoRows {
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to query album image: %v", err)
	}

	fmt.Printf("[Database] Found cover URL for album '%s': %s\n", albumName, coverURL)
	return coverURL, nil
}

// GetCoverByTrackFromDatabase searches for a track by name and artist, then returns the album cover
// This is more reliable than searching by album name since track names are more unique
func GetCoverByTrackFromDatabase(databasePath string, trackName string, artistName string) (string, error) {
	if databasePath == "" {
		return "", nil
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return "", fmt.Errorf("failed to open database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		return "", fmt.Errorf("failed to connect to database: %v", err)
	}

	// Search for track by name, prioritizing exact matches
	// Using LIKE with % to be more flexible with special characters
	var albumRowID int
	trackQuery := `
		SELECT album_rowid 
		FROM tracks 
		WHERE LOWER(name) LIKE LOWER(?) 
		AND (
			LOWER(artists) LIKE LOWER(?) 
			OR LOWER(artists) LIKE LOWER(?)
		)
		LIMIT 1
	`

	// Try with exact match first
	err = db.QueryRow(trackQuery, trackName, "%"+artistName+"%", artistName+"%").Scan(&albumRowID)

	if err == sql.ErrNoRows {
		// Track not found, return empty
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to query track: %v", err)
	}

	// Query for the largest cover image (highest width)
	var coverURL string
	imageQuery := `
		SELECT url 
		FROM album_images 
		WHERE album_rowid = ? 
		ORDER BY width DESC 
		LIMIT 1
	`
	err = db.QueryRow(imageQuery, albumRowID).Scan(&coverURL)

	if err == sql.ErrNoRows {
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to query album image: %v", err)
	}

	fmt.Printf("[Database] Found cover via track search '%s - %s': %s\n", trackName, artistName, coverURL)
	return coverURL, nil
}
