#!/usr/bin/env bash
# One-shot setup for Hub's daily reminders on a Coolify server running Supabase. Run it ON the server, as root,
# from a folder that also holds 006_reminders.sql and index.ts (README → Daily reminders shows the two commands).
# It: runs the reminders SQL, installs the "remind" Edge Function, saves the keys next to it, restarts the
# functions container, tests the function, and prints the secret the hourly n8n call needs. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
[ -f 006_reminders.sql ] && [ -f index.ts ] || fail "006_reminders.sql and index.ts must be in the same folder as this script."
command -v docker >/dev/null || fail "Docker isn't here. Run this on the server Coolify uses."

# Find Supabase through Docker rather than guessing paths: the Edge Functions container runs the
# supabase/edge-runtime image, and the database and auth containers are in the same Compose project.
FN=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /edge-runtime/ {print $1; exit}')
if [ -z "$FN" ]; then
  found=$(docker ps --format '  {{.Names}}  ({{.Image}})' | grep -i supabase || true)
  [ -n "$found" ] || fail "No Supabase containers are running on this server. Is Supabase hosted on a different server?"
  fail "Supabase runs here, but not its Edge Functions container. Its running containers are:
$found
In Coolify, open the Supabase service, make sure supabase-edge-functions is enabled and running, then run this again."
fi
PROJECT=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$FN")
sibling() { docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Image}}' | awk -v img="$1" '$2 ~ img {print $1; exit}'; }
DB=$(sibling 'supabase/postgres'); AUTH=$(sibling 'gotrue')
[ -n "$DB" ] || fail "Found $FN but not Supabase's database container next to it."
# Where the container's /home/deno/functions lives on this server, if it's a mounted folder (it survives redeploys).
FN_DIR=$(docker inspect -f '{{range .Mounts}}{{println .Destination "|" .Source}}{{end}}' "$FN" | sed -n 's#^/home/deno/functions/* | ##p' | head -n1)
say "Found Supabase: $FN and $DB."

say "1/5  Database: running 006_reminders.sql"
docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -t < 006_reminders.sql | grep -v '^\s*$' || fail "The SQL failed (see above)."

say "2/5  Keys: paste the two lines from 'node scripts/vapid-keys.mjs' (only the part after the = sign)"
read -rp "VAPID_PUBLIC_KEY: " PUB
read -rsp "VAPID_PRIVATE_KEY (hidden while you paste): " PRIV; echo
read -rp "Your email (push services only use it if something breaks): " MAIL
PUB=${PUB#VAPID_PUBLIC_KEY=}; PRIV=${PRIV#VAPID_PRIVATE_KEY=}; PUB=${PUB//[[:space:]]/}; PRIV=${PRIV//[[:space:]]/}
[[ $PUB =~ ^[A-Za-z0-9_-]{87}$ ]] || fail "That public key doesn't look right (it should be 87 characters of letters, digits, - and _)."
[[ $PRIV =~ ^[A-Za-z0-9_-]{43}$ ]] || fail "That private key doesn't look right (it should be 43 characters)."
[[ $MAIL == ?*@?*.?* && $MAIL != *[[:space:]\"\\]* ]] || fail "That email doesn't look right."

say "3/5  Installing the remind function"
# Keep the secret on re-runs, so the n8n call keeps working.
SECRET=$(docker exec "$FN" cat /home/deno/functions/remind/keys.json 2>/dev/null | grep -o '"REMIND_SECRET":"[^"]*"' | cut -d'"' -f4 || true)
[ -n "$SECRET" ] || SECRET=$(openssl rand -hex 32)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/remind"
cp index.ts "$TMP/remind/index.ts"
printf '{"VAPID_PUBLIC_KEY":"%s","VAPID_PRIVATE_KEY":"%s","VAPID_SUBJECT":"mailto:%s","REMIND_SECRET":"%s"}\n' "$PUB" "$PRIV" "$MAIL" "$SECRET" > "$TMP/remind/keys.json"
chmod 644 "$TMP/remind/keys.json" # the container must read it; it never leaves this server
if [ -n "$FN_DIR" ]; then
  mkdir -p "$FN_DIR/remind" && cp "$TMP/remind/"* "$FN_DIR/remind/"
  echo "Saved in $FN_DIR/remind"
else
  # No mounted folder: copy straight into the container. A Supabase redeploy in Coolify removes it again.
  docker cp "$TMP/remind" "$FN:/home/deno/functions/" >/dev/null
  NOTE="If you ever redeploy Supabase in Coolify, run this script again: the function lives inside its container."
  echo "Copied into $FN"
fi

say "4/5  Restarting $FN"
docker restart "$FN" >/dev/null

say "5/5  Testing (the first run downloads a library, so this can take a minute)"
envof() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p" | head -n1; }
ANON=$(envof "$FN" SUPABASE_ANON_KEY)
URL=$( [ -n "$AUTH" ] && envof "$AUTH" API_EXTERNAL_URL || true )
[ -n "$ANON" ] && [ -n "$URL" ] || fail "Installed, but couldn't work out the Supabase URL to test it. Test it from README step 4 instead."
OUT=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  OUT=$(curl -s -m 60 -X POST "${URL%/}/functions/v1/remind" -H "Authorization: Bearer $ANON" -H "x-remind-secret: $SECRET" || true)
  case "$OUT" in *'"sent"'*) break ;; esac
  sleep 5
done
case "$OUT" in
  *'"sent"'*) say "It works. Answer: $OUT" ;;
  *) fail "The function didn't answer as expected. Its reply was: ${OUT:-nothing}. Check: docker logs $FN --tail 50" ;;
esac

[ -n "${NOTE:-}" ] && say "$NOTE"
say "Done. Copy these two lines for the last step (the hourly call in n8n):"
echo "URL:           ${URL%/}/functions/v1/remind"
echo "REMIND_SECRET: $SECRET"
