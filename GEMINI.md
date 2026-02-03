# SpotiFLAC

## Project Overview

SpotiFLAC is a desktop application that allows users to download Spotify tracks in high-quality FLAC format by sourcing the audio from other streaming services like Tidal, Qobuz, and Amazon Music. It does not require a Spotify Premium account or authentication, as it uses public APIs and metadata.

**Architecture:**
*   **Framework:** [Wails v2](https://wails.io/) (Go backend + Web frontend)
*   **Backend:** Go (v1.25.5 specified in `go.mod`)
    *   Handles core logic: downloading, file management, audio conversion, metadata embedding, and FFmpeg integration.
    *   Key libraries: `go-flac`, `id3v2`, `bbolt` (local DB).
*   **Frontend:** React 19 + TypeScript
    *   Built with [Vite](https://vitejs.dev/).
    *   Styling: Tailwind CSS v4.
    *   UI Components: Radix UI, Lucide React.
    *   State Management: React Hooks (`useDownload`, `useMetadata`, etc.).

## Directory Structure

*   `backend/`: Contains all Go packages for the application logic (downloaders, metadata, system utils).
*   `frontend/`: The React application source code.
    *   `src/components/`: UI components (Views, Dialogs, Widgets).
    *   `src/hooks/`: Custom React hooks for bridging to Go backend.
    *   `src/lib/`: Utility functions and API wrappers.
    *   `wailsjs/`: Auto-generated bindings from Wails (created during build).
*   `main.go`: Application entry point. Sets up the Wails application window.
*   `app.go`: Defines the `App` struct and methods exposed to the frontend (the "Backend API").
*   `wails.json`: Wails project configuration.

## Build & Run Instructions

**Prerequisites:**
*   Go (v1.21+ recommended, `go.mod` specifies 1.25.5)
*   Node.js & pnpm
*   Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

**Development:**

1.  **Install Frontend Dependencies:**
    ```bash
    cd frontend
    pnpm install
    ```

2.  **Run in Development Mode:**
    From the root directory:
    ```bash
    wails dev
    ```
    This command will build the backend and start a vite dev server for the frontend, enabling hot-reloading.

**Building for Production:**

```bash
wails build
```
This produces a compiled binary in the `build/bin` directory.

## Key Concepts & Conventions

*   **Audio Sourcing:** The app takes a Spotify ID/URL, fetches metadata, and then searches for the track on target services (Tidal, Qobuz, Amazon) to download the lossless audio.
*   **FFmpeg:** The application relies on FFmpeg for audio conversion and analysis. It includes logic to check for and download FFmpeg if missing (`backend/ffmpeg.go`).
*   **History & Settings:** Uses `bbolt` (embedded key-value store) to persist download history and application settings locally.
*   **Frontend-Backend Communication:**
    *   Go methods in `App` struct (in `app.go`) are bound to the frontend.
    *   Frontend calls these methods via `window.go.main.App.<MethodName>` (or via the auto-generated `wailsjs` wrappers).
    *   Events are emitted from Go to React using `runtime.EventsEmit`.

## Development Tips

*   **Adding New Features:**
    1.  Define the Go method in `app.go` and add it to the `App` struct.
    2.  Run `wails dev` to auto-generate the TypeScript definitions in `frontend/wailsjs`.
    3.  Implement the UI in React using the generated hooks/functions.
*   **Styling:** Use Tailwind CSS utility classes. The project uses `shadcn/ui`-like components (built on Radix UI).
*   **Icons:** Use `lucide-react` for icons.
