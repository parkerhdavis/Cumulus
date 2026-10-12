#!/bin/sh
# Shares the host's real X session (mounted X socket + Xauthority). The VNC
# password comes from .env (8 effective chars — the VNC auth format truncates),
# stored at startup so changes to .env apply on the next recreate.
set -e

mkdir -p /tmp/x11vnc
# -storepasswd exits nonzero on an empty password, which is the guard we want.
x11vnc -storepasswd "${DESKTOP_PASSWORD:?DESKTOP_PASSWORD must be set in .env}" /tmp/x11vnc/passwd

# -forever: keep listening after a client disconnects; -shared: allow several
# viewers. -noshm: containers can't attach the host's SysV shm segments
# (MIT-SHM BadAccess) — slower polling without it, but it works. Everything
# else defaults sensibly for an on-prem tunnel.
exec x11vnc \
	-display "${X_DISPLAY:-unix:0}" \
	-auth "${X_AUTHORITY:-/var/run/lightdm/root/:0}" \
	-rfbauth /tmp/x11vnc/passwd \
	-forever \
	-shared \
	-noshm