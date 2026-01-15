package backend

import (
	"fmt"
	"math"
	"os"

	"github.com/go-flac/go-flac"
	mewflac "github.com/mewkiz/flac"
)

type AnalysisResult struct {
	FilePath      string        `json:"file_path"`
	FileSize      int64         `json:"file_size"`
	SampleRate    uint32        `json:"sample_rate"`
	Channels      uint8         `json:"channels"`
	BitsPerSample uint8         `json:"bits_per_sample"`
	TotalSamples  uint64        `json:"total_samples"`
	Duration      float64       `json:"duration"`
	BitDepth      string        `json:"bit_depth"`
	DynamicRange  float64       `json:"dynamic_range"`
	PeakAmplitude float64       `json:"peak_amplitude"`
	RMSLevel      float64       `json:"rms_level"`
	Spectrum      *SpectrumData `json:"spectrum,omitempty"`
}

func AnalyzeTrack(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	fileInfo, err := os.Stat(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	f, err := flac.ParseFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	result := &AnalysisResult{
		FilePath: filepath,
		FileSize: fileInfo.Size(),
	}

	if len(f.Meta) > 0 {
		streamInfo := f.Meta[0]
		if streamInfo.Type == flac.StreamInfo {

			data := streamInfo.Data
			if len(data) >= 18 {

				result.SampleRate = uint32(data[10])<<12 | uint32(data[11])<<4 | uint32(data[12])>>4

				result.Channels = ((data[12] >> 1) & 0x07) + 1

				result.BitsPerSample = ((data[12]&0x01)<<4 | data[13]>>4) + 1

				result.TotalSamples = uint64(data[13]&0x0F)<<32 |
					uint64(data[14])<<24 |
					uint64(data[15])<<16 |
					uint64(data[16])<<8 |
					uint64(data[17])

				if result.SampleRate > 0 {
					result.Duration = float64(result.TotalSamples) / float64(result.SampleRate)
				}

			}
		}
	}

	spectrum, err := AnalyzeSpectrum(filepath)
	if err != nil {

		fmt.Printf("Warning: failed to analyze spectrum: %v\n", err)
	} else {
		result.Spectrum = spectrum

		calculateRealAudioMetrics(result, filepath)
	}

	result.BitDepth = fmt.Sprintf("%d-bit", result.BitsPerSample)

	return result, nil
}

func calculateRealAudioMetrics(result *AnalysisResult, filepath string) {

	samples, err := decodeFLACForMetrics(filepath)
	if err != nil {
		return
	}

	var peak float64
	var sumSquares float64

	for _, sample := range samples {
		absVal := sample
		if absVal < 0 {
			absVal = -absVal
		}
		if absVal > peak {
			peak = absVal
		}
		sumSquares += sample * sample
	}

	peakDB := 20.0 * math.Log10(peak)
	result.PeakAmplitude = peakDB

	rms := math.Sqrt(sumSquares / float64(len(samples)))
	rmsDB := 20.0 * math.Log10(rms)
	result.RMSLevel = rmsDB

	result.DynamicRange = peakDB - rmsDB
}

func decodeFLACForMetrics(filepath string) ([]float64, error) {
	stream, err := mewflac.ParseFile(filepath)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	maxSamples := 10000000
	samples := make([]float64, 0, maxSamples)

	for {
		frame, err := stream.ParseNext()
		if err != nil {
			break
		}

		var channelSamples []int32
		if len(frame.Subframes) > 0 {
			channelSamples = frame.Subframes[0].Samples
		}

		maxVal := float64(int64(1) << (stream.Info.BitsPerSample - 1))
		for _, sample := range channelSamples {
			if len(samples) >= maxSamples {
				return samples, nil
			}
			normalized := float64(sample) / maxVal
			samples = append(samples, normalized)
		}

		if len(samples) >= maxSamples {
			break
		}
	}

	return samples, nil
}

func GetFileSize(filepath string) (int64, error) {
	info, err := os.Stat(filepath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func GetTrackMetadata(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	fileInfo, err := os.Stat(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	f, err := flac.ParseFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	result := &AnalysisResult{
		FilePath: filepath,
		FileSize: fileInfo.Size(),
	}

	if len(f.Meta) > 0 {
		streamInfo := f.Meta[0]
		if streamInfo.Type == flac.StreamInfo {
			data := streamInfo.Data
			if len(data) >= 18 {
				result.SampleRate = uint32(data[10])<<12 | uint32(data[11])<<4 | uint32(data[12])>>4
				result.BitsPerSample = ((data[12]&0x01)<<4 | data[13]>>4) + 1
				result.TotalSamples = uint64(data[13]&0x0F)<<32 |
					uint64(data[14])<<24 |
					uint64(data[15])<<16 |
					uint64(data[16])<<8 |
					uint64(data[17])

				if result.SampleRate > 0 {
					result.Duration = float64(result.TotalSamples) / float64(result.SampleRate)
				}
			}
		}
	}
	result.BitDepth = fmt.Sprintf("%d-bit", result.BitsPerSample)
	return result, nil
}
