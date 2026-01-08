package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/bogem/id3v2"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

// LibraryVerificationRequest represents a request to verify library completeness
type LibraryVerificationRequest struct {
	ScanPath        string `json:"scan_path"`
	CheckCovers     bool   `json:"check_covers"`
	CheckLyrics     bool   `json:"check_lyrics"`
	DownloadMissing bool   `json:"download_missing"`
	DatabasePath    string `json:"database_path"`
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

	// Download missing covers if requested
	if req.DownloadMissing && response.MissingCovers > 0 {
		fmt.Printf("\n[Library Verifier] Starting to download missing covers...\n")
		coverClient := NewCoverClient()

		// Parallel download with worker pool
		const maxWorkers = 10
		var wg sync.WaitGroup
		var mu sync.Mutex
		downloadedCount := int32(0)

		// Create a channel for tracks to download
		trackChan := make(chan *TrackVerificationResult, response.MissingCovers)

		// Send tracks to channel
		for i := range response.Tracks {
			if response.Tracks[i].MissingCover {
				trackChan <- &response.Tracks[i]
			}
		}
		close(trackChan)

		// Start workers
		for w := 0; w < maxWorkers; w++ {
			wg.Add(1)
			go func(workerID int) {
				defer wg.Done()

				for track := range trackChan {
					current := atomic.AddInt32(&downloadedCount, 1)
					fmt.Printf("[Library Verifier] Worker %d processing %d/%d: %s\n",
						workerID, current, response.MissingCovers, track.TrackName)

					// Extract metadata from audio file
					metadata, err := ExtractMetadataFromFile(track.FilePath)
					if err != nil {
						track.Error = fmt.Sprintf("Failed to extract metadata: %v", err)
						fmt.Printf("[Library Verifier] ✗ Failed to extract metadata: %v\n", err)
						continue
					}

					// Fallback: parse filename if metadata is empty
					if metadata.Title == "" || metadata.Artist == "" {
						filename := filepath.Base(track.FilePath)
						filename = strings.TrimSuffix(filename, filepath.Ext(filename))

						if strings.Contains(filename, " - ") {
							parts := strings.SplitN(filename, " - ", 2)
							if len(parts) == 2 {
								if metadata.Title == "" {
									metadata.Title = strings.TrimSpace(parts[0])
								}
								if metadata.Artist == "" {
									metadata.Artist = strings.TrimSpace(parts[1])
								}
							}
						}

						if metadata.Title == "" {
							metadata.Title = filename
						}
					}

					// Try to get cover from database first (much faster)
					var coverURL string
					if req.DatabasePath != "" && metadata.Album != "" {
						coverURL, err = GetAlbumCoverFromDatabase(req.DatabasePath, metadata.Album)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found cover in database by album\n")
						}
					}

					// If not found by album, try searching by track name and artist
					if coverURL == "" && req.DatabasePath != "" && metadata.Title != "" && metadata.Artist != "" {
						coverURL, err = GetCoverByTrackFromDatabase(req.DatabasePath, metadata.Title, metadata.Artist)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found cover in database by track\n")
						}
					}

					// If still not found in database, try external APIs
					if coverURL == "" {
						coverURL, err = SearchITunesForCover(metadata.Title, metadata.Artist)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found via iTunes\n")
						}
					}

					if coverURL == "" {
						coverURL, err = SearchDeezerForCover(metadata.Title, metadata.Artist)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found via Deezer\n")
						}
					}

					if coverURL == "" {
						searchQuery := fmt.Sprintf("track:%s artist:%s", metadata.Title, metadata.Artist)
						coverURL, err = SearchSpotifyForCover(searchQuery, metadata.Title, metadata.Artist)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found via Spotify\n")
						}
					}

					if coverURL == "" {
						coverURL, err = SearchMusicBrainzForCover(metadata.Title, metadata.Artist)
						if err == nil && coverURL != "" {
							fmt.Printf("[Library Verifier] ✓ Found via MusicBrainz\n")
						}
					}

					if coverURL == "" {
						track.Error = "Failed to find cover from any source"
						fmt.Printf("[Library Verifier] ✗ Cover not found from any source\n")
						continue
					}

					// Download cover to same location as audio file
					basePath := strings.TrimSuffix(track.FilePath, filepath.Ext(track.FilePath))
					coverPath := basePath + ".jpg"

					err = coverClient.DownloadCoverToPath(coverURL, coverPath, false)
					if err != nil {
						track.Error = fmt.Sprintf("Failed to download cover: %v", err)
						fmt.Printf("[Library Verifier] ✗ Failed to download: %v\n", err)
						continue
					}

					mu.Lock()
					track.CoverDownloaded = true
					track.CoverPath = coverPath
					response.CoversDownloaded++
					mu.Unlock()

					fmt.Printf("[Library Verifier] ✓ Cover downloaded successfully\n")
				}
			}(w)
		}

		wg.Wait()
		fmt.Printf("[Library Verifier] Cover download complete: %d covers downloaded\n", response.CoversDownloaded)
	}

	// Download missing lyrics if requested
	if req.DownloadMissing && response.MissingLyrics > 0 {
		fmt.Printf("\n[Library Verifier] Starting to download missing lyrics...\n")
		lyricsClient := NewLyricsClient()

		// Parallel download with worker pool
		const maxWorkers = 10
		var wg sync.WaitGroup
		var mu sync.Mutex
		downloadedCount := int32(0)

		// Create a channel for tracks to download
		trackChan := make(chan *TrackVerificationResult, response.MissingLyrics)

		// Send tracks to channel
		for i := range response.Tracks {
			if response.Tracks[i].MissingLyrics {
				trackChan <- &response.Tracks[i]
			}
		}
		close(trackChan)

		// Start workers
		for w := 0; w < maxWorkers; w++ {
			wg.Add(1)
			go func(workerID int) {
				defer wg.Done()

				for track := range trackChan {
					current := atomic.AddInt32(&downloadedCount, 1)
					fmt.Printf("[Library Verifier] Worker %d processing lyrics %d/%d: %s\n",
						workerID, current, response.MissingLyrics, track.TrackName)

					// Extract metadata from audio file
					metadata, err := ExtractMetadataFromFile(track.FilePath)
					if err != nil {
						track.Error = fmt.Sprintf("Failed to extract metadata: %v", err)
						fmt.Printf("[Library Verifier] ✗ Failed to extract metadata: %v\n", err)
						continue
					}

					// Fallback: parse filename if metadata is empty
					if metadata.Title == "" || metadata.Artist == "" {
						filename := filepath.Base(track.FilePath)
						filename = strings.TrimSuffix(filename, filepath.Ext(filename))

						if strings.Contains(filename, " - ") {
							parts := strings.SplitN(filename, " - ", 2)
							if len(parts) == 2 {
								if metadata.Title == "" {
									metadata.Title = strings.TrimSpace(parts[0])
								}
								if metadata.Artist == "" {
									metadata.Artist = strings.TrimSpace(parts[1])
								}
							}
						}

						if metadata.Title == "" {
							metadata.Title = filename
						}
					}

					// Skip if we don't have at least track name
					if metadata.Title == "" {
						fmt.Printf("[Library Verifier] ✗ Cannot download lyrics without track name\n")
						continue
					}

					// Fetch lyrics using track name and artist
					lyricsResp, err := lyricsClient.FetchLyricsWithMetadata(metadata.Title, metadata.Artist)
					if err != nil || lyricsResp == nil {
						fmt.Printf("[Library Verifier] ✗ Lyrics not found: %v\n", err)
						continue
					}

					// Convert to LRC format
					lrcContent := lyricsClient.ConvertToLRC(lyricsResp, metadata.Title, metadata.Artist)
					if lrcContent == "" {
						fmt.Printf("[Library Verifier] ✗ Failed to convert lyrics to LRC format\n")
						continue
					}

					// Save lyrics to same location as audio file
					basePath := strings.TrimSuffix(track.FilePath, filepath.Ext(track.FilePath))
					lyricsPath := basePath + ".lrc"

					err = os.WriteFile(lyricsPath, []byte(lrcContent), 0644)
					if err != nil {
						track.Error = fmt.Sprintf("Failed to save lyrics: %v", err)
						fmt.Printf("[Library Verifier] ✗ Failed to save lyrics: %v\n", err)
						continue
					}

					mu.Lock()
					track.LyricsDownloaded = true
					track.LyricsPath = lyricsPath
					response.LyricsDownloaded++
					mu.Unlock()

					fmt.Printf("[Library Verifier] ✓ Lyrics downloaded successfully\n")
				}
			}(w)
		}

		wg.Wait()
		fmt.Printf("[Library Verifier] Lyrics download complete: %d lyrics downloaded\n", response.LyricsDownloaded)
	}

	return response, nil
}

// ExtractMetadataFromFile extracts basic metadata from an audio file
func ExtractMetadataFromFile(filePath string) (*Metadata, error) {
	ext := strings.ToLower(filepath.Ext(filePath))

	switch ext {
	case ".flac":
		return extractMetadataFromFLAC(filePath)
	case ".mp3":
		return extractMetadataFromMP3(filePath)
	case ".m4a":
		return extractMetadataFromM4A(filePath)
	default:
		return nil, fmt.Errorf("unsupported file format: %s", ext)
	}
}

// SearchSpotifyForCover searches Spotify for a track and returns the cover URL
func SearchSpotifyForCover(searchQuery, expectedTitle, expectedArtist string) (string, error) {
	// Use the existing Spotify metadata client to search
	ctx := context.Background()
	client := NewSpotifyMetadataClient()

	// Search for the track
	results, err := client.Search(ctx, searchQuery, 5) // Get top 5 results
	if err != nil {
		return "", fmt.Errorf("Spotify search failed: %w", err)
	}

	// Check if we got any track results
	if len(results.Tracks) == 0 {
		return "", fmt.Errorf("no tracks found for query: %s", searchQuery)
	}

	// Return the cover image from the first result
	// The Images field contains the album cover URL
	if results.Tracks[0].Images != "" {
		return results.Tracks[0].Images, nil
	}

	return "", fmt.Errorf("no cover image found for track")
}

// Helper function to extract metadata from FLAC files
func extractMetadataFromFLAC(filePath string) (*Metadata, error) {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse FLAC: %w", err)
	}

	metadata := &Metadata{}

	// Find VorbisComment block
	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			// Extract fields
			if vals, err := cmt.Get(flacvorbis.FIELD_TITLE); err == nil && len(vals) > 0 {
				metadata.Title = vals[0]
			}
			if vals, err := cmt.Get(flacvorbis.FIELD_ARTIST); err == nil && len(vals) > 0 {
				metadata.Artist = vals[0]
			}
			if vals, err := cmt.Get(flacvorbis.FIELD_ALBUM); err == nil && len(vals) > 0 {
				metadata.Album = vals[0]
			}
			if vals, err := cmt.Get("ALBUMARTIST"); err == nil && len(vals) > 0 {
				metadata.AlbumArtist = vals[0]
			}
			break
		}
	}

	return metadata, nil
}

// Helper function to extract metadata from MP3 files
func extractMetadataFromMP3(filePath string) (*Metadata, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return nil, fmt.Errorf("failed to open MP3: %w", err)
	}
	defer tag.Close()

	metadata := &Metadata{
		Title:  tag.Title(),
		Artist: tag.Artist(),
		Album:  tag.Album(),
	}

	// Try to get album artist
	if frame := tag.GetTextFrame("TPE2"); frame.Text != "" {
		metadata.AlbumArtist = frame.Text
	}

	// Try to get track number
	if trackStr := tag.GetTextFrame(tag.CommonID("Track number/Position in set")).Text; trackStr != "" {
		// Handle "1/12" format
		parts := strings.Split(trackStr, "/")
		if trackNum, err := strconv.Atoi(parts[0]); err == nil {
			metadata.TrackNumber = trackNum
		}
	}

	return metadata, nil
}

// Helper function to extract metadata from M4A files
func extractMetadataFromM4A(filePath string) (*Metadata, error) {
	// For M4A files, we'll need to use a different library or ffprobe
	// For now, return basic info from filename
	filename := filepath.Base(filePath)
	nameWithoutExt := strings.TrimSuffix(filename, filepath.Ext(filename))

	// Try to parse "Artist - Title" format
	parts := strings.Split(nameWithoutExt, " - ")
	if len(parts) >= 2 {
		return &Metadata{
			Artist: strings.TrimSpace(parts[0]),
			Title:  strings.TrimSpace(parts[1]),
		}, nil
	}

	return &Metadata{
		Title: nameWithoutExt,
	}, nil
}
