package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

func streamTrackListChunks(ctx context.Context, tracks []AlbumTrackMetadata, callback MetadataCallback) error {
	if callback == nil || len(tracks) == 0 {
		return nil
	}

	const chunkSize = 25
	for start := 0; start < len(tracks); start += chunkSize {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		end := start + chunkSize
		if end > len(tracks) {
			end = len(tracks)
		}

		callback(tracks[start:end])

		if end < len(tracks) {
			time.Sleep(15 * time.Millisecond)
		}
	}

	return nil
}

func GetSpotifyDataWithAPI(ctx context.Context, spotifyURL string, useAPI bool, apiBaseURL string, batch bool, delay time.Duration, separator string, callback MetadataCallback) (interface{}, error) {
	if !useAPI || apiBaseURL == "" {
		return GetFilteredSpotifyData(ctx, spotifyURL, batch, delay, separator, callback)
	}

	spotifyType, id := parseSpotifyURLToTypeAndID(spotifyURL)
	if spotifyType == "" || id == "" {
		return nil, fmt.Errorf("invalid Spotify URL: %s", spotifyURL)
	}

	if spotifyType == "artist" {
		return GetFilteredSpotifyData(ctx, spotifyURL, batch, delay, separator, callback)
	}

	apiURL := fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(apiBaseURL, "/"), spotifyType, id)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create API request: %w", err)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("SpotFetch API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("SpotFetch API error: HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read API response: %w", err)
	}

	var data interface{}

	switch spotifyType {
	case "track":
		var trackResp TrackResponse
		if err := json.Unmarshal(bodyBytes, &trackResp); err != nil {
			return nil, fmt.Errorf("failed to decode track response: %w", err)
		}
		trackID := strings.TrimSpace(trackResp.Track.SpotifyID)
		if trackID == "" {
			trackID = strings.TrimSpace(id)
		}
		if trackID != "" {
			if identifiers, _, err := lookupSpotifyTrackIdentifiersViaSpotFetchAPI(trackID, apiBaseURL); err == nil {
				if identifiers.UPC != "" {
					trackResp.Track.UPC = identifiers.UPC
				}
			}
		}
		data = trackResp
	case "album":
		var albumResp AlbumResponsePayload
		if err := json.Unmarshal(bodyBytes, &albumResp); err != nil {
			return nil, fmt.Errorf("failed to decode album response: %w", err)
		}
		data = &albumResp
		if callback != nil {
			callback(&AlbumResponsePayload{
				AlbumInfo: albumResp.AlbumInfo,
				TrackList: []AlbumTrackMetadata{},
			})
			if err := streamTrackListChunks(ctx, albumResp.TrackList, callback); err != nil {
				return nil, err
			}
		}
	case "playlist":
		var playlistResp PlaylistResponsePayload
		if err := json.Unmarshal(bodyBytes, &playlistResp); err != nil {
			return nil, fmt.Errorf("failed to decode playlist response: %w", err)
		}
		data = playlistResp
		if callback != nil {
			callback(PlaylistResponsePayload{
				PlaylistInfo: playlistResp.PlaylistInfo,
				TrackList:    []AlbumTrackMetadata{},
			})
			if err := streamTrackListChunks(ctx, playlistResp.TrackList, callback); err != nil {
				return nil, err
			}
		}
	case "artist":
		var artistResp ArtistDiscographyPayload
		if err := json.Unmarshal(bodyBytes, &artistResp); err != nil {
			return nil, fmt.Errorf("failed to decode artist response: %w", err)
		}
		data = &artistResp
		if callback != nil {
			callback(&ArtistDiscographyPayload{
				ArtistInfo: artistResp.ArtistInfo,
				AlbumList:  artistResp.AlbumList,
				TrackList:  []AlbumTrackMetadata{},
			})
			if err := streamTrackListChunks(ctx, artistResp.TrackList, callback); err != nil {
				return nil, err
			}
		}
	default:
		return nil, fmt.Errorf("unsupported Spotify type: %s", spotifyType)
	}

	if callback != nil {
		switch payload := data.(type) {
		case TrackResponse:
			t := payload.Track
			callback([]AlbumTrackMetadata{{
				SpotifyID:   t.SpotifyID,
				Artists:     t.Artists,
				Name:        t.Name,
				AlbumName:   t.AlbumName,
				AlbumArtist: t.AlbumArtist,
				DurationMS:  t.DurationMS,
				Images:      t.Images,
				ReleaseDate: t.ReleaseDate,
				TrackNumber: t.TrackNumber,
				TotalTracks: t.TotalTracks,
				DiscNumber:  t.DiscNumber,
				TotalDiscs:  t.TotalDiscs,
				ExternalURL: t.ExternalURL,
				UPC:         t.UPC,
				Plays:       t.Plays,
				PreviewURL:  t.PreviewURL,
				IsExplicit:  t.IsExplicit,
			}})
		}
	}

	return data, nil
}

func parseSpotifyURLToTypeAndID(url string) (string, string) {

	if strings.HasPrefix(url, "spotify:") {
		parts := strings.Split(url, ":")
		if len(parts) >= 3 {
			return parts[1], parts[2]
		}
	}

	re := regexp.MustCompile(`spotify\.com/(track|album|playlist|artist)/([a-zA-Z0-9]+)`)
	matches := re.FindStringSubmatch(url)
	if len(matches) == 3 {
		return matches[1], matches[2]
	}

	return "", ""
}
