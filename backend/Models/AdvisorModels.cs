using System.Text.Json.Serialization;

namespace backend.Models;

public sealed class AdvisorRequest
{
    [JsonPropertyName("query")]
    public string Query { get; set; } = string.Empty;
}

public sealed class AdvisorResponse
{
    [JsonPropertyName("report")]
    public string Report { get; set; } = string.Empty;

    [JsonPropertyName("items")]
    public List<AdvisorItemPayload> Items { get; set; } = [];

    /// <summary>Flat list of all JPEG URLs for carousel UI (includes every page for primary + cross-referenced items).</summary>
    [JsonPropertyName("images")]
    public List<AdvisorImagePayload> Images { get; set; } = [];

    [JsonPropertyName("ragContextUsed")]
    public List<string> RagContextUsed { get; set; } = [];

    [JsonPropertyName("retrievalNotes")]
    public string? RetrievalNotes { get; set; }
}

public sealed class AdvisorItemPayload
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("aircraft")]
    public string Aircraft { get; set; } = string.Empty;

    [JsonPropertyName("sequence")]
    public string Sequence { get; set; } = string.Empty;

    [JsonPropertyName("systemTitle")]
    public string SystemTitle { get; set; } = string.Empty;

    [JsonPropertyName("item")]
    public string Item { get; set; } = string.Empty;

    [JsonPropertyName("repairCategory")]
    public string RepairCategory { get; set; } = string.Empty;

    [JsonPropertyName("installed")]
    public string Installed { get; set; } = string.Empty;

    [JsonPropertyName("required")]
    public string Required { get; set; } = string.Empty;

    [JsonPropertyName("remarks")]
    public string Remarks { get; set; } = string.Empty;

    [JsonPropertyName("imageUrls")]
    public List<string> ImageUrls { get; set; } = [];

    [JsonPropertyName("fromCrossReference")]
    public bool FromCrossReference { get; set; }
}

public sealed class AdvisorImagePayload
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("blobPath")]
    public string BlobPath { get; set; } = string.Empty;

    [JsonPropertyName("page")]
    public string Page { get; set; } = string.Empty;

    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    [JsonPropertyName("sequence")]
    public string Sequence { get; set; } = string.Empty;
}
