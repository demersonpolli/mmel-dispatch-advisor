using System.Text.Json.Serialization;

namespace backend.Models;

public sealed class MmelItemDocument
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("aircraft")]
    public string Aircraft { get; set; } = string.Empty;

    [JsonPropertyName("aircraftNorm")]
    public string AircraftNorm { get; set; } = string.Empty;

    [JsonPropertyName("revision")]
    public string Revision { get; set; } = string.Empty;

    [JsonPropertyName("revisionDate")]
    public string RevisionDate { get; set; } = string.Empty;

    [JsonPropertyName("systemTitle")]
    public string SystemTitle { get; set; } = string.Empty;

    [JsonPropertyName("sequence")]
    public string Sequence { get; set; } = string.Empty;

    /// <summary>Lowercase normalized sequence for Cosmos queries and indexing (e.g. 21-21-01, -24-01-01).</summary>
    [JsonPropertyName("sequenceNorm")]
    public string SequenceNorm { get; set; } = string.Empty;

    [JsonPropertyName("item")]
    public string Item { get; set; } = string.Empty;

    [JsonPropertyName("itemNorm")]
    public string ItemNorm { get; set; } = string.Empty;

    [JsonPropertyName("repairCategory")]
    public string RepairCategory { get; set; } = string.Empty;

    [JsonPropertyName("installed")]
    public string Installed { get; set; } = string.Empty;

    [JsonPropertyName("required")]
    public string Required { get; set; } = string.Empty;

    [JsonPropertyName("remarks")]
    public string Remarks { get; set; } = string.Empty;

    [JsonPropertyName("remarksNorm")]
    public string RemarksNorm { get; set; } = string.Empty;

    [JsonPropertyName("imageRefs")]
    public Dictionary<string, string> ImageRefs { get; set; } = [];
}
