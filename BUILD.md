# Release Guide

This document outlines the process for creating releases of SpotiFLAC.

## Building Releases

### Windows (x64)
```bash
wails build -platform windows/amd64
```
Output: `build/bin/SpotiFLAC.exe`

### Windows (x86 - 32-bit)
```bash
wails build -platform windows/386
```
Output: `build/bin/SpotiFLAC-386.exe`

### macOS (Intel)
```bash
wails build -platform darwin/amd64
```
Output: `build/bin/SpotiFLAC.app`

### macOS (Apple Silicon)
```bash
wails build -platform darwin/arm64
```
Output: `build/bin/SpotiFLAC.app`

### macOS (Universal Binary - Intel + Apple Silicon)
```bash
wails build -platform darwin/universal
```
Output: `build/bin/SpotiFLAC.app`

### Linux (x64)
```bash
wails build -platform linux/amd64
```
Output: `build/bin/SpotiFLAC`

### Linux (ARM64)
```bash
wails build -platform linux/arm64
```
Output: `build/bin/SpotiFLAC`

## Build All Platforms

To build for all platforms at once (requires appropriate OS or cross-compilation setup):

```bash
# Windows builds
wails build -platform windows/amd64
wails build -platform windows/386

# macOS builds (requires macOS)
wails build -platform darwin/universal

# Linux builds
wails build -platform linux/amd64
wails build -platform linux/arm64
```

## Release Checklist

- [ ] Update version in `wails.json`
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Test build on all target platforms
- [ ] Create git tag: `git tag v1.x.x`
- [ ] Push tag: `git push origin v1.x.x`
- [ ] Build all platform binaries
- [ ] Create GitHub release with binaries
- [ ] Update README if needed

## Packaging

### Windows
The `.exe` file can be distributed directly. Consider creating a `.zip` archive:
```bash
cd build/bin
7z a SpotiFLAC-v1.x.x-windows-amd64.zip SpotiFLAC.exe
```

### macOS
The `.app` bundle can be distributed directly or as a `.dmg`:
```bash
# Create DMG (requires create-dmg tool)
create-dmg --volname "SpotiFLAC" --window-pos 200 120 --window-size 800 400 SpotiFLAC-v1.x.x.dmg build/bin/SpotiFLAC.app
```

### Linux
Create a tarball:
```bash
cd build/bin
tar -czf SpotiFLAC-v1.x.x-linux-amd64.tar.gz SpotiFLAC
```

## Notes

- Cross-compilation from Linux/Windows to macOS is not supported - macOS builds require macOS
- Windows builds can be created from any platform
- Linux builds can be created from any platform
- Use `-clean` flag to ensure clean builds: `wails build -clean`
- Use `-ldflags "-s -w"` for smaller binaries: `wails build -ldflags "-s -w"`
