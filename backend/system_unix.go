//go:build !windows

package backend

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

func GetOSInfo() (string, error) {
	osType := runtime.GOOS
	arch := runtime.GOARCH

	switch osType {
	case "darwin":
		out, err := exec.Command("sw_vers", "-productVersion").Output()
		if err != nil {
			return fmt.Sprintf("macOS %s", arch), nil
		}
		version := strings.TrimSpace(string(out))
		return fmt.Sprintf("macOS %s (%s)", version, arch), nil

	case "linux":
		out, err := exec.Command("cat", "/etc/os-release").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "PRETTY_NAME=") {
					name := strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
					return fmt.Sprintf("%s (%s)", name, arch), nil
				}
			}
		}
		return fmt.Sprintf("Linux %s", arch), nil

	default:
		return fmt.Sprintf("%s %s", osType, arch), nil
	}
}
