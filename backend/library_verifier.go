package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LibraryVerificationRequest represents a request to verify library completeness
type LibraryVerificationRequest struct {
	ScanPath       string `json:"scan_path"`
	CheckCovers    bool   `json:"check_covers"`
	CheckLyrics    bool   `json:"check_lyrics"`
	DownloadMissing bool   `json:"download_missing"`
}

// TrackVerificationResult represents the verification result for a single track
type TrackVerificationResult struct {
	FilePath         string `json:"file_path"`
	TrackName        string `json:"track_name"`
	HasCover         bool   `json:"has_cover"`
	HasLyrics        bool   `json:"has_lyrics"`
	CoverPath        string `json:"cover_path,omitempty"`
	LyricsPath       string `json:"lyrics_path,omitempty"`
	MissingCover     bool   `json:"missing_cover"`
	MissingLyrics    bool   `json:"missing_lyrics"`
	CoverDownloaded  bool   `json:"cover_downloaded"`
	LyricsDownloaded bool   `json:"lyrics_downloaded"`
	Error            string `json:"error,omitempty"`
}

// LibraryVerificationResponse represents the response from library verification
type LibraryVerificationResponse struct {
	Success          bool                      `json:"success"`
	TotalTracks      int                       `json:"total_tracks"`
	TracksWithCover  int                       `json:"tracks_with_cover"`
	TracksWithLyrics int                       `json:"tracks_with_lyrics"`
	MissingCovers    int                       `json:"missing_covers"`
	MissingLyrics    int                       `json:"missing_lyrics"`
	CoversDownloaded int                       `json:"covers_downloaded"`
	LyricsDownloaded int                       `json:"lyrics_downloaded"`
	Tracks           []TrackVerificationResult `json:"tracks"`
	Error            string                    `json:"error,omitempty"`
}

// VerifyLibrary scans a directory and verifies that all tracks have covers and/or lyrics
func VerifyLibrary(req LibraryVerificationRequest) (*LibraryVerificationResponse, error) {
	fmt.Printf("\n[Library Verifier] Starting scan of: %s\n", req.ScanPath)
	fmt.Printf("[Library Verifier] Check covers: %v, Check lyrics: %v, Download missing: %v\n", 
		req.CheckCovers, req.CheckLyrics, req.DownloadMissing)

	response := &LibraryVerificationResponse{
		Success: true,
		Tracks:  make([]TrackVerificationResult, 0),
	}

	// Normalize path
	scanPath := NormalizePath(req.ScanPath)

	// Check if directory exists
	if _, err := os.Stat(scanPath); os.IsNotExist(err) {
		return &LibraryVerificationResponse{
			Success: false,
			Error:   fmt.Sprintf("Directory does not exist: %s", scanPath),
		}, fmt.Errorf("directory does not exist: %s", scanPath)
	}

	// Find all audio files recursively
	audioFiles := make([]string, 0)
	err := filepath.Walk(scanPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			ext := strings.ToLower(filepath.Ext(path))
			if ext == ".mp3" || ext == ".flac" || ext == ".m4a" {
				audioFiles = append(audioFiles, path)
			}
		}
		return nil
	})

	if err != nil {
		return &LibraryVerificationResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to scan directory: %v", err),
		}, err
	}

	fmt.Printf("[Library Verifier] Found %d audio files\n", len(audioFiles))
	response.TotalTracks = len(audioFiles)

	// Check each audio file for cover and lyrics
	for i, audioPath := range audioFiles {
		if i%10 == 0 {
			fmt.Printf("[Library Verifier] Progress: %d/%d\n", i, len(audioFiles))
		}

		result := TrackVerificationResult{
			FilePath:  audioPath,
			TrackName: filepath.Base(audioPath),
		}

		// Check for cover image (same filename but .jpg or .png)
		if req.CheckCovers {
			basePath := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
			coverPath := ""
			
			// Check for .jpg first, then .png
			if _, err := os.Stat(basePath + ".jpg"); err == nil {
				coverPath = basePath + ".jpg"
			} else if _, err := os.Stat(basePath + ".png"); err == nil {
				coverPath = basePath + ".png"
			}

			if coverPath != "" {
				result.HasCover = true
				result.CoverPath = coverPath
				response.TracksWithCover++
			} else {
				result.MissingCover = true
				response.MissingCovers++
			}
		}

		// Check for lyrics file (same filename but .lrc or .txt)
		if req.CheckLyrics {
			basePath := strings.TrimSuffix(audioPath, filepath.Ext(audioPath))
			lyricsPath := ""
			
			// Check for .lrc first, then .txt
			if _, err := os.Stat(basePath + ".lrc"); err == nil {
				lyricsPath = basePath + ".lrc"
			} else if _, err := os.Stat(basePath + ".txt"); err == nil {
				lyricsPath = basePath + ".txt"
			}

			if lyricsPath != "" {
				result.HasLyrics = true
				result.LyricsPath = lyricsPath
				response.TracksWithLyrics++
			} else {
				result.MissingLyrics = true
				response.MissingLyrics++
			}
		}

		response.Tracks = append(response.Tracks, result)
	}

	fmt.Printf("[Library Verifier] Scan complete:\n")
	fmt.Printf("  Total tracks: %d\n", response.TotalTracks)
	if req.CheckCovers {
		fmt.Printf("  Tracks with cover: %d\n", response.TracksWithCover)
		fmt.Printf("  Missing covers: %d\n", response.MissingCovers)
	}
	if req.CheckLyrics {
		fmt.Printf("  Tracks with lyrics: %d\n", response.TracksWithLyrics)
		fmt.Printf("  Missing lyrics: %d\n", response.MissingLyrics)
	}

	return response, nil
}
