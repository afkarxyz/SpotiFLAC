package backend

import (
	"archive/tar"
	"archive/zip"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ulikunitz/xz"
)

// decodeBase64 decodes a base64 encoded string
func decodeBase64(encoded string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

const (
	ffmpegWindowsURL = "aHR0cHM6Ly9naXRodWIuY29tL0J0Yk4vRkZtcGVnLUJ1aWxkcy9yZWxlYXNlcy9kb3dubG9hZC9sYXRlc3QvZmZtcGVnLW1hc3Rlci1sYXRlc3Qtd2luNjQtZ3BsLnppcA=="
	ffmpegLinuxURL   = "aHR0cHM6Ly9naXRodWIuY29tL0J0Yk4vRkZtcGVnLUJ1aWxkcy9yZWxlYXNlcy9kb3dubG9hZC9sYXRlc3QvZmZtcGVnLW1hc3Rlci1sYXRlc3QtbGludXg2NC1ncGwudGFyLnh6"
	ffmpegMacOSURL   = "aHR0cHM6Ly9ldmVybWVldC5jeC9mZm1wZWcvZ2V0cmVsZWFzZS9mZm1wZWcvemlw"
)

// GetFFmpegDir returns the directory where ffmpeg should be stored
func GetFFmpegDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".spotiflac"), nil
}

// GetFFmpegPath returns the full path to the ffmpeg executable
func GetFFmpegPath() (string, error) {
	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return "", err
	}

	ffmpegName := "ffmpeg"
	if runtime.GOOS == "windows" {
		ffmpegName = "ffmpeg.exe"
	}

	return filepath.Join(ffmpegDir, ffmpegName), nil
}

// IsFFmpegInstalled checks if ffmpeg is installed in the app directory
func IsFFmpegInstalled() (bool, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return false, err
	}

	_, err = os.Stat(ffmpegPath)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Verify it's executable
	cmd := exec.Command(ffmpegPath, "-version")
	// Hide console window on Windows
	setHideWindow(cmd)
	err = cmd.Run()
	return err == nil, nil
}

// DownloadFFmpeg downloads and extracts ffmpeg to the app directory
func DownloadFFmpeg(progressCallback func(int)) error {
	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return err
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(ffmpegDir, 0755); err != nil {
		return fmt.Errorf("failed to create ffmpeg directory: %w", err)
	}

	// Get the appropriate URL for the current OS
	var encodedURL string
	switch runtime.GOOS {
	case "windows":
		encodedURL = ffmpegWindowsURL
	case "linux":
		encodedURL = ffmpegLinuxURL
	case "darwin":
		encodedURL = ffmpegMacOSURL
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	// Decode URL
	url, err := decodeBase64(encodedURL)
	if err != nil {
		return fmt.Errorf("failed to decode ffmpeg URL: %w", err)
	}

	fmt.Printf("[FFmpeg] Downloading from: %s\n", url)

	// Create temporary file for download
	tmpFile, err := os.CreateTemp("", "ffmpeg-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// Download the file
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to download ffmpeg: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download ffmpeg: HTTP %d", resp.StatusCode)
	}

	totalSize := resp.ContentLength
	var downloaded int64

	// Create a progress reader
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := tmpFile.Write(buf[:n])
			if writeErr != nil {
				return fmt.Errorf("failed to write to temp file: %w", writeErr)
			}
			downloaded += int64(n)
			if totalSize > 0 && progressCallback != nil {
				progress := int(float64(downloaded) / float64(totalSize) * 100)
				progressCallback(progress)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read response: %w", err)
		}
	}

	tmpFile.Close()

	fmt.Printf("[FFmpeg] Download complete, extracting...\n")

	// Extract the archive
	switch runtime.GOOS {
	case "windows", "darwin":
		return extractZip(tmpFile.Name(), ffmpegDir)
	case "linux":
		return extractTarXz(tmpFile.Name(), ffmpegDir)
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}
}

// extractZip extracts ffmpeg from a zip archive
func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	ffmpegName := "ffmpeg"
	if runtime.GOOS == "windows" {
		ffmpegName = "ffmpeg.exe"
	}

	destPath := filepath.Join(destDir, ffmpegName)

	for _, f := range r.File {
		// Look for ffmpeg executable in any subdirectory
		baseName := filepath.Base(f.Name)
		if baseName == ffmpegName && !f.FileInfo().IsDir() {
			fmt.Printf("[FFmpeg] Found: %s\n", f.Name)

			rc, err := f.Open()
			if err != nil {
				return fmt.Errorf("failed to open file in zip: %w", err)
			}
			defer rc.Close()

			outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
			if err != nil {
				return fmt.Errorf("failed to create output file: %w", err)
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, rc)
			if err != nil {
				return fmt.Errorf("failed to extract file: %w", err)
			}

			fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
			return nil
		}
	}

	return fmt.Errorf("ffmpeg executable not found in archive")
}

// extractTarXz extracts ffmpeg from a tar.xz archive
func extractTarXz(tarXzPath, destDir string) error {
	file, err := os.Open(tarXzPath)
	if err != nil {
		return fmt.Errorf("failed to open tar.xz: %w", err)
	}
	defer file.Close()

	xzReader, err := xz.NewReader(file)
	if err != nil {
		return fmt.Errorf("failed to create xz reader: %w", err)
	}

	tarReader := tar.NewReader(xzReader)

	ffmpegName := "ffmpeg"
	destPath := filepath.Join(destDir, ffmpegName)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar: %w", err)
		}

		baseName := filepath.Base(header.Name)
		if baseName == ffmpegName && header.Typeflag == tar.TypeReg {
			fmt.Printf("[FFmpeg] Found: %s\n", header.Name)

			outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
			if err != nil {
				return fmt.Errorf("failed to create output file: %w", err)
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, tarReader)
			if err != nil {
				return fmt.Errorf("failed to extract file: %w", err)
			}

			fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
			return nil
		}
	}

	return fmt.Errorf("ffmpeg executable not found in archive")
}

// ConvertAudioRequest represents a request to convert audio files
type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"` // mp3, m4a
	Bitrate      string   `json:"bitrate"`       // e.g., "320k", "256k", "192k", "128k"
}

// ConvertAudioResult represents the result of a single file conversion
type ConvertAudioResult struct {
	InputFile  string `json:"input_file"`
	OutputFile string `json:"output_file"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

// ConvertAudio converts audio files using ffmpeg while preserving metadata
func ConvertAudio(req ConvertAudioRequest) ([]ConvertAudioResult, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return nil, fmt.Errorf("failed to get ffmpeg path: %w", err)
	}

	installed, err := IsFFmpegInstalled()
	if err != nil || !installed {
		return nil, fmt.Errorf("ffmpeg is not installed")
	}

	results := make([]ConvertAudioResult, len(req.InputFiles))
	var wg sync.WaitGroup
	var mu sync.Mutex

	// Convert files in parallel
	for i, inputFile := range req.InputFiles {
		wg.Add(1)
		go func(idx int, inputFile string) {
			defer wg.Done()

			result := ConvertAudioResult{
				InputFile: inputFile,
			}

			// Get input file info
			inputExt := strings.ToLower(filepath.Ext(inputFile))
			baseName := strings.TrimSuffix(filepath.Base(inputFile), inputExt)
			inputDir := filepath.Dir(inputFile)

			// Determine output directory: same as input file location + subfolder (MP3 or M4A)
			outputFormatUpper := strings.ToUpper(req.OutputFormat)
			outputDir := filepath.Join(inputDir, outputFormatUpper)

			// Create output directory if it doesn't exist
			if err := os.MkdirAll(outputDir, 0755); err != nil {
				result.Error = fmt.Sprintf("failed to create output directory: %v", err)
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			// Determine output path
			outputExt := "." + strings.ToLower(req.OutputFormat)
			outputFile := filepath.Join(outputDir, baseName+outputExt)

			// Skip if same format
			if inputExt == outputExt {
				result.Error = "Input and output formats are the same"
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			result.OutputFile = outputFile

			// Extract cover art and lyrics from input file before conversion
			var coverArtPath string
			var lyrics string
			
			coverArtPath, _ = ExtractCoverArt(inputFile)
			lyrics, _ = ExtractLyrics(inputFile)

			// Build ffmpeg command
			args := []string{
				"-i", inputFile,
				"-y", // Overwrite output
			}

			// Add codec and bitrate based on output format
			switch req.OutputFormat {
			case "mp3":
				args = append(args,
					"-codec:a", "libmp3lame",
					"-b:a", req.Bitrate,
					"-map", "0:a", // Map audio stream
					"-map_metadata", "0", // Copy all metadata
					"-id3v2_version", "3", // Use ID3v2.3 for better compatibility
				)
				// Map video stream if exists (for cover art)
				args = append(args, "-map", "0:v?", "-c:v", "copy")
			case "m4a":
				args = append(args,
					"-codec:a", "aac",
					"-b:a", req.Bitrate,
					"-map", "0:a", // Map audio stream
					"-map_metadata", "0", // Copy all metadata
				)
				// Map video stream for cover art in M4A
				args = append(args, "-map", "0:v?", "-c:v", "copy", "-disposition:v:0", "attached_pic")
			}

			args = append(args, outputFile)

			fmt.Printf("[FFmpeg] Converting: %s -> %s\n", inputFile, outputFile)

			cmd := exec.Command(ffmpegPath, args...)
			// Hide console window on Windows
			setHideWindow(cmd)
			output, err := cmd.CombinedOutput()
			if err != nil {
				result.Error = fmt.Sprintf("conversion failed: %s - %s", err.Error(), string(output))
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				// Clean up temp cover art file if exists
				if coverArtPath != "" {
					os.Remove(coverArtPath)
				}
				return
			}

			// Embed cover art and lyrics after conversion if they were extracted
			if coverArtPath != "" {
				if err := EmbedCoverArtOnly(outputFile, coverArtPath); err != nil {
					fmt.Printf("[FFmpeg] Warning: Failed to embed cover art: %v\n", err)
				} else {
					fmt.Printf("[FFmpeg] Cover art embedded successfully\n")
				}
				os.Remove(coverArtPath) // Clean up temp file
			}

			if lyrics != "" {
				if err := EmbedLyricsOnlyUniversal(outputFile, lyrics); err != nil {
					fmt.Printf("[FFmpeg] Warning: Failed to embed lyrics: %v\n", err)
				} else {
					fmt.Printf("[FFmpeg] Lyrics embedded successfully\n")
				}
			}

			result.Success = true
			fmt.Printf("[FFmpeg] Successfully converted: %s\n", outputFile)

			mu.Lock()
			results[idx] = result
			mu.Unlock()
		}(i, inputFile)
	}

	wg.Wait()
	return results, nil
}

// GetAudioInfo returns information about an audio file
type AudioFileInfo struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Format   string `json:"format"`
	Size     int64  `json:"size"`
}

// GetAudioFileInfo gets information about an audio file
func GetAudioFileInfo(filePath string) (*AudioFileInfo, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	return &AudioFileInfo{
		Path:     filePath,
		Filename: filepath.Base(filePath),
		Format:   ext,
		Size:     info.Size(),
	}, nil
}

// InstallFFmpegFromFile installs ffmpeg from a local file path
func InstallFFmpegFromFile(filePath string) error {
	// Check if file exists
	info, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("file does not exist: %w", err)
	}

	// Check if it's a regular file (not a directory)
	if info.IsDir() {
		return fmt.Errorf("path is a directory, not a file")
	}

	// Verify it's likely an ffmpeg executable by checking the filename
	fileName := strings.ToLower(filepath.Base(filePath))
	expectedName := "ffmpeg"
	if runtime.GOOS == "windows" {
		expectedName = "ffmpeg.exe"
	}

	if fileName != expectedName && !strings.Contains(fileName, "ffmpeg") {
		return fmt.Errorf("file does not appear to be an ffmpeg executable (expected name containing 'ffmpeg')")
	}

	// Get destination path
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return fmt.Errorf("failed to get ffmpeg path: %w", err)
	}

	ffmpegDir := filepath.Dir(ffmpegPath)
	
	// Create directory if it doesn't exist
	if err := os.MkdirAll(ffmpegDir, 0755); err != nil {
		return fmt.Errorf("failed to create ffmpeg directory: %w", err)
	}

	// Copy file to destination
	sourceFile, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}

	destFile, err := os.OpenFile(ffmpegPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		sourceFile.Close()
		return fmt.Errorf("failed to create destination file: %w", err)
	}

	_, err = io.Copy(destFile, sourceFile)
	sourceFile.Close()
	if err != nil {
		destFile.Close()
		return fmt.Errorf("failed to copy file: %w", err)
	}
	
	// Ensure all data is written to disk
	if err := destFile.Sync(); err != nil {
		destFile.Close()
		return fmt.Errorf("failed to sync file: %w", err)
	}
	destFile.Close()

	// On Windows, file may still be locked by antivirus or system
	// Wait a bit and retry verification
	maxRetries := 3
	retryDelay := 500 * time.Millisecond
	
	var verifyErr error
	for i := 0; i < maxRetries; i++ {
		if i > 0 {
			time.Sleep(retryDelay)
		}
		
		cmd := exec.Command(ffmpegPath, "-version")
		// Hide console window on Windows
		setHideWindow(cmd)
		verifyErr = cmd.Run()
		if verifyErr == nil {
			break
		}
	}
	
	if verifyErr != nil {
		return fmt.Errorf("file copied but ffmpeg verification failed after %d attempts: %w", maxRetries, verifyErr)
	}

	fmt.Printf("[FFmpeg] Successfully installed from: %s\n", filePath)
	return nil
}

