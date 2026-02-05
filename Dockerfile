
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive \
    apt-get install -y \
    ca-certificates \
    curl \
    git \
    gcc \
    libgtk-3-dev \
    libwebkit2gtk-4.0-dev \
    pkg-config \
    xz-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js 20
ENV NODE_VERSION=20.18.0
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | tar -C /usr/local -xz
ENV PATH="/usr/local/bin:${PATH}"

ENV GO_VERSION=1.23.4
RUN curl -fsSL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/go"
ENV PATH="${GOPATH}/bin:${PATH}"

RUN npm install -g pnpm

RUN go install github.com/wailsapp/wails/v2/cmd/wails@latest

WORKDIR /src
COPY . .

WORKDIR /src/frontend
RUN pnpm install --frozen-lockfile || pnpm install

WORKDIR /src
RUN wails build -platform linux/amd64 -o SpotiFLAC

FROM --platform=linux/amd64 ubuntu:22.04

COPY ui.patch /tmp

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dbus \
    ffmpeg \
    fonts-noto-cjk \
    libgtk-3-0 \
    libwebkit2gtk-4.0-37 \
    libegl1 \
    locales \
    openbox \
    patch \
    python3-numpy \
    tigervnc-standalone-server \
    tigervnc-tools \
    tzdata \
    xz-utils

RUN dbus-uuidgen > /etc/machine-id

RUN locale-gen en_US.UTF-8

RUN curl -fL# https://github.com/just-containers/s6-overlay/releases/latest/download/s6-overlay-noarch.tar.xz -o /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    rm -rf /tmp/s6-overlay-noarch.tar.xz

RUN curl -fL# https://github.com/just-containers/s6-overlay/releases/latest/download/s6-overlay-x86_64.tar.xz -o /tmp/s6-overlay-x86_64.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz && \
    rm -rf /tmp/s6-overlay-x86_64.tar.xz

RUN mkdir /usr/share/novnc && \
    curl -fL# https://github.com/novnc/noVNC/archive/master.tar.gz -o /tmp/novnc.tar.gz && \
    tar -xf /tmp/novnc.tar.gz --strip-components=1 -C /usr/share/novnc && \
    rm -rf /tmp/novnc.tar.gz

RUN mkdir /usr/share/novnc/utils/websockify && \
    curl -fL# https://github.com/novnc/websockify/archive/master.tar.gz -o /tmp/websockify.tar.gz && \
    tar -xf /tmp/websockify.tar.gz --strip-components=1 -C /usr/share/novnc/utils/websockify && \
    rm -rf /tmp/websockify.tar.gz

RUN curl -fL# https://site-assets.fontawesome.com/releases/v6.0.0/svgs/solid/folder-music.svg -o /usr/share/novnc/app/images/downloads.svg && \
    curl -fL# https://site-assets.fontawesome.com/releases/v6.0.0/svgs/solid/gear.svg -o /usr/share/novnc/app/images/config.svg && \
    sed -i 's/<path/<path style="fill:white"/' /usr/share/novnc/app/images/downloads.svg /usr/share/novnc/app/images/config.svg && \
    patch /usr/share/novnc/vnc.html < /tmp/ui.patch && \
    sed -i 's/10px 0 5px/8px 0 6px/' /usr/share/novnc/app/styles/base.css

RUN ln -s /data/Downloads /usr/share/novnc/downloads && \
    ln -s /data/config /usr/share/novnc/config

RUN userdel -f $(id -nu 1000) 2>/dev/null || true && \
    groupdel -f $(id -ng 1000) 2>/dev/null || true && \
    rm -rf /home && \
    useradd -u 1000 -U -d /data -s /bin/false spotiflac && \
    usermod -G users spotiflac

RUN mkdir -p /data/Downloads /data/config /data/appdata && \
    mkdir -p /app

RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder /src/build/bin/SpotiFLAC /app/SpotiFLAC

ENV DISPLAY=:1 \
    HOME=/tmp \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    VNC_PORT=5900 \
    NOVNC_PORT=6090 \
    PGID=1000 \
    PUID=1000 \
    UMASK=022 \
    MODIFY_VOLUMES=true \
    XDG_RUNTIME_DIR=/tmp \
    SPOTIFLAC_CONFIG_DIR=/data/config \
    SPOTIFLAC_DOWNLOAD_DIR=/data/Downloads

COPY rootfs /

ENTRYPOINT ["/init"]
