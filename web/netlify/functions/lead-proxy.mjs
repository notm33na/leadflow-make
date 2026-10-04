// LeadFlow lead proxy (docs/ARCHITECTURE.md §5.7, PRD FR-2).
// POST /api/lead -> adds Make's webhook API key (x-make-apikey) server-side and forwards to the Make webhook.
// Env: MAKE_WEBHOOK_URL, WEBHOOK_SECRET, CONTACT_EMAIL. Never logs request bodies.

const MAX_BYTES = 10 * 1024;
// Make normally replies in under 2 s (DECISIONS #50); 30 s is a safety margin for slow runs.
// Netlify synchronous functions may run for up to 60 s (#54).
const UPSTREAM_TIMEOUT_MS = 30_000;
const MIN_FILL_TIME_MS = 3000;
const ACCEPTED_MESSAGE = "Thanks! We've received your enquiry and will be in touch shortly.";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function fail(status, code, message) {
  return json(status, { ok: false, error: message ? { code, message } : { code } });
}

function upstreamMessage() {
  const contact = process.env.CONTACT_EMAIL || 'the address on our website';
  return `We couldn't confirm your enquiry was received. Please email us at ${contact}.`;
}

function log(event, fields) {
  // Status codes and submission_id only (§5.7 logging rule).
  console.log(JSON.stringify({ event, ...fields }));
}

// Mirrors the Make R1 bot route: honeypot filled, or a numeric fill time under 3 s.
function isBot(payload) {
  const honeypot = payload.fax_number;
  if (typeof honeypot === 'string' ? honeypot.length > 0 : honeypot != null && honeypot !== '') return true;
  const fill = payload.fill_time_ms;
  if (fill === undefined || fill === null || fill === '') return false; // Make answers 422 for a missing value
  const n = Number(fill);
  return Number.isFinite(n) && n < MIN_FILL_TIME_MS;
}

export default async function handler(req) {
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return fail(413, 'PAYLOAD_TOO_LARGE');
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return fail(413, 'PAYLOAD_TOO_LARGE');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return fail(400, 'INVALID_JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(400, 'INVALID_JSON');

  const submissionId = typeof payload.submission_id === 'string' ? payload.submission_id.slice(0, 64) : '';

  if (isBot(payload)) {
    log('bot_dropped', { status: 200, submission_id: submissionId });
    return json(200, { ok: true, status: 'accepted', submission_id: submissionId, message: ACCEPTED_MESSAGE });
  }

  const webhookUrl = process.env.MAKE_WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!webhookUrl || !secret) {
    log('misconfigured', { status: 502, submission_id: submissionId });
    return fail(502, 'UPSTREAM_UNAVAILABLE', upstreamMessage());
  }

  let res;
  try {
    // Single attempt only: the proxy never retries (§7.2).
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-make-apikey': secret },
      body: raw,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    log(timedOut ? 'upstream_timeout' : 'upstream_error', { status: timedOut ? 504 : 502, submission_id: submissionId });
    return timedOut
      ? fail(504, 'UPSTREAM_TIMEOUT', upstreamMessage())
      : fail(502, 'UPSTREAM_UNAVAILABLE', upstreamMessage());
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // Make platform replies ("Accepted", "Queue is full", API-key rejections) may be plain text.
  }

  if (res.status === 200 && data && data.ok === true) {
    log('accepted', { status: 200, upstream: res.status, submission_id: submissionId });
    return json(200, data);
  }
  if (res.status === 422 && data && typeof data === 'object') {
    log('rejected', { status: 422, upstream: res.status, submission_id: submissionId });
    return json(422, data);
  }
  log('upstream_unexpected', { status: 502, upstream: res.status, submission_id: submissionId });
  return fail(502, 'UPSTREAM_UNAVAILABLE', upstreamMessage());
}
