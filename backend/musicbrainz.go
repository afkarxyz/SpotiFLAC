package backend

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var AppVersion = "Unknown"

const (
	musicBrainzAPIBase               = "https://musicbrainz.org/ws/2"
	musicBrainzRequestTimeout        = 10 * time.Second
	musicBrainzRequestRetries        = 3
	musicBrainzRequestRetryWait      = 3 * time.Second
	musicBrainzMinRequestInterval    = 1100 * time.Millisecond
	musicBrainzThrottleCooldownOn503 = 5 * time.Second
)

type musicBrainzStatusError struct {
	StatusCode int
}

func (e *musicBrainzStatusError) Error() string {
	return fmt.Sprintf("MusicBrainz API returned status: %d", e.StatusCode)
}

type musicBrainzInflightCall struct {
	done   chan struct{}
	result Metadata
	err    error
}

var (
	musicBrainzCache      sync.Map
	musicBrainzInflightMu sync.Mutex
	musicBrainzInflight   = make(map[string]*musicBrainzInflightCall)

	musicBrainzThrottleMu  sync.Mutex
	musicBrainzNextRequest time.Time
	musicBrainzBlockedTill time.Time
)

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

func musicBrainzCacheKey(isrc string, useSingleGenre bool) string {
	separator := strings.TrimSpace(GetSeparator())
	if separator == "" {
		separator = ";"
	}

	return strings.ToUpper(strings.TrimSpace(isrc)) + "|" + fmt.Sprintf("%t", useSingleGenre) + "|" + separator
}

func waitForMusicBrainzRequestSlot() {
	musicBrainzThrottleMu.Lock()

	readyAt := musicBrainzNextRequest
	if musicBrainzBlockedTill.After(readyAt) {
		readyAt = musicBrainzBlockedTill
	}

	now := time.Now()
	if readyAt.Before(now) {
		readyAt = now
	}

	musicBrainzNextRequest = readyAt.Add(musicBrainzMinRequestInterval)
	waitDuration := time.Until(readyAt)

	musicBrainzThrottleMu.Unlock()

	if waitDuration > 0 {
		time.Sleep(waitDuration)
	}
}

func noteMusicBrainzThrottle() {
	musicBrainzThrottleMu.Lock()
	defer musicBrainzThrottleMu.Unlock()

	cooldownUntil := time.Now().Add(musicBrainzThrottleCooldownOn503)
	if cooldownUntil.After(musicBrainzBlockedTill) {
		musicBrainzBlockedTill = cooldownUntil
	}
	if musicBrainzNextRequest.Before(musicBrainzBlockedTill) {
		musicBrainzNextRequest = musicBrainzBlockedTill
	}
}

func shouldRetryMusicBrainzRequest(err error) bool {
	if err == nil {
		return false
	}

	statusErr, ok := err.(*musicBrainzStatusError)
	if !ok {
		return true
	}

	return statusErr.StatusCode == http.StatusServiceUnavailable || statusErr.StatusCode >= http.StatusInternalServerError
}

func queryMusicBrainzRecordings(client *http.Client, query string) (*MusicBrainzRecordingResponse, error) {
	reqURL := fmt.Sprintf("%s/recording?query=%s&fmt=json&inc=releases+artist-credits+tags+media+release-groups+labels", musicBrainzAPIBase, url.QueryEscape(query))

	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", fmt.Sprintf("SpotiFLAC/%s ( hi@afkarxyz.qzz.io )", AppVersion))
	req.Header.Set("Accept", "application/json")

	var lastErr error
	for attempt := 0; attempt < musicBrainzRequestRetries; attempt++ {
		waitForMusicBrainzRequestSlot()

		resp, err := client.Do(req)
		if err == nil && resp != nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()

			var mbResp MusicBrainzRecordingResponse
			if decodeErr := json.NewDecoder(resp.Body).Decode(&mbResp); decodeErr != nil {
				return nil, decodeErr
			}

			return &mbResp, nil
		}

		if err != nil {
			lastErr = err
		} else if resp == nil {
			lastErr = fmt.Errorf("empty response from MusicBrainz")
		} else {
			if resp.StatusCode == http.StatusServiceUnavailable {
				noteMusicBrainzThrottle()
			}
			lastErr = &musicBrainzStatusError{StatusCode: resp.StatusCode}
			resp.Body.Close()
		}

		if attempt < musicBrainzRequestRetries-1 && shouldRetryMusicBrainzRequest(lastErr) {
			time.Sleep(musicBrainzRequestRetryWait)
			continue
		}

		break
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("empty response from MusicBrainz")
	}

	return nil, lastErr
}

func FetchMusicBrainzMetadata(isrc, title, artist, album string, useSingleGenre bool, embedGenre bool) (Metadata, error) {
	var meta Metadata
	var resultErr error

	if !embedGenre {
		return meta, nil
	}

	if isrc == "" {
		resultErr = fmt.Errorf("no ISRC provided")
		return meta, resultErr
	}

	cacheKey := musicBrainzCacheKey(isrc, useSingleGenre)
	if cached, ok := musicBrainzCache.Load(cacheKey); ok {
		return cached.(Metadata), nil
	}

	musicBrainzInflightMu.Lock()
	if call, ok := musicBrainzInflight[cacheKey]; ok {
		musicBrainzInflightMu.Unlock()
		<-call.done
		return call.result, call.err
	}

	call := &musicBrainzInflightCall{done: make(chan struct{})}
	musicBrainzInflight[cacheKey] = call
	musicBrainzInflightMu.Unlock()

	defer func() {
		call.result = meta
		call.err = resultErr

		musicBrainzInflightMu.Lock()
		delete(musicBrainzInflight, cacheKey)
		close(call.done)
		musicBrainzInflightMu.Unlock()
	}()

	client := &http.Client{
		Timeout: musicBrainzRequestTimeout,
	}

	query := fmt.Sprintf("isrc:%s", isrc)
	mbResp, err := queryMusicBrainzRecordings(client, query)
	if err != nil {
		resultErr = err
		return meta, resultErr
	}

	if len(mbResp.Recordings) == 0 {
		resultErr = fmt.Errorf("no recordings found for ISRC: %s", isrc)
		return meta, resultErr
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

	if meta.Genre == "" {
		resultErr = fmt.Errorf("no genre tags found in MusicBrainz")
		return meta, resultErr
	}

	musicBrainzCache.Store(cacheKey, meta)

	return meta, nil
}
