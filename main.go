package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
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
	delay := flag.Duration("delay", 500*time.Millisecond, "Delay between downloads (e.g., 500ms, 1s)")
	concurrency := flag.Int("c", 3, "Number of concurrent downloads")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s [flags] [spotify-url]\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	args := flag.Args()

	// Handle Persistent Config Set
	if *setOutput != "" {
		if len(args) > 0 {
			// Check if a URL was also provided
			possibleURL := args[0]
			if strings.HasPrefix(possibleURL, "http") {
				fmt.Fprintln(os.Stderr, "Error: --set-output cannot be used together with a Spotify URL.")
				flag.Usage()
				os.Exit(1)
			}
		}
		handleSetOutput(*setOutput)
		return
	}

	// Handle CLI Download
	if len(args) > 0 {
		arg := args[0]
		// Validate as an HTTPS Spotify URL before invoking CLI mode
		if u, err := url.Parse(arg); err == nil && u.Scheme == "https" && strings.Contains(u.Host, "spotify.com") {
			runCLI(app, arg, *outputDir, *delay, *concurrency)
			return
		} else {
			// Inform the user that the argument was not recognized as a Spotify URL
			fmt.Fprintf(os.Stderr, "Warning: Unrecognized argument %q. Launching GUI instead.\n", arg)
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

	// Ensure the resolved path is either a directory or does not exist
	if info, err := os.Stat(absPath); err == nil {
		if !info.IsDir() {
			log.Fatalf("Path %s already exists and is not a directory", absPath)
		}
	} else if !os.IsNotExist(err) {
		log.Fatalf("Failed to stat path %s: %v", absPath, err)
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

func runCLI(app *App, spotifyURL string, outputDirOverride string, delay time.Duration, concurrency int) {
	// Manually manage the app lifecycle for CLI mode: in the normal Wails GUI flow,
	// Wails calls startup/shutdown for us and supplies the context; here we create
	// a Cancel context and invoke startup/shutdown ourselves to handle signals.
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	app.startup(ctx)
	defer app.shutdown(ctx)

	// Robust URL validation
	u, err := url.Parse(spotifyURL)
	if err != nil || u.Scheme == "" || u.Host == "" || !strings.Contains(u.Host, "spotify.com") {
		log.Fatalf("Invalid Spotify URL: %s. Must be a valid http/https URL from spotify.com", spotifyURL)
	}

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

	fmt.Printf("Queued %d tracks for download (Concurrency: %d, Delay: %v)...\n", len(tracksToDownload), concurrency, delay)

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

	// Process downloads concurrently
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency) // Semaphore to limit concurrency
	var mu sync.Mutex

	successCount := 0
	failCount := 0

	total := len(tracksToDownload)

	for i, req := range tracksToDownload {
		// Check for cancellation before starting new downloads
		select {
		case <-ctx.Done():
			fmt.Println("\nDownload cancelled by user.")
			// Fallthrough to check below
		default:
		}

		if ctx.Err() != nil {
			break
		}

		wg.Add(1)
		sem <- struct{}{} // Acquire token

		go func(idx int, r DownloadRequest) {
			defer wg.Done()
			defer func() { <-sem }() // Release token

			// Simulating delay for politeness if needed across threads,
			// though less effective when strictly parallel, still helps stagger requests.
			if delay > 0 {
				time.Sleep(delay)
			}

			r.OutputDir = finalOutputDir
			if r.Service == "" {
				r.Service = "tidal"
			}
			if r.AudioFormat == "" {
				r.AudioFormat = "LOSSLESS"
			}

			resp, err := app.DownloadTrack(r)

			var resultMsg string
			var isSuccess bool

			if err != nil {
				resultMsg = fmt.Sprintf("[%d/%d] Failed: %s - %s (%v)", idx+1, total, r.TrackName, r.ArtistName, err)
				isSuccess = false
			} else if !resp.Success {
				resultMsg = fmt.Sprintf("[%d/%d] Failed: %s - %s (%s)", idx+1, total, r.TrackName, r.ArtistName, resp.Error)
				isSuccess = false
			} else {
				status := "Done"
				if resp.AlreadyExists {
					status = "Exists"
				}
				resultMsg = fmt.Sprintf("[%d/%d] %s: %s - %s", idx+1, total, status, r.TrackName, r.ArtistName)
				isSuccess = true
			}

			// Print immediately (might interleave slightly but acceptable for CLI)
			fmt.Println(resultMsg)

			mu.Lock()
			if isSuccess {
				successCount++
			} else {
				failCount++
			}
			mu.Unlock()

		}(i, req)
	}

	wg.Wait()

	fmt.Printf("\nSummary: %d Success, %d Failed. Output dir: %s\n", successCount, failCount, finalOutputDir)
}

func mapTrackToDownloadRequest(t backend.TrackMetadata) DownloadRequest {
	return DownloadRequest{
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
		Copyright:          t.Copyright,
		Publisher:          t.Publisher,
		Duration:           t.DurationMS,
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

	// Known limitation: for playlist items, AlbumInfoMetadata may be incomplete or empty.
	// We check if we can infer from the track metadata itself using fields found in AlbumTrackMetadata if available.
	if req.AlbumName == "" && t.AlbumName != "" {
		req.AlbumName = t.AlbumName
	}
	if req.ReleaseDate == "" && t.ReleaseDate != "" {
		req.ReleaseDate = t.ReleaseDate
	}

	// TODO: Verify how playlist tracks populate AlbumTrackMetadata/AlbumInfoMetadata and extend this fallback logic if playlist tracks can legitimately lack album data.

	return req
}
