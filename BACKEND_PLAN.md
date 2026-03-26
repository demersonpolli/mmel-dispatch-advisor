# MMEL Dispatch Advisor — Backend Development Plan

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented |
| ⚠️ | Partially addressed — see notes |
| 🔲 | Not yet implemented |

---

## Phase 1 — Bug fixes (blocking issues)

### Step 1.1 — Fix `IngestMmelFunction` error handling ✅

`try/catch` wrapping `DirectoryNotFoundException` (400), `InvalidOperationException` (400), and general `Exception` (500). Each returns the error message in the HTTP response body.

**File:** `backend/Functions/IngestMmelFunction.cs`

---

### Step 1.2 — Fix `RagMarkdownService` thread-safety ✅

Replaced null-check lazy load with `new Lazy<IReadOnlyList<string>>(..., isThreadSafe: true)`. Also added `ChunkCount` property to the interface for the health check.

**File:** `backend/Services/RagMarkdownService.cs`

---

### Step 1.3 — Fix `BlobReadUrlService` for managed identity deployments ✅

Three-tier URL generation with automatic fallback:
1. **Account-key SAS** — when the connection string contains the storage account key (`CanGenerateSasUri=true`). Synchronous, no network call.
2. **User delegation SAS** — when running under managed identity. Calls `BlobServiceClient.GetUserDelegationKeyAsync()` and caches the delegation key for 23 hours (double-checked lock via `SemaphoreSlim`).
3. **Public base URL** — last resort if `Blob__PublicBlobBaseUrl` is configured.

`IBlobReadUrlService.GetReadUrl` changed to `GetReadUrlAsync` (async, takes `CancellationToken`). Callers updated in `DispatchAdvisorService` and `SearchMmelFunction`. Deploy scripts assign the `Storage Blob Delegator` role to the Function App managed identity.

**Files:** `backend/Services/BlobReadUrlService.cs`, `backend/Services/DispatchAdvisorService.cs`, `backend/Functions/SearchMmelFunction.cs`, `scripts/deploy-azure.ps1`, `scripts/deploy-azure.sh`

---

## Phase 2 — Functional gaps

### Step 2.1 — Return image URLs from `GET /api/search` ✅

`SearchMmelFunction` now injects `IBlobReadUrlService`, resolves SAS URLs for each `imageRef`, and returns `AdvisorItemPayload` objects (same model as `/api/advise`) with populated `imageUrls`.

**File:** `backend/Functions/SearchMmelFunction.cs`

---

### Step 2.2 — Add `GET /api/health` endpoint ✅

`HealthFunction` pings Cosmos DB (`ReadContainerAsync`), Blob Storage (`GetPropertiesAsync`), and checks RAG chunk count. Returns `200 healthy` or `503 degraded` with per-dependency status.

**File:** `backend/Functions/HealthFunction.cs`

---

### Step 2.3 — Add pagination to `GET /api/search` ✅

`SearchPagedAsync` added to `ICosmosItemRepository` and implemented in `CosmosItemRepository`. Uses `QueryRequestOptions { MaxItemCount = pageSize }` and reads exactly one Cosmos page via `ReadNextAsync`, returning the opaque `ContinuationToken` from `FeedResponse`. `SearchMmelFunction` reads optional `?continuationToken=` query param and returns the next token in the `X-Continuation-Token` response header when further pages exist.

**Files:** `backend/Services/CosmosItemRepository.cs`, `backend/Functions/SearchMmelFunction.cs`

---

### Step 2.4 — Add CORS support ✅

Added `extensions.http.cors` to `host.json` (allow all origins). Deploy scripts also run `az functionapp cors add --allowed-origins "*"`.

**File:** `backend/host.json`

---

## Phase 3 — Infrastructure and deployment

### Step 3.1 — Cosmos DB provisioning in deployment scripts ✅

Both scripts create the Cosmos account, database, and container with partition key `/aircraftNorm`. They also apply a composite index policy (`aircraftNorm+sequenceNorm`, `aircraftNorm+itemNorm`).

**Files:** `scripts/deploy-azure.ps1`, `scripts/deploy-azure.sh`

---

### Step 3.2 — MMEL Blob Storage provisioning in deployment scripts ✅

Scripts create the data storage account and `mmel-page-images` container. `Blob__ConnectionString`, `Blob__ContainerName`, and `Blob__PublicBlobBaseUrl` are all written to Function App settings automatically.

**Files:** `scripts/deploy-azure.ps1`, `scripts/deploy-azure.sh`

---

### Step 3.3 — Bundle `mmel_rag.md` with the published Function App ✅

`backend.csproj` includes `mmel_rag.md` as a `Content` item with `CopyToPublishDirectory=Always`. Deploy scripts set `Rag__MarkdownPath=mmel_rag.md` (relative to `AppContext.BaseDirectory`).

**File:** `backend/backend.csproj`

---

### Step 3.4 — Ingestion strategy for Azure deployment ✅

Option A implemented: all MMEL JSON files under `documents/mmel/**/*.json` are included as `Content` items in `backend.csproj` and bundled with the publish output under `mmel/`. Deploy scripts set `Ingestion__SourceDirectory=mmel` and trigger the ingest endpoint automatically after zip deploy.

**File:** `backend/backend.csproj`

---

## Phase 4 — Data completeness

### Step 4.1 — Parse missing MMEL PDFs (B-787, ERJ-170-190) — N/A

Both PDFs were removed. `parse_mmel.py` was updated: the unused `SKIP_FILES` set was removed and a comment documents that these two aircraft are not included. Neither was ever in `PDF_CONFIG` so no parse behaviour changed.

---

### Step 4.2 — Validate all existing MMEL JSON files ✅

`utils/validate_mmel_json.py` scans all JSON files under `documents/mmel/`. For each file it checks: JSON parses and matches `MmelSourceRoot` schema, items with empty sequence (schema error), items with no images, items with no remarks, suspicious Unicode in remarks (curly quotes, zero-width chars, control chars), and cross-reference sequences in remarks (same three regexes as `RemarkReferenceExtractor.cs`) that don't resolve to any sequence in the same file. Supports `--errors-only` flag to suppress warnings. Current results: **0 errors across all 10 files**; 9/10 files have warnings (typographic quotes from PDF extraction, and expected inter-chapter cross-references).

**File:** `utils/validate_mmel_json.py`

---

## Phase 5 — Quality and resilience

### Step 5.1 — Verify Foundry Responses API request format ✅

Two fixes applied after verifying the spec:

**Request** — replaced the combined `{ "input": "## System...\n## User..." }` string with the proper role-separated shape:
```json
{ "instructions": "<system prompt>", "input": "<user message>" }
```
`model` is intentionally omitted — the Agent Application endpoint resolves it server-side from the published agent definition.

**Response parsing** — `ExtractOutputText` now filters `output[].content[]` items by `"type": "output_text"` before reading `"text"`. Previously any content block with a `"text"` field was included, which could incorrectly concatenate `"refusal"` blocks (same shape, different type).

**File:** `backend/Services/FoundryAgentChatService.cs`

---

### Step 5.2 — Cosmos DB composite index policy ✅

Composite indexes (`aircraftNorm+sequenceNorm`, `aircraftNorm+itemNorm`) applied by both deploy scripts via `az cosmosdb sql container update --idx`.

---

### Step 5.3 — Key Vault integration for secrets ✅

Both deploy scripts now provision a Key Vault (`mmel-dispatch-kv` by default, overridable via `$KeyVaultName` / `KEY_VAULT_NAME`) with `--enable-rbac-authorization true`. The scripts assign `Key Vault Secrets Officer` to the deploying identity (so they can write secrets) and `Key Vault Secrets User` to the Function App managed identity (so the runtime can resolve references). `Cosmos__ConnectionString` and `Blob__ConnectionString` are stored as secrets (`cosmos-connection-string`, `blob-connection-string`) and referenced in Function App settings via `@Microsoft.KeyVault(SecretUri=...)` syntax. `local.settings.json` keeps plain values for local development. A retry loop handles RBAC propagation delay when writing secrets.

**Files:** `scripts/deploy-azure.ps1`, `scripts/deploy-azure.sh`

---

### Step 5.4 — Application Insights structured logging ✅

Both deploy scripts provision a Log Analytics workspace (`mmel-dispatch-logs`) and workspace-based Application Insights component (`mmel-dispatch-insights`). `APPLICATIONINSIGHTS_CONNECTION_STRING` is wired into Function App settings and `local.settings.json`. In `DispatchAdvisorService`, three structured `LogInformation` events are emitted per request: extraction (aircraftNorm, searchTermsCount, Foundry extraction latency, queryHash), retrieval (itemsFound), and completion (items, images, Foundry report latency, total elapsed). Errors are caught and logged via `LogError` with `aircraftNorm` and a SHA-256-derived `queryHash` (first 8 bytes as hex) so alerts can correlate without logging PII.

**Files:** `backend/Services/DispatchAdvisorService.cs`, `scripts/deploy-azure.ps1`, `scripts/deploy-azure.sh`

---

## Phase 6 — End-to-end validation

### Step 6.1 — Local smoke test ✅

All endpoints verified against live Azure Cosmos + Blob using `local.settings.json` credentials:

| Endpoint | Result |
|----------|--------|
| `GET /api/health` | `200 healthy` — cosmos OK, blob OK, rag OK (6 242 chunks) |
| `POST /api/ingest?file=A-220_Rev_15.json` | `200` — 540 items upserted, 554 images uploaded |
| `GET /api/search?aircraft=airbus+a320&q=pressurization` | `200` — items returned with signed SAS image URLs (200 OK, 226 KB JPEG) |
| `POST /api/advise` (no Foundry URL) | `400 Foundry__ApplicationBaseUrl is required` — correct controlled error |

Fixes applied during this step:
- `IngestMmelFunction`: error responses use `CancellationToken.None` so timeouts return `408` with message instead of silent `500`
- `host.json`: `functionTimeout` set to `00:10:00`
- `local.settings.json` + deploy script templates: RAG/ingest relative paths corrected from `../documents/` to `../../../documents/` (relative to `AppContext.BaseDirectory`)

### Step 6.2 — Azure smoke test 🔲

1. Run deploy scripts (provisions + publishes + auto-ingests)
2. Repeat ingest + health + search + advise against the Azure Function URL with `?code=<key>`
3. Verify SAS image URLs are accessible
4. Verify cross-reference items appear for items with remarks referencing other sequences

### Step 6.3 — Validate all aircraft types 🔲

| Aircraft | Sample query |
|----------|-------------|
| Airbus A320 | "A320 with one hydraulic system inoperative" |
| Airbus A220 | "A220 APU bleed air failure" |
| ATR 42 | "ATR 42 fuel crossfeed valve unserviceable" |
| ATR 72 | "ATR 72 autopilot inoperative" |
| Boeing 737 | "B737 cabin pressure controller fault" |
| Boeing 737 MAX | "737 MAX MCAS inoperative" |
| Boeing 747-400 | "747-400 with two generators failed" |
| Boeing 747-8 | "747-8 cargo door indicator fault" |
| Boeing 777 | "B777 ETOPS oxygen system partial" |

---

## Summary — current status

| Priority | Step | Status |
|----------|------|--------|
| P0 | 1.1 Ingest error handling | ✅ Done |
| P0 | 1.2 RAG thread safety | ✅ Done |
| P0 | 1.3 Blob SAS for managed identity | ✅ Done |
| P0 | 3.3 Bundle mmel_rag.md with publish | ✅ Done |
| P0 | 3.4 Ingestion strategy for Azure | ✅ Done (Option A) |
| P1 | 2.1 Image URLs in search results | ✅ Done |
| P1 | 5.1 Verify Foundry request format | ✅ Done |
| P1 | 3.1 Cosmos DB provisioning in scripts | ✅ Done |
| P1 | 3.2 MMEL Blob provisioning in scripts | ✅ Done |
| P2 | 2.2 Health check endpoint | ✅ Done |
| P2 | 2.3 Search pagination | ✅ Done |
| P2 | 2.4 CORS support | ✅ Done |
| P2 | 5.2 Cosmos indexing | ✅ Done |
| P2 | 5.3 Key Vault secrets | ✅ Done |
| P2 | 5.4 Structured logging | ✅ Done |
| P3 | 4.1 Parse B-787 and ERJ-170-190 | N/A — PDFs removed |
| P3 | 4.2 Validate all JSON files | ✅ Done |
| P4 | 6.1 Local smoke test | ✅ Done |
| P4 | 6.2 Azure smoke test | 🔲 Pending |
| P4 | 6.3 Validate all aircraft types | 🔲 Pending |
