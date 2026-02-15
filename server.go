package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ServerDownloadRequest struct {
	URL string `json:"url"`
}

var serverAppInstance *App

func downloadHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Only POST method is allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Error reading request body", http.StatusInternalServerError)
		return
	}
	defer r.Body.Close()

	var req ServerDownloadRequest
	err = json.Unmarshal(body, &req)
	if err != nil {
		http.Error(w, "Error parsing JSON body", http.StatusBadRequest)
		return
	}

	if req.URL == "" {
		http.Error(w, "URL is required", http.StatusBadRequest)
		return
	}

	if serverAppInstance == nil || serverAppInstance.ctx == nil {
		http.Error(w, "App instance not initialized", http.StatusInternalServerError)
		return
	}

	runtime.EventsEmit(serverAppInstance.ctx, "spotiflac:fetch-url", req.URL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Fetch request sent"})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func StartServer(app *App) {
	serverAppInstance = app
	http.HandleFunc("/health", healthHandler)
	http.HandleFunc("/download", downloadHandler)
	fmt.Println("SpotiFLAC server listening on :8698")
	go func() {
		if err := http.ListenAndServe(":8698", nil); err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()
}
