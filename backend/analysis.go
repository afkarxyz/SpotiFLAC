package backend

import (
	"bytes"
	"encoding/base64"
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

type AnalysisDecodeResponse struct {
	PCMBase64     string  `json:"pcm_base64"`
	SampleRate    uint32  `json:"sample_rate"`
	Channels      uint8   `json:"channels"`
	BitsPerSample uint8   `json:"bits_per_sample"`
	Duration      float64 `json:"duration"`
	BitrateKbps   int     `json:"bitrate_kbps,omitempty"`
	BitDepth      string  `json:"bit_depth,omitempty"`
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

func DecodeAudioForAnalysis(filePath string) (*AnalysisDecodeResponse, error) {
	metadata, err := GetTrackMetadata(filePath)
	if err != nil {
		return nil, err
	}

	pcmBase64, err := extractAnalysisPCMBase64(filePath)
	if err != nil {
		return nil, err
	}

	resp := &AnalysisDecodeResponse{
		PCMBase64:     pcmBase64,
		SampleRate:    metadata.SampleRate,
		Channels:      metadata.Channels,
		BitsPerSample: metadata.BitsPerSample,
		Duration:      metadata.Duration,
		BitDepth:      metadata.BitDepth,
	}

	if metadata.Bitrate > 0 {
		resp.BitrateKbps = metadata.Bitrate / 1000
	}

	return resp, nil
}

func extractAnalysisPCMBase64(filePath string) (string, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return "", err
	}

	argSets := [][]string{
		{
			"-v", "error",
			"-i", filePath,
			"-vn",
			"-map", "0:a:0",
			"-af", "pan=mono|c0=c0",
			"-f", "s16le",
			"-acodec", "pcm_s16le",
			"pipe:1",
		},
		{
			"-v", "error",
			"-i", filePath,
			"-vn",
			"-map", "0:a:0",
			"-ac", "1",
			"-f", "s16le",
			"-acodec", "pcm_s16le",
			"pipe:1",
		},
	}

	var lastErr error

	for _, args := range argSets {
		var stdout bytes.Buffer
		var stderr bytes.Buffer

		cmd := exec.Command(ffmpegPath, args...)
		setHideWindow(cmd)
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			lastErr = fmt.Errorf("ffmpeg analysis decode failed: %w - %s", err, strings.TrimSpace(stderr.String()))
			continue
		}

		if stdout.Len() == 0 {
			lastErr = fmt.Errorf("ffmpeg analysis decode returned empty PCM output")
			continue
		}

		return base64.StdEncoding.EncodeToString(stdout.Bytes()), nil
	}

	if lastErr != nil {
		return "", lastErr
	}

	return "", fmt.Errorf("ffmpeg analysis decode failed")
}
