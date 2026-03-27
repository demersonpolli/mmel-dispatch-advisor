namespace backend.Options;

public sealed class CosmosOptions
{
    public string ConnectionString { get; set; } = string.Empty;
    public string DatabaseName { get; set; } = "mmel-dispatch";
    public string ContainerName { get; set; } = "mmel-items";
}

public sealed class BlobOptions
{
    public string ConnectionString { get; set; } = string.Empty;
    public string ContainerName { get; set; } = "mmel-page-images";

    /// <summary>Optional. If set and SAS cannot be generated, image URLs are built as {PublicBlobBaseUrl}/{blobPath}.</summary>
    public string PublicBlobBaseUrl { get; set; } = string.Empty;

    /// <summary>Read SAS lifetime when generating URLs from the storage key (minutes).</summary>
    public int SasExpiryMinutes { get; set; } = 60;
}

public sealed class IngestionOptions
{
    public string SourceDirectory { get; set; } = "../documents/mmel";
}

public sealed class RagOptions
{
    /// <summary>Path to mmel_rag.md relative to app base or absolute.</summary>
    public string MarkdownPath { get; set; } = "../documents/mmel_rag.md";

    /// <summary>Max RAG sections to pass to the extraction model.</summary>
    public int TopChunkCount { get; set; } = 8;
}

/// <summary>Azure AI Services / OpenAI Responses API configuration.</summary>
public sealed class FoundryOptions
{
    /// <summary>
    /// Base URL of the Azure AI Services endpoint (no trailing slash), e.g.
    /// https://&lt;resource&gt;.cognitiveservices.azure.com
    /// The service appends /models/chat/completions?api-version=... at call time.
    /// </summary>
    public string ApplicationBaseUrl { get; set; } = string.Empty;

    /// <summary>
    /// Azure OpenAI deployment name (e.g. "gpt-4o"). Sent as "model" in the request body.
    /// </summary>
    public string ModelDeployment { get; set; } = string.Empty;

    /// <summary>API version query parameter for Azure OpenAI chat completions.</summary>
    public string ApiVersion { get; set; } = "2024-02-01";

    /// <summary>Entra ID scope for bearer token (DefaultAzureCredential).</summary>
    public string TokenScope { get; set; } = "https://cognitiveservices.azure.com/.default";
}
