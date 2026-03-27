
# MMEL Dispatch Advisor — Backend

Backend Overview

This backend is the core engine of the MMEL Dispatch Advisor, responsible for:

- Transforming raw MMEL data into structured, queryable records
- Enabling real-time search across aircraft constraints
- Orchestrating AI-driven dispatch advisory workflows
- Bridging regulatory documentation with operational decision-making

It combines serverless architecture, distributed storage, and AI agents to deliver fast, explainable, and context-aware recommendations.

Built with .NET **Azure Functions** (isolated worker, **.NET 8**) that ingests MMEL JSON into **Azure Cosmos DB**, stores page images in **Azure Blob Storage**, exposes search APIs, and runs a **dispatch advisor** flow using **Microsoft Foundry** (Agent Application + Responses API) plus local RAG over `documents/mmel_rag.md`.

## Architecture

| Component | Role |
|-----------|------|
| **Ingest** (`POST /api/ingest`) | Reads `documents/mmel/**/*.json`, uploads base64 page images to Blob, upserts one document per MMEL item into Cosmos (`sequenceNorm`, `remarksNorm`, `imageRefs` as blob paths only). |
| **Search** (`GET /api/search`) | Cosmos query by `aircraftNorm`, optional `sequenceNorm`, text in `itemNorm` / `remarksNorm`. |
| **Advise** (`POST /api/advise`) | RAG chunks from `mmel_rag.md` → Foundry agent (JSON extraction) → Cosmos + remark cross-references → Foundry agent (Markdown report) → response includes `items`, `images` (carousel URLs), `report`. |
| **Foundry** | `FoundryAgentChatService` calls `{ApplicationBaseUrl}/responses` with Entra token (`DefaultAzureCredential`). |

```mermaid
<img width="6707" height="3990" alt="image" src="https://github.com/user-attachments/assets/58dd5be9-f23a-4566-a229-71b36171f0d5" />

```

## Project layout

| Path | Purpose |
|------|---------|
| `Program.cs` | Host builder, DI, configuration sections. |
| `Functions/` | HTTP triggers: `IngestMmel`, `SearchMmel`, `DispatchAdvisor`. |
| `Services/` | Ingestion, Cosmos, Blob SAS URLs, RAG chunking, Foundry HTTP client, advisor orchestration, remark reference parsing. |
| `Models/` | Source MMEL DTOs, Cosmos document shape, advisor request/response. |
| `Options/` | `Cosmos`, `Blob`, `Ingestion`, `Rag`, `Foundry` options. |
| `host.json` | Functions host configuration. |
| `local.settings.json` | **Local only** — secrets and overrides (not committed). |

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) — for deployment scripts in `../scripts/`
- Azure resources (create separately or use your existing accounts):
  - **Cosmos DB** (SQL API) + database + container (partition key `/aircraftNorm`)
  - **Storage account** + blob container for MMEL page images
  - **Function App storage** (created by deploy script) + optional second account for MMEL blobs
- **Microsoft Foundry**: published **Agent Application** and **Responses** endpoint URL for `/api/advise`
- For local advise: Entra access to the Foundry app (e.g. Azure CLI login + **Azure AI User** on the application)

## Configuration

Copy `local.settings.json.example` → `local.settings.json` and set:

| Key | Description |
|-----|-------------|
| `AzureWebJobsStorage` | Functions runtime storage (local: `UseDevelopmentStorage=true` with Azurite, or real connection string). |
| `Cosmos__ConnectionString` | Cosmos DB connection string (or use managed identity in Azure — not wired in code yet; connection string is current pattern). |
| `Cosmos__DatabaseName` / `Cosmos__ContainerName` | Target database and container. |
| `Blob__ConnectionString` / `Blob__ContainerName` | Blob storage for uploaded JPEGs. |
| `Blob__PublicBlobBaseUrl` | Optional if SAS cannot be generated (AAD-only storage). |
| `Blob__SasExpiryMinutes` | SAS lifetime for image URLs returned to clients. |
| `Ingestion__SourceDirectory` | Relative to app base, e.g. `../documents/mmel`. |
| `Rag__MarkdownPath` | RAG source, e.g. `../documents/mmel_rag.md`. |
| `Rag__TopChunkCount` | Number of markdown chunks passed to the extraction step. |
| `Foundry__ApplicationBaseUrl` | Full base URL ending in `/protocols/openai` (no trailing slash). |
| `Foundry__ApiVersion` | Default `2025-11-15-preview`. |
| `Foundry__TokenScope` | Default `https://ai.azure.com/.default`. |

In **Azure**, the same keys are set as **Application settings** on the Function App (use Key Vault references for secrets in production).

## Build and run locally

```bash
dotnet build
```

```bash
func start
```

Default local base URL: `http://localhost:7071` (check `func` output).

## API reference

### `POST /api/ingest`

- Ingests all `*.json` under the configured MMEL directory (skips typical “Cover Page” files).
- Query: optional `?file=<partial-path-or-filename>` to limit to one file.
- Response: `{ filesProcessed, itemsUpserted, imagesUploaded }`.

### `GET /api/search`

- Query: `aircraft`, `q` (required); optional `sequence`, `limit` (1–200).
- Returns array of Cosmos item documents.

### `POST /api/advise`

- Body: `{ "query": "natural language situation" }`.
- Response: `report` (Markdown), `items` (with `imageUrls`, `fromCrossReference`), `images` (flat carousel list), `ragContextUsed`.

All HTTP functions use `AuthorizationLevel.Function` — pass the function key (`?code=...` or `x-functions-key` header).

## Data model (Cosmos)

One document per MMEL line item. Important fields: `id`, `aircraftNorm`, `sequenceNorm`, `itemNorm`, `remarksNorm`, `imageRefs` (map page → blob path). **Re-run ingest** after schema changes so older documents get `sequenceNorm` / `remarksNorm`.

Recommended **composite index** (Portal / IaC): `/aircraftNorm` + `/sequenceNorm`.

## Deployment

Use the repository scripts (from repo root):

- **Deploy**: [`../scripts/deploy-azure.ps1`](../scripts/deploy-azure.ps1) or [`../scripts/deploy-azure.sh`](../scripts/deploy-azure.sh)
- **Remove Azure resources** created for this stack: [`../scripts/remove-azure-resources.ps1`](../scripts/remove-azure-resources.ps1) or [`../scripts/remove-azure-resources.sh`](../scripts/remove-azure-resources.sh)

The deploy scripts provision a **resource group**, **storage account**, and **Linux Consumption Function App** (.NET 8 isolated), then publish the backend. **Cosmos DB, MMEL blob storage, and Foundry** are not created by default — set app settings after deploy (or extend the scripts).

## Operational notes

- **Managed identity**: The host uses `DefaultAzureCredential` for Foundry. Assign the Function App’s identity **Azure AI User** on the Agent Application resource.
- **Secrets**: Prefer Key Vault + `@Microsoft.KeyVault(...)` app settings for Cosmos and Blob connection strings in production.
- **RAG file on Azure**: Bundle `mmel_rag.md` with the app or mount/blob-sync; adjust `Rag__MarkdownPath` to a deployed path.
- **MMEL JSON on Azure**: Ingestion reads from the filesystem; for cloud you typically run ingest from a build pipeline with data present, or refactor to read from Blob (future).

## Troubleshooting

| Issue | Check |
|-------|--------|
| Foundry 401/403 | Token scope, RBAC on Agent Application, managed identity enabled on Function App. |
| Empty advise results | `aircraftNorm` match, Cosmos data ingested, `sequenceNorm`/`remarksNorm` populated. |
| Images missing URLs | Blob connection string with account key for SAS, or `Blob__PublicBlobBaseUrl`. |
| Ingest path not found | `Ingestion__SourceDirectory` relative to `bin` output when running locally vs Azure. |

## Related documentation

- [Microsoft Foundry — Responses API](https://learn.microsoft.com/azure/ai-foundry/agents/how-to/publish-responses?view=foundry)
- [Azure Functions — .NET isolated](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide)
