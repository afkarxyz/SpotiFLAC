package backend

import (
	"fmt"
	"os"
	"testing"
)

func TestReproduction(t *testing.T) {
	// Spotify ID for "The Real Slim Shady"
	spotifyID := "3yfqSUWxFvZELEM4PmlwIR" // Use the one from search if this fails, or just this one.
    // The previous search result `5EvF8OdvwB2CQy9Un7eiiI` seems more reliable.
    spotifyID = "3yfqSUWxFvZELEM4PmlwIR"
    // Actually, I'll use the ID from the search result.
    spotifyID = "5EvF8OdvwB2CQy9Un7eiiI"

	downloader := NewAmazonDownloader()

	fmt.Println("--- Testing GetAmazonURLFromSpotify ---")
	amazonURL, err := downloader.GetAmazonURLFromSpotify(spotifyID)
	if err != nil {
		t.Fatalf("GetAmazonURLFromSpotify failed: %v", err)
	}
	fmt.Printf("Amazon URL: %s\n", amazonURL)

	// Create temp dir for downloads
	tempDir, err := os.MkdirTemp("", "spotiflac_debug")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)
    fmt.Printf("Temp dir: %s\n", tempDir)

	fmt.Println("\n--- Testing Lucida Download ---")
	path, err := downloader.DownloadFromLucida(amazonURL, tempDir, "FLAC")
	if err != nil {
		fmt.Printf("Lucida Download failed: %v\n", err)
	} else {
		fmt.Printf("Lucida Download success: %s\n", path)
	}

	fmt.Println("\n--- Testing Double-Double Download (Fallback) ---")
	// Double-Double logic is inside DownloadFromService, which tries Lucida first.
    // To test Double-Double specifically, we can modify the code or just call DownloadFromService 
    // and see if it fails over to Double-Double if Lucida fails.
    // But since `DownloadFromService` calls `DownloadFromLucida` internally, 
    // we can just call `DownloadFromService`.
    
    // However, I want to force Double-Double if Lucida succeeds (unlikely given the error).
    // If Lucida fails above, `DownloadFromService` will try Double-Double.

    path, err = downloader.DownloadFromService(amazonURL, tempDir, "FLAC")
    if err != nil {
        fmt.Printf("DownloadFromService failed: %v\n", err)
    } else {
        fmt.Printf("DownloadFromService success: %s\n", path)
    }
}
