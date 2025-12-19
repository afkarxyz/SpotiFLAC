package backend

import (
	"fmt"
	"os"
	"os/exec"
	pathfilepath "path/filepath"
	"strconv"
	"strings"
	"sync"

	id3v2 "github.com/bogem/id3v2/v2"
	"github.com/go-flac/flacpicture"
	"github.com/go-flac/flacvorbis"
	"github.com/go-flac/go-flac"
)

type Metadata struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Date        string // Recorded date (full date YYYY-MM-DD)
	ReleaseDate string // Release date (full date) - kept for compatibility
	TrackNumber int
	TotalTracks int // Total tracks in album
	DiscNumber  int
	ISRC        string
	Lyrics      string
	Description string
}

func EmbedMetadata(filepath string, metadata Metadata, coverPath string) error {
	f, err := flac.ParseFile(filepath)
	if err != nil {
		return fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	var cmtIdx = -1
	for idx, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmtIdx = idx
			break
		}
	}

	cmt := flacvorbis.New()

	if metadata.Title != "" {
		_ = cmt.Add(flacvorbis.FIELD_TITLE, metadata.Title)
	}
	if metadata.Artist != "" {
		_ = cmt.Add(flacvorbis.FIELD_ARTIST, metadata.Artist)
	}
	if metadata.Album != "" {
		_ = cmt.Add(flacvorbis.FIELD_ALBUM, metadata.Album)
	}
	if metadata.AlbumArtist != "" {
		_ = cmt.Add("ALBUMARTIST", metadata.AlbumArtist)
	}
	if metadata.Date != "" {
		_ = cmt.Add(flacvorbis.FIELD_DATE, metadata.Date)
	}
	if metadata.TrackNumber > 0 {
		_ = cmt.Add(flacvorbis.FIELD_TRACKNUMBER, strconv.Itoa(metadata.TrackNumber))
	}
	if metadata.TotalTracks > 0 {
		_ = cmt.Add("TOTALTRACKS", strconv.Itoa(metadata.TotalTracks))
	}
	if metadata.DiscNumber > 0 {
		_ = cmt.Add("DISCNUMBER", strconv.Itoa(metadata.DiscNumber))
	}
	if metadata.ISRC != "" {
		_ = cmt.Add(flacvorbis.FIELD_ISRC, metadata.ISRC)
	}
	if metadata.Description != "" {
		_ = cmt.Add("DESCRIPTION", metadata.Description)
	}
	// Lyrics is added last to keep it at the bottom
	if metadata.Lyrics != "" {
		_ = cmt.Add("LYRICS", metadata.Lyrics) // Or "UNSYNCEDLYRICS" for unsynced
	}

	cmtBlock := cmt.Marshal()
	if cmtIdx < 0 {
		f.Meta = append(f.Meta, &cmtBlock)
	} else {
		f.Meta[cmtIdx] = &cmtBlock
	}

	if coverPath != "" && fileExists(coverPath) {
		if err := embedCoverArt(f, coverPath); err != nil {
			fmt.Printf("Warning: Failed to embed cover art: %v\n", err)
		}
	}

	if err := f.Save(filepath); err != nil {
		return fmt.Errorf("failed to save FLAC file: %w", err)
	}

	return nil
}

func embedCoverArt(f *flac.File, coverPath string) error {
	imgData, err := os.ReadFile(coverPath)
	if err != nil {
		return fmt.Errorf("failed to read cover image: %w", err)
	}

	picture, err := flacpicture.NewFromImageData(
		flacpicture.PictureTypeFrontCover,
		"Cover",
		imgData,
		"image/jpeg",
	)
	if err != nil {
		return fmt.Errorf("failed to create picture block: %w", err)
	}

	pictureBlock := picture.Marshal()

	for i := len(f.Meta) - 1; i >= 0; i-- {
		if f.Meta[i].Type == flac.Picture {
			f.Meta = append(f.Meta[:i], f.Meta[i+1:]...)
		}
	}

	f.Meta = append(f.Meta, &pictureBlock)

	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// extractYear extracts the year from a release date string
// Handles formats: "YYYY-MM-DD", "YYYY-MM", "YYYY"
func extractYear(releaseDate string) string {
	if releaseDate == "" {
		return ""
	}
	// Try to extract year (first 4 digits)
	if len(releaseDate) >= 4 {
		return releaseDate[:4]
	}
	return releaseDate
}

// EmbedLyricsOnly adds lyrics to a FLAC file while preserving existing metadata
func EmbedLyricsOnly(filepath string, lyrics string) error {
	if lyrics == "" {
		return nil
	}
	f, err := flac.ParseFile(filepath)
	if err != nil {
		return fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	var cmtIdx = -1
	var existingCmt *flacvorbis.MetaDataBlockVorbisComment
	for idx, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmtIdx = idx
			existingCmt, err = flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				existingCmt = nil
			}
			break
		}
	}

	// Create new comment block, preserving existing comments
	cmt := flacvorbis.New()

	// Copy existing comments except LYRICS
	if existingCmt != nil {
		for _, comment := range existingCmt.Comments {
			parts := strings.SplitN(comment, "=", 2)
			if len(parts) == 2 {
				fieldName := strings.ToUpper(parts[0])
				if fieldName != "LYRICS" && fieldName != "UNSYNCEDLYRICS" && fieldName != "SYNCEDLYRICS" {
					_ = cmt.Add(parts[0], parts[1])
				}
			}
		}
	}

	// Add lyrics
	_ = cmt.Add("LYRICS", lyrics)

	cmtBlock := cmt.Marshal()
	if cmtIdx < 0 {
		f.Meta = append(f.Meta, &cmtBlock)
	} else {
		f.Meta[cmtIdx] = &cmtBlock
	}

	if err := f.Save(filepath); err != nil {
		return fmt.Errorf("failed to save FLAC file: %w", err)
	}

	return nil
}

// ReadISRCFromFile reads ISRC metadata from a FLAC file
func ReadISRCFromFile(filepath string) (string, error) {
	if !fileExists(filepath) {
		return "", fmt.Errorf("file does not exist")
	}

	f, err := flac.ParseFile(filepath)
	if err != nil {
		return "", fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	// Find VorbisComment block
	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			// Get ISRC field
			isrcValues, err := cmt.Get(flacvorbis.FIELD_ISRC)
			if err == nil && len(isrcValues) > 0 {
				return isrcValues[0], nil
			}
		}
	}

	return "", nil // No ISRC found
}

// CheckISRCExists checks if a file with the given ISRC already exists in the directory
func CheckISRCExists(outputDir string, targetISRC string) (string, bool) {
	if targetISRC == "" {
		return "", false
	}

	// Read all .flac files in directory
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return "", false
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		// Check only .flac files
		filename := entry.Name()
		if len(filename) < 5 || filename[len(filename)-5:] != ".flac" {
			continue
		}

		filepath := fmt.Sprintf("%s/%s", outputDir, filename)

		// Read ISRC from file (this will fail for corrupted files)
		isrc, err := ReadISRCFromFile(filepath)
		if err != nil {
			// File is corrupted or unreadable, delete it
			fmt.Printf("Removing corrupted/unreadable file: %s (error: %v)\n", filepath, err)
			if removeErr := os.Remove(filepath); removeErr != nil {
				fmt.Printf("Warning: Failed to remove corrupted file %s: %v\n", filepath, removeErr)
			}
			continue
		}

		// Compare ISRC (case-insensitive)
		if isrc != "" && strings.EqualFold(isrc, targetISRC) {
			return filepath, true
		}
	}

	return "", false
}

// ExtractCoverArt extracts cover art from an audio file and saves it to a temporary file
func ExtractCoverArt(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))

	switch ext {
	case ".mp3":
		return extractCoverFromMp3(filePath)
	case ".m4a", ".flac":
		return extractCoverFromM4AOrFlac(filePath)
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

// extractCoverFromMp3 extracts cover art from MP3 file
func extractCoverFromMp3(filePath string) (string, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	pictures := tag.GetFrames(tag.CommonID("Attached picture"))
	if len(pictures) == 0 {
		return "", fmt.Errorf("no cover art found")
	}

	pic, ok := pictures[0].(id3v2.PictureFrame)
	if !ok {
		return "", fmt.Errorf("invalid picture frame")
	}

	// Create temporary file
	tmpFile, err := os.CreateTemp("", "cover-*.jpg")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tmpFile.Close()

	if _, err := tmpFile.Write(pic.Picture); err != nil {
		os.Remove(tmpFile.Name())
		return "", fmt.Errorf("failed to write cover art: %w", err)
	}

	return tmpFile.Name(), nil
}

// extractCoverFromM4AOrFlac extracts cover art from M4A or FLAC file
func extractCoverFromM4AOrFlac(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))

	if ext == ".flac" {
		f, err := flac.ParseFile(filePath)
		if err != nil {
			return "", fmt.Errorf("failed to parse FLAC file: %w", err)
		}

		for _, block := range f.Meta {
			if block.Type == flac.Picture {
				pic, err := flacpicture.ParseFromMetaDataBlock(*block)
				if err != nil {
					continue
				}

				// Create temporary file
				tmpFile, err := os.CreateTemp("", "cover-*.jpg")
				if err != nil {
					return "", fmt.Errorf("failed to create temp file: %w", err)
				}
				defer tmpFile.Close()

				if _, err := tmpFile.Write(pic.ImageData); err != nil {
					os.Remove(tmpFile.Name())
					return "", fmt.Errorf("failed to write cover art: %w", err)
				}

				return tmpFile.Name(), nil
			}
		}
		return "", fmt.Errorf("no cover art found")
	}

	// For M4A, try to extract using ffmpeg or return empty
	// M4A cover art should be preserved by ffmpeg during conversion
	return "", nil
}

// ExtractLyrics extracts lyrics from an audio file
func ExtractLyrics(filePath string) (string, error) {
	ext := strings.ToLower(pathfilepath.Ext(filePath))

	switch ext {
	case ".mp3":
		return extractLyricsFromMp3(filePath)
	case ".flac":
		return extractLyricsFromFlac(filePath)
	case ".m4a":
		// M4A lyrics extraction would need different approach
		return "", nil
	default:
		return "", fmt.Errorf("unsupported file format: %s", ext)
	}
}

// extractLyricsFromMp3 extracts lyrics from MP3 file
func extractLyricsFromMp3(filePath string) (string, error) {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return "", fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	usltFrames := tag.GetFrames(tag.CommonID("Unsynchronised lyrics/text transcription"))
	if len(usltFrames) == 0 {
		fmt.Printf("[ExtractLyrics] No USLT frames found in MP3: %s\n", filePath)
		return "", nil
	}

	uslt, ok := usltFrames[0].(id3v2.UnsynchronisedLyricsFrame)
	if !ok {
		fmt.Printf("[ExtractLyrics] USLT frame type assertion failed in MP3: %s\n", filePath)
		return "", nil
	}

	if uslt.Lyrics == "" {
		fmt.Printf("[ExtractLyrics] USLT frame has empty lyrics in MP3: %s\n", filePath)
		return "", nil
	}

	fmt.Printf("[ExtractLyrics] Successfully extracted lyrics from MP3: %s (%d characters)\n", filePath, len(uslt.Lyrics))
	return uslt.Lyrics, nil
}

// extractLyricsFromFlac extracts lyrics from FLAC file
func extractLyricsFromFlac(filePath string) (string, error) {
	f, err := flac.ParseFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to parse FLAC file: %w", err)
	}

	for _, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			cmt, err := flacvorbis.ParseFromMetaDataBlock(*block)
			if err != nil {
				continue
			}

			// Search through comments for lyrics
			for _, comment := range cmt.Comments {
				parts := strings.SplitN(comment, "=", 2)
				if len(parts) == 2 {
					fieldName := strings.ToUpper(parts[0])
					if fieldName == "LYRICS" || fieldName == "UNSYNCEDLYRICS" {
						lyrics := parts[1]
						fmt.Printf("[ExtractLyrics] Successfully extracted lyrics from FLAC: %s (%d characters)\n", filePath, len(lyrics))
						return lyrics, nil
					}
				}
			}
		}
	}

	fmt.Printf("[ExtractLyrics] No lyrics found in FLAC: %s\n", filePath)
	return "", nil
}

// EmbedCoverArtOnly embeds cover art into an audio file
func EmbedCoverArtOnly(filePath string, coverPath string) error {
	if coverPath == "" || !fileExists(coverPath) {
		return nil
	}

	ext := strings.ToLower(pathfilepath.Ext(filePath))

	switch ext {
	case ".mp3":
		return embedCoverToMp3(filePath, coverPath)
	case ".m4a":
		// M4A cover art should be handled by ffmpeg during conversion
		// If not, we can try to embed using atomicparsley or similar tool
		// For now, return nil as ffmpeg should handle it
		return nil
	default:
		return fmt.Errorf("unsupported file format: %s", ext)
	}
}

// embedCoverToMp3 embeds cover art into MP3 file
func embedCoverToMp3(filePath string, coverPath string) error {
	tag, err := id3v2.Open(filePath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// Remove existing cover art
	tag.DeleteFrames(tag.CommonID("Attached picture"))

	// Read cover art
	artwork, err := os.ReadFile(coverPath)
	if err != nil {
		return fmt.Errorf("failed to read cover art: %w", err)
	}

	// Add new cover art
	pic := id3v2.PictureFrame{
		Encoding:    id3v2.EncodingUTF8,
		MimeType:    "image/jpeg",
		PictureType: id3v2.PTFrontCover,
		Description: "Front cover",
		Picture:     artwork,
	}
	tag.AddAttachedPicture(pic)

	if err := tag.Save(); err != nil {
		return fmt.Errorf("failed to save MP3 tags: %w", err)
	}

	return nil
}

// EmbedLyricsOnlyMP3 adds lyrics to an MP3 file using ID3v2 USLT frame
func EmbedLyricsOnlyMP3(filepath string, lyrics string) error {
	if lyrics == "" {
		return nil
	}

	tag, err := id3v2.Open(filepath, id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("failed to open MP3 file: %w", err)
	}
	defer tag.Close()

	// Remove existing USLT frames
	tag.DeleteFrames(tag.CommonID("Unsynchronised lyrics/text transcription"))

	// Add new USLT frame with lyrics
	// Use UTF-8 encoding for better compatibility with AIMP and other players
	usltFrame := id3v2.UnsynchronisedLyricsFrame{
		Encoding:          id3v2.EncodingUTF8, // Use UTF-8 instead of default encoding
		Language:          "eng",
		ContentDescriptor: "", // Empty descriptor for better compatibility
		Lyrics:            lyrics,
	}
	tag.AddUnsynchronisedLyricsFrame(usltFrame)

	if err := tag.Save(); err != nil {
		return fmt.Errorf("failed to save MP3 tags: %w", err)
	}

	return nil
}

// embedLyricsToM4A adds lyrics to an M4A file using ffmpeg
func embedLyricsToM4A(filepath string, lyrics string) error {
	// Use ffmpeg to embed lyrics into M4A file
	// M4A uses iTunes metadata format with atom '©lyr' for lyrics
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return fmt.Errorf("ffmpeg not found: %w", err)
	}

	// Create temporary output file with proper extension so ffmpeg can detect format
	tmpOutputFile := strings.TrimSuffix(filepath, pathfilepath.Ext(filepath)) + ".tmp" + pathfilepath.Ext(filepath)
	defer func() {
		// Only remove if file still exists (rename might have failed)
		if _, err := os.Stat(tmpOutputFile); err == nil {
			os.Remove(tmpOutputFile)
		}
	}()

	// Use ffmpeg to copy file and add lyrics metadata
	// For M4A, we need to use the correct metadata tag format and specify output format
	// Use -f ipod for M4A format (iPod format is compatible with M4A)
	cmd := exec.Command(ffmpegPath,
		"-i", filepath,
		"-map", "0",
		"-map_metadata", "0",
		"-metadata", "lyrics-eng="+lyrics,
		"-metadata", "lyrics="+lyrics,
		"-codec", "copy",
		"-f", "ipod", // Explicitly specify M4A/iPod format
		"-y", // Overwrite
		tmpOutputFile,
	)

	// Hide console window on Windows
	setHideWindow(cmd)

	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("[FFmpeg] Error embedding lyrics to M4A: %s\n", string(output))
		return fmt.Errorf("ffmpeg failed to embed lyrics: %s - %w", string(output), err)
	}

	// Replace original file with new file
	if err := os.Rename(tmpOutputFile, filepath); err != nil {
		return fmt.Errorf("failed to replace original file: %w", err)
	}

	fmt.Printf("[FFmpeg] Lyrics embedded to M4A successfully: %d characters\n", len(lyrics))
	return nil
}

// EmbedLyricsOnlyUniversal embeds lyrics to MP3, FLAC, or M4A file
func EmbedLyricsOnlyUniversal(filepath string, lyrics string) error {
	if lyrics == "" {
		return nil
	}

	ext := strings.ToLower(pathfilepath.Ext(filepath))
	switch ext {
	case ".mp3":
		return EmbedLyricsOnlyMP3(filepath, lyrics)
	case ".flac":
		return EmbedLyricsOnly(filepath, lyrics)
	case ".m4a":
		return embedLyricsToM4A(filepath, lyrics)
	default:
		return fmt.Errorf("unsupported file format for lyrics embedding: %s", ext)
	}
}

// FileExistenceResult represents the result of checking if a file exists
type FileExistenceResult struct {
	ISRC       string `json:"isrc"`
	Exists     bool   `json:"exists"`
	FilePath   string `json:"file_path,omitempty"`
	TrackName  string `json:"track_name,omitempty"`
	ArtistName string `json:"artist_name,omitempty"`
}

// CheckFilesExistParallel checks if multiple files exist in parallel
// It builds an ISRC index from the output directory once, then checks all tracks against it
func CheckFilesExistParallel(outputDir string, tracks []struct {
	ISRC       string
	TrackName  string
	ArtistName string
}) []FileExistenceResult {
	results := make([]FileExistenceResult, len(tracks))

	// Build ISRC index from output directory (scan once)
	isrcIndex := buildISRCIndex(outputDir)

	// Check each track against the index (parallel)
	var wg sync.WaitGroup
	for i, track := range tracks {
		wg.Add(1)
		go func(idx int, t struct {
			ISRC       string
			TrackName  string
			ArtistName string
		}) {
			defer wg.Done()

			result := FileExistenceResult{
				ISRC:       t.ISRC,
				TrackName:  t.TrackName,
				ArtistName: t.ArtistName,
				Exists:     false,
			}

			if t.ISRC != "" {
				if filePath, exists := isrcIndex[strings.ToUpper(t.ISRC)]; exists {
					result.Exists = true
					result.FilePath = filePath
				}
			}

			results[idx] = result
		}(i, track)
	}

	wg.Wait()
	return results
}

// buildISRCIndex scans a directory and builds a map of ISRC -> file path
func buildISRCIndex(outputDir string) map[string]string {
	index := make(map[string]string)

	// Walk directory recursively - only check .flac files for SpotiFLAC
	pathfilepath.Walk(outputDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		ext := strings.ToLower(pathfilepath.Ext(path))
		if ext != ".flac" {
			return nil
		}

		// Read ISRC from file
		isrc, err := ReadISRCFromFile(path)
		if err != nil || isrc == "" {
			return nil
		}

		// Store in index (uppercase for case-insensitive matching)
		index[strings.ToUpper(isrc)] = path
		return nil
	})

	return index
}
