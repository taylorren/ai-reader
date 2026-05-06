#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
SERVICE_TEMPLATE="$REPO_DIR/deploy/reader3.service"
SERVICE_NAME="reader3.service"
SERVICE_TARGET="/etc/systemd/system/$SERVICE_NAME"
RUN_AS_USER=${SUDO_USER:-${USER}}
RUN_AS_GROUP=$(id -gn "$RUN_AS_USER")
RUN_AS_HOME=$(getent passwd "$RUN_AS_USER" | cut -d: -f6)
UV_BIN=""

for candidate in \
    "$REPO_DIR/.venv/bin/uv" \
    "$RUN_AS_HOME/.local/bin/uv" \
    "$(command -v uv 2>/dev/null || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
        UV_BIN="$candidate"
        break
    fi
done

if [[ ! -f "$SERVICE_TEMPLATE" ]]; then
    echo "Missing service template: $SERVICE_TEMPLATE" >&2
    exit 1
fi

if [[ -z "$UV_BIN" ]]; then
    echo "uv was not found. Checked .venv/bin/uv, $RUN_AS_HOME/.local/bin/uv, and PATH." >&2
    exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "Run this installer with sudo so it can write $SERVICE_TARGET and enable the service." >&2
    exit 1
fi

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

sed \
    -e "s|__WORKDIR__|$REPO_DIR|g" \
    -e "s|__USER__|$RUN_AS_USER|g" \
    -e "s|__GROUP__|$RUN_AS_GROUP|g" \
    -e "s|__UV_BIN__|$UV_BIN|g" \
    "$SERVICE_TEMPLATE" > "$tmpfile"

install -m 0644 "$tmpfile" "$SERVICE_TARGET"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl status "$SERVICE_NAME" --no-pager