# Development Guide

## Prerequisites

Before running the application locally, ensure you have the following installed:

1.  **Go** (v1.23+ recommended)
2.  **Node.js** (v16+ recommended)
3.  **Wails CLI**

### Installing Wails

Since you already have Go installed, you can install the Wails CLI by running:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Ensure that your `go/bin` directory is in your PATH. You can check if it's installed by running `wails version`.

## Running the Application

To run the application in development mode (with hot reloading for both frontend and backend):

```bash
wails dev
```

This will compiles the application and open it in a window. It also starts a browser-based version at http://localhost:34115.

## Building for Production

To create a production build (Application.app):

```bash
wails build
```

The output will be in the `build/bin` directory.
