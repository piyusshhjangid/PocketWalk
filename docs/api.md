# API reference

PocketWalk exposes three endpoints. All bodies are JSON. Every error is `{ "error": "<fixed text>" }`: the server never returns stack traces, exception text, prompts or provider errors.

| Method and path | Purpose |
|---|---|
| `POST /walks/plan` | Plan a walk (the only expensive endpoint; rate limited and concurrency capped) |
| `GET /health` | Liveness: `200 { status, service, uptimeSeconds }` while the process runs, including while draining. Never calls a provider |
| `GET /ready` | Readiness: `200 { status: "ready" }`, or `503 { status: "unavailable", reason: "starting" \| "shutting_down" }`. Makes no outbound calls |

## `POST /walks/plan`

### Request
`Content-Type: application/json`, body at most 10 kB.

| Field | Type | Rules |
|---|---|---|
| `minutes` | number | exactly `10`, `20` or `40` |
| `energy` | string, optional | `"easy"` or `"normal"` (default `"normal"`) |
| `location` | object, optional | `{ "city": "<letters, 2-80 characters>" }`. A city name only: no coordinates, by design |

Unknown fields are ignored and never echoed. The city is used for one weather lookup and is never stored, logged, traced or returned.

```bash
curl -X POST localhost:3000/walks/plan -H 'content-type: application/json' \
  -d '{"minutes":20,"energy":"easy","location":{"city":"Jalandhar"}}'
```

### Successful response (`200`)
```json
{
  "plan": { "title": "…", "steps": [{ "minutes": 8, "text": "…" }, "…3 steps…"], "notice": "…" },
  "meta": {
    "planner": "model",
    "provider": "google",
    "model": "gemma-4-26b-a4b-it",
    "validation": { "parse": "passed", "schema": "passed", "business": "passed", "safety": "passed", "repaired": false, "repairs": [] },
    "modelLatencyMs": 0, "validationLatencyMs": 0, "safetyLatencyMs": 0, "durationMs": 0,
    "contextLatencyMs": 0, "weatherLatencyMs": 0,
    "context": {
      "weather": "ok", "daylight": "ok", "timeOfDay": "afternoon", "daylightPhase": "day",
      "conditions": { "condition": "rain", "temperatureC": 15, "temperatureBand": "cool", "precipitation": "moderate", "wind": "calm" },
      "guidance": ["wet"]
    }
  }
}
```
The numbers are placeholders, not measurements. The step minutes always add up to the requested `minutes`.

- **`meta.planner`** is `"model"` (Gemma's plan passed every check) or `"fallback"` (a deterministic walk). Fallback text is never labelled as AI.
- A model plan that only needed harmless normalisation is still `"model"` with `validation.repaired: true`.
- **`meta.context.weather`** is `ok`, `unavailable` (with `weatherFailure`: `not_configured`, `location_not_found`, `timeout`, `unavailable`, `rate_limited`, `misconfigured`, `malformed`, `unknown`) or `not_requested` (no location sent). The context never contains a location.
- **On fallback** the response has `"planner": "fallback"` and `fallbackReason` (`timeout`, `not_configured`, `unavailable`, `rate_limited`, `misconfigured`, `empty_response`, `invalid_json`, `schema_invalid`, `business_rule`, `safety_violation`, `unknown`), `fallbackSource` (`deterministic`, or `emergency` if even the fallback failed validation), a fixed `message`, and `fallbackLatencyMs`.
- `validation.<stage>` is `not_run` when that stage never saw the output.

### Errors
| Status | When | Body |
|---|---|---|
| `400` | invalid input, malformed JSON, wrong content type | `Invalid request: minutes must be 10, 20 or 40 ...` (validation) or `Bad request` (parser) |
| `404` | unknown path or wrong method (always JSON, never the HTML page) | `Not found` |
| `413` | body over 10 kB | `Bad request` |
| `429` | rate limit exceeded (default 20 plans per minute per client); has `Retry-After` | `Too many requests. Please try again in a moment.` |
| `503` | concurrency cap reached (default 8 simultaneous plans); has `Retry-After` | `PocketWalk is busy right now. Please try again in a moment.` |
| `504` | request deadline passed and not even the safe fallback could be built | `This took longer than expected. Please try again.` |
| `500` | unexpected bug | `Internal server error` |

A model or weather failure is **not** an error: the caller gets `200` with a valid fallback walk and `meta.planner: "fallback"`.

## Where the behaviour is specified
`docs/architecture.md` describes the pipeline (context, prompt, model, validation, safety, fallback), the request deadline and cancellation, limits, shutdown and the Sentry privacy controls. Per-checkpoint evidence lives in `docs/checkpoints/`.
