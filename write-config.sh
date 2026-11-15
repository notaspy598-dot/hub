#!/bin/sh
# Runs at container start (nginx's entrypoint hook): turns Coolify's env vars into public/config.js.
# A missing or malformed value stops the container, so a typo shows up in Coolify's logs, not as a blank page.
set -eu

case "${SUPABASE_URL:-}" in https://*) ;; *) echo "SUPABASE_URL must start with https://" >&2; exit 1 ;; esac
case "${SUPABASE_ANON_KEY:-}" in '' | *[!A-Za-z0-9._-]*) echo "SUPABASE_ANON_KEY is missing or has odd characters" >&2; exit 1 ;; esac
case "${TELEGRAM_ID:-}" in '' | *[!0-9]*) echo "TELEGRAM_ID must be your numeric Telegram user ID" >&2; exit 1 ;; esac
case "$SUPABASE_URL" in *[\'\\]*) echo "SUPABASE_URL has a quote or backslash" >&2; exit 1 ;; esac

cat > /usr/share/nginx/html/config.js <<EOF
export const SUPABASE_URL = '${SUPABASE_URL%/}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
export const TELEGRAM_ID = ${TELEGRAM_ID};
EOF
echo "config.js written for ${SUPABASE_URL%/}"
