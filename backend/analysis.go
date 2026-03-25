package backend

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type AnalysisResult struct {
	FilePath      string  `json:"file_path"`
	FileSize      int64   `json:"file_size"`
	SampleRate    uint32  `json:"sample_rate"`
	Channels      uint8   `json:"channels"`
	BitsPerSample uint8   `json:"bits_per_sample"`
	TotalSamples  uint64  `json:"total_samples"`
	Duration      float64 `json:"duration"`
	Bitrate       int     `json:"bit_rate"`
	BitDepth      string  `json:"bit_depth"`
	DynamicRange  float64 `json:"dynamic_range"`
	PeakAmplitude float64 `json:"peak_amplitude"`
	RMSLevel      float64 `json:"rms_level"`
}

func GetTrackMetadata(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	return GetMetadataWithFFprobe(filepath)
}

func GetMetadataWithFFprobe(filePath string) (*AnalysisResult, error) {
	ffprobePath, err := GetFFprobePath()
	if err != nil {
		return nil, err
	}

	for i := 0; i < 5; i++ {
		if f, err := os.Open(filePath); err == nil {
			f.Close()
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	args := []string{
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=sample_rate,channels,bits_per_raw_sample,bits_per_sample,duration,bit_rate",
		"-of", "default=noprint_wrappers=0",
		filePath,
	}
	cmd := exec.Command(ffprobePath, args...)
	setHideWindow(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("ffprobe failed: %v - %s", err, string(output))
	}

	infoMap := make(map[string]string)
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "=") {
			parts := strings.SplitN(line, "=", 2)
			infoMap[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}

	res := &AnalysisResult{
		FilePath: filePath,
	}

	if info, err := os.Stat(filePath); err == nil {
		res.FileSize = info.Size()
	}

	if val, ok := infoMap["sample_rate"]; ok {
		s, _ := strconv.Atoi(val)
		res.SampleRate = uint32(s)
	}
	if val, ok := infoMap["channels"]; ok {
		c, _ := strconv.Atoi(val)
		res.Channels = uint8(c)
	}
	if val, ok := infoMap["duration"]; ok {
		d, _ := strconv.ParseFloat(val, 64)
		res.Duration = d
	}
	if val, ok := infoMap["bit_rate"]; ok && val != "N/A" {
		br, _ := strconv.Atoi(val)
		res.Bitrate = br
	}

	bits := 0
	if val, ok := infoMap["bits_per_raw_sample"]; ok && val != "N/A" {
		bits, _ = strconv.Atoi(val)
	}
	if bits == 0 {
		if val, ok := infoMap["bits_per_sample"]; ok && val != "N/A" {
			bits, _ = strconv.Atoi(val)
		}
	}

	res.BitsPerSample = uint8(bits)
	if bits > 0 {
		res.BitDepth = fmt.Sprintf("%d-bit", bits)
	} else {
		res.BitDepth = "Unknown"
	}

	return res, nil
}
