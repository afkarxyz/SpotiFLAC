package backend

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SelectMultipleFiles opens a file dialog to select multiple audio files
func SelectMultipleFiles(ctx context.Context) ([]string, error) {
	files, err := runtime.OpenMultipleFilesDialog(ctx, runtime.OpenDialogOptions{
		Title: "Select Audio Files",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Audio Files (*.mp3, *.m4a, *.flac)",
				Pattern:     "*.mp3;*.m4a;*.flac",
			},
			{
				DisplayName: "MP3 Files (*.mp3)",
				Pattern:     "*.mp3",
			},
			{
				DisplayName: "M4A Files (*.m4a)",
				Pattern:     "*.m4a",
			},
			{
				DisplayName: "FLAC Files (*.flac)",
				Pattern:     "*.flac",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// SelectOutputDirectory opens a directory dialog to select output folder
func SelectOutputDirectory(ctx context.Context) (string, error) {
	dir, err := runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{
		Title: "Select Output Directory",
	})
	if err != nil {
		return "", err
	}
	return dir, nil
}

