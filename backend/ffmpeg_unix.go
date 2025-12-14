//go:build !windows
// +build !windows

package backend

import (
	"os/exec"
)

// setHideWindow is a no-op on non-Windows platforms
func setHideWindow(cmd *exec.Cmd) {
	// No-op on Unix-like systems
}

