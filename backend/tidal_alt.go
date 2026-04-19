package backend

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const tidalAltDownloadAPIBaseURL = "https://tidal.spotbye.qzz.io/get"

type TidalAltAPIResponse struct {
	Title string `json:"title"`
	Link  string `json:"link"`
}

func buildTidalOutputPath(outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyTrackNumber, spotifyDiscNumber int, isrcOverride string, useFirstArtistOnly bool) (string, bool, error) {
	if outputDir != "." {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return "", false, fmt.Errorf("directory error: %w", err)
		}
	}

	artistNameForFile := sanitizeFilename(spotifyArtistName)
	albumArtistForFile := sanitizeFilename(spotifyAlbumArtist)
	if useFirstArtistOnly {
		artistNameForFile = sanitizeFilename(GetFirstArtist(spotifyArtistName))
		albumArtistForFile = sanitizeFilename(GetFirstArtist(spotifyAlbumArtist))
	}

	trackTitleForFile := sanitizeFilename(spotifyTrackName)
	albumTitleForFile := sanitizeFilename(spotifyAlbumName)

	filename := buildTidalFilename(trackTitleForFile, artistNameForFile, albumTitleForFile, albumArtistForFile, spotifyReleaseDate, spotifyTrackNumber, spotifyDiscNumber, filenameFormat, includeTrackNumber, position, useAlbumTrackNumber, isrcOverride)
	outputFilename := filepath.Join(outputDir, filename)

	outputFilename, alreadyExists := ResolveOutputPathForDownload(outputFilename, GetRedownloadWithSuffixSetting())
	return outputFilename, alreadyExists, nil
}

func finalizeTidalDownload(outputFilename, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, useSingleGenre bool, embedGenre bool) {
	trackTitle := spotifyTrackName
	artistName := spotifyArtistName
	albumTitle := spotifyAlbumName

	type mbResult struct {
		ISRC     string
		Metadata Metadata
	}

	metaChan := make(chan mbResult, 1)
	if embedGenre && spotifyURL != "" {
		go func() {
			res := mbResult{}
			var isrc string
			parts := strings.Split(spotifyURL, "/")
			if len(parts) > 0 {
				sID := strings.Split(parts[len(parts)-1], "?")[0]
				if sID != "" {
					client := NewSongLinkClient()
					if val, err := client.GetISRC(sID); err == nil {
						isrc = val
					}
				}
			}
			res.ISRC = isrc
			if isrc != "" {
				if ShouldSkipMusicBrainzMetadataFetch() {
					fmt.Println("Skipping MusicBrainz metadata fetch because status check is offline.")
				} else {
					fmt.Println("Fetching MusicBrainz metadata...")
					if fetchedMeta, err := FetchMusicBrainzMetadata(isrc, trackTitle, artistName, albumTitle, useSingleGenre, embedGenre); err == nil {
						res.Metadata = fetchedMeta
						fmt.Println("✓ MusicBrainz metadata fetched")
					} else {
						fmt.Printf("Warning: Failed to fetch MusicBrainz metadata: %v\n", err)
					}
				}
			}
			metaChan <- res
		}()
	} else {
		close(metaChan)
	}

	isrc := strings.TrimSpace(isrcOverride)
	var mbMeta Metadata
	if spotifyURL != "" {
		result := <-metaChan
		if isrc == "" {
			isrc = result.ISRC
		}
		mbMeta = result.Metadata
	}

	upc := ""
	if spotifyURL != "" {
		if identifiers, err := GetSpotifyTrackIdentifiersDirect(spotifyURL); err == nil || identifiers.ISRC != "" || identifiers.UPC != "" {
			if strings.TrimSpace(isrc) == "" && strings.TrimSpace(identifiers.ISRC) != "" {
				isrc = strings.TrimSpace(identifiers.ISRC)
			}
			upc = strings.TrimSpace(identifiers.UPC)
		}
	}

	fmt.Println("Adding metadata...")

	coverPath := ""
	if spotifyCoverURL != "" {
		coverPath = outputFilename + ".cover.jpg"
		coverClient := NewCoverClient()
		if err := coverClient.DownloadCoverToPath(spotifyCoverURL, coverPath, embedMaxQualityCover); err != nil {
			fmt.Printf("Warning: Failed to download Spotify cover: %v\n", err)
			coverPath = ""
		} else {
			defer os.Remove(coverPath)
			fmt.Println("Spotify cover downloaded")
		}
	}

	trackNumberToEmbed := spotifyTrackNumber
	if trackNumberToEmbed == 0 {
		trackNumberToEmbed = 1
	}

	metadata := Metadata{
		Title:       trackTitle,
		Artist:      artistName,
		Album:       albumTitle,
		AlbumArtist: spotifyAlbumArtist,
		Date:        spotifyReleaseDate,
		TrackNumber: trackNumberToEmbed,
		TotalTracks: spotifyTotalTracks,
		DiscNumber:  spotifyDiscNumber,
		TotalDiscs:  spotifyTotalDiscs,
		URL:         spotifyURL,
		Comment:     spotifyURL,
		Copyright:   spotifyCopyright,
		Publisher:   spotifyPublisher,
		Composer:    spotifyComposer,
		Separator:   metadataSeparator,
		Description: "https://github.com/spotbye/SpotiFLAC",
		ISRC:        isrc,
		UPC:         upc,
		Genre:       mbMeta.Genre,
	}

	if err := EmbedMetadata(outputFilename, metadata, coverPath); err != nil {
		fmt.Printf("Tagging failed: %v\n", err)
	} else {
		fmt.Println("Metadata saved")
	}
}

func (t *TidalDownloader) GetAltDownloadURLFromSpotify(spotifyTrackID string) (string, error) {
	spotifyTrackID = strings.TrimSpace(spotifyTrackID)
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required")
	}

	apiURL := fmt.Sprintf("%s/%s", tidalAltDownloadAPIBaseURL, spotifyTrackID)
	fmt.Printf("Tidal Alt. API URL: %s\n", apiURL)

	req, err := NewRequestWithDefaultHeaders(http.MethodGet, apiURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create Tidal Alt. request: %w", err)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to get Tidal Alt. download URL: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read Tidal Alt. response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		preview := strings.TrimSpace(string(body))
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		return "", fmt.Errorf("Tidal Alt. returned status %d: %s", resp.StatusCode, preview)
	}

	var payload TidalAltAPIResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("failed to decode Tidal Alt. response: %w", err)
	}

	downloadURL := strings.TrimSpace(payload.Link)
	if downloadURL == "" {
		return "", fmt.Errorf("Tidal Alt. response did not include a download link")
	}

	fmt.Println("✓ Tidal Alt. download URL found")
	return downloadURL, nil
}

func (t *TidalDownloader) DownloadAlt(spotifyTrackID, outputDir, filenameFormat string, includeTrackNumber bool, position int, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate string, useAlbumTrackNumber bool, spotifyCoverURL string, embedMaxQualityCover bool, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks int, spotifyTotalDiscs int, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL string, useFirstArtistOnly bool, useSingleGenre bool, embedGenre bool) (string, error) {
	spotifyTrackID = strings.TrimSpace(spotifyTrackID)
	if spotifyTrackID == "" {
		return "", fmt.Errorf("spotify track ID is required for Tidal Alt.")
	}

	outputFilename, alreadyExists, err := buildTidalOutputPath(outputDir, filenameFormat, includeTrackNumber, position, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, useAlbumTrackNumber, spotifyTrackNumber, spotifyDiscNumber, isrcOverride, useFirstArtistOnly)
	if err != nil {
		return "", err
	}
	if alreadyExists {
		fmt.Printf("File already exists: %s (%.2f MB)\n", outputFilename, float64(mustFileSize(outputFilename))/(1024*1024))
		return "EXISTS:" + outputFilename, nil
	}

	fmt.Printf("Using Tidal Alt. for Spotify track: %s\n", spotifyTrackID)

	downloadURL, err := t.GetAltDownloadURLFromSpotify(spotifyTrackID)
	if err != nil {
		return outputFilename, err
	}

	fmt.Printf("Downloading to: %s\n", outputFilename)
	if err := t.DownloadFile(downloadURL, outputFilename); err != nil {
		cleanupTidalDownloadArtifacts(outputFilename)
		return outputFilename, err
	}

	finalizeTidalDownload(outputFilename, spotifyTrackName, spotifyArtistName, spotifyAlbumName, spotifyAlbumArtist, spotifyReleaseDate, spotifyCoverURL, embedMaxQualityCover, spotifyTrackNumber, spotifyDiscNumber, spotifyTotalTracks, spotifyTotalDiscs, spotifyCopyright, spotifyPublisher, spotifyComposer, metadataSeparator, isrcOverride, spotifyURL, useSingleGenre, embedGenre)

	fmt.Println("Done")
	fmt.Println("✓ Downloaded successfully from Tidal Alt.")
	return outputFilename, nil
}
