package backend

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func GetDefaultMusicPath() string {

	homeDir, err := os.UserHomeDir()
	if err != nil {

		return "C:\\Users\\Public\\Music"
	}

	return filepath.Join(homeDir, "Music")
}

func GetConfigPath() (string, error) {
	dir, err := EnsureAppDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(dir, "config.json"), nil
}

func LoadConfigSettings() (map[string]interface{}, error) {
	configPath, err := GetConfigPath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var settings map[string]interface{}
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}

	return settings, nil
}

func GetSpotFetchAPISettings() (bool, string) {
	settings, err := LoadConfigSettings()
	if err != nil || settings == nil {
		return false, ""
	}

	useAPI, _ := settings["useSpotFetchAPI"].(bool)
	if !useAPI {
		return false, ""
	}

	apiURL, _ := settings["spotFetchAPIUrl"].(string)
	if apiURL == "" {
		apiURL = "https://sp.afkarxyz.qzz.io/api"
	}

	return true, apiURL
}
