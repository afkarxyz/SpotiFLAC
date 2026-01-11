package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	id3v2 "github.com/bogem/id3v2/v2"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

type FileInfo struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"is_dir"`
	Size     int64      `json:"size"`
	Children []FileInfo `json:"children,omitempty"`
}

type AudioMetadata struct {
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	AlbumArtist string `json:"album_artist"`
	TrackNumber int    `json:"track_number"`
	DiscNumber  int    `json:"disc_number"`
	Year        string `json:"year"`
}

type RenamePreview struct {
	OldPath  string        `json:"old_path"`
	OldName  string        `json:"old_name"`
	NewName  string        `json:"new_name"`
	NewPath  string        `json:"new_path"`
	Error    string        `json:"error,omitempty"`
	Metadata AudioMetadata `json:"metadata"`
}

type RenameResult struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func ListDirectory(dirPath string) ([]FileInfo, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	var result []FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fileInfo := FileInfo{
			Name:  entry.Name(),
			Path:  filepath.Join(dirPath, entry.Name()),
			IsDir: entry.IsDir(),
			Size:  info.Size(),
		}

		if entry.IsDir() {
			children, err := ListDirectory(fileInfo.Path)
			if err == nil {
				fileInfo.Children = children
			}
		}

		result = append(result, fileInfo)
	}

	return result, nil
}

func ListAudioFiles(dirPath string) ([]FileInfo, error) {
	var result []FileInfo

	err := filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".flac" || ext == ".mp3" || ext == ".m4a" {
			result = append(result, FileInfo{
				Name:  info.Name(),
				Path:  path,
				IsDir: false,
				Size:  info.Size(),
			})
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	return result, nil
}

func ReadAudioMetadata(filePath string) (*AudioMetadata, error) {
	if !fileExists(filePath) {
		return nil, fmt.Errorf("file does not exist")
	}

	ext := strings.ToLower(filepath.Ext(filePath))

	switch ext {
	case ".flac":
		return readFlacMetadata(filePath)
	case ".mp3":
		return readMp3Metadata(filePath)
	case ".m4a":
		return readM4aMetadata(filePath)
	default:
		return nil, fmt.Errorf("unsupported file format: %s", ext)
	}
}

func readFlacMetadata(filePath string) (*AudioMetadata, error) {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	metadata := &AudioMetadata{}

	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			for _, comment := range cmt.Comments {
				parts := strings.SplitN(comment, "=", 2)
				if len(parts) != 2 {
					continue
				}

				fieldName := strings.ToUpper(parts[0])
				value := parts[1]

				switch fieldName {
				case "TITLE":
					metadata.Title = value
				case "ARTIST":
					metadata.Artist = value
				case "ALBUM":
					metadata.Album = value
				case "ALBUMARTIST":
					metadata.AlbumArtist = value
				case "TRACKNUMBER":
					if num, err := strconv.Atoi(value); err == nil {
						metadata.TrackNumber = num
					}
				case "DISCNUMBER":
					if num, err := strconv.Atoi(value); err == nil {
						metadata.DiscNumber = num
					}
				case "DATE", "YEAR":
					metadata.Year = value
				}
			}
		}
	}

	return metadata, nil
}

func readMp3Metadata(filePath string) (*AudioMetadata, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return nil, fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	metadata := &AudioMetadata{
		Title:  tag.Title(),
		Artist: tag.Artist(),
		Album:  tag.Album(),
		Year:   tag.Year(),
	}

	if frames := tag.GetFrames("TPE2"); len(frames) > 0 {
		if textFrame, ok := frames[0].(id3v2.TextFrame); ok {
			metadata.AlbumArtist = textFrame.Text
		}
	}

	if frames := tag.GetFrames(tag.CommonID("Track number/Position in set")); len(frames) > 0 {
		if textFrame, ok := frames[0].(id3v2.TextFrame); ok {
			trackStr := strings.Split(textFrame.Text, "/")[0]
			if num, err := strconv.Atoi(trackStr); err == nil {
				metadata.TrackNumber = num
			}
		}
	}

	if frames := tag.GetFrames(tag.CommonID("Part of a set")); len(frames) > 0 {
		if textFrame, ok := frames[0].(id3v2.TextFrame); ok {
			discStr := strings.Split(textFrame.Text, "/")[0]
			if num, err := strconv.Atoi(discStr); err == nil {
				metadata.DiscNumber = num
			}
		}
	}

	return metadata, nil
}

func readMetadataWithFFprobe(filePath string) (*AudioMetadata, error) {
	ffprobePath, err := GetFFprobePath()
	if err != nil {
		return nil, err
	}

	if err := ValidateExecutable(ffprobePath); err != nil {
		return nil, fmt.Errorf("invalid ffprobe executable: %w", err)
	}

	cmd := exec.Command(ffprobePath,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		filePath,
	)

	setHideWindow(cmd)

	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var result struct {
		Format struct {
			Tags map[string]string `json:"tags"`
		} `json:"format"`
		Streams []struct {
			Tags map[string]string `json:"tags"`
		} `json:"streams"`
	}

	if err := json.Unmarshal(output, &result); err != nil {
		return nil, err
	}

	metadata := &AudioMetadata{}

	allTags := make(map[string]string)

	for _, stream := range result.Streams {
		for key, value := range stream.Tags {
			allTags[strings.ToLower(key)] = value
		}
	}

	for key, value := range result.Format.Tags {
		allTags[strings.ToLower(key)] = value
	}

	for key, value := range allTags {
		switch key {
		case "title":
			metadata.Title = value
		case "artist":
			metadata.Artist = value
		case "album":
			metadata.Album = value
		case "album_artist", "albumartist":
			metadata.AlbumArtist = value
		case "track":

			trackStr := strings.Split(value, "/")[0]
			if num, err := strconv.Atoi(trackStr); err == nil {
				metadata.TrackNumber = num
			}
		case "disc":
			discStr := strings.Split(value, "/")[0]
			if num, err := strconv.Atoi(discStr); err == nil {
				metadata.DiscNumber = num
			}
		case "date", "year":
			if metadata.Year == "" || len(value) > len(metadata.Year) {
				metadata.Year = value
			}
		}
	}

	return metadata, nil
}

func readM4aMetadata(filePath string) (*AudioMetadata, error) {
	metadata, err := readMetadataWithFFprobe(filePath)
	if err != nil {
		return &AudioMetadata{}, nil
	}
	return metadata, nil
}

func GenerateFilename(metadata *AudioMetadata, format string, ext string) string {
	if metadata == nil {
		return ""
	}

	result := format

	year := metadata.Year
	if len(year) >= 4 {
		year = year[:4]
	}

	result = strings.ReplaceAll(result, "{title}", sanitizeFilenameForRename(metadata.Title))
	result = strings.ReplaceAll(result, "{artist}", sanitizeFilenameForRename(metadata.Artist))
	result = strings.ReplaceAll(result, "{album}", sanitizeFilenameForRename(metadata.Album))
	result = strings.ReplaceAll(result, "{album_artist}", sanitizeFilenameForRename(metadata.AlbumArtist))
	result = strings.ReplaceAll(result, "{year}", sanitizeFilenameForRename(year))

	if metadata.TrackNumber > 0 {
		result = strings.ReplaceAll(result, "{track}", fmt.Sprintf("%02d", metadata.TrackNumber))
	} else {
		result = strings.ReplaceAll(result, "{track}", "")
	}

	if metadata.DiscNumber > 0 {
		result = strings.ReplaceAll(result, "{disc}", fmt.Sprintf("%d", metadata.DiscNumber))
	} else {
		result = strings.ReplaceAll(result, "{disc}", "")
	}

	result = strings.TrimSpace(result)
	result = strings.Join(strings.Fields(result), " ")

	result = strings.Trim(result, " -._")

	if result == "" {
		return ""
	}

	return result + ext
}

func sanitizeFilenameForRename(name string) string {

	invalid := []string{"<", ">", ":", "\"", "/", "\\", "|", "?", "*"}
	result := name
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, "")
	}
	return strings.TrimSpace(result)
}

func PreviewRename(files []string, format string) []RenamePreview {
	var previews []RenamePreview

	for _, filePath := range files {
		preview := RenamePreview{
			OldPath: filePath,
			OldName: filepath.Base(filePath),
		}

		metadata, err := ReadAudioMetadata(filePath)
		if err != nil {
			preview.Error = err.Error()
			previews = append(previews, preview)
			continue
		}

		preview.Metadata = *metadata

		ext := filepath.Ext(filePath)
		newName := GenerateFilename(metadata, format, ext)

		if newName == "" {
			preview.Error = "Could not generate filename (missing metadata)"
			previews = append(previews, preview)
			continue
		}

		preview.NewName = newName
		preview.NewPath = filepath.Join(filepath.Dir(filePath), newName)

		previews = append(previews, preview)
	}

	return previews
}

func GetFileSizes(files []string) map[string]int64 {
	result := make(map[string]int64)
	for _, filePath := range files {
		info, err := os.Stat(filePath)
		if err == nil {
			result[filePath] = info.Size()
		}
	}
	return result
}

func RenameFiles(files []string, format string) []RenameResult {
	var results []RenameResult

	for _, filePath := range files {
		result := RenameResult{
			OldPath: filePath,
		}

		metadata, err := ReadAudioMetadata(filePath)
		if err != nil {
			result.Error = err.Error()
			result.Success = false
			results = append(results, result)
			continue
		}

		ext := filepath.Ext(filePath)
		newName := GenerateFilename(metadata, format, ext)

		if newName == "" {
			result.Error = "Could not generate filename (missing metadata)"
			result.Success = false
			results = append(results, result)
			continue
		}

		newPath := filepath.Join(filepath.Dir(filePath), newName)
		result.NewPath = newPath

		if newPath != filePath {
			if _, err := os.Stat(newPath); err == nil {
				result.Error = "File already exists"
				result.Success = false
				results = append(results, result)
				continue
			}
		}

		if err := os.Rename(filePath, newPath); err != nil {
			result.Error = err.Error()
			result.Success = false
			results = append(results, result)
			continue
		}

		result.Success = true
		results = append(results, result)
	}

	return results
}
