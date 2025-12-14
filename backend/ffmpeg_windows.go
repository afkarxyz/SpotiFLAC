//go:build windows
// +build windows

package backend

import (
	"os/exec"
	"syscall"
)

// setHideWindow sets HideWindow attribute for Windows processes
func setHideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
}

