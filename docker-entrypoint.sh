#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:1}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
RESOLUTION="${RESOLUTION:-1280x720}"
DEPTH="${DEPTH:-24}"

export DISPLAY

Xvfb "${DISPLAY}" -screen 0 "${RESOLUTION}x${DEPTH}" -nolisten tcp &
openbox &
x11vnc -display "${DISPLAY}" -rfbport "${VNC_PORT}" -forever -shared -nopw -noxdamage -quiet &
/usr/share/novnc/utils/novnc_proxy --vnc "localhost:${VNC_PORT}" --listen "${NOVNC_PORT}" &

/app/SpotiFLAC &

wait -n
