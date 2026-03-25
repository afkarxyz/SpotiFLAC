package backend

import (
	"fmt"
	"math"
)

const (
	previewMaxSeconds         = 35
	previewExpectedMinSeconds = 60
	largeMismatchMinExpected  = 90
	minAllowedDurationDiff    = 15
	durationDiffRatio         = 0.25
)

func ValidateDownloadedTrackDuration(filePath string, expectedSeconds int) (bool, error) {
	if filePath == "" || expectedSeconds <= 0 {
		return false, nil
	}

	actualDuration, err := GetAudioDuration(filePath)
	if err != nil || actualDuration <= 0 {
		return false, nil
	}

	actualSeconds := int(math.Round(actualDuration))
	if actualSeconds <= 0 {
		return false, nil
	}

	if expectedSeconds >= previewExpectedMinSeconds && actualSeconds <= previewMaxSeconds {
		return true, fmt.Errorf("detected preview/sample download: file is %ds, expected about %ds. file was removed", actualSeconds, expectedSeconds)
	}

	if expectedSeconds >= largeMismatchMinExpected {
		allowedDiff := int(math.Max(minAllowedDurationDiff, math.Round(float64(expectedSeconds)*durationDiffRatio)))
		diff := int(math.Abs(float64(actualSeconds - expectedSeconds)))
		if diff > allowedDiff {
			return true, fmt.Errorf("downloaded file duration mismatch: file is %ds, expected about %ds. file was removed", actualSeconds, expectedSeconds)
		}
	}

	return true, nil
}
