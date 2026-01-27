package backend

import (
	"context"
	"os/exec"
	"runtime"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func OpenFolderInExplorer(path string) error {
	var cmd *exec.Cmd

	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	case "linux":
		cmd = exec.Command("xdg-open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}

	return cmd.Start()
}

func SelectFolderDialog(ctx context.Context, defaultPath string) (string, error) {

	if defaultPath == "" {
		defaultPath = GetDefaultMusicPath()
	}

	options := wailsRuntime.OpenDialogOptions{
		Title:            "Select Download Folder",
		DefaultDirectory: defaultPath,
	}

	selectedPath, err := wailsRuntime.OpenDirectoryDialog(ctx, options)
	if err != nil {
		return "", err
	}

	if selectedPath == "" {
		return "", nil
	}

	return selectedPath, nil
}

func SelectFileDialog(ctx context.Context) (string, error) {
	options := wailsRuntime.OpenDialogOptions{
		Title: "Select FLAC File for Analysis",
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "FLAC Audio Files (*.flac)",
				Pattern:     "*.flac",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	}

	selectedFile, err := wailsRuntime.OpenFileDialog(ctx, options)
	if err != nil {
		return "", err
	}

	if selectedFile == "" {
		return "", nil
	}

	return selectedFile, nil
}

func SelectImageVideoDialog(ctx context.Context) ([]string, error) {
	options := wailsRuntime.OpenDialogOptions{
		Title: "Select Image or Video",
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "Supported Files (*.jpg, *.png, *.mp4, *.mov, ...)",
				Pattern:     "*.jpg;*.jpeg;*.png;*.gif;*.webp;*.mp4;*.mkv;*.webm;*.mov",
			},
			{
				DisplayName: "All Files (*.*)",
				Pattern:     "*.*",
			},
		},
	}

	selectedPaths, err := wailsRuntime.OpenMultipleFilesDialog(ctx, options)
	if err != nil {
		return nil, err
	}

	return selectedPaths, nil
}
