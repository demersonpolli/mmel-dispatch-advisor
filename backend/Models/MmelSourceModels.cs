using System.Text.Json.Serialization;

namespace backend.Models;

public sealed class MmelSourceRoot
{
    [JsonPropertyName("aircraft")]
    public string Aircraft { get; set; } = string.Empty;

    [JsonPropertyName("revision")]
    public string Revision { get; set; } = string.Empty;

    [JsonPropertyName("revision_date")]
    public string RevisionDate { get; set; } = string.Empty;

    [JsonPropertyName("system")]
    public List<MmelSystem> Systems { get; set; } = [];
}

public sealed class MmelSystem
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("equipment")]
    public List<MmelEquipment> Equipment { get; set; } = [];
}

public sealed class MmelEquipment
{
    [JsonPropertyName("sequence")]
    public string Sequence { get; set; } = string.Empty;

    [JsonPropertyName("items")]
    public List<MmelItem> Items { get; set; } = [];
}

public sealed class MmelItem
{
    [JsonPropertyName("item")]
    public string Item { get; set; } = string.Empty;

    [JsonPropertyName("repair_category")]
    public string RepairCategory { get; set; } = string.Empty;

    [JsonPropertyName("installed")]
    public object? Installed { get; set; }

    [JsonPropertyName("required")]
    public object? Required { get; set; }

    [JsonPropertyName("remarks")]
    public string Remarks { get; set; } = string.Empty;

    [JsonPropertyName("pages")]
    public Dictionary<string, string> Pages { get; set; } = [];
}
