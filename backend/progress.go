package backend

import (
	"fmt"
	"io"
	"sync"
	"time"
)

// DownloadStatus represents the status of a download item
type DownloadStatus string

const (
	StatusQueued      DownloadStatus = "queued"
	StatusDownloading DownloadStatus = "downloading"
	StatusCompleted   DownloadStatus = "completed"
	StatusFailed      DownloadStatus = "failed"
	StatusSkipped     DownloadStatus = "skipped"
)

// DownloadItem represents a single item in the download queue
type DownloadItem struct {
	ID           string         `json:"id"`
	TrackName    string         `json:"track_name"`
	ArtistName   string         `json:"artist_name"`
	AlbumName    string         `json:"album_name"`
	ISRC         string         `json:"isrc"`
	Status       DownloadStatus `json:"status"`
	Progress     float64        `json:"progress"`      // MB downloaded
	TotalSize    float64        `json:"total_size"`    // MB total (if known)
	Speed        float64        `json:"speed"`         // MB/s
	StartTime    int64          `json:"start_time"`    // Unix timestamp
	EndTime      int64          `json:"end_time"`      // Unix timestamp
	ErrorMessage string         `json:"error_message"` // If failed
	FilePath     string         `json:"file_path"`     // Final file path
}

// Global progress tracker
var (
	currentProgress     float64
	currentProgressLock sync.RWMutex
	isDownloading       bool
	downloadingLock     sync.RWMutex
	currentSpeed        float64
	speedLock           sync.RWMutex

	// Download queue tracking
	downloadQueue       []DownloadItem
	downloadQueueLock   sync.RWMutex
	currentItemID       string
	currentItemLock     sync.RWMutex
	totalDownloaded     float64
	totalDownloadedLock sync.RWMutex
	sessionStartTime    int64
	sessionStartLock    sync.RWMutex
)

// ProgressInfo represents download progress information
type ProgressInfo struct {
	IsDownloading bool    `json:"is_downloading"`
	MBDownloaded  float64 `json:"mb_downloaded"`
	SpeedMBps     float64 `json:"speed_mbps"`
}

// DownloadQueueInfo represents the complete download queue state
type DownloadQueueInfo struct {
	IsDownloading    bool           `json:"is_downloading"`
	Queue            []DownloadItem `json:"queue"`
	CurrentSpeed     float64        `json:"current_speed"`      // MB/s
	TotalDownloaded  float64        `json:"total_downloaded"`   // MB this session
	SessionStartTime int64          `json:"session_start_time"` // Unix timestamp
	QueuedCount      int            `json:"queued_count"`
	CompletedCount   int            `json:"completed_count"`
	FailedCount      int            `json:"failed_count"`
	SkippedCount     int            `json:"skipped_count"`
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
	itemID      string // Track which download item this belongs to
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
		itemID:      "",
	}
}

// NewProgressWriterWithID creates a progress writer with an item ID for queue tracking
func NewProgressWriterWithID(writer io.Writer, itemID string) *ProgressWriter {
	pw := NewProgressWriter(writer)
	pw.itemID = itemID
	return pw
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

		var speedMBps float64
		if timeDiff > 0 {
			speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
			SetDownloadSpeed(speedMBps)
			fmt.Printf("\rDownloaded: %.2f MB (%.2f MB/s)", mbDownloaded, speedMBps)
		} else {
			fmt.Printf("\rDownloaded: %.2f MB", mbDownloaded)
		}

		// Update global progress
		SetDownloadProgress(mbDownloaded)

		// Update individual item progress if we have an item ID
		if pw.itemID != "" {
			UpdateItemProgress(pw.itemID, mbDownloaded, speedMBps)
		}

		pw.lastPrinted = pw.total
		pw.lastTime = now
		pw.lastBytes = pw.total
	}

	return n, err
}

func (pw *ProgressWriter) GetTotal() int64 {
	return pw.total
}

// Queue management functions

// AddToQueue adds a new item to the download queue
func AddToQueue(id, trackName, artistName, albumName, isrc string) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	item := DownloadItem{
		ID:         id,
		TrackName:  trackName,
		ArtistName: artistName,
		AlbumName:  albumName,
		ISRC:       isrc,
		Status:     StatusQueued,
		Progress:   0,
		TotalSize:  0,
		Speed:      0,
		StartTime:  0,
		EndTime:    0,
	}

	downloadQueue = append(downloadQueue, item)

	// Initialize session start time if this is the first item
	sessionStartLock.Lock()
	if sessionStartTime == 0 {
		sessionStartTime = time.Now().Unix()
	}
	sessionStartLock.Unlock()
}

// StartDownloadItem marks an item as currently downloading
func StartDownloadItem(id string) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].ID == id {
			downloadQueue[i].Status = StatusDownloading
			downloadQueue[i].StartTime = time.Now().Unix()
			downloadQueue[i].Progress = 0
			break
		}
	}

	currentItemLock.Lock()
	currentItemID = id
	currentItemLock.Unlock()
}

// UpdateItemProgress updates the progress of the current download item
func UpdateItemProgress(id string, progress, speed float64) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].ID == id {
			downloadQueue[i].Progress = progress
			downloadQueue[i].Speed = speed
			break
		}
	}
}

// GetCurrentItemID returns the ID of the currently downloading item
func GetCurrentItemID() string {
	currentItemLock.RLock()
	defer currentItemLock.RUnlock()
	return currentItemID
}

// CompleteDownloadItem marks an item as completed
func CompleteDownloadItem(id, filePath string, finalSize float64) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].ID == id {
			downloadQueue[i].Status = StatusCompleted
			downloadQueue[i].EndTime = time.Now().Unix()
			downloadQueue[i].FilePath = filePath
			downloadQueue[i].Progress = finalSize
			downloadQueue[i].TotalSize = finalSize

			// Add to total downloaded
			totalDownloadedLock.Lock()
			totalDownloaded += finalSize
			totalDownloadedLock.Unlock()
			break
		}
	}
}

// FailDownloadItem marks an item as failed
func FailDownloadItem(id, errorMsg string) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].ID == id {
			downloadQueue[i].Status = StatusFailed
			downloadQueue[i].EndTime = time.Now().Unix()
			downloadQueue[i].ErrorMessage = errorMsg
			break
		}
	}
}

// SkipDownloadItem marks an item as skipped (already exists)
func SkipDownloadItem(id, filePath string) {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].ID == id {
			downloadQueue[i].Status = StatusSkipped
			downloadQueue[i].EndTime = time.Now().Unix()
			downloadQueue[i].FilePath = filePath
			break
		}
	}
}

// GetDownloadQueue returns the complete download queue state
func GetDownloadQueue() DownloadQueueInfo {
	// Auto-reset session if all downloads are complete
	ResetSessionIfComplete()

	downloadQueueLock.RLock()
	defer downloadQueueLock.RUnlock()

	downloadingLock.RLock()
	downloading := isDownloading
	downloadingLock.RUnlock()

	speedLock.RLock()
	speed := currentSpeed
	speedLock.RUnlock()

	totalDownloadedLock.RLock()
	total := totalDownloaded
	totalDownloadedLock.RUnlock()

	sessionStartLock.RLock()
	sessionStart := sessionStartTime
	sessionStartLock.RUnlock()

	// Count statuses
	var queued, completed, failed, skipped int
	for _, item := range downloadQueue {
		switch item.Status {
		case StatusQueued:
			queued++
		case StatusCompleted:
			completed++
		case StatusFailed:
			failed++
		case StatusSkipped:
			skipped++
		}
	}

	// Create a copy of the queue
	queueCopy := make([]DownloadItem, len(downloadQueue))
	copy(queueCopy, downloadQueue)

	return DownloadQueueInfo{
		IsDownloading:    downloading,
		Queue:            queueCopy,
		CurrentSpeed:     speed,
		TotalDownloaded:  total,
		SessionStartTime: sessionStart,
		QueuedCount:      queued,
		CompletedCount:   completed,
		FailedCount:      failed,
		SkippedCount:     skipped,
	}
}

// ClearDownloadQueue clears all completed, failed, and skipped items from the queue
func ClearDownloadQueue() {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	// Keep only queued and downloading items
	newQueue := make([]DownloadItem, 0)
	for _, item := range downloadQueue {
		if item.Status == StatusQueued || item.Status == StatusDownloading {
			newQueue = append(newQueue, item)
		}
	}
	downloadQueue = newQueue
}

// ClearAllDownloads clears the entire queue and resets session stats
func ClearAllDownloads() {
	downloadQueueLock.Lock()
	downloadQueue = []DownloadItem{}
	downloadQueueLock.Unlock()

	totalDownloadedLock.Lock()
	totalDownloaded = 0
	totalDownloadedLock.Unlock()

	sessionStartLock.Lock()
	sessionStartTime = 0
	sessionStartLock.Unlock()

	currentItemLock.Lock()
	currentItemID = ""
	currentItemLock.Unlock()

	// Reset current progress and speed
	SetDownloadProgress(0)
	SetDownloadSpeed(0)
}

// CancelAllQueuedItems marks all queued items as skipped (cancelled)
// This is called when user stops a download or when batch download completes
func CancelAllQueuedItems() {
	downloadQueueLock.Lock()
	defer downloadQueueLock.Unlock()

	for i := range downloadQueue {
		if downloadQueue[i].Status == StatusQueued {
			downloadQueue[i].Status = StatusSkipped
			downloadQueue[i].EndTime = time.Now().Unix()
			downloadQueue[i].ErrorMessage = "Cancelled"
		}
	}
}

// ResetSessionIfComplete resets session stats if no active or queued downloads
// Note: Does NOT clear the queue - items remain visible for history
func ResetSessionIfComplete() {
	downloadQueueLock.RLock()
	hasActiveOrQueued := false
	for _, item := range downloadQueue {
		if item.Status == StatusQueued || item.Status == StatusDownloading {
			hasActiveOrQueued = true
			break
		}
	}
	downloadQueueLock.RUnlock()

	// If no active or queued items, reset session stats
	// But keep the queue items for history visibility
	if !hasActiveOrQueued {
		sessionStartLock.Lock()
		sessionStartTime = 0
		sessionStartLock.Unlock()

		totalDownloadedLock.Lock()
		totalDownloaded = 0
		totalDownloadedLock.Unlock()
	}
}
