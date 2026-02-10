package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type SendNowResponse []struct {
	FileCode string `json:"file_code"`
}

func UploadToSendNow(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	return uploadToService(filepath.Base(filePath), file)
}

func UploadBytesToSendNow(filename string, data []byte) (string, error) {
	return uploadToService(filename, bytes.NewReader(data))
}

func uploadToService(filename string, fileReader io.Reader) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fields := map[string]string{
		"sess_id":          "",
		"utype":            "anon",
		"hidden":           "",
		"enableemail":      "",
		"link_rcpt":        "",
		"link_pass":        "",
		"file_expire_time": "",
		"file_expire_unit": "DAY",
		"file_max_dl":      "1",
		"file_public":      "1",
		"keepalive":        "1",
	}

	for key, val := range fields {
		if err := writer.WriteField(key, val); err != nil {
			return "", err
		}
	}

	part, err := writer.CreateFormFile("file_0", filename)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, fileReader); err != nil {
		return "", err
	}

	writer.Close()

	uploadURL, err := getUploadURL()
	if err != nil {
		return "", fmt.Errorf("failed to get upload server: %v", err)
	}

	req, err := http.NewRequest("POST", uploadURL, body)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")
	req.Header.Set("Origin", "https://send.now")
	req.Header.Set("Referer", "https://send.now/")
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("server error %d: %s", resp.StatusCode, string(respBytes))
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result SendNowResponse
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %v, raw: %s", err, string(respBytes))
	}

	if len(result) == 0 || result[0].FileCode == "" {
		return "", fmt.Errorf("invalid response format")
	}

	fileCode := result[0].FileCode
	downloadLink := fmt.Sprintf("https://send.now/%s", fileCode)

	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".mp4" || ext == ".mov" || ext == ".mkv" || ext == ".webm" || ext == ".avi" {
		return fmt.Sprintf("[Video](%s)", downloadLink), nil
	}

	return fetchDirectImageLink(downloadLink)
}

func getUploadURL() (string, error) {
	req, err := http.NewRequest("GET", "https://send.now/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("failed to fetch main page: status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	body := string(bodyBytes)

	re := regexp.MustCompile(`action=["'](https://[^"']+/cgi-bin/upload\.cgi\?upload_type=file[^"']*)["']`)
	matches := re.FindStringSubmatch(body)
	if len(matches) > 1 {
		return matches[1], nil
	}

	reFallback := regexp.MustCompile(`action=["'](https://[^"']+/cgi-bin/upload\.cgi)`)
	matchesFallback := reFallback.FindStringSubmatch(body)
	if len(matchesFallback) > 1 {
		return matchesFallback[1] + "?upload_type=file&utype=anon", nil
	}

	return "", fmt.Errorf("upload URL not found in main page")
}

func fetchDirectImageLink(url string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	htmlBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	htmlStr := string(htmlBytes)

	reFullRes := regexp.MustCompile(`(?i)<a[^>]+href=["']([^"']+)["'][^>]*title=["']Open image on new tab["']`)
	matchesFull := reFullRes.FindStringSubmatch(htmlStr)
	if len(matchesFull) > 1 {
		return fmt.Sprintf("![image](%s)", matchesFull[1]), nil
	}

	reClipboard := regexp.MustCompile(`(?s)data-clipboard-text=['"]<a href="[^"]+".*?><img src="([^"]+)"`)
	matches := reClipboard.FindStringSubmatch(htmlStr)
	if len(matches) > 1 {
		return fmt.Sprintf("![image](%s)", matches[1]), nil
	}

	reImg := regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']*?\.send\.now/i/[^"']+)["']`)
	matchesImg := reImg.FindStringSubmatch(htmlStr)
	if len(matchesImg) > 1 {
		return fmt.Sprintf("![image](%s)", matchesImg[1]), nil
	}

	reAnchor := regexp.MustCompile(`(?i)<a[^>]+href=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["']`)
	matchesAnchor := reAnchor.FindStringSubmatch(htmlStr)
	if len(matchesAnchor) > 1 {
		return fmt.Sprintf("![image](%s)", matchesAnchor[1]), nil
	}

	reGeneric := regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["']`)
	matchesGeneric := reGeneric.FindAllStringSubmatch(htmlStr, -1)
	for _, match := range matchesGeneric {
		if len(match) > 1 {
			link := match[1]

			if !regexp.MustCompile(`(?i)(logo|icon|button|assets)`).MatchString(filepath.Base(link)) {
				return fmt.Sprintf("![image](%s)", link), nil
			}
		}
	}

	return fmt.Sprintf("[View File](%s)", url), nil
}
