package backend

import (
	"fmt"
	"math"
	"os"

	"github.com/go-flac/go-flac"
	mewflac "github.com/mewkiz/flac"
)

// AnalysisResult contains the audio analysis data
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

// AnalyzeTrack performs audio analysis on a FLAC file
func AnalyzeTrack(filepath string) (*AnalysisResult, error) {
	if !fileExists(filepath) {
		return nil, fmt.Errorf("file does not exist: %s", filepath)
	}

	// Get file size
	fileInfo, err := os.Stat(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	// Parse FLAC file
	f, err := flac.ParseFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	result := &AnalysisResult{
		FilePath: filepath,
		FileSize: fileInfo.Size(),
	}

	// Extract basic audio properties from STREAMINFO block
	if len(f.Meta) > 0 {
		streamInfo := f.Meta[0]
		if streamInfo.Type == flac.StreamInfo {
			// Read STREAMINFO data
			data := streamInfo.Data
			if len(data) >= 18 {
				// Sample rate (bits 10-29 of bytes 10-13)
				result.SampleRate = uint32(data[10])<<12 | uint32(data[11])<<4 | uint32(data[12])>>4

				// Channels (bits 30-32 of byte 12)
				result.Channels = ((data[12] >> 1) & 0x07) + 1

				// Bits per sample (bits 33-37 of bytes 12-13)
				result.BitsPerSample = ((data[12]&0x01)<<4 | data[13]>>4) + 1

				// Total samples (bits 38-73 of bytes 13-17)
				result.TotalSamples = uint64(data[13]&0x0F)<<32 |
					uint64(data[14])<<24 |
					uint64(data[15])<<16 |
					uint64(data[16])<<8 |
					uint64(data[17])

				// Calculate duration
				if result.SampleRate > 0 {
					result.Duration = float64(result.TotalSamples) / float64(result.SampleRate)
				}

				// Read min/max frame size and block size for additional analysis
				// Min block size (bytes 0-1)
				// Max block size (bytes 2-3)
				// These can give us hints about encoding quality
			}
		}
	}

	// Analyze spectrum and calculate real audio metrics
	spectrum, err := AnalyzeSpectrum(filepath)
	if err != nil {
		// Log error but continue
		fmt.Printf("Warning: failed to analyze spectrum: %v\n", err)
	} else {
		result.Spectrum = spectrum
		// Calculate dynamic range, peak, and RMS from decoded samples
		calculateRealAudioMetrics(result, filepath)
	}

	// Set bit depth
	result.BitDepth = fmt.Sprintf("%d-bit", result.BitsPerSample)

	return result, nil
}

// calculateRealAudioMetrics calculates actual dynamic range, peak, and RMS from decoded audio
func calculateRealAudioMetrics(result *AnalysisResult, filepath string) {
	// Decode FLAC to get actual samples
	samples, err := decodeFLACForMetrics(filepath)
	if err != nil {
		return
	}

	// Calculate peak amplitude
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

	// Convert peak to dB (reference: 1.0 = 0 dBFS)
	peakDB := 20.0 * math.Log10(peak)
	result.PeakAmplitude = peakDB

	// Calculate RMS (Root Mean Square)
	rms := math.Sqrt(sumSquares / float64(len(samples)))
	rmsDB := 20.0 * math.Log10(rms)
	result.RMSLevel = rmsDB

	// Dynamic range is the difference between peak and RMS
	result.DynamicRange = peakDB - rmsDB
}

// decodeFLACForMetrics decodes FLAC file and returns normalized samples for metric calculation
func decodeFLACForMetrics(filepath string) ([]float64, error) {
	stream, err := mewflac.ParseFile(filepath)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	// Limit samples to prevent memory issues (10 million samples = ~3.8 minutes at 44.1kHz)
	maxSamples := 10000000
	samples := make([]float64, 0, maxSamples)

	// Read all audio frames
	for {
		frame, err := stream.ParseNext()
		if err != nil {
			break
		}

		// Get samples from first channel (mono or left channel)
		var channelSamples []int32
		if len(frame.Subframes) > 0 {
			channelSamples = frame.Subframes[0].Samples
		}

		// Normalize samples to -1.0 to 1.0 range
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
