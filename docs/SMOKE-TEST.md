# Live smoke test: LeadFlow demo

**Date:** 2026-10-08 · **Sent at:** 2026-10-08T18:32:21Z · **Result:** ❌ **FAIL** (form check failed; other checks blocked or awaiting a human check)

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
| 1 | Form response: HTTP 200, `ok:true` | ❌ **FAIL** | `HTTP 502` in **2.98 s** (time to first byte 2.96 s). Body: `{"ok":false,"error":{"code":"UPSTREAM_UNAVAILABLE","message":"We couldn't confirm your enquiry was received. Please email us at [contact email]"}}`. Netlify request ID `01M4ECKBNK3X5XS8TG8WJ37ZV3`, served at `Thu, 08 Oct 2026 18:32:24 GMT`. |
| 2 | AI scoring: tier `hot`, `scoring_method = ai` | ⛔ **BLOCKED** | No Make API token in `.env`, so the execution log can't be read. The Leads sheet row (column U `scoring_method`) wasn't checked. |
| 3 | Personalised email arrived in the lead's inbox | 🟡 **Needs human check** | `TEST_EMAIL` was used (no disposable inbox), so Claude can't read that inbox. |
| 4 | Slack owner alert module succeeded | 🟡 **Needs human glance** | Blocked for the same reason as check 2. Check #leadflow-alerts. |

**Credits used:** unknown, between **0 and 12**. It depends on the cause below. Read the actual figure from Make → scenario → **History** (the run at about 18:32:22Z, if there is one).

## Diagnosis (no live systems changed)

The proxy (`web/netlify/functions/lead-proxy.mjs`) returns `502 UPSTREAM_UNAVAILABLE` in three cases:

1. `MAKE_WEBHOOK_URL` or `WEBHOOK_SECRET` is missing in the function environment. **Unlikely.** That branch makes no network call, so it would answer in milliseconds, not 2.96 s. Both variables exist on the Netlify project but are stored as secret values (the CLI lists them as empty), so their values couldn't be confirmed.
2. A network error reaching Make. **Unlikely.** A connection failure would normally fail fast, and a timeout would return `504` after 30 s.
3. **Make answered, but not with `200` + JSON `ok:true` (or `422` + JSON). Most likely.**

The **timing** is the main clue. When things work, M04 replies early, in 0.9–1.5 s, and a full hot run takes about 3 s (ARCHITECTURE §3, DECISIONS #50). A 2.96 s answer fits Make replying **at the end of a run**. ARCHITECTURE §4.2 documents this: Make sends a plain-text `200 Accepted` when no Webhook response module was reached, or when the request was only queued.

Possible causes, most likely first:

| Hypothesis | What you would see in Make | Was the lead processed? | Proposed fix (owner applies) |
|---|---|---|---|
| **A. M04 isn't replying.** M04 was disconnected or moved after a slow module, or it errored and its Resume handler swallowed the error. | A run at about 18:32:22Z in History. M04 shows an error, or the run has no M04 bundle. | **Probably yes**: Sheets row, Slack alert and email should all exist. | Reconnect M04 directly after R1 route 2, before M10/M13, with status `200` and the §4.2 body. Compare the live scenario against ARCHITECTURE §5 and re-export the blueprint. |
| **B. Scenario is OFF, or the organisation is paused for running out of credits** (Make Free: 1,000/month) | No run in History. The webhook queue shows 1 item. Credits are at or near 0. | **No, not yet.** ⚠️ The queued request **will run when the scenario is switched back on**. That spends about 12 credits and sends one email to the `TEST_EMAIL` sub-address. | Delete the queued item if you don't want it to run, then switch the scenario on (or wait for the credit reset). |
| **C. The webhook API key was rotated.** Make returns `401` because Netlify `WEBHOOK_SECRET` no longer matches. | No run in History. 0 credits used (DECISIONS #47). | No | Set Netlify `WEBHOOK_SECRET` to the current key on the Make webhook, then redeploy. |

**Secondary finding: proxy logs are unreadable.** The function invocation was logged at 2026-10-08T18:32:22.760Z, but its message is **empty** in Netlify's log API (`netlify logs --json`). The proxy's `event` / `upstream` status line (`upstream_unexpected`, `upstream: <code>`) was lost, and that would have identified the cause straight away. Proposed fix: confirm in the Netlify UI (Logs → Functions) whether the line appears there. If it doesn't, also log a plain string, e.g. `console.log(\`lead-proxy ${event} status=${status} upstream=${upstream}\`)`. Then verify with `node tools/test-proxy.mjs` and redeploy.

## Unblocking checks 2 and 4: Make API token

Make's API exposes execution logs and details. Reading them needs only the **`scenarios:read`** scope ([scenario logs API](https://developers.make.com/api-documentation/api-reference/scenarios/logs)). Endpoints: `GET /scenarios/{scenarioId}/logs`, `GET /scenarios/{scenarioId}/executions/{executionId}` (status and error, including the failing module), and `GET /scenarios/{scenarioId}/modules/{moduleId}/logs` (per-module status, for example `M17 Slack · hot alert`). These calls use **0 credits**.

To create a token ([official steps](https://developers.make.com/api-documentation/authentication/create-authentication-token)):

1. In Make, click your avatar (bottom left) → **Profile** → **API** tab → **Add token**.
2. Label it, e.g. `leadflow-smoke-readonly`, and tick **only `scenarios:read`**.
3. Save, and copy the token right away (it's partly hidden afterwards).
4. Add it to `.env` (gitignored) as `MAKE_API_TOKEN=…`. Also add `MAKE_ZONE=` (for example `eu1.make.com`, the host in your Make URL) and `MAKE_SCENARIO_ID=` (the number in the scenario's URL). Add placeholders for the same three to `.env.example`.

**Free-plan note:** Make's developer docs list API rate limits by plan starting at Core (60 requests/min) and say nothing about the Free plan ([rate limiting](https://developers.make.com/api-documentation/getting-started/rate-limiting)). Whether a Free organisation can use these endpoints is **unconfirmed** (🧪). Fallback: read the same information in the Make UI (scenario → History → the run → module bubbles).

## Human checks needed now (0 credits)

1. **Make → scenario → History:** is there a run at about 18:32:22Z? Note its status, credits used, and the status of M04, M13 (Gemini), M17 (Slack hot alert) and M18 (Gmail). Also check the scenario's ON toggle, the webhook queue and the credits left.
2. **`TEST_EMAIL` inbox:** look for a message to the `+hot-smk10081832` sub-address with subject *"Your Web design project with Media & Software Manager: next steps"*. Check that the second paragraph is **not** the default opener *"Thanks for sharing the details of your project. It sounds like a great fit for the work we do."*
3. **Slack #leadflow-alerts:** look for a hot-lead alert with `Ref: 4b44a2ca-9c2d-4ab5-9c30-92a35cb582db`.
4. **Leads sheet:** look for a row with that `submission_id`, with tier `hot` and `scoring_method` `ai`.

Even if all four pass (hypothesis A), check 1 stays **FAIL**: a real visitor would have seen an error message for a lead that was actually captured.

## Note for IT

By design, the **owner** is alerted on **Slack** (#leadflow-alerts), and the **email goes to the lead** (the personalised reply, M18 on the hot route). There is **no separate notification email to the freelancer/owner**. Its absence is expected, not a fault.
