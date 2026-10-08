# Live smoke test: LeadFlow demo

**Date:** 2026-10-08 · **Sent at:** 2026-10-08T18:32:21Z · **Result:** ❌ **FAIL** (2 of 4 checks failed, 1 passed, 1 partly passed. Root causes: the scenario was switched off by hand, and the Gemini latency is at the M13 timeout. Fixes specified.)

All data is **synthetic test data**: payload `tests/payloads/01-hot.json` (T-01). No real enquiry was involved.

## What was sent

| Item | Value |
|---|---|
| Endpoint | `POST https://m-and-s-leadflow-demo.netlify.app/api/lead`, rewritten by `netlify.toml` to `lead-proxy`, the same path the browser form uses. Make was not called directly. |
| Payload | T-01 hot lead (`web_design`, `over_10k`, `asap`), `fill_time_ms` 64210, honeypot empty, `submitted_at` set to send time, `page_url` = live site with UTM |
| `submission_id` | `4b44a2ca-9c2d-4ab5-9c30-92a35cb582db` |
| Lead email | `TEST_EMAIL` from `.env`, sub-addressed with tag `hot-smk10081832` (address not recorded here) |
| Disposable inbox | Not used. The project owner chose `TEST_EMAIL` instead of a third-party inbox service. |
| Sends | **1** (budget: 1). No retries. |
| Netlify deploy | `6ac2abf8baa0d743175e7136` (published 2026-10-04T19:41:53Z, function `lead-proxy`, Node 22) |

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Form response: HTTP 200, `ok:true` | ❌ **FAIL** | `HTTP 502` in **2.98 s** (time to first byte 2.96 s). Body: `{"ok":false,"error":{"code":"UPSTREAM_UNAVAILABLE","message":"We couldn't confirm your enquiry was received. Please email us at [contact email]"}}`. Netlify request ID `01M4ECKBNK3X5XS8TG8WJ37ZV3`. Cause: the scenario was **switched off**, so Make queued the request (finding 1). |
| 2 | AI scoring: tier `hot`, `scoring_method = ai` | ❌ **FAIL** | Make run log: **M13 HTTP · Gemini score** `+20.0s` → "An error has been caught during operation" (the 20 s timeout), Resume. **M14** parse error caught, Resume. So M15 used the rules fallback: `scoring_method = rules_fallback`, `ai_error = ai_unavailable` (ARCHITECTURE §5.4). The lead was still routed **hot** (M16, M17, M18 ran), but by rules, not AI. Cause: Gemini latency (finding 2). |
| 3 | Personalised email arrived in the lead's inbox | 🟡 **Sent; opener expected to be the default** | Make run log: **M18 Gmail · personalised reply** "The operation was completed" (+1.0 s). M14 returned no opener, so by the M15 rule the email carries the **default** opener (*"Thanks for sharing the details of your project…"*). Inbox not read by Claude (`TEST_EMAIL`): confirm by hand. |
| 4 | Slack owner alert module succeeded | ✅ **PASS** | Make run log: **M17 Slack · hot alert** "The operation was completed" (+0.2 s). |

**Credits used: 12** (Make run log: Operations 12, Credits 12, Data size 14.8 KB). This is within the ≤ 12 budget and matches the hot-route credit table.

**Make run:** `bc66610b246f40c7a0735830da2f8f5c`, trigger *Instant*, duration **23 s**, started 2026-10-08 23:49:09 (Make UI local time, UTC+5 = **18:49:09Z**). This is about 17 min after the send, matching a queued request processed when the scenario was switched back on. The owner supplied the run log. The run is linked to this send by timing and route. Confirm with `Ref: 4b44a2ca-…` in the Slack alert.

## Findings

### 1. The scenario was off when the lead arrived → form showed an error (check 1)

- The proxy took 2.96 s and returned 502, so Make had answered without the JSON `ok:true` body.
- The only Make run for this lead started about **17 min later**. Its three Webhook response modules (M03, M04, M07) logged: *"Response can't be processed when scenario is not executed immediately on data arrival."*
- So Make **queued** the request while the scenario was inactive, replied to the proxy with its default plain-text `Accepted` (DECISIONS #18), and processed the lead once the scenario was active again. M04's real reply had nowhere to go. Recorded as **DECISIONS #58**.
- The proxy worked as designed. A visitor saw the fallback message with the contact email, and the lead was **not lost**, only late.
- **Why was it off?** The owner had **switched it off by hand** (confirmed 2026-10-08). There was no error, so no scenario fix is needed. The lesson is procedural: the pre-test checklist now starts with "scenario ON, webhook queue empty".

### 2. Gemini now takes about 17 s, against a 20 s M13 timeout → rules fallback (checks 2 and 3)

- In Make, M13 hit exactly its 20 s timeout.
- Local 0-credit calls with the same prompt and model (`node tools/gemini-smoke-test.mjs tests/payloads/01-hot.json`), three in a row: **16.9 s PASS** (AI score 90, hot), **1 FAIL** (reason not captured; consistent with the timeout), **17.3 s PASS** (`latency=17323ms`).
- Build step 8 measured about 3 s for the **whole** hot run, so Gemini latency has drifted up to the limit.
- The prompt already uses `thinkingLevel: low`, the lowest the model accepts (DECISIONS #25), so the lever is the timeout. Recorded as **DECISIONS #57**.

### 3. Proxy logs were unreadable (secondary)

The invocation was logged at 18:32:22.760Z with an **empty message** in Netlify's **historical** log API (`netlify logs --since`). After the redeploy, the same API still returned empty messages for every line, but the **live stream** (`netlify logs --follow`) showed the full line. The history API is the limitation, not the log format. For future live tests, start `netlify logs --source functions --function lead-proxy --follow` **before** the send, or use the Netlify UI. Either would have shown `upstream_unexpected upstream=200 reply=text_accepted` straight away.

## Fixes

| # | Fix | Where | Status |
|---|---|---|---|
| 1 | Keep the scenario **ON** for live tests. It was switched off by hand, not by an error (finding 1). Before every live test, check: scenario ON, webhook queue empty, credits left. | Make UI (owner) | ✅ The scenario has been on since about 18:49Z, judging by the run. |
| 2 | **M13 Timeout: 20 → 45 s.** Credits are unchanged. The form isn't affected, because M04 replies before M13 (#50). The worst-case run is about 1 min, far below Make Free's 5-min limit. | Make: M13 → *Timeout* = `45` (owner). Spec updated in the repo: ARCHITECTURE §5 M13 row, §7.2, §8; DECISIONS #30, #54, #57; `tools/gemini-smoke-test.mjs` mirrors 45 s. | ✅ Spec · ⏳ Make |
| 3 | Proxy logs: plain `key=value` text, plus `reply` = `json` / `text_accepted` / `text_queue_full` / `text_other` / `empty` on unexpected Make replies. Never bodies. `node tools/test-proxy.mjs`: **ALL PASS (18)**, including log-line and no-email assertions. ARCHITECTURE §5.7 updated. | `web/netlify/functions/lead-proxy.mjs` (commit `fe5b69c`) | ✅ **Deployed** 2026-10-08T18:58Z (deploy `6ac7e7b7b3f60cb640864ca9`). Verified with two 0-credit honeypot requests (bot drop, Make not called): `POST` → 200 `ok:true`, `GET` → 405, and the live log stream showed `lead-proxy event=bot_dropped status=200 submission_id=e2e049f7-…`. |
| 4 | Re-test: one T-01 through the proxy (about 12 credits) after fixes 1 and 2. Expect 200 `ok:true` in under 2 s, `scoring_method = ai`, a non-default opener, and M17 OK. Record the M13 duration against DECISIONS #57. | — | ⏳ Needs approval |

## Make API token (optional, for reading runs without the UI)

Make's API reads execution logs and details with only the **`scenarios:read`** scope ([scenario logs API](https://developers.make.com/api-documentation/api-reference/scenarios/logs)), at 0 credits: `GET /scenarios/{scenarioId}/logs`, `GET /scenarios/{scenarioId}/executions/{executionId}`, `GET /scenarios/{scenarioId}/modules/{moduleId}/logs`.

To create one ([official steps](https://developers.make.com/api-documentation/authentication/create-authentication-token)): avatar (bottom left) → **Profile** → **API** tab → **Add token**. Label it `leadflow-smoke-readonly`, tick **only `scenarios:read`**, save, and copy the token right away. Put it in `.env` as `MAKE_API_TOKEN`, with `MAKE_ZONE` (for example `eu1.make.com`) and `MAKE_SCENARIO_ID`.

Make's docs list API rate limits from Core (60/min) upwards and say nothing about Free ([rate limiting](https://developers.make.com/api-documentation/getting-started/rate-limiting)), so Free-plan API access is **unconfirmed** (🧪). Fallback: Make UI → History → the run, as used for this report.

## Note for IT

By design, the **owner** is alerted on **Slack** (#leadflow-alerts), and the **email goes to the lead** (the personalised reply, M18 on the hot route). There is **no separate notification email to the freelancer/owner**. Its absence is expected, not a fault.
