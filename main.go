package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"spotiflac/backend"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {

	app := NewApp()

	// CLI Flags
	setOutput := flag.String("set-output", "", "Set the default download directory")
	outputDir := flag.String("o", "", "Output directory for this download")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s [flags] [spotify-url]\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	// Handle Persistent Config Set
	if *setOutput != "" {
		handleSetOutput(*setOutput)
		return
	}

	// Handle CLI Download
	args := flag.Args()
	if len(args) > 0 {
		arg := args[0]
		if strings.HasPrefix(arg, "http") && strings.Contains(arg, "spotify.com") {
			runCLI(app, arg, *outputDir)
			return
		}
	}

	// Normal GUI Start
	err := wails.Run(&options.App{
		Title:     "SpotiFLAC",
		Width:     1024,
		Height:    600,
		MinWidth:  1024,
		MinHeight: 600,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: false,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              false,
			WindowIsTranslucent:               false,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
		},
	})

	if err != nil {
		log.Fatal("Error:", err.Error())
	}
}

func handleSetOutput(path string) {
	// Normalize path (absolute)
	normalizedPath := backend.NormalizePath(path)
	absPath, err := filepath.Abs(normalizedPath)
	if err != nil {
		log.Fatalf("Failed to resolve absolute path: %v", err)
	}
	
	// Create directory (idempotent)
	if err := os.MkdirAll(absPath, 0755); err != nil {
		log.Fatalf("Failed to create directory %s: %v", absPath, err)
	}

	if err := backend.SetConfiguration("downloadPath", absPath); err != nil {
		log.Fatalf("Failed to save configuration: %v", err)
	}

	fmt.Printf("Default download directory set to: %s\n", absPath)
}

func runCLI(app *App, spotifyURL string, outputDirOverride string) {
	// Initialize backend manually since Wails isn't doing it
	// app.startup normally does this, but it takes a context we can provide
	ctx := context.Background()
	app.startup(ctx)
	defer app.shutdown(ctx)

	fmt.Printf("Analyzing Spotify URL: %s\n", spotifyURL)

	// Fetch metadata directly using backend
	data, err := backend.GetFilteredSpotifyData(ctx, spotifyURL, false, 0)
	if err != nil {
		log.Fatalf("Failed to fetch metadata: %v", err)
	}

	var tracksToDownload []DownloadRequest

	switch v := data.(type) {
	case backend.TrackResponse:
		fmt.Printf("Found Track: %s - %s\n", v.Track.Name, v.Track.Artists)
		req := mapTrackToDownloadRequest(v.Track)
		tracksToDownload = append(tracksToDownload, req)

	case *backend.AlbumResponsePayload:
		fmt.Printf("Found Album: %s - %s (%d tracks)\n", v.AlbumInfo.Name, v.AlbumInfo.Artists, len(v.TrackList))
		for _, t := range v.TrackList {
			req := mapAlbumTrackToDownloadRequest(t, v.AlbumInfo)
			tracksToDownload = append(tracksToDownload, req)
		}

	case backend.PlaylistResponsePayload:
		fmt.Printf("Found Playlist: %s (%d tracks)\n", v.PlaylistInfo.Owner.Name, len(v.TrackList))
		for _, t := range v.TrackList {
			req := mapAlbumTrackToDownloadRequest(t, backend.AlbumInfoMetadata{}) 
			tracksToDownload = append(tracksToDownload, req)
		}
	
	default:
		log.Fatalf("Unsupported Spotify content type via CLI: %T", v)
	}

	fmt.Printf("Queued %d tracks for download...\n", len(tracksToDownload))
	
	// Process downloads
	successCount := 0
	failCount := 0

	// Determine output directory once
	finalOutputDir := backend.GetDefaultMusicPath()
	if outputDirOverride != "" {
		normalizedOverride := backend.NormalizePath(outputDirOverride)
		absOverride, err := filepath.Abs(normalizedOverride)
		if err != nil {
			fmt.Printf("Warning: Failed to resolve absolute path for override: %v. Using as-is.\n", err)
			finalOutputDir = normalizedOverride
		} else {
			finalOutputDir = absOverride
		}
	}

	for i, req := range tracksToDownload {
		fmt.Printf("[%d/%d] Downloading: %s - %s\n", i+1, len(tracksToDownload), req.TrackName, req.ArtistName)
		
		req.OutputDir = finalOutputDir

		// Set default service to Tidal if not specified (struct defaults are empty)
		if req.Service == "" {
			req.Service = "tidal"
		}
		if req.AudioFormat == "" {
			req.AudioFormat = "LOSSLESS"
		}

		resp, err := app.DownloadTrack(req)
		if err != nil {
			fmt.Printf("Failed: %v\n", err)
			failCount++
		} else {
			if resp.Success {
				msg := "Done"
				if resp.AlreadyExists {
					msg = "Already Exists"
				}
				fmt.Printf("%s: %s\n", msg, resp.File)
				successCount++
			} else {
				fmt.Printf("Failed: %s\n", resp.Error)
				failCount++
			}
		}
		// Small delay to be nice
		time.Sleep(500 * time.Millisecond)
	}

	fmt.Printf("\nSummary: %d Success, %d Failed. Output dir: %s\n", successCount, failCount, finalOutputDir)
}

func mapTrackToDownloadRequest(t backend.TrackMetadata) DownloadRequest {
	return DownloadRequest{
		SpotifyID:           t.SpotifyID,
		ISRC:                t.ISRC,
		TrackName:           t.Name,
		ArtistName:          t.Artists,
		AlbumName:           t.AlbumName,
		AlbumArtist:         t.AlbumArtist,
		ReleaseDate:         t.ReleaseDate,
		CoverURL:            t.Images,
		TrackNumber:         true, 
		Position:            t.TrackNumber,
		SpotifyTrackNumber:  t.TrackNumber,
		SpotifyDiscNumber:   t.DiscNumber,
		SpotifyTotalTracks:  t.TotalTracks,
		SpotifyTotalDiscs:   t.TotalDiscs,
		Copyright:           t.Copyright,
		Publisher:           t.Publisher,
		Duration:            t.DurationMS,
	}
}

func mapAlbumTrackToDownloadRequest(t backend.AlbumTrackMetadata, albumInfo backend.AlbumInfoMetadata) DownloadRequest {
	req := DownloadRequest{
		SpotifyID:          t.SpotifyID,
		ISRC:               t.ISRC,
		TrackName:          t.Name,
		ArtistName:         t.Artists,
		AlbumName:          t.AlbumName,
		AlbumArtist:        t.AlbumArtist,
		ReleaseDate:        t.ReleaseDate,
		CoverURL:           t.Images,
		TrackNumber:        true,
		Position:           t.TrackNumber,
		SpotifyTrackNumber: t.TrackNumber,
		SpotifyDiscNumber:  t.DiscNumber,
		SpotifyTotalTracks: t.TotalTracks,
		SpotifyTotalDiscs:  t.TotalDiscs,
		Duration:           t.DurationMS,
	}

	// Fallback to album info if track info is missing some details
	if req.AlbumName == "" {
		req.AlbumName = albumInfo.Name
	}
	if req.ReleaseDate == "" {
		req.ReleaseDate = albumInfo.ReleaseDate
	}
	// Note: Playlist items might not have AlbumInfo passed in correctly, logic might need adjustment if playlist tracks lack album data in themselves.
	// But AlbumTrackMetadata usually has AlbumName.
	
	return req
}
