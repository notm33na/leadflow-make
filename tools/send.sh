#!/usr/bin/env bash
# LeadFlow: send ONE test case directly to the Make webhook (Git Bash).
#
#   bash tools/send.sh T-01      expand tests/payloads/<file for T-01> and send it once
#   bash tools/send.sh new-run   start a new RUN_ID (fresh emails, so re-runs don't hit dedupe)
#   bash tools/send.sh status    show the current RUN_ID and how many sends it has
#
# Expansion matches payload-tester:
#   {{TEST_EMAIL+tag}} -> local+tag-RUN_ID@domain (from TEST_EMAIL in .env)
#   {{RUN_ID}}         -> current RUN_ID
#   {{SUBMISSION_ID}}  -> fresh UUID v4 (T-13 reuses T-12's id from the same run)
# Sends with header x-make-apikey (a deliberately wrong key for T-08), saves the expanded
# payload and response under tests/responses/ (gitignored), prints only HTTP status + body,
# and appends one line to tests/results.md. Never prints secrets or the expanded email.
# Max 10 sends per RUN_ID unless FORCE=1.

set -euo pipefail
cd "$(dirname "$0")/.."

RESP_DIR="tests/responses"
RUN_FILE="$RESP_DIR/.run_id"
RESULTS="tests/results.md"
MANIFEST="tests/payloads/manifest.json"
mkdir -p "$RESP_DIR"

new_run_id() { date -u +%m%d%H%M; }

current_run_id() {
  if [[ ! -s "$RUN_FILE" ]]; then new_run_id > "$RUN_FILE"; fi
  tr -d '[:space:]' < "$RUN_FILE"
}

sends_in_run() {
  [[ -f "$RESULTS" ]] || { echo 0; return; }
  grep -c -F "| $1 |" "$RESULTS" || true
}

cmd="${1:-}"
case "$cmd" in
  "" | -h | --help)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  new-run)
    new_run_id > "$RUN_FILE"
    echo "New RUN_ID: $(current_run_id)"
    exit 0 ;;
  status)
    run="$(current_run_id)"
    echo "RUN_ID: $run · sends in this run: $(sends_in_run "$run")/10"
    exit 0 ;;
esac

TEST_ID="$cmd"

# --- secrets: load without echoing, check without printing values ---
if [[ ! -f .env ]]; then echo "Error: .env not found (copy .env.example and fill it in)." >&2; exit 1; fi
set -a; source .env; set +a
for var in MAKE_WEBHOOK_URL WEBHOOK_SECRET TEST_EMAIL; do
  val="${!var:-}"
  if [[ -z "$val" || "$val" == *"<"* ]]; then echo "Error: $var is missing or still a placeholder in .env." >&2; exit 1; fi
done

# --- look up the test in the manifest ---
entry="$(node -e '
  const m = require("./" + process.argv[1]);
  const c = m.cases.find((x) => x.id === process.argv[2]);
  if (!c) process.exit(2);
  const route = Array.isArray(c.route) ? c.route.join("|") : c.route;
  console.log([c.file, c.http, route, c.credits].join("\t"));
' "$MANIFEST" "$TEST_ID")" || { echo "Error: $TEST_ID is not in $MANIFEST (proxy/form tests -P/-F are not sent with this script)." >&2; exit 1; }
IFS=$'\t' read -r FILE EXPECTED_HTTP ROUTE CREDITS <<< "$entry"

RUN_ID="$(current_run_id)"
count="$(sends_in_run "$RUN_ID")"
if (( count >= 10 )) && [[ "${FORCE:-}" != "1" ]]; then
  echo "Error: RUN_ID $RUN_ID already has $count sends (cap 10). Run 'bash tools/send.sh new-run' or set FORCE=1." >&2
  exit 1
fi

# --- submission id ---
ID_FILE_T12="$RESP_DIR/$RUN_ID.T-12.id"
if [[ "$TEST_ID" == "T-13" ]]; then
  [[ -s "$ID_FILE_T12" ]] || { echo "Error: T-13 reuses T-12's submission_id; send T-12 first in this run." >&2; exit 1; }
  SUB_ID="$(tr -d '[:space:]' < "$ID_FILE_T12")"
else
  SUB_ID="$(node -e 'console.log(require("crypto").randomUUID())')"
fi
[[ "$TEST_ID" == "T-12" ]] && printf '%s\n' "$SUB_ID" > "$ID_FILE_T12"

# --- expand the payload (TEST_EMAIL read from the environment, never printed) ---
PAYLOAD="$RESP_DIR/$RUN_ID.$TEST_ID.json"
RESP="$RESP_DIR/$RUN_ID.$TEST_ID.response.txt"
RUN_ID="$RUN_ID" SUB_ID="$SUB_ID" node -e '
  const fs = require("fs");
  const [src, dest] = process.argv.slice(1);
  const [local, domain] = process.env.TEST_EMAIL.split("@");
  const out = fs.readFileSync(src, "utf8")
    .replace(/\{\{TEST_EMAIL\+([A-Za-z0-9-]+)\}\}/g, (_, tag) => `${local}+${tag}-${process.env.RUN_ID}@${domain}`)
    .replace(/\{\{RUN_ID\}\}/g, process.env.RUN_ID)
    .replace(/\{\{SUBMISSION_ID\}\}/g, process.env.SUB_ID);
  JSON.parse(out); // fail early on broken JSON
  fs.writeFileSync(dest, out);
' "tests/payloads/$FILE" "$PAYLOAD"

# --- key header via a temp file, so the key never appears in the process list or output ---
HDR="$RESP_DIR/.hdr.$$"
trap 'rm -f "$HDR"' EXIT
if [[ "$TEST_ID" == "T-08" ]]; then
  KEY="deliberately-wrong-key-T-08-$(date +%s)"
else
  KEY="$WEBHOOK_SECRET"
fi
printf 'x-make-apikey: %s\n' "$KEY" > "$HDR"
unset KEY

# --- send exactly once ---
CURL_OUT="$(curl -s --max-time 30 -o "$RESP" -w '%{http_code} %{time_total}' \
  -H 'Content-Type: application/json' -H @"$HDR" \
  --data-binary @"$PAYLOAD" "$MAKE_WEBHOOK_URL" || true)"
HTTP_CODE="${CURL_OUT%% *}"
RESP_TIME="${CURL_OUT##* }"
[[ -n "$HTTP_CODE" ]] || HTTP_CODE="000"
[[ "$CURL_OUT" == *" "* ]] || RESP_TIME="?"
[[ -f "$RESP" ]] || : > "$RESP"

# --- body with any email address masked, single line for the results table ---
BODY="$(node -e '
  const t = require("fs").readFileSync(process.argv[1], "utf8");
  console.log(t.replace(/[^\s"<>@]+@[^\s"<>]+/g, "[email]").trim());
' "$RESP")"
BODY_LINE="$(printf '%s' "$BODY" | tr '\r\n' '  ' | sed 's/|/\\|/g' | cut -c1-200)"

echo "$TEST_ID · $FILE · RUN_ID $RUN_ID · submission_id $SUB_ID"
echo "HTTP $HTTP_CODE in ${RESP_TIME}s (expected $EXPECTED_HTTP; route $ROUTE; ~$CREDITS credits at full build)"
echo "Body: ${BODY:-<empty>}"

# --- results log (tag/RUN_ID only, never the expanded email) ---
if [[ ! -f "$RESULTS" ]]; then
  {
    echo "# Test results"
    echo
    echo "Appended by \`tools/send.sh\`. Emails are never recorded; see PRD §11 for expectations."
    echo
    echo "| UTC time | Test | File | RUN_ID | submission_id | HTTP | Expected | Response (first 200 chars) |"
    echo "|---|---|---|---|---|---|---|---|"
  } > "$RESULTS"
fi
echo "| $(date -u +%Y-%m-%dT%H:%M:%SZ) | $TEST_ID | $FILE | $RUN_ID | $SUB_ID | $HTTP_CODE (${RESP_TIME}s) | $EXPECTED_HTTP | $BODY_LINE |" >> "$RESULTS"
