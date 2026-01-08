# syntax=docker/dockerfile:1.7
ARG GO_VERSION=1.25.5

FROM golang:${GO_VERSION}-bookworm AS build

ARG WAILS_VERSION=v2.11.0
ARG WAILS_PLATFORM=linux/amd64

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    pkg-config \
    build-essential \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g corepack \
    && corepack enable \
    && corepack prepare pnpm@9.12.2 --activate

RUN go install github.com/wailsapp/wails/v2/cmd/wails@${WAILS_VERSION}

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN wails build -platform ${WAILS_PLATFORM} -clean -o SpotiFLAC

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dbus-x11 \
    x11vnc \
    xvfb \
    openbox \
    novnc \
    websockify \
    libgtk-3-0 \
    libwebkit2gtk-4.0-37 \
    libx11-6 \
    libxrandr2 \
    libxdamage1 \
    libxfixes3 \
    libxext6 \
    libxcomposite1 \
    libxkbcommon-x11-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgbm1 \
    libdrm2 \
    libasound2 \
    libnss3 \
    libgl1 \
    libgdk-pixbuf2.0-0 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libglib2.0-0 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /src/build/bin/SpotiFLAC /app/SpotiFLAC
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && useradd -m -u 1000 app

USER app

ENV DISPLAY=:1 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    RESOLUTION=1280x720 \
    DEPTH=24

EXPOSE 6080 5900

ENTRYPOINT ["docker-entrypoint.sh"]
