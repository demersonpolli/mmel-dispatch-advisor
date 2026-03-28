# Azure Architecture Diagrams

This file summarizes the Azure services used by MMEL Dispatch Advisor based on the deployment scripts in `scripts/`.

## Azure Resource Topology

```mermaid
graph TD
  subgraph RG["Azure Resource Group: rg-mmel-dispatch-advisor"]
    FA["Function App (Azure Functions, Linux Consumption)"]
    SA_RUNTIME["Storage Account (Functions runtime)"]
    SA_DATA["Storage Account (MMEL data)"]
    BLOB["Blob Container: mmel-page-images"]
    COSMOS["Cosmos DB (SQL API)"]
    KV["Key Vault"]
    AI["Azure AI Services (Foundry)"]
    APPINS["Application Insights"]
    LOGS["Log Analytics Workspace"]
  end

  SA_DATA --> BLOB
  FA --> SA_RUNTIME
  FA --> COSMOS
  FA --> BLOB
  FA --> AI
  FA --> APPINS
  APPINS --> LOGS
  FA --> KV

  FA -. "Managed Identity (Key Vault Secrets User)" .-> KV
  FA -. "RBAC: Storage Blob Delegator" .-> SA_DATA
  FA -. "RBAC: Cognitive Services User" .-> AI
```

## Runtime Data Flow (Azure Services Only)

```mermaid
graph LR
  CLIENT["Client UI"]
  FA["Azure Functions API"]
  COSMOS["Cosmos DB (items)"]
  BLOB["Blob Storage (page images)"]
  AI["Azure AI Services (Foundry)"]

  CLIENT --> FA
  FA --> COSMOS
  FA --> BLOB
  FA --> AI
```
