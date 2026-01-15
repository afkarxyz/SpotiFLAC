package backend

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
)

func GetOSInfo() (string, error) {
	arch := runtime.GOARCH

	cmd := exec.Command("wmic", "os", "get", "Caption,Version", "/value")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		cmdVer := exec.Command("cmd", "/c", "ver")
		cmdVer.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		outVer, errVer := cmdVer.Output()
		if errVer != nil {
			return fmt.Sprintf("Windows %s", arch), nil
		}
		return strings.TrimSpace(string(outVer)), nil
	}

	lines := strings.Split(string(out), "\n")
	var caption, version string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Caption=") {
			caption = strings.TrimPrefix(line, "Caption=")
		} else if strings.HasPrefix(line, "Version=") {
			version = strings.TrimPrefix(line, "Version=")
		}
	}
	if caption != "" && version != "" {
		return fmt.Sprintf("%s (%s, %s)", caption, version, arch), nil
	}
	return strings.TrimSpace(string(out)), nil
}
