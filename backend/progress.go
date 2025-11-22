package backend

import (
	"fmt"
	"io"
	"sync"
)

// Global progress tracker
var (
	currentProgress     float64
	currentProgressLock sync.RWMutex
	isDownloading       bool
	downloadingLock     sync.RWMutex
)

// ProgressInfo represents download progress information
type ProgressInfo struct {
	IsDownloading bool    `json:"is_downloading"`
	MBDownloaded  float64 `json:"mb_downloaded"`
}

// GetDownloadProgress returns current download progress
func GetDownloadProgress() ProgressInfo {
	downloadingLock.RLock()
	downloading := isDownloading
	downloadingLock.RUnlock()

	currentProgressLock.RLock()
	progress := currentProgress
	currentProgressLock.RUnlock()

	return ProgressInfo{
		IsDownloading: downloading,
		MBDownloaded:  progress,
	}
}

// SetDownloadProgress updates the current download progress
func SetDownloadProgress(mbDownloaded float64) {
	currentProgressLock.Lock()
	currentProgress = mbDownloaded
	currentProgressLock.Unlock()
}

// SetDownloading sets the downloading state
func SetDownloading(downloading bool) {
	downloadingLock.Lock()
	isDownloading = downloading
	downloadingLock.Unlock()

	if !downloading {
		// Reset progress when download completes
		SetDownloadProgress(0)
	}
}

// ProgressWriter wraps an io.Writer and reports download progress
type ProgressWriter struct {
	writer      io.Writer
	total       int64
	lastPrinted int64
}

func NewProgressWriter(writer io.Writer) *ProgressWriter {
	return &ProgressWriter{
		writer:      writer,
		total:       0,
		lastPrinted: 0,
	}
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n, err := pw.writer.Write(p)
	pw.total += int64(n)

	// Report progress every 256KB for smoother updates
	if pw.total-pw.lastPrinted >= 256*1024 {
		mbDownloaded := float64(pw.total) / (1024 * 1024)
		fmt.Printf("\rDownloaded: %.2f MB", mbDownloaded)

		// Update global progress
		SetDownloadProgress(mbDownloaded)

		pw.lastPrinted = pw.total
	}

	return n, err
}

func (pw *ProgressWriter) GetTotal() int64 {
	return pw.total
}
