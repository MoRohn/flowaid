# TypeSafe AI (Jev) System One API — verified live 2026-09-22

Base URL: https://api.typesafe.ai
Auth: `Authorization: Bearer <TYPESAFE_API_KEY>` (env var in repo `.env.local`)
Request id header on responses: `x-typesafe-request-id`

## GET /v1/models

```json
{
  "models": [
    { "name": "jev-latest", "description": "...", "release_date": "2026-09-10T18:38:01Z" },
    { "name": "jev-preview", "description": "...", "release_date": "..." }
  ]
}
```

jev-latest → jev-1.13.0 currently.

## POST /v1/systemone

Request:

```json
{
  "model": "jev-latest",
  "state": { "message": "my card was stolen", "customer_tier": "gold" }, // string | object | array of text
  "questions": {
    "urgent": {
      "type": "noul",
      "instructions": "Is this support request urgent?",
      "criteria": { "true": "Requires immediate attention", "false": "Can wait" }
    }, // criteria optional
    "team": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Invoices, charges, refunds",
        "security": "Fraud, stolen cards",
        "technical_support": "Bugs",
        "sales": "Purchasing"
      }
    }, // criteria REQUIRED, map optionKey→description, ≤255 options
    "risk": {
      "type": "score",
      "instructions": "How risky is this situation?",
      "criteria": ["No risk", "Low risk", "Moderate risk", "High risk", "Critical risk"]
    } // criteria REQUIRED, ordered array of 2–10 level descriptions
  }
}
```

Response (actual):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "urgent": { "type": "noul", "noul": 0.96 },
    "team": {
      "type": "choice",
      "choice": "security",
      "confidence": 1.0,
      "probabilities": { "sales": 0.0, "security": 1.0, "billing": 0.0, "technical_support": 0.0 }
    },
    "risk": {
      "type": "score",
      "score": 3.72,
      "confidence": 0.77,
      "legend": {
        "0": "No risk",
        "1": "Low risk",
        "2": "Moderate risk",
        "3": "High risk",
        "4": "Critical risk"
      },
      "probabilities": { "0": 0.0, "1": 0.0, "2": 0.0, "3": 0.27, "4": 0.73 }
    }
  },
  "usage": { "input_tokens": 469, "output_tokens": 76 }
}
```

Semantics: noul = P(yes) in [0,1], no separate confidence (0.5 = undecided). choice/score carry `confidence` in [0,1] derived from the distribution. score is probability-weighted fractional value in [0, levels-1]. Multiple independent questions against the same state are batched in one request (this is the native batching mechanism).

Errors:

- 401 `{"detail":{"error_type":"authentication_error","message":"..."}}`
- 422 `{"detail":[{"type":"missing","loc":["body","questions","team","choice","criteria"],"msg":"Field required","input":{...}}]}`
- 429 rate limited (exponential backoff), 529 overloaded.

Limits: 64k tokens/request, 32k tokens for state + longest question; ~1,200 rpm; text only (no images). Pricing: $0.042 per million input tokens, output free.
