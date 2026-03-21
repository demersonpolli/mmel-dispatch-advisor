using System.Text.RegularExpressions;

namespace backend.Services;

/// <summary>Extracts MMEL sequence references from remarks (e.g. Refer to Item 21-50-1, Item 21-21-01).</summary>
public static class RemarkReferenceExtractor
{
    // Standard FAA-style: 21-50-1, 21-21-01A
    private static readonly Regex StandardSeq = new(
        @"\b(\d{2}-\d{2}-\d{1,2}[A-Za-z]?)\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // "Item 21-50-1" / "item 21-50-01"
    private static readonly Regex ItemPrefix = new(
        @"\bItem\s+(\d{2}-\d{2}-\d{1,2}[A-Za-z]?)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // Boeing B-777 style: -24-01-01, -26-05A
    private static readonly Regex DashPrefix = new(
        @"(?<![0-9A-Za-z])(-\d{1,2}-\d{1,2}(?:-\d{1,2})?[A-Za-z]?)\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static IReadOnlySet<string> ExtractSequenceReferences(string remarks)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(remarks))
        {
            return set;
        }

        foreach (Match m in StandardSeq.Matches(remarks))
        {
            set.Add(NormalizeSequenceToken(m.Groups[1].Value));
        }

        foreach (Match m in ItemPrefix.Matches(remarks))
        {
            set.Add(NormalizeSequenceToken(m.Groups[1].Value));
        }

        foreach (Match m in DashPrefix.Matches(remarks))
        {
            set.Add(NormalizeSequenceToken(m.Groups[1].Value));
        }

        return set;
    }

    public static string NormalizeSequenceToken(string raw)
    {
        return raw.Replace('\u2212', '-').Replace('\u2013', '-').Trim().ToLowerInvariant();
    }
}
