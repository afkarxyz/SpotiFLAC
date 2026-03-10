package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var AppVersion = "Unknown"

const musicBrainzAPIBase = "https://musicbrainz.org/ws/2"

type MusicBrainzRecordingResponse struct {
	Recordings []struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Length   int    `json:"length"`
		Releases []struct {
			ID           string `json:"id"`
			Title        string `json:"title"`
			Status       string `json:"status"`
			ReleaseGroup struct {
				ID          string `json:"id"`
				Title       string `json:"title"`
				PrimaryType string `json:"primary-type"`
			} `json:"release-group"`
			Date    string `json:"date"`
			Country string `json:"country"`
			Media   []struct {
				Format string `json:"format"`
			} `json:"media"`
			LabelInfo []struct {
				Label struct {
					Name string `json:"name"`
				} `json:"label"`
			} `json:"label-info"`
		} `json:"releases"`
		ArtistCredit []struct {
			Artist struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"artist-credit"`
		Tags []struct {
			Count int    `json:"count"`
			Name  string `json:"name"`
		} `json:"tags"`
	} `json:"recordings"`
}

func FetchMusicBrainzMetadata(isrc, title, artist, album string, useSingleGenre bool, embedGenre bool) (Metadata, error) {
	var meta Metadata

	if !embedGenre {
		return meta, nil
	}

	if isrc == "" {
		return meta, fmt.Errorf("no ISRC provided")
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	query := fmt.Sprintf("isrc:%s", isrc)
	reqURL := fmt.Sprintf("%s/recording?query=%s&fmt=json&inc=releases+artist-credits+tags+media+release-groups+labels", musicBrainzAPIBase, url.QueryEscape(query))

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return meta, err
	}

	req.Header.Set("User-Agent", fmt.Sprintf("SpotiFLAC/%s ( support@exyezed.cc )", AppVersion))

	var resp *http.Response
	var lastErr error

	for i := 0; i < 3; i++ {
		resp, lastErr = client.Do(req)
		if lastErr == nil && resp.StatusCode == http.StatusOK {
			break
		}

		if resp != nil {
			resp.Body.Close()
		}

		if i < 2 {
			time.Sleep(2 * time.Second)
		}
	}

	if lastErr != nil {
		return meta, lastErr
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return meta, fmt.Errorf("MusicBrainz API returned status: %d", resp.StatusCode)
	}
	defer resp.Body.Close()

	var mbResp MusicBrainzRecordingResponse
	if err := json.NewDecoder(resp.Body).Decode(&mbResp); err != nil {
		return meta, err
	}

	if len(mbResp.Recordings) == 0 {
		return meta, fmt.Errorf("no recordings found for ISRC: %s", isrc)
	}

	recording := mbResp.Recordings[0]

	var genres []string
	caser := cases.Title(language.English)

	if useSingleGenre {

		maxCount := -1
		var bestTag string

		for _, tag := range recording.Tags {
			if tag.Count > maxCount {
				maxCount = tag.Count
				bestTag = tag.Name
			}
		}

		if bestTag != "" {
			meta.Genre = caser.String(bestTag)
		}
	} else {
		for _, tag := range recording.Tags {

			genres = append(genres, caser.String(tag.Name))
		}
		if len(genres) > 0 {

			if len(genres) > 5 {
				genres = genres[:5]
			}
			meta.Genre = strings.Join(genres, GetSeparator())
		}
	}

	return meta, nil
}
