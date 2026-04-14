package backend

import "strings"

func ResolveTrackISRC(spotifyTrackID string) string {
	spotifyTrackID = strings.TrimSpace(spotifyTrackID)
	if spotifyTrackID == "" {
		return ""
	}

	if cachedISRC, err := GetCachedISRC(spotifyTrackID); err == nil && cachedISRC != "" {
		return strings.ToUpper(strings.TrimSpace(cachedISRC))
	}

	client := NewSongLinkClient()
	isrc, err := client.GetISRCDirect(spotifyTrackID)
	if err != nil {
		return ""
	}

	return strings.ToUpper(strings.TrimSpace(isrc))
}
