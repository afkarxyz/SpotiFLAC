package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"spotiflac/backend"
)

// AlbumDownloader handles downloading entire albums
type AlbumDownloader struct {
	config   Config
	reporter ProgressReporter
	fetcher  *MetadataFetcher
}

// NewAlbumDownloader creates a new album downloader
func NewAlbumDownloader(config Config, reporter ProgressReporter) *AlbumDownloader {
	if reporter == nil {
		reporter = &NoOpProgressReporter{}
	}
	return &AlbumDownloader{
		config:   config,
		reporter: reporter,
		fetcher:  NewMetadataFetcher(),
	}
}

// DownloadAlbum downloads all tracks from a Spotify album URL
func (d *AlbumDownloader) DownloadAlbum(spotifyURL string) error {
	// 1. Fetch album metadata
	album, err := d.fetcher.FetchAlbum(spotifyURL)
	if err != nil {
		return fmt.Errorf("failed to fetch album metadata: %w", err)
	}

	// 2. Setup output directory
	outputDir := d.config.GetOutputDir()
	if d.config.CreateAlbumFolders() {
		// Create a subfolder for the album
		albumFolder := backend.SanitizeFolderPath(fmt.Sprintf("%s - %s", album.Artist, album.Name))
		outputDir = filepath.Join(outputDir, albumFolder)
	}

	// Ensure output directory exists
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Notify album start
	d.reporter.OnAlbumStart(album.Name, album.TrackCount)

	// 4. Download each track
	successCount := 0
	failedCount := 0
	skippedCount := 0

	for _, track := range album.Tracks {
		result := d.downloadTrack(track, outputDir)

		switch result.Status {
		case DownloadSuccess:
			successCount++
		case DownloadFailed:
			failedCount++
		case DownloadSkipped:
			skippedCount++
		}
	}

	// 5. Notify album complete
	d.reporter.OnAlbumComplete(successCount, failedCount, skippedCount)

	// Return error if all tracks failed
	if failedCount > 0 && successCount == 0 {
		return fmt.Errorf("all tracks failed to download")
	}

	return nil
}

// DownloadStatus represents the result of a download attempt
type DownloadStatus int

const (
	DownloadSuccess DownloadStatus = iota
	DownloadFailed
	DownloadSkipped
)

// DownloadResult represents the result of a track download
type DownloadResult struct {
	Status   DownloadStatus
	FilePath string
	Error    error
	SizeMB   float64
}

// downloadTrack downloads a single track with automatic service fallback
func (d *AlbumDownloader) downloadTrack(track TrackMetadata, outputDir string) DownloadResult {
	// Notify track start
	d.reporter.OnTrackStart(track.Name, track.Artist)

	// Check if file already exists by ISRC
	if existingFile, exists := backend.CheckISRCExists(outputDir, track.ISRC); exists {
		d.reporter.OnTrackSkipped(track.Name, "file already exists")
		return DownloadResult{
			Status:   DownloadSkipped,
			FilePath: existingFile,
		}
	}

	// Check if file already exists by filename
	expectedFilename := backend.BuildExpectedFilename(
		track.Name,
		track.Artist,
		d.config.GetFilenameFormat(),
		d.config.UseTrackNumbers(),
		track.TrackNumber,
		true, // use album track number
	)
	expectedPath := filepath.Join(outputDir, expectedFilename)

	if fileInfo, err := os.Stat(expectedPath); err == nil && fileInfo.Size() > 100*1024 {
		// Validate the file by checking if it has valid ISRC metadata
		if fileISRC, readErr := backend.ReadISRCFromFile(expectedPath); readErr == nil && fileISRC != "" {
			d.reporter.OnTrackSkipped(track.Name, "file already exists")
			sizeMB := float64(fileInfo.Size()) / (1024 * 1024)
			return DownloadResult{
				Status:   DownloadSkipped,
				FilePath: expectedPath,
				SizeMB:   sizeMB,
			}
		} else {
			// File exists but has no valid ISRC metadata - delete it
			os.Remove(expectedPath)
		}
	}

	// Determine service order (preferred first, then fallback)
	preferredService := d.config.GetPreferredService()
	services := []string{preferredService}

	// Add other services for fallback
	allServices := []string{"tidal", "deezer", "amazon", "qobuz"}
	for _, svc := range allServices {
		if svc != preferredService {
			services = append(services, svc)
		}
	}

	// Try each service until one succeeds
	var lastErr error
	for _, service := range services {
		result := d.downloadTrackFromService(track, outputDir, service)

		if result.Status == DownloadSuccess {
			d.reporter.OnTrackComplete(track.Name, result.FilePath, result.SizeMB)
			return result
		}

		if result.Status == DownloadSkipped {
			d.reporter.OnTrackSkipped(track.Name, "file already exists")
			return result
		}

		lastErr = result.Error
	}

	// All services failed
	errorMsg := "not available on any service"
	if lastErr != nil {
		errorMsg = lastErr.Error()
	}
	d.reporter.OnTrackFailed(track.Name, errorMsg)

	return DownloadResult{
		Status: DownloadFailed,
		Error:  lastErr,
	}
}

// downloadTrackFromService downloads a track from a specific service
func (d *AlbumDownloader) downloadTrackFromService(track TrackMetadata, outputDir, service string) DownloadResult {
	var filename string
	var err error

	audioFormat := d.config.GetAudioFormat()
	filenameFormat := d.config.GetFilenameFormat()
	useTrackNumbers := d.config.UseTrackNumbers()

	switch service {
	case "amazon":
		downloader := backend.NewAmazonDownloader()
		if track.SpotifyID == "" {
			return DownloadResult{Status: DownloadFailed, Error: fmt.Errorf("spotify ID required for Amazon")}
		}
		filename, err = downloader.DownloadBySpotifyID(
			track.SpotifyID,
			outputDir,
			filenameFormat,
			useTrackNumbers,
			track.TrackNumber,
			track.Name,
			track.Artist,
			track.AlbumName,
			true, // use album track number
		)

	case "tidal":
		downloader := backend.NewTidalDownloader("")
		if track.SpotifyID == "" {
			return DownloadResult{Status: DownloadFailed, Error: fmt.Errorf("spotify ID required for Tidal")}
		}
		filename, err = downloader.DownloadWithFallbackAndISRC(
			track.SpotifyID,
			track.ISRC,
			outputDir,
			audioFormat,
			filenameFormat,
			useTrackNumbers,
			track.TrackNumber,
			track.Name,
			track.Artist,
			track.AlbumName,
			true, // use album track number
			track.Duration/1000, // convert to seconds
		)

	case "qobuz":
		downloader := backend.NewQobuzDownloader()
		filename, err = downloader.DownloadByISRC(
			track.ISRC,
			outputDir,
			audioFormat,
			filenameFormat,
			useTrackNumbers,
			track.TrackNumber,
			track.Name,
			track.Artist,
			track.AlbumName,
			true, // use album track number
		)

	case "deezer":
		downloader := backend.NewDeezerDownloader()
		if track.SpotifyID == "" {
			return DownloadResult{Status: DownloadFailed, Error: fmt.Errorf("spotify ID required for Deezer")}
		}
		filename, err = downloader.DownloadBySpotifyID(
			track.SpotifyID,
			outputDir,
			filenameFormat,
			useTrackNumbers,
			track.TrackNumber,
			track.Name,
			track.Artist,
			track.AlbumName,
			true, // use album track number
		)

	default:
		return DownloadResult{
			Status: DownloadFailed,
			Error:  fmt.Errorf("unsupported service: %s", service),
		}
	}

	if err != nil {
		// Clean up partial file
		if filename != "" && !strings.HasPrefix(filename, "EXISTS:") {
			if _, statErr := os.Stat(filename); statErr == nil {
				os.Remove(filename)
			}
		}
		return DownloadResult{
			Status: DownloadFailed,
			Error:  err,
		}
	}

	// Check if file already existed
	alreadyExists := strings.HasPrefix(filename, "EXISTS:")
	if alreadyExists {
		filename = strings.TrimPrefix(filename, "EXISTS:")

		// Get file size
		var sizeMB float64
		if fileInfo, statErr := os.Stat(filename); statErr == nil {
			sizeMB = float64(fileInfo.Size()) / (1024 * 1024)
		}

		return DownloadResult{
			Status:   DownloadSkipped,
			FilePath: filename,
			SizeMB:   sizeMB,
		}
	}

	// Get file size for completed download
	var sizeMB float64
	if fileInfo, statErr := os.Stat(filename); statErr == nil {
		sizeMB = float64(fileInfo.Size()) / (1024 * 1024)
	}

	return DownloadResult{
		Status:   DownloadSuccess,
		FilePath: filename,
		SizeMB:   sizeMB,
	}
}

// DownloadPlaylist downloads all tracks from a Spotify playlist URL
func (d *AlbumDownloader) DownloadPlaylist(spotifyURL string) error {
	// 1. Fetch playlist metadata
	playlist, err := d.fetcher.FetchPlaylist(spotifyURL)
	if err != nil {
		return fmt.Errorf("failed to fetch playlist metadata: %w", err)
	}

	// 2. Setup output directory
	outputDir := d.config.GetOutputDir()
	if d.config.CreateAlbumFolders() {
		// Create a subfolder for the playlist
		playlistFolder := backend.SanitizeFolderPath(fmt.Sprintf("Playlist - %s", playlist.Name))
		outputDir = filepath.Join(outputDir, playlistFolder)
	}

	// Ensure output directory exists
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Notify playlist start (reusing OnAlbumStart for now)
	d.reporter.OnAlbumStart(playlist.Name, playlist.TrackCount)

	// 4. Download each track
	successCount := 0
	failedCount := 0
	skippedCount := 0

	for _, track := range playlist.Tracks {
		result := d.downloadTrack(track, outputDir)

		switch result.Status {
		case DownloadSuccess:
			successCount++
		case DownloadFailed:
			failedCount++
		case DownloadSkipped:
			skippedCount++
		}
	}

	// 5. Notify playlist complete
	d.reporter.OnAlbumComplete(successCount, failedCount, skippedCount)

	// Return error if all tracks failed
	if failedCount > 0 && successCount == 0 {
		return fmt.Errorf("all tracks failed to download")
	}

	return nil
}

// DownloadDiscography downloads all albums from an artist's discography
func (d *AlbumDownloader) DownloadDiscography(spotifyURL string) error {
	// 1. Fetch discography metadata
	discography, err := d.fetcher.FetchDiscography(spotifyURL)
	if err != nil {
		return fmt.Errorf("failed to fetch discography metadata: %w", err)
	}

	// 2. Setup base output directory
	baseOutputDir := d.config.GetOutputDir()
	if d.config.CreateAlbumFolders() {
		// Create a subfolder for the artist's discography
		artistFolder := backend.SanitizeFolderPath(fmt.Sprintf("%s - Discography", discography.ArtistName))
		baseOutputDir = filepath.Join(baseOutputDir, artistFolder)
	}

	// Ensure base directory exists
	if err := os.MkdirAll(baseOutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// 3. Notify discography start
	totalTracks := len(discography.AllTracks)
	d.reporter.OnAlbumStart(fmt.Sprintf("%s - %s", discography.ArtistName, discography.DiscographyType), totalTracks)

	// 4. Download each album
	totalSuccessCount := 0
	totalFailedCount := 0
	totalSkippedCount := 0

	for albumIdx, album := range discography.Albums {
		// Create album subfolder
		albumFolder := backend.SanitizeFolderPath(fmt.Sprintf("%s - %s", album.Artist, album.Name))
		albumOutputDir := filepath.Join(baseOutputDir, albumFolder)

		if err := os.MkdirAll(albumOutputDir, 0755); err != nil {
			d.reporter.OnTrackFailed(album.Name, fmt.Sprintf("failed to create album folder: %v", err))
			totalFailedCount += len(album.Tracks)
			continue
		}

		// Download each track in the album
		for _, track := range album.Tracks {
			result := d.downloadTrack(track, albumOutputDir)

			switch result.Status {
			case DownloadSuccess:
				totalSuccessCount++
			case DownloadFailed:
				totalFailedCount++
			case DownloadSkipped:
				totalSkippedCount++
			}
		}

		// Optional: small pause between albums to avoid rate limiting
		if albumIdx < len(discography.Albums)-1 {
			// time.Sleep(500 * time.Millisecond)
		}
	}

	// 5. Notify discography complete
	d.reporter.OnAlbumComplete(totalSuccessCount, totalFailedCount, totalSkippedCount)

	// Return error if all tracks failed
	if totalFailedCount > 0 && totalSuccessCount == 0 {
		return fmt.Errorf("all tracks failed to download")
	}

	return nil
}
