# MMEL Dispatch Advisor

**MMEL Dispatch Advisor** helps operations and dispatch staff work with **Master Minimum Equipment List (MMEL)** data: turning FAA-style MMEL sources into structured data, searchable records, and **natural-language dispatch guidance** grounded in your corpus—with **MMEL page images** surfaced for review on tablets (e.g. carousel UI).

## What this software does

- **Ingests** parsed MMEL JSON (with embedded page images) and stores **items** in **Azure Cosmos DB** for search and lookup, while **JPEGs** live in **Azure Blob Storage** (Cosmos holds paths, not base64).
- **Searches** by aircraft, item text, optional sequence, and remark text.
- **Advises** from a plain-language situation (e.g. aircraft + malfunction): uses **RAG** over a markdown MMEL digest, **Microsoft Foundry** agents (**Responses API**) to extract keys and author a short report, pulls **linked MMEL rows** when remarks reference other sequences, and returns **image URLs** for the UI.

Upstream **Python** utilities in this repo generate MMEL JSON and `mmel_rag.md` from PDFs; the **.NET Azure Functions** backend is the cloud API and orchestration layer.

## Repository layout

| Path | Description |
|------|-------------|
| [`backend/`](backend/) | Azure Functions API (.NET 8 isolated): ingest, search, advise. **See [backend/README.md](backend/README.md).** |
| [`documents/mmel/`](documents/mmel/) | MMEL JSON (and PDFs) used as the data source. |
| [`documents/mmel_rag.md`](documents/mmel_rag.md) | Aggregated markdown for RAG (regenerate with `utils/generate_rag_markdown.py`). |
| [`utils/`](utils/) | Python parsers and generators for MMEL PDF → JSON. |
| [`scripts/`](scripts/) | **Azure deploy** and **resource removal** helpers (see below). |

## Quick start (local API)

1. Install **.NET 8**, **Azure Functions Core Tools**, and clone this repo.  
2. Copy [`backend/local.settings.json.example`](backend/local.settings.json.example) → `backend/local.settings.json` and fill Cosmos, Blob, Foundry, and paths.  
3. From `backend/`: `dotnet build` then `func start`.  

Full configuration, endpoints, and operations: **[backend/README.md](backend/README.md)**.

## Deploy to Azure

Prerequisites: **Azure CLI** (`az login`), **.NET 8 SDK**, and globally unique names for the Function App and storage account.

**Windows (PowerShell):**

```powershell
.\scripts\deploy-azure.ps1 `
  -ResourceGroup rg-mmel-dispatch-advisor `
  -FunctionAppName <your-unique-function-app-name> `
  -StorageAccountName <your-unique-storage-name> `
  -Location eastus
```

**Linux / macOS:**

```bash
chmod +x scripts/deploy-azure.sh
./scripts/deploy-azure.sh rg-mmel-dispatch-advisor <function-app-name> <storage-account-name> eastus
```

The scripts create (if needed) the **resource group**, **storage account**, and a **Linux Consumption** Function App, then **zip-deploy** the backend. They do **not** provision Cosmos DB, Foundry, or the MMEL blob account—set **Application settings** on the Function App after deploy (see `backend/README.md`).

Skip code publish (infra only): PowerShell `-SkipPublish`; Bash `SKIP_PUBLISH=1 ./scripts/deploy-azure.sh ...`.

## Remove Azure resources (teardown)

This **deletes the entire resource group** (Function App, Functions storage, and anything else in that group). Use a **dedicated** resource group for this stack.

**Windows:**

```powershell
.\scripts\remove-azure-resources.ps1 -ResourceGroup rg-mmel-dispatch-advisor -Force
```

**Linux / macOS:**

```bash
chmod +x scripts/remove-azure-resources.sh
./scripts/remove-azure-resources.sh rg-mmel-dispatch-advisor --yes
```

To keep Cosmos or other shared services, do **not** put them in the same resource group, or remove resources manually in the Azure Portal.

## License

See [LICENSE](LICENSE).
