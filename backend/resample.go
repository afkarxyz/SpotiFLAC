package backend

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// FlacInfo holds basic audio properties of a FLAC file.
type FlacInfo struct {
	Path          string `json:"path"`
	SampleRate    uint32 `json:"sample_rate"`     // e.g. 44100
	BitsPerSample uint8  `json:"bits_per_sample"` // e.g. 16, 24
}

// GetFlacInfoBatch reads sample rate and bit depth for multiple files in parallel.
func GetFlacInfoBatch(paths []string) []FlacInfo {
	results := make([]FlacInfo, len(paths))
	var wg sync.WaitGroup

	for i, path := range paths {
		wg.Add(1)
		go func(idx int, p string) {
			defer wg.Done()
			info := FlacInfo{Path: p}

			ffprobePath, err := GetFFprobePath()
			if err != nil {
				results[idx] = info
				return
			}

			args := []string{
				"-v", "error",
				"-select_streams", "a:0",
				"-show_entries", "stream=sample_rate,bits_per_raw_sample,bits_per_sample",
				"-of", "default=noprint_wrappers=0",
				p,
			}
			cmd := exec.Command(ffprobePath, args...)
			setHideWindow(cmd)
			out, err := cmd.CombinedOutput()
			if err != nil {
				results[idx] = info
				return
			}

			kvMap := make(map[string]string)
			for _, line := range strings.Split(string(out), "\n") {
				if parts := strings.SplitN(line, "=", 2); len(parts) == 2 {
					kvMap[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
				}
			}

			if v, ok := kvMap["sample_rate"]; ok {
				if s, err := strconv.Atoi(v); err == nil {
					info.SampleRate = uint32(s)
				}
			}

			bits := 0
			if v, ok := kvMap["bits_per_raw_sample"]; ok && v != "N/A" && v != "" {
				bits, _ = strconv.Atoi(v)
			}
			if bits == 0 {
				if v, ok := kvMap["bits_per_sample"]; ok && v != "N/A" && v != "" {
					bits, _ = strconv.Atoi(v)
				}
			}
			info.BitsPerSample = uint8(bits)

			results[idx] = info
		}(i, path)
	}

	wg.Wait()
	return results
}

type ResampleRequest struct {
	InputFiles []string `json:"input_files"`
	SampleRate string   `json:"sample_rate"`
	BitDepth   string   `json:"bit_depth"`
}

type ResampleResult struct {
	InputFile  string `json:"input_file"`
	OutputFile string `json:"output_file"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
}

func buildFolderLabel(sampleRate, bitDepth string) string {
	var parts []string

	if bitDepth != "" {
		parts = append(parts, bitDepth+"bit")
	}

	switch sampleRate {
	case "44100":
		parts = append(parts, "44.1kHz")
	case "48000":
		parts = append(parts, "48kHz")
	case "96000":
		parts = append(parts, "96kHz")
	case "192000":
		parts = append(parts, "192kHz")
	default:
		if sampleRate != "" {
			parts = append(parts, sampleRate+"Hz")
		}
	}

	if len(parts) == 0 {
		return "Resampled"
	}
	return strings.Join(parts, " ")
}

func ResampleAudio(req ResampleRequest) ([]ResampleResult, error) {
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

	if req.SampleRate == "" && req.BitDepth == "" {
		return nil, fmt.Errorf("at least one of sample rate or bit depth must be specified")
	}

	results := make([]ResampleResult, len(req.InputFiles))
	var wg sync.WaitGroup
	var mu sync.Mutex

	folderLabel := buildFolderLabel(req.SampleRate, req.BitDepth)

	for i, inputFile := range req.InputFiles {
		wg.Add(1)
		go func(idx int, inputFile string) {
			defer wg.Done()

			result := ResampleResult{
				InputFile: inputFile,
			}

			inputExt := strings.ToLower(filepath.Ext(inputFile))
			baseName := strings.TrimSuffix(filepath.Base(inputFile), inputExt)
			inputDir := filepath.Dir(inputFile)

			outputDir := filepath.Join(inputDir, folderLabel)
			if err := os.MkdirAll(outputDir, 0755); err != nil {
				result.Error = fmt.Sprintf("failed to create output directory: %v", err)
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			// Output is always FLAC (lossless resampling).
			outputFile := filepath.Join(outputDir, baseName+".flac")
			result.OutputFile = outputFile

			args := []string{
				"-i", inputFile,
				"-y",
			}

			if req.BitDepth != "" {
				switch req.BitDepth {
				case "16":
					args = append(args, "-c:a", "flac", "-sample_fmt", "s16")
				case "24":
					args = append(args, "-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24")
				default:
					args = append(args, "-c:a", "flac")
				}
			} else {
				args = append(args, "-c:a", "flac")
			}

			if req.SampleRate != "" {
				args = append(args, "-ar", req.SampleRate)
			}

			args = append(args, "-map_metadata", "0")
			args = append(args, outputFile)

			fmt.Printf("[Resample] %s -> %s\n", inputFile, outputFile)

			cmd := exec.Command(ffmpegPath, args...)
			setHideWindow(cmd)
			output, err := cmd.CombinedOutput()
			if err != nil {
				result.Error = fmt.Sprintf("resampling failed: %s - %s", err.Error(), string(output))
				result.Success = false
				mu.Lock()
				results[idx] = result
				mu.Unlock()
				return
			}

			result.Success = true
			fmt.Printf("[Resample] Done: %s\n", outputFile)
			mu.Lock()
			results[idx] = result
			mu.Unlock()
		}(i, inputFile)
	}

	wg.Wait()
	return results, nil
}
