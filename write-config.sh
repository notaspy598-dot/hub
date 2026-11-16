#!/bin/sh
# Runs at container start (nginx's entrypoint hook): turns Coolify's env vars into public/config.js.
# A missing or malformed value stops the container, so a typo shows up in Coolify's logs, not as a blank page.
set -eu
OUT="${CONFIG_OUT:-/usr/share/nginx/html/config.js}"

case "${SUPABASE_URL:-}" in https://*) ;; *) echo "SUPABASE_URL must start with https://" >&2; exit 1 ;; esac
case "${SUPABASE_ANON_KEY:-}" in '' | *[!A-Za-z0-9._-]*) echo "SUPABASE_ANON_KEY is missing or has odd characters" >&2; exit 1 ;; esac
case "${LINK_WEBHOOK:-}" in '' | https://*) ;; *) echo "LINK_WEBHOOK must start with https:// (or be empty)" >&2; exit 1 ;; esac
case "$SUPABASE_URL${LINK_WEBHOOK:-}" in *[\'\\[:space:]]*) echo "SUPABASE_URL or LINK_WEBHOOK has a quote, backslash or space" >&2; exit 1 ;; esac
# Optional: the public half of the VAPID pair (scripts/vapid-keys.mjs). Empty hides the Daily reminder panel.
case "${VAPID_PUBLIC_KEY:-}" in *[!A-Za-z0-9_-]*) echo "VAPID_PUBLIC_KEY must be the base64url public key only" >&2; exit 1 ;; esac
# Optional: only to keep the cards an old Telegram bot chat made.
case "${TELEGRAM_ID:-}" in *[!0-9]*) echo "TELEGRAM_ID must be digits only, or left empty" >&2; exit 1 ;; esac

cat > "$OUT" <<EOF
export const SUPABASE_URL = '${SUPABASE_URL%/}';
export const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
export const LINK_WEBHOOK = '${LINK_WEBHOOK:-}';
export const TELEGRAM_ID = ${TELEGRAM_ID:-0};
export const VAPID_PUBLIC_KEY = '${VAPID_PUBLIC_KEY:-}';
EOF
echo "config.js written for ${SUPABASE_URL%/}"
