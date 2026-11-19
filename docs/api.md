# API and contracts

Next move has two programmatic surfaces:

- **REST** under `/api/agent/*`, for any agent that can make HTTP requests.
- **MCP** at `/mcp`, a stateless JSON-RPC endpoint for clients that speak the Model Context
  Protocol (Claude Code, Cursor, Codex).

Both use the same `nmk_…` bearer keys and call the same functions in `server/data.ts`. The
differences are transport and shape, not rules.

Base URL is the deployment origin (for example `https://<space>.space.fast`). The MCP URL is
`<origin>/mcp`.

## 1. Authentication at a glance

| Route | Credential | Notes |
| --- | --- | --- |
| `POST /api/agent/session` | one-time `nmh_…` code in the body | Exchanges a code for a key; no bearer yet |
| `GET /api/agent/guide` | none | Public Markdown guide |
| `GET /api/agent/context` | `Authorization: Bearer nmk_…` | Declared `readOnly: false` so `lastUsedAt` can be recorded |
| `PUT /api/agent/profile` | bearer | |
| `POST /api/agent/tracks` | bearer | |
| `POST /api/agent/jobs` | bearer | |
| `POST /api/agent/icons` | bearer | |
| `POST /api/agent/runs` | bearer | |
| `POST /api/agent/logs` | bearer | |
| `POST /mcp` | bearer | Foreign browser `Origin` rejected |
| `GET /mcp`, `DELETE /mcp` | — | `405 method_not_allowed` |

Bearer format is exact: `Bearer nmk_` followed by 43 base64url characters. Keys are stored
only as HMACs; a missing, expired, revoked, blocked or non-member key gets `401` with
`WWW-Authenticate: Bearer realm="nextmove", error="invalid_token"`.

Agent data responses and MCP JSON-RPC responses carry `cache-control: no-store`. The guide is
`Content-Type: text/markdown; charset=utf-8`.

## 2. REST endpoints

### 2.1 `POST /api/agent/session` — exchange a code for a key

Request:

```json
{
  "code": "nmh_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "agentName": "Claude Code"
}
```

`agentName` is optional. It is stripped of control characters, trimmed, truncated to 60
characters, and defaults to `"Agent"`.

Success `200`:

```json
{
  "apiKey": "nmk_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "expiresAt": "2026-11-18T17:30:00.000Z",
  "purpose": "onboarding"
}
```

Behavior:

- Validates the code format `^nmh_[A-Za-z0-9_-]{43}$`.
- Looks up `codeHash` through `by_hash`; refuses unknown, used or expired codes.
- Re-checks membership; blocked/non-member callers get `403 no_access`.
- Issues a `kind: "session"` key for 6 hours, stores only its hash and an 8-character prefix.
- Marks the handoff `usedAt` and records `agentKeyId` in the same transaction.

Errors:

| Status | `error` | When |
| --- | --- | --- |
| 400 | `invalid_json` | Body isn't a JSON object |
| 400 | `invalid_code` | Code doesn't match `nmh_…` |
| 400 | `code_unavailable` | Unknown, used or expired |
| 403 | `no_access` | Owner is no longer a member / is blocked |

### 2.2 `GET /api/agent/guide` — the research guide

No auth. Returns `agentGuide()` as Markdown: workflows, profile and job fields, research
rules, salary judging, dedupe rules and run logging. This is the same text the MCP
`get_instructions` tool returns.

### 2.3 `GET /api/agent/context` — what the agent may know

```json
{
  "today": "2026-11-18",
  "profile": {
    "headline": "Engineering manager",
    "summary": "…",
    "location": "Lisbon, Portugal",
    "workAuthorization": "EU",
    "remotePreference": "Remote",
    "strengths": ["Coaching managers"],
    "doNotAssume": ["Manager of managers"],
    "dealbreakers": ["On-call rotations"],
    "sources": "CV, LinkedIn PDF",
    "updatedAt": "2026-11-18T09:00:00.000Z"
  },
  "tracks": [
    {
      "key": "engineering-manager",
      "title": "Engineering Manager",
      "seniority": "Senior",
      "salaryTarget": 125000,
      "salaryCurrency": "EUR",
      "salaryBasis": "base",
      "searchNotes": "Platform or infrastructure",
      "active": true
    }
  ],
  "jobs": [
    {
      "key": "acme-platform-em",
      "trackKey": "engineering-manager",
      "title": "Engineering Manager, Platform",
      "company": "Acme",
      "companyWebsite": "https://acme.example",
      "companyIcon": "https://acme.example/apple-touch-icon.png",
      "applyUrl": "https://jobs.acme.example/em-platform",
      "location": "EMEA · Remote",
      "salary": "€120,000–€140,000 base",
      "fit": "strong",
      "openingStatus": "open",
      "firstFound": "2026-11-01",
      "lastVerified": "2026-11-18",
      "applicationStatus": "applied"
    }
  ],
  "limits": { "jobsPerSave": 25, "jobsPerUser": 1000 }
}
```

Important omissions: **no notes**, no eligibility, workplace, salaryNote, fitSummary,
caveats, highlights or tags. The agent gets enough to deduplicate and judge, not enough to
read back the private reasoning it submitted. If there is no profile, `profile` is `null`.

### 2.4 `PUT /api/agent/profile` — replace the profile

Request:

```json
{
  "profile": {
    "headline": "Engineering manager",
    "summary": "Five years leading distributed platform teams.",
    "location": "Lisbon, Portugal",
    "workAuthorization": "EU",
    "remotePreference": "Remote first",
    "strengths": ["Coaching managers", "Incident leadership"],
    "doNotAssume": ["Manager of managers"],
    "dealbreakers": ["On-call rotations"],
    "sources": "CV, LinkedIn PDF"
  }
}
```

Success: `{ "saved": true }`. This **replaces** the existing profile; omitted optional fields
become empty. Required: `headline` (≤200), `summary` (≤4,000), `location` (≤200). Lists are
≤20 items, each ≤300 chars. All fields are sealed.

### 2.5 `POST /api/agent/tracks` — create/update roles

Request:

```json
{
  "tracks": [
    {
      "key": "engineering-manager",
      "title": "Engineering Manager",
      "seniority": "Senior",
      "salaryTarget": 125000,
      "salaryCurrency": "EUR",
      "salaryBasis": "base",
      "searchNotes": "Platform or infrastructure",
      "active": true
    },
    {
      "key": "senior-swe",
      "title": "Senior Software Engineer",
      "salaryTarget": 110000,
      "salaryCurrency": "EUR",
      "salaryBasis": "base"
    }
  ]
}
```

Success: `{ "created": ["…"], "updated": ["…"] }`.

Rules:

- 1–12 tracks per call; the owner cannot exceed 12 total.
- Upsert by key; roles you leave out are unchanged.
- `key` ≤60, lowercase words joined by dashes (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), unique in the batch.
- `title` ≤120 required; `seniority` ≤80; `searchNotes` ≤1,000.
- `salaryTarget` is a non-negative number below 100,000,000, rounded, or `null`.
- `salaryCurrency` is a 3-letter code and is required when `salaryTarget` is set.
- `salaryBasis` is `"base"` (default) or `"total"`.
- `active` defaults to `true`.

### 2.6 `POST /api/agent/jobs` — save researched openings

Request:

```json
{
  "jobs": [
    {
      "key": "acme-platform-em",
      "trackKey": "engineering-manager",
      "title": "Engineering Manager, Platform",
      "company": {
        "name": "Acme",
        "website": "https://acme.example",
        "icon": "https://acme.example/apple-touch-icon.png",
        "summary": "Builds rockets.",
        "industry": "Aerospace",
        "remoteModel": "Fully distributed",
        "remoteSummary": "Remote across EMEA."
      },
      "applyUrl": "https://jobs.acme.example/em-platform",
      "location": "EMEA · Remote",
      "eligibility": "likely",
      "workplace": "remote_first",
      "salary": "€120,000–€140,000 base",
      "salaryNote": "Below the €125k base target.",
      "fit": "strong",
      "fitSummary": "Matches distributed platform leadership.",
      "highlights": ["Lead the platform team"],
      "caveats": ["Salary not published"],
      "tags": ["Platform", "Remote"],
      "source": { "name": "Lenny's Jobs", "url": "https://www.lennysjobs.com/" },
      "lastVerified": "2026-11-18",
      "openingStatus": "open"
    }
  ]
}
```

Success: `{ "created": ["acme-platform-em"], "updated": [] }`.

Rules:

- 1–25 jobs per call. More than 25 is a validation error; split the batch.
- Upsert by `key`. The whole batch is validated and sealed before the first write, so any
  problem saves nothing and returns every problem.
- `trackKey` must match an existing role for this owner.
- One record per opening: a new `key` for a `canonicalUrl` already tracked is refused with
  "already tracked as …; reuse that key". `canonicalUrl` lowercases scheme/host, strips the
  fragment, trailing slash and tracking params (`utm_*`, `ref`, `gclid`, `fbclid`, `source`,
  `src`), and sorts the remaining query.
- On update, `status`, `notes` and `firstFound` are preserved. On insert, `status` is sealed as
  `shortlisted`, `notes` is `""`, and `firstFound` is the supplied date or today.
- The owner total is capped at 1,000 jobs.
- Required: `key` (≤100, dashed), `trackKey` (≤60), `title` (≤200), `company.name` (≤120),
  `applyUrl` (absolute http(s), no credentials, ≤2,048), `location` (≤200), `eligibility`,
  `workplace`, `fit`, `fitSummary` (≤1,200), `source.name` (≤120), `source.url` (absolute
  http(s)), `lastVerified` (real `YYYY-MM-DD`, not in the future), `openingStatus`.
- Optional: `company.website` (http(s)), `company.icon` (https, or `""`), company summary
  (≤1,000), industry (≤120), remote model (≤120), remote summary (≤600), `salary` (≤200,
  default "Not published"), `salaryNote` (≤800), highlights/caveats (12 items, 300 chars),
  tags (12 items, 40 chars), `firstFound` (real date, not in the future).
- A duplicate `key` or duplicate canonical URL **within the batch** is also rejected.

Enums are listed in [section 4](#4-enums-and-validation).

### 2.7 `POST /api/agent/icons` — backfill company icons only

Request:

```json
{
  "icons": [
    { "key": "acme-platform-em", "icon": "https://acme.example/apple-touch-icon.png" },
    { "key": "globex-staff", "icon": "" }
  ]
}
```

Success: `{ "updated": ["acme-platform-em", "globex-staff"] }`.

- 1–1,000 items; each `key` must already be tracked by this owner.
- `icon` is an absolute https URL, or `""` to clear it.
- Only `companyIcon` changes; research, status and notes are untouched.
- A single unknown key rejects the whole batch.

This exists because `save_jobs` replaces the whole research payload and agents cannot read
back the existing research; without a narrow write, icon backfill would require resending
everything.

### 2.8 `POST /api/agent/runs` — log what a run did

Request:

```json
{ "summary": "Added Acme; rechecked 6 listings; closed Globex.", "added": 1, "updated": 6, "closed": 1 }
```

Success: `{ "logged": true }`. `summary` is required (≤4,000) and sealed; counts are optional
integers 0–100,000 (default 0); the key label and key ID are recorded. Runs are shown newest
first on **Your agent** (latest 20) and are removed by account deletion.

### 2.9 `POST /api/agent/logs` — append dated log entries

Request:

```json
{
  "logs": [
    { "jobKey": "acme-platform-em", "date": "2026-11-19", "log": "*Applied* — recruiter replied." }
  ]
}
```

Success: `{ "added": 1 }`.

Rules:

- 1–25 entries per call; each entry appends a row to a tracked opening.
- `jobKey` must match an existing job for this owner. The whole batch is validated first, so an
  unknown key saves nothing.
- `date` is a real `YYYY-MM-DD`, not in the future. `log` is required markdown (≤20,000 chars).
- The `log` text is sealed; the `date` is plain. Agents can add entries but never read them back
  (they are absent from `get_context`).

### 2.10 `POST /mcp` — MCP

See [section 5](#5-mcp-endpoint).

## 3. REST error model

All agent JSON errors use a consistent envelope:

```json
{
  "error": "validation_error",
  "message": "3 problems: jobs[0].fit must be one of: strong, good, stretch; …",
  "problems": [
    "jobs[0].fit must be one of: strong, good, stretch",
    "jobs[0].applyUrl must be an absolute http(s) URL",
    "jobs[1].trackKey \"staff\" isn't one of the user's roles (one of: engineering-manager, senior-swe)"
  ]
}
```

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_json` | Body is not JSON or not a JSON object |
| 400 | `validation_error` | `ContractError`; includes `problems` |
| 400 | `invalid_code` | Code format is wrong |
| 400 | `code_unavailable` | Code is unknown, used or expired |
| 401 | `invalid_token` | Missing/expired/revoked key; includes `WWW-Authenticate` |
| 403 | `no_access` | Redeeming for a non-member/blocked owner |
| 403 | `forbidden_origin` | MCP request with a foreign browser `Origin` |
| 405 | `method_not_allowed` | `GET`/`DELETE /mcp` |

`RequestError` carries the status/code/message. `ContractError` becomes
`400 validation_error`. Any other error is rethrown so the transaction rolls back; the platform
returns a 500 and nothing in that request commits.

## 4. Enums and validation

### Enums

| Field | Allowed values |
| --- | --- |
| `status` | `shortlisted`, `applied`, `interviewing`, `rejected`, `offer`, `withdrawn`, `not_interested` |
| `fit` | `strong`, `good`, `stretch` |
| `eligibility` | `confirmed`, `likely`, `confirm` |
| `workplace` | `remote_first`, `remote_role`, `hybrid`, `onsite` |
| `openingStatus` | `open`, `closed`, `unknown` |
| `salaryBasis` | `base`, `total` |

### Limits

| Limit | Value |
| --- | --- |
| Jobs per save | 25 |
| Jobs per user | 1,000 |
| Roles per user | 12 |
| Notes | 20,000 chars |
| List items | 12 (except profile lists: 20) |
| Profile summary | 4,000 chars |
| Job fit summary | 1,200 chars |
| Stored ciphertext | 60,000 chars |
| Handoff code | 30 minutes, single use |
| Session key | 6 hours |
| MCP key | 90 days |

### URL and date rules

- `applyUrl`, `source.url` and `company.website` must be absolute `http(s)` URLs with no
  credentials and no whitespace.
- `company.icon` must be absolute **https** (the page loads it as an image; plain http would
  be mixed content). Empty is allowed.
- Dates must be real calendar dates in `YYYY-MM-DD` and not in the future (a one-day tolerance
  covers time zones). `firstFound` is optional; `lastVerified` is required.
- Keys are lowercase words joined by single dashes, no leading/trailing dash.

## 5. MCP endpoint

### 5.1 Transport

- `POST /mcp` only; `GET`/`DELETE` return `405`.
- Streamable HTTP with **JSON responses**, no SSE stream.
- JSON-RPC 2.0, one request per HTTP call. Batch arrays are rejected.
- Notifications (no `id`) and responses get an empty `202`.
- `Origin`, when present, must match the request `Host`; otherwise `403
  {"error":"forbidden_origin"}` (plain JSON, before JSON-RPC parsing).
- Missing/invalid key: JSON-RPC error `-32001` with HTTP `401` and `WWW-Authenticate`.

### 5.2 Methods

| Method | Behavior |
| --- | --- |
| `initialize` | Negotiates protocol version. Supported: `2025-11-25`, `2025-06-18`, `2025-03-26`. An unknown requested version gets the latest (`2025-11-25`). Returns `capabilities.tools.listChanged: false`, `serverInfo` (`nextmove`, "Next move", `1.0.0`) and `instructions`. |
| `ping` | `{}` |
| `tools/list` | The eight tools with JSON Schemas and annotations. |
| `tools/call` | `params.name` + `params.arguments`; returns `content` (text) and `structuredContent` when the result is an object. |
| notification / no `id` | `202` empty. |
| anything else | `-32601` method not found. |

JSON-RPC error codes:

| Code | Meaning |
| --- | --- |
| `-32700` | Parse error (body isn't JSON) |
| `-32600` | Invalid request (batch, non-object, wrong `jsonrpc`) |
| `-32601` | Method not found |
| `-32602` | Unknown tool |
| `-32001` | Missing/expired/revoked key (HTTP 401) |

A `ContractError` inside `tools/call` is **not** an HTTP error. It is a successful JSON-RPC
result with `isError: true` and content:

```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "result": {
    "content": [
      { "type": "text", "text": "{\n  \"error\": \"validation_error\",\n  \"problems\": [\"…\"]\n}" }
    ],
    "isError": true
  }
}
```

This lets an agent read the problems and retry without treating the transport as broken. The
same all-or-nothing guarantee applies: validation runs before writes.

### 5.3 Tools

| Tool | Arguments | Maps to |
| --- | --- | --- |
| `get_instructions` | none | `agentGuide()` |
| `get_context` | none | `agentContext` |
| `save_profile` | `{ profile }` | `saveProfile` |
| `save_tracks` | `{ tracks }` (1–12) | `saveTracks` |
| `save_jobs` | `{ jobs }` (1–25) | `saveJobs` |
| `save_company_icons` | `{ icons }` (1–1,000) | `saveCompanyIcons` |
| `log_run` | `{ summary, added?, updated?, closed? }` | `logRun` |
| `add_logs` | `{ logs }` (1–25) | `addLogs` |

Tool annotations describe `get_instructions`/`get_context` as read-only and the save tools as
non-destructive, idempotent upserts. They are client hints; the server enforces the same rules
as REST.

### 5.4 Example: initialize

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": { "name": "Claude Code", "version": "1.0.0" }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "nextmove", "title": "Next move", "version": "1.0.0" },
    "instructions": "Next move is the user's job-search tracker. You research openings; these tools store them. …"
  }
}
```

### 5.5 Example: call a tool

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "save_jobs",
    "arguments": { "jobs": [ { "key": "acme-platform-em", "…": "…" } ] }
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "{\n  \"created\": [\"acme-platform-em\"],\n  \"updated\": []\n}" }],
    "structuredContent": { "created": ["acme-platform-em"], "updated": [] },
    "isError": false
  }
}
```

### 5.6 Client configuration examples

The **Your agent** page generates these with the live URL and key. They are shown once.

Claude Code:

```bash
claude mcp add --transport http nextmove <origin>/mcp \
  --header "Authorization: Bearer <nmk_…>"
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "nextmove": {
      "url": "<origin>/mcp",
      "headers": { "Authorization": "Bearer <nmk_…>" }
    }
  }
}
```

Codex (`~/.codex/config.toml`, key from an environment variable):

```toml
[mcp_servers.nextmove]
url = "<origin>/mcp"
bearer_token_env_var = "NEXTMOVE_KEY"

# in your shell profile:
# export NEXTMOVE_KEY="<nmk_…>"
```

## 6. Prompts and the guide

`shared/prompts.ts` owns the text:

- `onboardingPrompt({ origin, mode, code?, expiresAt? })` — asks for CV/LinkedIn, roles, salary
  targets, location/work authorization, remote preference and dealbreakers; then summarizes,
  confirms, saves profile/tracks, and runs the first search.
- `updatePrompt({ origin, mode, code?, expiresAt? })` — get context, recheck listings older
  than 14 days, backfill icons, search new openings, save in batches, log the run.
- `agentGuide()` — the MCP `get_instructions` text and `GET /api/agent/guide`: workflows,
  profile/job fields, research rules, salary judging and tracker-accuracy rules.

HTTP mode includes the session endpoint and the one-time code. MCP mode contains no code and
tells the agent to use the Next move tools already configured. Prompts are built in the
browser for display; the app does not store them. A prompt change ships with the app, so every
new prompt is current.

The prompt is instruction, not enforcement. The capability rules in [security.md](security.md)
are what the server actually guarantees.

## 7. Example flow with curl

```bash
ORIGIN="https://<space>.space.fast"

# 1. Exchange the one-time code from the prompt.
SESSION=$(curl -sS -X POST "$ORIGIN/api/agent/session" \
  -H 'content-type: application/json' \
  -d '{"code":"nmh_…","agentName":"Claude Code"}')
KEY=$(printf '%s' "$SESSION" | jq -r .apiKey)

# 2. Read the context.
curl -sS "$ORIGIN/api/agent/context" -H "Authorization: Bearer $KEY" | jq .

# 3. Save roles (must exist before jobs).
curl -sS -X POST "$ORIGIN/api/agent/tracks" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"tracks":[{"key":"engineering-manager","title":"Engineering Manager","salaryTarget":125000,"salaryCurrency":"EUR","salaryBasis":"base"}]}'

# 4. Save up to 25 researched jobs.
curl -sS -X POST "$ORIGIN/api/agent/jobs" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d @jobs.json

# 5. Log the run.
curl -sS -X POST "$ORIGIN/api/agent/runs" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"summary":"Added Acme.","added":1,"updated":0,"closed":0}'
```

MCP equivalent (initialize first, then `tools/list` / `tools/call`) uses the same bearer key at
`$ORIGIN/mcp`.

## 8. Who writes which field

| Field group | Written by | Notes |
| --- | --- | --- |
| `ownerId`, `id`, `createdAt`, `updatedAt` | Server | Never accepted from a caller. |
| `canonicalUrl` | Server | Derived from `applyUrl` on every job save. |
| `statusChangedAt` | Server | Set only when the user changes status. |
| `keyHash`, `codeHash`, `expiresAt`, `lastUsedAt`, `revokedAt` | Server | Credential lifecycle. |
| Profile fields | Agent | `save_profile` / `PUT profile` replaces. |
| Track fields | Agent (UI only toggles `active`) | Upsert by key. |
| Job posting/research fields | Agent | Allowlisted in `saveJobs`. |
| `companyIcon` | Agent (narrow write) | `save_company_icons` / `POST icons`. |
| `status`, `notes` | **User only** | Never in an agent payload or response. |
| `firstFound` | Agent on insert, then preserved | Never changes on update. |
| `openingStatus`, `lastVerified` | Agent | Research accuracy is the agent's job. |
| Run summary/counts | Agent | Sealed summary, plain counts. |
| Log entries | Agent appends; user edits/deletes | Sealed markdown, plain date; agents never read back. |
| Membership, handoffs, keys | Server | User triggers, server writes. |
| Deletion | User only | Confirmation `"DELETE"`. |

For the table-level view, see [data-model.md](data-model.md). For the security rationale, see
[security.md](security.md).
