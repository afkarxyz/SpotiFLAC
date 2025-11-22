package backend

import (
	"fmt"
	"io"
	"sync"
	"time"
)

// Global progress tracker
var (
	currentProgress     float64
	currentProgressLock sync.RWMutex
	isDownloading       bool
	downloadingLock     sync.RWMutex
	currentSpeed        float64
	speedLock           sync.RWMutex
)

// ProgressInfo represents download progress information
type ProgressInfo struct {
	IsDownloading bool    `json:"is_downloading"`
	MBDownloaded  float64 `json:"mb_downloaded"`
	SpeedMBps     float64 `json:"speed_mbps"`
}

// GetDownloadProgress returns current download progress
func GetDownloadProgress() ProgressInfo {
	downloadingLock.RLock()
	downloading := isDownloading
	downloadingLock.RUnlock()

	currentProgressLock.RLock()
	progress := currentProgress
	currentProgressLock.RUnlock()

	speedLock.RLock()
	speed := currentSpeed
	speedLock.RUnlock()

	return ProgressInfo{
		IsDownloading: downloading,
		MBDownloaded:  progress,
		SpeedMBps:     speed,
	}
}

// SetDownloadSpeed updates the current download speed
func SetDownloadSpeed(mbps float64) {
	speedLock.Lock()
	currentSpeed = mbps
	speedLock.Unlock()
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
		SetDownloadSpeed(0)
	}
}

// ProgressWriter wraps an io.Writer and reports download progress
type ProgressWriter struct {
	writer      io.Writer
	total       int64
	lastPrinted int64
	startTime   int64
	lastTime    int64
	lastBytes   int64
}

func NewProgressWriter(writer io.Writer) *ProgressWriter {
	now := getCurrentTimeMillis()
	return &ProgressWriter{
		writer:      writer,
		total:       0,
		lastPrinted: 0,
		startTime:   now,
		lastTime:    now,
		lastBytes:   0,
	}
}

func getCurrentTimeMillis() int64 {
	return time.Now().UnixMilli()
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n, err := pw.writer.Write(p)
	pw.total += int64(n)

	// Report progress every 256KB for smoother updates
	if pw.total-pw.lastPrinted >= 256*1024 {
		mbDownloaded := float64(pw.total) / (1024 * 1024)

		// Calculate speed (MB/s)
		now := getCurrentTimeMillis()
		timeDiff := float64(now-pw.lastTime) / 1000.0 // seconds
		bytesDiff := float64(pw.total - pw.lastBytes)

		if timeDiff > 0 {
			speedMBps := (bytesDiff / (1024 * 1024)) / timeDiff
			SetDownloadSpeed(speedMBps)
			fmt.Printf("\rDownloaded: %.2f MB (%.2f MB/s)", mbDownloaded, speedMBps)
		} else {
			fmt.Printf("\rDownloaded: %.2f MB", mbDownloaded)
		}

		// Update global progress
		SetDownloadProgress(mbDownloaded)

		pw.lastPrinted = pw.total
		pw.lastTime = now
		pw.lastBytes = pw.total
	}

	return n, err
}

func (pw *ProgressWriter) GetTotal() int64 {
	return pw.total
}
