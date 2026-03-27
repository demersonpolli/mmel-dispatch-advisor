using System.Net;
using System.Text.RegularExpressions;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace backend.Functions;

/// <summary>
/// Returns the top RAG chunks from mmel_rag.md that match the given query, optionally filtered by aircraft norm.
/// Used by the frontend to show MMEL hints as the user types an issue description.
/// </summary>
public sealed class RagHintFunction
{
    private readonly IRagMarkdownService _rag;
    private readonly ILogger<RagHintFunction> _logger;

    public RagHintFunction(IRagMarkdownService rag, ILogger<RagHintFunction> logger)
    {
        _rag = rag;
        _logger = logger;
    }

    [Function("RagHint")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "rag-hints")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var q = query.Get("q")?.Trim() ?? string.Empty;
        var aircraftNorm = query.Get("aircraft")?.Trim().ToLowerInvariant() ?? string.Empty;

        if (q.Length < 3)
        {
            var empty = req.CreateResponse(HttpStatusCode.OK);
            await empty.WriteAsJsonAsync(Array.Empty<object>(), cancellationToken);
            return empty;
        }

        var chunks = _rag.GetTopChunks(q, 10);
        var hints = new List<object>();

        foreach (var chunk in chunks)
        {
            // Filter by aircraft if provided
            if (!string.IsNullOrEmpty(aircraftNorm))
            {
                var chunkAircraft = ExtractField(chunk, "Aircraft").ToLowerInvariant();
                if (!chunkAircraft.Contains(aircraftNorm) && !aircraftNorm.Contains(chunkAircraft))
                    continue;
            }

            var titleLine = chunk.Split('\n').FirstOrDefault(l => l.StartsWith("### ", StringComparison.Ordinal));
            var title = titleLine is not null ? titleLine[4..].Trim() : string.Empty;
            var sequence = ExtractField(chunk, "Sequence");
            var system = ExtractField(chunk, "System");

            if (string.IsNullOrEmpty(title) && string.IsNullOrEmpty(sequence)) continue;

            hints.Add(new { sequence, system, title });
            if (hints.Count >= 5) break;
        }

        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Cache-Control", "no-cache");
        await response.WriteAsJsonAsync(hints, cancellationToken);
        return response;
    }

    private static string ExtractField(string chunk, string fieldName)
    {
        var pattern = $@"\*\*{Regex.Escape(fieldName)}:\*\*\s*(.+)";
        var match = Regex.Match(chunk, pattern);
        return match.Success ? match.Groups[1].Value.Trim() : string.Empty;
    }
}
