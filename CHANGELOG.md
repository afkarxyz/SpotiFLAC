# Changelog

All notable changes to this fork will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **CSV Playlist Import**: Import and download tracks from CSV files for batch processing
- **Individual Track Download**: Download single tracks from playlists without fetching entire playlist
- **Parallel Downloads**: Configurable worker pool pattern for concurrent cover and lyrics downloads
  - Settings to control number of parallel workers
  - Improved download speed for large libraries
- **Enhanced Cover Art Sources**: 
  - Added iTunes as primary cover source
  - Added Deezer as secondary cover source
  - Added MusicBrainz as fallback cover source
  - Prioritized iTunes and Deezer over Spotify for reliability
- **Database Integration**: Track-based database search for better cover art matching
- **Library Verification**: Batch verification tool for existing music libraries
  - Progress tracking
  - Detailed verification reports
  - Missing file detection

### Changed
- **Performance**: Optimized CSV parsing for large files (10,000+ tracks)
- **Metadata Parsing**: Enhanced filename parsing when metadata is missing or incomplete
- **Path Handling**: Fixed whitespace trimming in `sanitizePath` function
- **Cover Priority**: Reordered cover sources for better success rate

### Fixed
- Path sanitization bug where trimmed values weren't being used
- Performance issues with large CSV files
- Nested download paths for covers and lyrics
- Metadata extraction from filenames with various formats

### Security
- Enforced strict validation for FFmpeg binary paths
- Added executable validation checks
- Improved path sanitization

## [7.0] - 2024

Base version from upstream [afkarxyz/SpotiFLAC](https://github.com/afkarxyz/SpotiFLAC)

### Features from Upstream
- Spotify metadata integration
- Download from Tidal, Qobuz, and Amazon Music
- FLAC format support
- Album art embedding
- Lyrics support
- Audio conversion
- Cross-platform support (Windows, macOS, Linux)

---

## Contributing

When adding to this changelog:
- Add unreleased changes under `[Unreleased]` section
- Use categories: Added, Changed, Deprecated, Removed, Fixed, Security
- Include clear descriptions of what changed and why
- Reference issue/PR numbers when applicable
