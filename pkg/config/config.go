package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// AppConfig holds application configuration
type AppConfig struct {
	OutputDir        string `yaml:"output_dir"`
	AudioFormat      string `yaml:"audio_format"`       // LOSSLESS, HIGH, MEDIUM
	PreferredService string `yaml:"preferred_service"`  // tidal, deezer, amazon, qobuz
	FilenameFormat   string `yaml:"filename_format"`    // title-artist, artist-title, etc.
	TrackNumbers     bool   `yaml:"track_numbers"`
	AlbumFolders     bool   `yaml:"album_folders"`      // Create a subfolder for each album
}

// GetDefaultConfigPath returns the default configuration file path
func GetDefaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".spotiflac.yaml"
	}
	return filepath.Join(home, ".spotiflac", "config.yaml")
}

// LoadOrDefault loads configuration from the specified path
// If the file doesn't exist or has errors, returns default configuration
func LoadOrDefault(path string) *AppConfig {
	cfg := DefaultConfig()

	// If path is empty, use default path
	if path == "" {
		path = GetDefaultConfigPath()
	}

	data, err := os.ReadFile(path)
	if err != nil {
		// File doesn't exist or can't be read, return default
		return cfg
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		// Error parsing YAML, return default
		return cfg
	}

	// Validate and fix invalid values
	cfg.Validate()

	return cfg
}

// Save saves the configuration to the specified path
func (c *AppConfig) Save(path string) error {
	// If path is empty, use default path
	if path == "" {
		path = GetDefaultConfigPath()
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// DefaultConfig returns a configuration with sensible defaults
func DefaultConfig() *AppConfig {
	home, _ := os.UserHomeDir()
	defaultOutputDir := filepath.Join(home, "Music", "SpotiFLAC")

	return &AppConfig{
		OutputDir:        defaultOutputDir,
		AudioFormat:      "LOSSLESS",
		PreferredService: "tidal",
		FilenameFormat:   "title-artist",
		TrackNumbers:     true,
		AlbumFolders:     true,
	}
}

// Validate validates and fixes configuration values
func (c *AppConfig) Validate() {
	// Validate audio format
	validFormats := map[string]bool{"LOSSLESS": true, "HIGH": true, "MEDIUM": true}
	if !validFormats[c.AudioFormat] {
		c.AudioFormat = "LOSSLESS"
	}

	// Validate service
	validServices := map[string]bool{"tidal": true, "deezer": true, "amazon": true, "qobuz": true}
	if !validServices[c.PreferredService] {
		c.PreferredService = "tidal"
	}

	// Validate filename format
	validFormats = map[string]bool{"title-artist": true, "artist-title": true, "track-title-artist": true}
	if !validFormats[c.FilenameFormat] {
		c.FilenameFormat = "title-artist"
	}

	// Expand ~ in output directory
	if c.OutputDir != "" && c.OutputDir[0] == '~' {
		home, _ := os.UserHomeDir()
		c.OutputDir = filepath.Join(home, c.OutputDir[1:])
	}
}

// Implement core.Config interface methods

func (c *AppConfig) GetOutputDir() string {
	return c.OutputDir
}

func (c *AppConfig) GetAudioFormat() string {
	return c.AudioFormat
}

func (c *AppConfig) GetPreferredService() string {
	return c.PreferredService
}

func (c *AppConfig) GetFilenameFormat() string {
	return c.FilenameFormat
}

func (c *AppConfig) UseTrackNumbers() bool {
	return c.TrackNumbers
}

func (c *AppConfig) CreateAlbumFolders() bool {
	return c.AlbumFolders
}
