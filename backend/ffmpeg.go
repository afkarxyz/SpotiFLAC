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
	"time"

	"github.com/ulikunitz/xz"
)

func decodeBase64(encoded string) (string, error) {
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

func ValidateExecutable(path string) error {
	cleanedPath := filepath.Clean(path)
	if cleanedPath == "" {
		return fmt.Errorf("empty path")
	}

	if !filepath.IsAbs(cleanedPath) {
		return fmt.Errorf("path must be absolute: %s", path)
	}

	info, err := os.Stat(cleanedPath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if info.IsDir() {
		return fmt.Errorf("path is a directory: %s", path)
	}

	if runtime.GOOS != "windows" {
		if info.Mode()&0111 == 0 {
			return fmt.Errorf("file is not executable: %s", path)
		}
	}

	base := filepath.Base(cleanedPath)
	validNames := map[string]bool{
		"ffmpeg":      true,
		"ffmpeg.exe":  true,
		"ffprobe":     true,
		"ffprobe.exe": true,
	}
	if !validNames[base] {
		return fmt.Errorf("invalid executable name: %s", base)
	}

	return nil
}

const (
	ffmpegWindowsURL = "aHR0cHM6Ly9naXRodWIuY29tL0J0Yk4vRkZtcGVnLUJ1aWxkcy9yZWxlYXNlcy9kb3dubG9hZC9sYXRlc3QvZmZtcGVnLW1hc3Rlci1sYXRlc3Qtd2luNjQtZ3BsLnppcA=="
	ffmpegLinuxURL   = "aHR0cHM6Ly9naXRodWIuY29tL0J0Yk4vRkZtcGVnLUJ1aWxkcy9yZWxlYXNlcy9kb3dubG9hZC9sYXRlc3QvZmZtcGVnLW1hc3Rlci1sYXRlc3QtbGludXg2NC1ncGwudGFyLnh6"
	ffmpegMacOSURL   = "aHR0cHM6Ly9ldmVybWVldC5jeC9mZm1wZWcvZ2V0cmVsZWFzZS96aXA="
	ffprobeMacOSURL  = "aHR0cHM6Ly9ldmVybWVldC5jeC9mZm1wZWcvZ2V0cmVsZWFzZS9mZnByb2JlL3ppcA=="
)

func GetFFmpegDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(homeDir, ".spotiflac"), nil
}

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

func IsFFprobeInstalled() (bool, error) {
	ffprobePath, err := GetFFprobePath()
	if err != nil {
		return false, nil
	}

	if err := ValidateExecutable(ffprobePath); err != nil {
		return false, nil
	}

	cmd := exec.Command(ffprobePath, "-version")
	setHideWindow(cmd)
	err = cmd.Run()
	return err == nil, nil
}

func IsFFmpegInstalled() (bool, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return false, err
	}

	if err := ValidateExecutable(ffmpegPath); err != nil {
		return false, nil
	}

	cmd := exec.Command(ffmpegPath, "-version")

	setHideWindow(cmd)
	err = cmd.Run()
	return err == nil, nil
}

func DownloadFFmpeg(progressCallback func(int)) error {

	SetDownloadProgress(0)
	SetDownloadSpeed(0)
	SetDownloading(true)
	defer SetDownloading(false)

	ffmpegDir, err := GetFFmpegDir()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(ffmpegDir, 0755); err != nil {
		return fmt.Errorf("failed to create ffmpeg directory: %w", err)
	}

	if runtime.GOOS == "darwin" {
		ffmpegInstalled, _ := IsFFmpegInstalled()
		ffprobeInstalled, _ := IsFFprobeInstalled()

		if !ffmpegInstalled && !ffprobeInstalled {

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

			ffmpegURL, _ := decodeBase64(ffmpegMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffmpeg from: %s\n", ffmpegURL)
			if err := downloadAndExtract(ffmpegURL, ffmpegDir, progressCallback, 0, 100); err != nil {
				return err
			}
		} else if !ffprobeInstalled {

			ffprobeURL, _ := decodeBase64(ffprobeMacOSURL)
			fmt.Printf("[FFmpeg] Downloading ffprobe from: %s\n", ffprobeURL)
			if err := downloadAndExtract(ffprobeURL, ffmpegDir, progressCallback, 0, 100); err != nil {
				return fmt.Errorf("failed to download ffprobe: %w", err)
			}
		}
		return nil
	}

	var encodedURL string
	switch runtime.GOOS {
	case "windows":
		encodedURL = ffmpegWindowsURL
	case "linux":
		encodedURL = ffmpegLinuxURL
	default:
		return fmt.Errorf("unsupported operating system: %s", runtime.GOOS)
	}

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

func downloadAndExtract(url, destDir string, progressCallback func(int), progressStart, progressEnd int) error {

	tmpFile, err := os.CreateTemp("", "ffmpeg-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

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
	lastTime := time.Now()
	var lastBytes int64

	if totalSize > 0 {
		totalSizeMB := float64(totalSize) / (1024 * 1024)
		fmt.Printf("[FFmpeg] Total size: %.2f MB\n", totalSizeMB)
	} else {
		fmt.Printf("[FFmpeg] Downloading... (size unknown)\n")
	}

	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := tmpFile.Write(buf[:n])
			if writeErr != nil {
				return fmt.Errorf("failed to write to temp file: %w", writeErr)
			}
			downloaded += int64(n)

			mbDownloaded := float64(downloaded) / (1024 * 1024)
			now := time.Now()
			timeDiff := now.Sub(lastTime).Seconds()
			var speedMBps float64

			if timeDiff > 0.1 {
				bytesDiff := float64(downloaded - lastBytes)
				speedMBps = (bytesDiff / (1024 * 1024)) / timeDiff
				lastTime = now
				lastBytes = downloaded
			}

			SetDownloadProgress(mbDownloaded)
			if speedMBps > 0 {
				SetDownloadSpeed(speedMBps)
			}

			if totalSize > 0 && progressCallback != nil {
				rawProgress := float64(downloaded) / float64(totalSize)
				scaledProgress := progressStart + int(rawProgress*float64(progressEnd-progressStart))
				progressCallback(scaledProgress)
			}

			if totalSize > 0 {
				percent := float64(downloaded) * 100 / float64(totalSize)
				if speedMBps > 0 {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB / %.2f MB (%.1f%%) - %.2f MB/s",
						mbDownloaded, float64(totalSize)/(1024*1024), percent, speedMBps)
				} else {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB / %.2f MB (%.1f%%)",
						mbDownloaded, float64(totalSize)/(1024*1024), percent)
				}
			} else {
				if speedMBps > 0 {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB - %.2f MB/s", mbDownloaded, speedMBps)
				} else {
					fmt.Printf("\r[FFmpeg] Downloading: %.2f MB", mbDownloaded)
				}
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

	if totalSize > 0 {
		fmt.Printf("\r[FFmpeg] Download complete: %.2f MB / %.2f MB (100%%)          \n",
			float64(downloaded)/(1024*1024), float64(totalSize)/(1024*1024))
	} else {
		fmt.Printf("\r[FFmpeg] Download complete: %.2f MB          \n", float64(downloaded)/(1024*1024))
	}
	fmt.Printf("[FFmpeg] Extracting...\n")

	if strings.HasSuffix(url, ".tar.xz") || runtime.GOOS == "linux" {
		return extractTarXz(tmpFile.Name(), destDir)
	}
	return extractZip(tmpFile.Name(), destDir)
}

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

type ConvertAudioRequest struct {
	InputFiles   []string `json:"input_files"`
	OutputFormat string   `json:"output_format"`
	Bitrate      string   `json:"bitrate"`
	Codec        string   `json:"codec"`
}

type ConvertAudioResult struct {
	InputFile  string `json:"input_file"`
	OutputFile string `json:"output_file"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

func ConvertAudio(req ConvertAudioRequest) ([]ConvertAudioResult, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return nil, fmt.Errorf("failed to get ffmpeg path: %w", err)
	}

	if err := ValidateExecutable(ffmpegPath); err != nil {
		return nil, fmt.Errorf("invalid ffmpeg executable: %w", err)
	}

	installed, err := IsFFmpegInstalled()
	if err != nil || !installed {
		return nil, fmt.Errorf("ffmpeg is not installed")
	}

	results := make([]ConvertAudioResult, len(req.InputFiles))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, inputFile := range req.InputFiles {
		wg.Add(1)
		go func(idx int, inputFile string) {
			defer wg.Done()

			result := ConvertAudioResult{
				InputFile: inputFile,
			}

			inputExt := strings.ToLower(filepath.Ext(inputFile))
			baseName := strings.TrimSuffix(filepath.Base(inputFile), inputExt)
			inputDir := filepath.Dir(inputFile)

			outputFormatUpper := strings.ToUpper(req.OutputFormat)
			outputDir := filepath.Join(inputDir, outputFormatUpper)

			if err := os.MkdirAll(outputDir, 0755); err != nil {
				result.Error = fmt.Sprintf("failed to create output directory: %v", err)
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			outputExt := "." + strings.ToLower(req.OutputFormat)
			outputFile := filepath.Join(outputDir, baseName+outputExt)

			if inputExt == outputExt {
				result.Error = "Input and output formats are the same"
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			result.OutputFile = outputFile

			var coverArtPath string
			var lyrics string
			var inputMetadata Metadata

			inputMetadata, err = ExtractFullMetadataFromFile(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract metadata from %s: %v\n", inputFile, err)
			}

			coverArtPath, _ = ExtractCoverArt(inputFile)
			lyrics, err = ExtractLyrics(inputFile)
			if err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to extract lyrics from %s: %v\n", inputFile, err)
			} else if lyrics != "" {
				fmt.Printf("[FFmpeg] Lyrics extracted from %s: %d characters\n", inputFile, len(lyrics))
			} else {
				fmt.Printf("[FFmpeg] No lyrics found in %s\n", inputFile)
			}

			inputMetadata.Lyrics = lyrics

			args := []string{
				"-i", inputFile,
				"-y",
			}

			switch req.OutputFormat {
			case "mp3":
				args = append(args,
					"-codec:a", "libmp3lame",
					"-b:a", req.Bitrate,
					"-map", "0:a",
					"-id3v2_version", "3",
				)
			case "m4a":

				codec := req.Codec
				if codec == "" {
					codec = "aac"
				}

				if codec == "alac" {

					args = append(args,
						"-codec:a", "alac",
						"-map", "0:a",
					)
				} else {

					args = append(args,
						"-codec:a", "aac",
						"-b:a", req.Bitrate,
						"-map", "0:a",
					)
				}
			}

			args = append(args, outputFile)

			fmt.Printf("[FFmpeg] Converting: %s -> %s\n", inputFile, outputFile)

			cmd := exec.Command(ffmpegPath, args...)

			setHideWindow(cmd)
			output, err := cmd.CombinedOutput()
			if err != nil {
				result.Error = fmt.Sprintf("conversion failed: %s - %s", err.Error(), string(output))
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()

				if coverArtPath != "" {
					os.Remove(coverArtPath)
				}
				return
			}

			if err := EmbedMetadataToConvertedFile(outputFile, inputMetadata, coverArtPath); err != nil {
				fmt.Printf("[FFmpeg] Warning: Failed to embed metadata: %v\n", err)
			} else {
				fmt.Printf("[FFmpeg] Metadata embedded successfully\n")
			}

			if lyrics != "" {
				if err := EmbedLyricsOnlyUniversal(outputFile, lyrics); err != nil {
					fmt.Printf("[FFmpeg] Warning: Failed to embed lyrics: %v\n", err)
				} else {
					fmt.Printf("[FFmpeg] Lyrics embedded successfully\n")
				}
			}

			if coverArtPath != "" {
				os.Remove(coverArtPath)
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

type AudioFileInfo struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Format   string `json:"format"`
	Size     int64  `json:"size"`
}

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
