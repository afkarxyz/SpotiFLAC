[![GitHub All Releases](https://img.shields.io/github/downloads/afkarxyz/SpotiFLAC/total?style=for-the-badge)](https://github.com/afkarxyz/SpotiFLAC/releases)

![Maintenance](https://maintenance.afkarxyz.fun?v=3)

![Image](https://github.com/user-attachments/assets/a6e92fdd-2944-45c1-83e8-e23a26c827af)

<div align="center">

Get Spotify tracks in true FLAC from Tidal, Qobuz & Amazon Music — no account required.

![Windows](https://img.shields.io/badge/Windows-10%2B-0078D6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgMjAgMjAiPjxwYXRoIGZpbGw9IiNmZmZmZmYiIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTIwIDEwLjg3M1YyMEw4LjQ3OSAxOC41MzdsLjAwMS03LjY2NEgyMFptLTEzLjEyIDBsLS4wMDEgNy40NjFMMCAxNy40NjF2LTYuNTg4aDYuODhaTTIwIDkuMjczSDguNDhsLS4wMDEtNy44MUwyMCAwdjkuMjczWk02Ljg3OSAxLjY2NmwuMDAxIDcuNjA3SDBWMi41MzlsNi44NzktLjg3M1oiLz48L3N2Zz4=)
![macOS](https://img.shields.io/badge/macOS-10.13%2B-000000?style=for-the-badge&logo=apple&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-Any-FCC624?style=for-the-badge&logo=linux&logoColor=white)

</div>

## ⚠️ Enhanced Fork with Bug Fixes

> **Note:** The original SpotiFLAC repository currently has issues with Spotify API calls being blocked. This fork includes bug fixes, performance improvements, and additional features while maintaining full compatibility with the original codebase.

### [Download Original](https://github.com/afkarxyz/SpotiFLAC/releases) | [Fork Repository](https://github.com/keypaa/SpotiFLAC)

## Screenshot

![Image](https://github.com/user-attachments/assets/afe01529-bcf0-4486-8792-62af26adafee)

## 🚀 Fork Features & Enhancements

This fork includes several improvements and new features:

### 📊 Comparison with Original

| Feature | Original | This Fork |
|---------|----------|--------|
| CSV Import | ❌ | ✅ |
| Individual Track Download | ❌ | ✅ |
| Parallel Downloads | ❌ | ✅ Configurable |
| Library Verification | ❌ | ✅ |
| Multiple Cover Sources | Spotify only | ✅ iTunes, Deezer, MusicBrainz |
| SQLite Database Support | ❌ | ✅ Optional |
| Path Sanitization Bug | ❌ | ✅ Fixed |
| Large CSV Performance | Slow | ✅ Optimized |
| Metadata Parsing | Basic | ✅ Enhanced |

### ✨ New Features
- **CSV Playlist Import** - Import playlists from CSV files for batch downloading
- **Individual Track Download** - Download individual tracks from playlists without fetching the entire playlist
- **Parallel Downloads** - Configurable parallel downloading for covers and lyrics with worker pool pattern
- **Enhanced Cover Sources** - Added iTunes, Deezer, and MusicBrainz as additional cover art sources
- **SQLite Database Integration** - Optional local SQLite database for fast ISRC and cover art lookups, reducing API calls and improving performance
- **Library Verification** - Batch verification of existing music libraries with progress tracking

### 🔧 Bug Fixes & Improvements
- **Performance Optimization** - Improved CSV parsing for large files
- **Better Metadata Parsing** - Enhanced filename parsing when metadata is missing
- **Cover Priority** - Prioritized iTunes and Deezer over Spotify for more reliable cover art
- **Path Sanitization** - Fixed whitespace trimming in path handling
- **Security** - Enforced strict validation for FFmpeg binary paths
- **Nested Paths** - Resolved issues with nested download paths for covers and lyrics

## 📦 Building from Source

### Prerequisites
- [Go](https://golang.org/dl/) 1.21 or later
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- [Wails](https://wails.io/) v2.9.0 or later

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/keypaa/SpotiFLAC.git
   cd SpotiFLAC
   ```

2. **Install Wails CLI**
   ```bash
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```

3. **Install frontend dependencies**
   ```bash
   cd frontend
   pnpm install
   cd ..
   ```

4. **Run in development mode**
   ```bash
   wails dev
   ```

5. **Build for production**
   ```bash
   wails build
   ```
   
   The executable will be in `build/bin/`

### Platform-Specific Notes

**Windows:**
- Requires Windows 10/11 with WebView2 runtime (usually pre-installed)
- Build produces `SpotiFLAC.exe`

**macOS:**
- Requires macOS 10.13 or later
- Build produces `SpotiFLAC.app`

**Linux:**
- Requires webkit2gtk
- Install dependencies: `sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev`

## 🎯 How It Works

SpotiFLAC uses **Spotify metadata only** for track information (track names, artists, album info). The actual audio files are downloaded from:
- **Tidal** - High-quality FLAC files
- **Qobuz** - Lossless audio
- **Amazon Music** - Additional source

> **Important:** Spotify API is used only for metadata retrieval (track information, album art URLs, etc.). If Spotify's API becomes unavailable, the search functionality may be affected, but downloads from Tidal/Qobuz/Amazon will continue to work if you have direct URLs.

### SQLite Database Integration (Optional)

This fork supports an optional local SQLite database to cache track metadata and improve performance:

**Benefits:**
- **Faster lookups** - Query local database instead of making API calls
- **Reduced API load** - Fewer requests to Spotify API
- **Offline capability** - Access cached ISRC codes and cover art URLs without internet

**Database Source:**
The database used is `spotify_clean.sqlite3` from [Anna's Archive](https://annas-archive.org/), which contains scraped Spotify metadata.

> ⚠️ **Legal Disclaimer:** The database contains scraped data from Spotify. The legality of downloading and using such databases may vary by jurisdiction. Users are responsible for ensuring compliance with their local laws and Spotify's Terms of Service. This feature is completely optional - the app works perfectly fine without a database by making API calls directly.

**Database Schema:**
```sql
-- tracks table
CREATE TABLE tracks (
    id TEXT PRIMARY KEY,              -- Spotify ID
    external_id_isrc TEXT,            -- ISRC code
    -- ... other metadata
);

-- albums table
CREATE TABLE albums (
    rowid INTEGER PRIMARY KEY,
    name TEXT,                        -- Album name
    -- ... other metadata
);

-- album_images table  
CREATE TABLE album_images (
    album_rowid INTEGER,              -- Foreign key to albums.rowid
    url TEXT,                         -- Cover art URL
    width INTEGER,                    -- Image width
    height INTEGER                    -- Image height
);
```

**Usage:**
1. Obtain `spotify_clean.sqlite3` database (if you choose to use this feature)
2. Configure the database path in settings
3. App will automatically query database first, then fallback to API if needed
4. Use `TestDatabaseConnection` to verify database schema

**Note:** This feature is entirely optional. The app functions normally without a database.

## 🔧 Troubleshooting

### Spotify API Issues
If Spotify search is not working:
- The app can still download tracks if you have direct Spotify URLs
- Alternative: Use the CSV import feature to bulk download tracks
- Downloads from Tidal/Qobuz/Amazon are not affected by Spotify API issues

### Build Issues
- Make sure all prerequisites are installed (Go 1.21+, Node 18+, Wails)
- Clear `node_modules` and `build` folders, then rebuild:
  ```bash
  rm -rf frontend/node_modules build
  cd frontend && pnpm install && cd ..
  wails build
  ```
- Verify Go version: `go version` (needs 1.21+)
- Verify Node version: `node --version` (needs 18+)
- Verify Wails: `wails doctor`

### Runtime Issues
- **FFmpeg not found**: The app will download FFmpeg automatically on first run
- **WebView2 missing (Windows)**: Download from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/)
- **Permission denied (Linux)**: Make the binary executable with `chmod +x SpotiFLAC`

### Performance Tips
- Enable parallel downloads in settings for faster cover/lyrics fetching
- Use CSV import for large playlists (better performance than UI)
- Close other applications if downloads are slow

## Other projects

### [SpotiFLAC Mobile](https://github.com/zarzet/SpotiFLAC-Mobile)
Mobile port of SpotiFLAC for Android & iOS — maintained by [@zarzet](https://github.com/zarzet)

### [SpotiDownloader](https://github.com/afkarxyz/SpotiDownloader) 
Get Spotify tracks in MP3 and FLAC via the spotidownloader.com API

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the terms specified in the LICENSE file.

[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/afkarxyz)

## Disclaimer

This project is for **educational and private use only**. The developer does not condone or encourage copyright infringement.

**SpotiFLAC** is a third-party tool and is not affiliated with, endorsed by, or connected to Spotify, Tidal, Qobuz, Amazon Music, or any other streaming service.

You are solely responsible for:
1. Ensuring your use of this software complies with your local laws.
2. Reading and adhering to the Terms of Service of the respective platforms.
3. Any legal consequences resulting from the misuse of this tool.

The software is provided "as is", without warranty of any kind. The author assumes no liability for any bans, damages, or legal issues arising from its use.
