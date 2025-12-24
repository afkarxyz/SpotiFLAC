package core

// ProgressReporter defines the interface for progress reporting
// This allows different implementations (GUI, CLI, JSON, etc.) to handle progress updates
type ProgressReporter interface {
	// OnAlbumStart is called when album download begins
	OnAlbumStart(albumName string, trackCount int)

	// OnTrackStart is called when a track download begins
	OnTrackStart(trackName, artistName string)

	// OnTrackProgress is called periodically during track download
	// downloaded is in MB, speed is in MB/s
	OnTrackProgress(downloaded, speed float64)

	// OnTrackComplete is called when a track download successfully completes
	// sizeMB is the final file size in megabytes
	OnTrackComplete(trackName, filePath string, sizeMB float64)

	// OnTrackFailed is called when a track download fails
	OnTrackFailed(trackName, errorMsg string)

	// OnTrackSkipped is called when a track is skipped (e.g., already exists)
	OnTrackSkipped(trackName, reason string)

	// OnAlbumComplete is called when all tracks have been processed
	OnAlbumComplete(successCount, failedCount, skippedCount int)
}

// Config defines the interface for application configuration
// This abstraction allows different config sources (file, CLI flags, env vars, etc.)
type Config interface {
	// GetOutputDir returns the directory where downloaded files should be saved
	GetOutputDir() string

	// GetAudioFormat returns the desired audio quality
	// Valid values: "LOSSLESS", "HIGH", "MEDIUM"
	GetAudioFormat() string

	// GetPreferredService returns the preferred streaming service
	// Valid values: "tidal", "deezer", "amazon", "qobuz"
	// If the track is not available on the preferred service, fallback to others
	GetPreferredService() string

	// GetFilenameFormat returns the format for naming downloaded files
	// Valid values: "title-artist", "artist-title", "track-title-artist"
	GetFilenameFormat() string

	// UseTrackNumbers returns whether to prepend track numbers to filenames
	UseTrackNumbers() bool

	// CreateAlbumFolders returns whether to create a subfolder for each album
	CreateAlbumFolders() bool
}

// NoOpProgressReporter is a progress reporter that does nothing
// Useful for testing or when progress reporting is not needed
type NoOpProgressReporter struct{}

func (n *NoOpProgressReporter) OnAlbumStart(albumName string, trackCount int)                {}
func (n *NoOpProgressReporter) OnTrackStart(trackName, artistName string)                    {}
func (n *NoOpProgressReporter) OnTrackProgress(downloaded, speed float64)                    {}
func (n *NoOpProgressReporter) OnTrackComplete(trackName, filePath string, sizeMB float64)   {}
func (n *NoOpProgressReporter) OnTrackFailed(trackName, errorMsg string)                     {}
func (n *NoOpProgressReporter) OnTrackSkipped(trackName, reason string)                      {}
func (n *NoOpProgressReporter) OnAlbumComplete(successCount, failedCount, skippedCount int)  {}
