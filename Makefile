.PHONY: build-gui build-cli install-cli test clean help

# Variables
CLI_BINARY := bin/spotiflac-cli
CLI_SOURCE := ./cmd/cli

# Default target
.DEFAULT_GOAL := help

## help: Display this help
help:
	@echo "Available commands:"
	@echo ""
	@echo "  make build-gui        - Build the GUI application with Wails"
	@echo "  make build-cli        - Build the SpotiFLAC CLI"
	@echo "  make build-all        - Build both GUI and CLI"
	@echo "  make install-cli      - Install the CLI globally"
	@echo "  make test             - Run tests"
	@echo "  make clean            - Clean build files"
	@echo "  make dev-cli          - Quick build and test the CLI"
	@echo ""

## build-gui: Build the GUI application with Wails
build-gui:
	@echo "📦 Building GUI application..."
	wails build

## build-cli: Build the CLI
build-cli:
	@echo "📦 Building CLI..."
	@mkdir -p bin
	go build -o $(CLI_BINARY) $(CLI_SOURCE)
	@echo "✓ CLI built: $(CLI_BINARY)"

## build-all: Build both GUI and CLI
build-all: build-gui build-cli
	@echo "✓ All binaries built"

## install-cli: Install the CLI globally
install-cli:
	@echo "📥 Installing CLI..."
	go install $(CLI_SOURCE)
	@echo "✓ CLI installed globally (spotiflac-cli)"

## test: Run tests
test:
	@echo "🧪 Running tests..."
	go test ./backend/core/... -v

## clean: Clean build files
clean:
	@echo "🧹 Cleaning..."
	rm -rf build/ bin/
	go clean
	@echo "✓ Cleanup complete"

## dev-cli: Quick build for development
dev-cli: build-cli
	@echo ""
	@echo "💡 Usage:"
	@echo "  ./$(CLI_BINARY) album <spotify-url>"
	@echo ""
	@echo "Example:"
	@echo "  ./$(CLI_BINARY) album https://open.spotify.com/album/..."
	@echo ""
