# LeadFlow

**AI lead capture, qualification and routing on Make.com.** Built by **Media & Software Manager** on free tiers only.

Every enquiry gets an on-page reply in about **1 second**. Gemini scores it, hot leads reach the owner in **Slack within seconds** with a personalised email to the lead, and spam never reaches anyone. That costs **≤ 12 Make credits per lead**, and bots and bad keys cost **0**.

> *Demo form, synthetic test data, measured results.* No real customer data or outcomes are shown.

| | |
|---|---|
| 🎥 Demo video | [docs/demo-video.mp4](docs/demo-video.mp4) |
| 🌐 Live demo form | https://m-and-s-leadflow-demo.netlify.app/ |
| 📄 Case study | [docs/CASE-STUDY.md](docs/CASE-STUDY.md) |
| 🖼️ Screenshots | [scenario](docs/screenshots/make-scenario.png) · [Slack alerts](docs/screenshots/slack-hot-alerts.png) · [landing page](docs/screenshots/landing-page-dark.png) |
| 🧩 Build spec | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/PRD.md](docs/PRD.md) · [docs/DECISIONS.md](docs/DECISIONS.md) |

## Highlights
- **Custom webhook security:** Make's webhook API key, with the secret held by a Netlify Function proxy, never in the browser. Wrong keys are rejected before the scenario runs, at 0 credits.
- **Validation, dedupe and idempotency:**
  - 15-condition validation router.
  - Google Sheets lookup by email; returning leads are counted, not duplicated.
  - Replays are ignored.
- **AI scoring with a safety net:**
  - Gemini through Make's raw HTTP module, with a strict JSON schema and a versioned prompt.
  - Prompt-injection defence.
  - A deterministic rules score pre-screens spam and takes over if the AI fails. A deliberate outage test still captured, scored and routed the lead.
- **Tiered routing:** hot → Slack + personalised email; warm → standard email; cold → stored; spam → quarantine.
- **Production-minded error handling:**
  - Every module that can fail has a handler, with owner alerts and an Errors log.
  - Lead text is escaped before it goes into emails (verified) and Slack alerts.
- **Evidence over assumptions:** 56 logged platform decisions, each backed by official docs or a recorded test, and a zero-credit local smoke test for the AI prompt.

## Measured results (synthetic data)
| Route | Credits | | Metric | Result |
|---|---|---|---|---|
| Hot | 12 | | Form reply | 0.9–1.5 s |
| Warm | 11 | | AI tiers correct (8 cases) | 8/8 |
| Cold / AI spam | 10 | | AI outage → lead lost | 0 |
| Link spam (no AI call) | 6 | | Free-tier AI availability (Flash-Lite) | 12/12 calls |
| Duplicate / replay | 5 / 4 | | Running cost | £0 |
| Bot / wrong key | 2 (0 via proxy) / 0 | | | |

## Stack
Make.com (Free) · Google Gemini (free tier, Flash-Lite) · Google Sheets · Slack (Free) · Gmail · Netlify (Free)

## Repository
```
docs/        PRD, architecture, decisions log, case study, demo video, screenshots
prompts/     versioned Gemini system prompt (lead-scoring@1.1)
web/         landing page, Netlify Function proxy, netlify.toml
tools/       Gemini smoke test, proxy unit tests, send.sh test sender, JSON schemas
tests/       synthetic payloads + manifest
```

## Run the checks locally
```bash
node tools/gemini-smoke-test.mjs --offline   # payload, gate and rules checks (no API calls)
node tools/gemini-smoke-test.mjs             # live AI scoring check (needs GEMINI_API_KEY in .env)
node tools/test-proxy.mjs                    # proxy unit tests (mocked, no network)
bash tools/send.sh T-01                      # send one synthetic lead to the live scenario (spends credits)
```
Copy `.env.example` to `.env` first. Secrets never go in the repo.
