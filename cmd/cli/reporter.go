package main

import (
	"fmt"
	"time"
)

// CliProgressReporter implements core.ProgressReporter for CLI output
type CliProgressReporter struct {
	currentTrack  string
	successCount  int
	failedCount   int
	skippedCount  int
	albumName     string
	trackCount    int
	startTime     time.Time
	lastProgress  float64
}

// NewCliProgressReporter creates a new CLI progress reporter
func NewCliProgressReporter() *CliProgressReporter {
	return &CliProgressReporter{
		startTime: time.Now(),
	}
}

// OnAlbumStart is called when album download begins
func (r *CliProgressReporter) OnAlbumStart(albumName string, trackCount int) {
	r.albumName = albumName
	r.trackCount = trackCount
	fmt.Printf("\n📀 Downloading: %s (%d tracks)\n", albumName, trackCount)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// OnTrackStart is called when a track download begins
func (r *CliProgressReporter) OnTrackStart(trackName, artistName string) {
	r.currentTrack = trackName
	r.lastProgress = 0
	fmt.Printf("⏳ %s - %s", trackName, artistName)
}

// OnTrackProgress is called periodically during track download
func (r *CliProgressReporter) OnTrackProgress(downloaded, speed float64) {
	// Only update if there's a meaningful change (avoid flickering)
	if downloaded-r.lastProgress > 0.5 || speed > 0 {
		r.lastProgress = downloaded
		// Clear current line and rewrite with progress
		fmt.Printf("\r⏳ %s (%.1f MB @ %.1f MB/s)", r.currentTrack, downloaded, speed)
	}
}

// OnTrackComplete is called when a track download successfully completes
func (r *CliProgressReporter) OnTrackComplete(trackName, filePath string, sizeMB float64) {
	// Clear the progress line and show final result
	fmt.Printf("\r✓ %s (%.1f MB)                    \n", trackName, sizeMB)
	r.successCount++
}

// OnTrackFailed is called when a track download fails
func (r *CliProgressReporter) OnTrackFailed(trackName, errorMsg string) {
	// Clear the progress line and show error
	shortError := errorMsg
	if len(errorMsg) > 50 {
		shortError = errorMsg[:50] + "..."
	}
	fmt.Printf("\r✗ %s - ERROR: %s                    \n", trackName, shortError)
	r.failedCount++
}

// OnTrackSkipped is called when a track is skipped
func (r *CliProgressReporter) OnTrackSkipped(trackName, reason string) {
	// Clear the progress line and show skip reason
	fmt.Printf("\r⚠ %s - SKIPPED: %s                    \n", trackName, reason)
	r.skippedCount++
}

// OnAlbumComplete is called when all tracks have been processed
func (r *CliProgressReporter) OnAlbumComplete(successCount, failedCount, skippedCount int) {
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

// PrintSummary prints the final download summary
func (r *CliProgressReporter) PrintSummary() {
	duration := time.Since(r.startTime)
	fmt.Printf("\n✨ Completed in %s\n", duration.Round(time.Second))

	if r.successCount > 0 {
		fmt.Printf("   ✓ %d track(s) downloaded\n", r.successCount)
	}
	if r.skippedCount > 0 {
		fmt.Printf("   ⚠ %d track(s) skipped\n", r.skippedCount)
	}
	if r.failedCount > 0 {
		fmt.Printf("   ✗ %d track(s) failed\n", r.failedCount)
	}

	fmt.Println()
}
