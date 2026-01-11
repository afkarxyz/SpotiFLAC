package backend

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	spotifySize300 = "ab67616d00001e02"
	spotifySize640 = "ab67616d0000b273"
	spotifySizeMax = "ab67616d000082c1"
)

type CoverDownloadRequest struct {
	CoverURL       string `json:"cover_url"`
	TrackName      string `json:"track_name"`
	ArtistName     string `json:"artist_name"`
	AlbumName      string `json:"album_name"`
	AlbumArtist    string `json:"album_artist"`
	ReleaseDate    string `json:"release_date"`
	OutputDir      string `json:"output_dir"`
	FilenameFormat string `json:"filename_format"`
	TrackNumber    bool   `json:"track_number"`
	Position       int    `json:"position"`
	DiscNumber     int    `json:"disc_number"`
}

type CoverDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

type HeaderDownloadRequest struct {
	HeaderURL  string `json:"header_url"`
	ArtistName string `json:"artist_name"`
	OutputDir  string `json:"output_dir"`
}

type HeaderDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

type CoverClient struct {
	httpClient *http.Client
}

func NewCoverClient() *CoverClient {
	return &CoverClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func buildCoverFilename(trackName, artistName, albumName, albumArtist, releaseDate, filenameFormat string, includeTrackNumber bool, position, discNumber int) string {
	safeTitle := sanitizeFilename(trackName)
	safeArtist := sanitizeFilename(artistName)
	safeAlbum := sanitizeFilename(albumName)
	safeAlbumArtist := sanitizeFilename(albumArtist)

	year := ""
	if len(releaseDate) >= 4 {
		year = releaseDate[:4]
	}

	var filename string

	if strings.Contains(filenameFormat, "{") {
		filename = filenameFormat
		filename = strings.ReplaceAll(filename, "{title}", safeTitle)
		filename = strings.ReplaceAll(filename, "{artist}", safeArtist)
		filename = strings.ReplaceAll(filename, "{album}", safeAlbum)
		filename = strings.ReplaceAll(filename, "{album_artist}", safeAlbumArtist)
		filename = strings.ReplaceAll(filename, "{year}", year)

		if discNumber > 0 {
			filename = strings.ReplaceAll(filename, "{disc}", fmt.Sprintf("%d", discNumber))
		} else {
			filename = strings.ReplaceAll(filename, "{disc}", "")
		}

		if position > 0 {
			filename = strings.ReplaceAll(filename, "{track}", fmt.Sprintf("%02d", position))
		} else {

			filename = regexp.MustCompile(`\{track\}\.\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*-\s*`).ReplaceAllString(filename, "")
			filename = regexp.MustCompile(`\{track\}\s*`).ReplaceAllString(filename, "")
		}
	} else {

		switch filenameFormat {
		case "artist-title":
			filename = fmt.Sprintf("%s - %s", safeArtist, safeTitle)
		case "title-artist":
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		case "title":
			filename = safeTitle
		default:
			filename = fmt.Sprintf("%s - %s", safeTitle, safeArtist)
		}

		if includeTrackNumber && position > 0 {
			filename = fmt.Sprintf("%02d - %s", position, filename)
		}
	}

	return filename + ".cover.jpg"
}

func convertSmallToMedium(imageURL string) string {
	if strings.Contains(imageURL, spotifySize300) {
		return strings.Replace(imageURL, spotifySize300, spotifySize640, 1)
	}
	return imageURL
}

func (c *CoverClient) getMaxResolutionURL(imageURL string) string {

	mediumURL := convertSmallToMedium(imageURL)
	if strings.Contains(mediumURL, spotifySize640) {
		return strings.Replace(mediumURL, spotifySize640, spotifySizeMax, 1)
	}
	return mediumURL
}

func (c *CoverClient) DownloadCoverToPath(coverURL, outputPath string, embedMaxQualityCover bool) error {
	if coverURL == "" {
		return fmt.Errorf("cover URL is required")
	}

	downloadURL := convertSmallToMedium(coverURL)
	if embedMaxQualityCover {
		downloadURL = c.getMaxResolutionURL(downloadURL)
	}

	resp, err := c.httpClient.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("failed to download cover: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download cover: HTTP %d", resp.StatusCode)
	}

	file, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create file: %v", err)
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to write cover file: %v", err)
	}

	return nil
}

func (c *CoverClient) DownloadCover(req CoverDownloadRequest) (*CoverDownloadResponse, error) {
	if req.CoverURL == "" {
		return &CoverDownloadResponse{
			Success: false,
			Error:   "Cover URL is required",
		}, fmt.Errorf("cover URL is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create output directory: %v", err),
		}, err
	}

	filenameFormat := req.FilenameFormat
	if filenameFormat == "" {
		filenameFormat = "title-artist"
	}
	filename := buildCoverFilename(req.TrackName, req.ArtistName, req.AlbumName, req.AlbumArtist, req.ReleaseDate, filenameFormat, req.TrackNumber, req.Position, req.DiscNumber)
	filePath := filepath.Join(outputDir, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &CoverDownloadResponse{
			Success:       true,
			Message:       "Cover file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	downloadURL := c.getMaxResolutionURL(req.CoverURL)

	resp, err := c.httpClient.Get(downloadURL)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download cover: %v", err),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download cover: HTTP %d", resp.StatusCode),
		}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create file: %v", err),
		}, err
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return &CoverDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write cover file: %v", err),
		}, err
	}

	return &CoverDownloadResponse{
		Success: true,
		Message: "Cover downloaded successfully",
		File:    filePath,
	}, nil
}

func (c *CoverClient) DownloadHeader(req HeaderDownloadRequest) (*HeaderDownloadResponse, error) {
	if req.HeaderURL == "" {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   "Header URL is required",
		}, fmt.Errorf("header URL is required")
	}

	if req.ArtistName == "" {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	artistFolder := filepath.Join(outputDir, sanitizeFilename(req.ArtistName))
	if err := os.MkdirAll(artistFolder, 0755); err != nil {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create artist folder: %v", err),
		}, err
	}

	filename := sanitizeFilename(req.ArtistName) + "_Header.jpg"
	filePath := filepath.Join(artistFolder, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &HeaderDownloadResponse{
			Success:       true,
			Message:       "Header file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	resp, err := c.httpClient.Get(req.HeaderURL)
	if err != nil {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download header: %v", err),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download header: HTTP %d", resp.StatusCode),
		}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create file: %v", err),
		}, err
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return &HeaderDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write header file: %v", err),
		}, err
	}

	return &HeaderDownloadResponse{
		Success: true,
		Message: "Header downloaded successfully",
		File:    filePath,
	}, nil
}

type GalleryImageDownloadRequest struct {
	ImageURL   string `json:"image_url"`
	ArtistName string `json:"artist_name"`
	ImageIndex int    `json:"image_index"`
	OutputDir  string `json:"output_dir"`
}

type GalleryImageDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

func (c *CoverClient) DownloadGalleryImage(req GalleryImageDownloadRequest) (*GalleryImageDownloadResponse, error) {
	if req.ImageURL == "" {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   "Image URL is required",
		}, fmt.Errorf("image URL is required")
	}

	if req.ArtistName == "" {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	artistFolder := filepath.Join(outputDir, sanitizeFilename(req.ArtistName))
	if err := os.MkdirAll(artistFolder, 0755); err != nil {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create artist folder: %v", err),
		}, err
	}

	filename := sanitizeFilename(req.ArtistName) + fmt.Sprintf("_Gallery_%d.jpg", req.ImageIndex+1)
	filePath := filepath.Join(artistFolder, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &GalleryImageDownloadResponse{
			Success:       true,
			Message:       "Gallery image file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	resp, err := c.httpClient.Get(req.ImageURL)
	if err != nil {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download gallery image: %v", err),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download gallery image: HTTP %d", resp.StatusCode),
		}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create file: %v", err),
		}, err
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return &GalleryImageDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write gallery image file: %v", err),
		}, err
	}

	return &GalleryImageDownloadResponse{
		Success: true,
		Message: "Gallery image downloaded successfully",
		File:    filePath,
	}, nil
}

type AvatarDownloadRequest struct {
	AvatarURL  string `json:"avatar_url"`
	ArtistName string `json:"artist_name"`
	OutputDir  string `json:"output_dir"`
}

type AvatarDownloadResponse struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	File          string `json:"file,omitempty"`
	Error         string `json:"error,omitempty"`
	AlreadyExists bool   `json:"already_exists,omitempty"`
}

func (c *CoverClient) DownloadAvatar(req AvatarDownloadRequest) (*AvatarDownloadResponse, error) {
	if req.AvatarURL == "" {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   "Avatar URL is required",
		}, fmt.Errorf("avatar URL is required")
	}

	if req.ArtistName == "" {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   "Artist name is required",
		}, fmt.Errorf("artist name is required")
	}

	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = GetDefaultMusicPath()
	} else {
		outputDir = NormalizePath(outputDir)
	}

	artistFolder := filepath.Join(outputDir, sanitizeFilename(req.ArtistName))
	if err := os.MkdirAll(artistFolder, 0755); err != nil {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create artist folder: %v", err),
		}, err
	}

	filename := sanitizeFilename(req.ArtistName) + "_Avatar.jpg"
	filePath := filepath.Join(artistFolder, filename)

	if fileInfo, err := os.Stat(filePath); err == nil && fileInfo.Size() > 0 {
		return &AvatarDownloadResponse{
			Success:       true,
			Message:       "Avatar file already exists",
			File:          filePath,
			AlreadyExists: true,
		}, nil
	}

	resp, err := c.httpClient.Get(req.AvatarURL)
	if err != nil {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download avatar: %v", err),
		}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to download avatar: HTTP %d", resp.StatusCode),
		}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	file, err := os.Create(filePath)
	if err != nil {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to create file: %v", err),
		}, err
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return &AvatarDownloadResponse{
			Success: false,
			Error:   fmt.Sprintf("failed to write avatar file: %v", err),
		}, err
	}

	return &AvatarDownloadResponse{
		Success: true,
		Message: "Avatar downloaded successfully",
		File:    filePath,
	}, nil
}
