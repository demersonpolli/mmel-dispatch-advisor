using System.Text;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IRagMarkdownService
{
    IReadOnlyList<string> GetTopChunks(string userQuery, int count);
    int ChunkCount { get; }
    /// <summary>Returns the distinct lowercased aircraftNorm values found in the RAG file (from **Aircraft:** headers).</summary>
    IReadOnlyList<string> GetDistinctAircraftNorms();
}

/// <summary>Lightweight RAG over mmel_rag.md: splits on ### headings and ranks by token overlap with the user query.</summary>
public sealed class RagMarkdownService : IRagMarkdownService
{
    private readonly Lazy<IReadOnlyList<string>> _chunks;

    public RagMarkdownService(IOptions<RagOptions> options, ILogger<RagMarkdownService> logger)
    {
        var opts = options.Value;
        _chunks = new Lazy<IReadOnlyList<string>>(() =>
        {
            var path = ResolvePath(opts.MarkdownPath);
            if (!File.Exists(path))
            {
                logger.LogWarning("RAG markdown not found at {Path}", path);
                return [];
            }

            var fullText = File.ReadAllText(path, Encoding.UTF8);
            var chunks = SplitIntoItemChunks(fullText);
            logger.LogInformation("Loaded RAG markdown: {Path}, {Count} chunks", path, chunks.Count);
            return chunks;
        }, isThreadSafe: true);
    }

    public IReadOnlyList<string> GetTopChunks(string userQuery, int count)
    {
        var chunks = _chunks.Value;
        if (chunks.Count == 0)
        {
            return [];
        }

        var terms = Tokenize(userQuery);
        if (terms.Count == 0)
        {
            return chunks.Take(count).ToList();
        }

        return chunks
            .Select(chunk => (chunk, score: ScoreChunk(chunk, terms)))
            .OrderByDescending(x => x.score)
            .ThenBy(x => x.chunk.Length)
            .Take(count)
            .Select(x => x.chunk)
            .ToList();
    }

    public int ChunkCount => _chunks.Value.Count;

    public IReadOnlyList<string> GetDistinctAircraftNorms()
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var chunk in _chunks.Value)
        {
            foreach (var line in chunk.Split('\n'))
            {
                var t = line.Trim();
                if (t.StartsWith("- **Aircraft:**", StringComparison.Ordinal))
                {
                    var name = t["- **Aircraft:**".Length..].Trim().ToLowerInvariant();
                    if (!string.IsNullOrEmpty(name))
                    {
                        result.Add(name);
                    }
                }
            }
        }
        return result.OrderBy(x => x).ToList();
    }

    private static string ResolvePath(string configuredPath)
    {
        if (Path.IsPathRooted(configuredPath))
        {
            return configuredPath;
        }

        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, configuredPath));
    }

    /// <summary>Splits on lines starting with ### (item sections); keeps aircraft headers with following items.</summary>
    private static List<string> SplitIntoItemChunks(string text)
    {
        var lines = text.Split('\n');
        var chunks = new List<StringBuilder>();
        StringBuilder? current = null;

        foreach (var line in lines)
        {
            if (line.StartsWith("### ", StringComparison.Ordinal))
            {
                if (current is { Length: > 0 })
                {
                    chunks.Add(current);
                }

                current = new StringBuilder();
                current.AppendLine(line.TrimEnd());
            }
            else if (current is not null)
            {
                current.AppendLine(line.TrimEnd());
            }
        }

        if (current is { Length: > 0 })
        {
            chunks.Add(current);
        }

        return chunks.Select(sb => sb.ToString().Trim()).Where(s => s.Length > 0).ToList();
    }

    private static HashSet<string> Tokenize(string text)
    {
        var separators = new[] { ' ', '\t', '\n', '\r', ',', '.', ';', ':', '(', ')', '-', '/', '\\' };
        return text
            .Split(separators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .Where(s => s.Length > 2)
            .ToHashSet();
    }

    private static int ScoreChunk(string chunk, HashSet<string> queryTerms)
    {
        var chunkTerms = Tokenize(chunk);
        return queryTerms.Count(t => chunkTerms.Contains(t));
    }
}
