//go:build darwin

package backend

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

func SetMacOSFileIconFromImage(filePath, imagePath string, iconSize int) error {
	if filePath == "" {
		return fmt.Errorf("file path is required")
	}
	if imagePath == "" {
		return fmt.Errorf("image path is required")
	}

	resizedPath, err := ResizeImageForIcon(imagePath, iconSize)
	if err != nil {
		return err
	}
	defer os.Remove(resizedPath)

	script := `
use framework "AppKit"
on run argv
    set imagePath to item 1 of argv
    set targetPath to item 2 of argv
    set iconImage to current application's NSImage's alloc()'s initWithContentsOfFile:imagePath
    if iconImage is missing value then error "Failed to load icon image"
    set didSet to (current application's NSWorkspace's sharedWorkspace()'s setIcon:iconImage forFile:targetPath options:0) as boolean
    if didSet is false then error "Failed to set custom file icon"
end run
`

	cmd := exec.Command("osascript", "-", resizedPath, filePath)
	cmd.Stdin = strings.NewReader(script)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to apply macOS file icon: %v (%s)", err, strings.TrimSpace(string(output)))
	}
	return nil
}
