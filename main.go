package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "SpotiFLAC",
		Width:     1024,
		Height:    600,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 255},
		OnStartup:        app.startup,
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
