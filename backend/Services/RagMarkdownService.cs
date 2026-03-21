using System.Text;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IRagMarkdownService
{
    IReadOnlyList<string> GetTopChunks(string userQuery, int count);
}

/// <summary>Lightweight RAG over mmel_rag.md: splits on ### headings and ranks by token overlap with the user query.</summary>
public sealed class RagMarkdownService : IRagMarkdownService
{
    private readonly RagOptions _options;
    private readonly ILogger<RagMarkdownService> _logger;
    private IReadOnlyList<string>? _chunks;

    public RagMarkdownService(IOptions<RagOptions> options, ILogger<RagMarkdownService> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public IReadOnlyList<string> GetTopChunks(string userQuery, int count)
    {
        EnsureLoaded();
        if (_chunks is null || _chunks.Count == 0)
        {
            return [];
        }

        var terms = Tokenize(userQuery);
        if (terms.Count == 0)
        {
            return _chunks.Take(count).ToList();
        }

        var scored = _chunks
            .Select(chunk => (chunk, score: ScoreChunk(chunk, terms)))
            .OrderByDescending(x => x.score)
            .ThenBy(x => x.chunk.Length)
            .Take(count)
            .Select(x => x.chunk)
            .ToList();

        return scored;
    }

    private void EnsureLoaded()
    {
        if (_chunks is not null)
        {
            return;
        }

        var path = ResolvePath(_options.MarkdownPath);
        if (!File.Exists(path))
        {
            _logger.LogWarning("RAG markdown not found at {Path}", path);
            _chunks = [];
            return;
        }

        var fullText = File.ReadAllText(path, Encoding.UTF8);
        _chunks = SplitIntoItemChunks(fullText);
        _logger.LogInformation("Loaded RAG markdown: {Path}, {Count} chunks", path, _chunks.Count);
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
