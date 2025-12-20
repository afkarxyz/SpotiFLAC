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
	ffmpegMacOSURL   = "aHR0cHM6Ly9ldmVybWVldC5jeC9mZm1wZWcvZ2V0cmVsZWFzZS96aXA="
	ffprobeMacOSURL  = "aHR0cHM6Ly9ldmVybWVldC5jeC9mZm1wZWcvZ2V0cmVsZWFzZS9mZnByb2JlL3ppcA=="
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

// GetFFprobePath returns the full path to the ffprobe executable in app directory
func GetFFprobePath() (string, error) {
	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return "", err
	}

	ffprobeName := "ffprobe"
	if runtime.GOOS == "windows" {
		ffprobeName = "ffprobe.exe"
	}

	ffprobePath := filepath.Join(ffmpegDir, ffprobeName)
	if _, err := os.Stat(ffprobePath); err == nil {
		return ffprobePath, nil
	}

	return "", fmt.Errorf("ffprobe not found in app directory")
}

// IsFFprobeInstalled checks if ffprobe is installed in the app directory
func IsFFprobeInstalled() (bool, error) {
	ffprobePath, err := GetFFprobePath()
	if err != nil {
		return false, nil
	}

	// Verify it's executable
	cmd := exec.Command(ffprobePath, "-version")
	setHideWindow(cmd)
	err = cmd.Run()
	return err == nil, nil
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

	// For macOS, download ffmpeg and ffprobe separately (only if not already installed)
	if runtime.GOOS == "darwin" {
		ffmpegInstalled, _ := IsFFmpegInstalled()
		ffprobeInstalled, _ := IsFFprobeInstalled()

		if !ffmpegInstalled && !ffprobeInstalled {
			// Download both
			ffmpegURL, _ := decodeBase64(ffmpegMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffmpeg from: %s\n", ffmpegURL)
			if err := downloadAndExtract(ffmpegURL, ffmpegDir, progressCallback, 0, 50); err != nil {
				return err
			}

			ffprobeURL, _ := decodeBase64(ffprobeMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffprobe from: %s\n", ffprobeURL)
			if err := downloadAndExtract(ffprobeURL, ffmpegDir, progressCallback, 50, 100); err != nil {
				return fmt.Errorf("failed to download ffprobe: %w", err)
			}
		} else if !ffmpegInstalled {
			// Only download ffmpeg
			ffmpegURL, _ := decodeBase64(ffmpegMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffmpeg from: %s\n", ffmpegURL)
			if err := downloadAndExtract(ffmpegURL, ffmpegDir, progressCallback, 0, 100); err != nil {
				return err
			}
		} else if !ffprobeInstalled {
			// Only download ffprobe
			ffprobeURL, _ := decodeBase64(ffprobeMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffprobe from: %s\n", ffprobeURL)
			if err := downloadAndExtract(ffprobeURL, ffmpegDir, progressCallback, 0, 100); err != nil {
				return fmt.Errorf("failed to download ffprobe: %w", err)
			}
		}
		return nil
	}

	// For Windows/Linux: single archive contains both ffmpeg and ffprobe
	var encodedURL string
	switch runtime.GOOS {
	case "windows":
		encodedURL = ffmpegWindowsURL
	case "linux":
		encodedURL = ffmpegLinuxURL
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

	// Decode URL
	url, err := decodeBase64(encodedURL)
	if err != nil {
		return fmt.Errorf("failed to decode ffmpeg URL: %w", err)
	}

	fmt.Printf("[FFmpeg] Downloading from: %s\n", url)

	if err := downloadAndExtract(url, ffmpegDir, progressCallback, 0, 100); err != nil {
		return err
	}

	return nil
}

// downloadAndExtract downloads a file and extracts it
func downloadAndExtract(url, destDir string, progressCallback func(int), progressStart, progressEnd int) error {
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
		return fmt.Errorf("failed to download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download: HTTP %d", resp.StatusCode)
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
				// Scale progress between progressStart and progressEnd
				rawProgress := float64(downloaded) / float64(totalSize)
				scaledProgress := progressStart + int(rawProgress*float64(progressEnd-progressStart))
				progressCallback(scaledProgress)
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

	// Extract the archive based on file type
	if strings.HasSuffix(url, ".tar.xz") || runtime.GOOS == "linux" {
		return extractTarXz(tmpFile.Name(), destDir)
	}
	return extractZip(tmpFile.Name(), destDir)
}

// extractZip extracts ffmpeg and ffprobe from a zip archive (skips ffplay)
func extractZip(zipPath, destDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("failed to open zip: %w", err)
	}
	defer r.Close()

	ffmpegName := "ffmpeg"
	ffprobeName := "ffprobe"
	if runtime.GOOS == "windows" {
		ffmpegName = "ffmpeg.exe"
		ffprobeName = "ffprobe.exe"
	}

	foundFFmpeg := false
	foundFFprobe := false

	for _, f := range r.File {
		baseName := filepath.Base(f.Name)
		if f.FileInfo().IsDir() {
			continue
		}

		var destPath string
		if baseName == ffmpegName {
			destPath = filepath.Join(destDir, ffmpegName)
			foundFFmpeg = true
		} else if baseName == ffprobeName {
			destPath = filepath.Join(destDir, ffprobeName)
			foundFFprobe = true
		} else {
			// Skip ffplay and other files
			continue
		}

		fmt.Printf("[FFmpeg] Found: %s\n", f.Name)

		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("failed to open file in zip: %w", err)
		}

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			rc.Close()
			return fmt.Errorf("failed to create output file: %w", err)
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()

		if err != nil {
			return fmt.Errorf("failed to extract file: %w", err)
		}

		fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
	}

	// At least one of ffmpeg or ffprobe should be found
	if !foundFFmpeg && !foundFFprobe {
		return fmt.Errorf("neither ffmpeg nor ffprobe found in archive")
	}

	if foundFFmpeg {
		fmt.Printf("[FFmpeg] ffmpeg extracted successfully\n")
	}
	if foundFFprobe {
		fmt.Printf("[FFmpeg] ffprobe extracted successfully\n")
	}

	return nil
}

// extractTarXz extracts ffmpeg and ffprobe from a tar.xz archive (skips ffplay)
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
	ffprobeName := "ffprobe"
	foundFFmpeg := false
	foundFFprobe := false

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar: %w", err)
		}

		if header.Typeflag != tar.TypeReg {
			continue
		}

		baseName := filepath.Base(header.Name)
		var destPath string

		if baseName == ffmpegName {
			destPath = filepath.Join(destDir, ffmpegName)
			foundFFmpeg = true
		} else if baseName == ffprobeName {
			destPath = filepath.Join(destDir, ffprobeName)
			foundFFprobe = true
		} else {
			// Skip ffplay and other files
			continue
		}

		fmt.Printf("[FFmpeg] Found: %s\n", header.Name)

		outFile, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
		if err != nil {
			return fmt.Errorf("failed to create output file: %w", err)
		}

		_, err = io.Copy(outFile, tarReader)
		outFile.Close()

		if err != nil {
			return fmt.Errorf("failed to extract file: %w", err)
		}

		fmt.Printf("[FFmpeg] Extracted to: %s\n", destPath)
	}

	// At least one of ffmpeg or ffprobe should be found
	if !foundFFmpeg && !foundFFprobe {
		return fmt.Errorf("neither ffmpeg nor ffprobe found in archive")
	}

	if foundFFmpeg {
		fmt.Printf("[FFmpeg] ffmpeg extracted successfully\n")
	}
	if foundFFprobe {
		fmt.Printf("[FFmpeg] ffprobe extracted successfully\n")
	}

	return nil
}

// ConvertAudioRequest represents a request to convert audio files
type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"` // mp3, m4a
	Bitrate      string   `json:"bitrate"`       // e.g., "320k", "256k", "192k", "128k" (ignored for ALAC)
	Codec        string   `json:"codec"`         // For m4a: "aac" (lossy) or "alac" (lossless). Default: "aac"
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
			lyrics, err = ExtractLyrics(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract lyrics from %s: %v\n", inputFile, err)
			} else if lyrics != "" {
				fmt.Printf("[FFmpeg] Lyrics extracted from %s: %d characters\n", inputFile, len(lyrics))
			} else {
				fmt.Printf("[FFmpeg] No lyrics found in %s\n", inputFile)
			}

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
				// Determine codec: ALAC (lossless) or AAC (lossy)
				codec := req.Codec
				if codec == "" {
					codec = "aac" // Default to AAC for backward compatibility
				}

				if codec == "alac" {
					// ALAC - Apple Lossless (no bitrate needed)
					args = append(args,
						"-codec:a", "alac",
						"-map", "0:a", // Map audio stream
						"-map_metadata", "0", // Copy all metadata
					)
				} else {
					// AAC - lossy with bitrate
					args = append(args,
						"-codec:a", "aac",
						"-b:a", req.Bitrate,
						"-map", "0:a", // Map audio stream
						"-map_metadata", "0", // Copy all metadata
					)
				}
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
