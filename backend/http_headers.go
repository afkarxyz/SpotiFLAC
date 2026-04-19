package backend

import (
	"io"
	"net/http"
)

const DefaultDownloaderUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"

func NewRequestWithDefaultHeaders(method string, rawURL string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequest(method, rawURL, body)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", DefaultDownloaderUserAgent)
	req.Header.Set("Accept", "application/json, text/plain, */*")

	return req, nil
}

