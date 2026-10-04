// Unit checks for web/netlify/functions/lead-proxy.mjs with a mocked Make webhook (no network).
// Run: node tools/test-proxy.mjs
const { default: handler } = await import(new URL('../web/netlify/functions/lead-proxy.mjs', import.meta.url));

process.env.MAKE_WEBHOOK_URL = 'https://mock.invalid/hook';
process.env.WEBHOOK_SECRET = 'mock-secret';
process.env.CONTACT_EMAIL = 'contact@example.com';

let upstream;
let calls = 0;
let lastHeaders;
globalThis.fetch = async (url, init) => {
  calls++;
  lastHeaders = init.headers;
  return upstream();
};
const realLog = console.log;
console.log = () => {};

const good = {
  schema_version: '1', submission_id: '3f1c2a9e-1b2c-4d3e-8f90-123456789abc', name: 'A B', email: 'a@b.example',
  service: 'seo', budget: '2k_5k', timeline: 'asap', message: 'x'.repeat(30), consent: true, fax_number: '', fill_time_ms: 5000,
};
const req = (method, body) => new Request('https://site.example/api/lead', { method, body });
const makeOk = () => new Response(JSON.stringify({ ok: true, status: 'accepted', submission_id: good.submission_id, message: 'Thanks' }), { status: 200 });
const results = [];

async function check(name, request, mock, expStatus, expCalls, extra) {
  upstream = mock;
  calls = 0;
  const res = await handler(request);
  const body = await res.json();
  const ok = res.status === expStatus && calls === expCalls && (!extra || extra(body));
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}: status ${res.status}, upstream calls ${calls}${ok ? '' : ' body=' + JSON.stringify(body)}`);
}

await check('GET rejected', req('GET'), makeOk, 405, 0);
await check('oversized body', req('POST', JSON.stringify({ ...good, message: 'x'.repeat(11000) })), makeOk, 413, 0);
await check('invalid JSON', req('POST', '{nope'), makeOk, 400, 0);
await check('array body', req('POST', '[1]'), makeOk, 400, 0);
await check('honeypot dropped', req('POST', JSON.stringify({ ...good, fax_number: '123' })), makeOk, 200, 0, (b) => b.ok && b.submission_id === good.submission_id);
await check('too fast dropped', req('POST', JSON.stringify({ ...good, fill_time_ms: 900 })), makeOk, 200, 0);
await check('valid forwarded', req('POST', JSON.stringify(good)), makeOk, 200, 1, (b) => b.ok === true);
results.push(`${lastHeaders['x-make-apikey'] === 'mock-secret' && !('x-leadflow-secret' in lastHeaders) ? 'PASS' : 'FAIL'}  secret sent as x-make-apikey (Make webhook API key)`);
await check('missing fill time forwarded', req('POST', JSON.stringify({ ...good, fill_time_ms: undefined })), makeOk, 200, 1);
await check('422 passed through', req('POST', JSON.stringify(good)), () => new Response(JSON.stringify({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Check', fields: ['email'] } }), { status: 422 }), 422, 1, (b) => b.error.fields[0] === 'email');
await check('plain-text Accepted -> 502', req('POST', JSON.stringify(good)), () => new Response('Accepted', { status: 200 }), 502, 1, (b) => b.error.message.includes('contact@example.com'));
await check('Make API-key rejection (401 text) -> 502', req('POST', JSON.stringify(good)), () => new Response('Unauthorized', { status: 401 }), 502, 1, (b) => b.error.code === 'UPSTREAM_UNAVAILABLE');
await check('Make API-key rejection (403 JSON) -> 502', req('POST', JSON.stringify(good)), () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }), 502, 1);
await check('Queue is full -> 502', req('POST', JSON.stringify(good)), () => new Response('Queue is full', { status: 400 }), 502, 1);
await check('timeout -> 504', req('POST', JSON.stringify(good)), () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, 504, 1);
await check('network error -> 502', req('POST', JSON.stringify(good)), () => { throw new TypeError('fetch failed'); }, 502, 1);
delete process.env.WEBHOOK_SECRET;
await check('missing env -> 502', req('POST', JSON.stringify(good)), makeOk, 502, 0);

console.log = realLog;
console.log(results.join('\n'));
const allPass = results.every((r) => r.startsWith('PASS'));
console.log(allPass ? `\nALL PASS (${results.length})` : '\nFAILURES');
process.exitCode = allPass ? 0 : 1;
