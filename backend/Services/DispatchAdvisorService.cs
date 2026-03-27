using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using backend.Models;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IDispatchAdvisorService
{
    Task<AdvisorResponse> AdviseAsync(string userQuery, CancellationToken cancellationToken);
}

public sealed class DispatchAdvisorService : IDispatchAdvisorService
{
    private readonly IRagMarkdownService _rag;
    private readonly ICosmosItemRepository _cosmos;
    private readonly IBlobReadUrlService _blobUrls;
    private readonly IFoundryAgentChatService _foundryAgent;
    private readonly RagOptions _ragOptions;
    private readonly ILogger<DispatchAdvisorService> _logger;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    public DispatchAdvisorService(
        IRagMarkdownService rag,
        ICosmosItemRepository cosmos,
        IBlobReadUrlService blobUrls,
        IFoundryAgentChatService foundryAgent,
        IOptions<RagOptions> ragOptions,
        ILogger<DispatchAdvisorService> logger)
    {
        _rag = rag;
        _cosmos = cosmos;
        _blobUrls = blobUrls;
        _foundryAgent = foundryAgent;
        _ragOptions = ragOptions.Value;
        _logger = logger;
    }

    public async Task<AdvisorResponse> AdviseAsync(string userQuery, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(userQuery))
        {
            throw new ArgumentException("Query is required.", nameof(userQuery));
        }

        var queryHash = ComputeQueryHash(userQuery);
        var totalSw = Stopwatch.StartNew();
        var aircraftNorm = "(unknown)";

        try
        {
            var ragChunks = _rag.GetTopChunks(userQuery, _ragOptions.TopChunkCount).ToList();
            var ragContext = string.Join("\n\n---\n\n", ragChunks);

            var extractSw = Stopwatch.StartNew();
            var extraction = await ExtractKeysAsync(userQuery, ragContext, ragChunks, cancellationToken);
            extractSw.Stop();

            aircraftNorm = extraction.AircraftNorm.Trim().ToLowerInvariant();

            _logger.LogInformation(
                "Advise extraction aircraft={AircraftNorm} searchTermsCount={SearchTermsCount} foundryLatencyMs={LatencyMs} queryHash={QueryHash}",
                aircraftNorm, extraction.SearchTerms.Count, extractSw.ElapsedMilliseconds, queryHash);

            var collected = new Dictionary<string, MmelItemDocument>(StringComparer.Ordinal);

            foreach (var seq in extraction.SequenceCandidates)
            {
                var norm = RemarkReferenceExtractor.NormalizeSequenceToken(seq);
                if (string.IsNullOrEmpty(norm))
                {
                    continue;
                }

                var hits = await _cosmos.GetByAircraftAndSequenceAsync(aircraftNorm, norm, cancellationToken);
                foreach (var h in hits)
                {
                    collected[h.Id] = h;
                }
            }

            foreach (var term in extraction.SearchTerms.Where(t => !string.IsNullOrWhiteSpace(t)).Take(6))
            {
                var hits = await _cosmos.SearchAsync(aircraftNorm, term, null, 20, cancellationToken);
                foreach (var h in hits)
                {
                    collected[h.Id] = h;
                }
            }

            _logger.LogInformation(
                "Advise retrieval aircraft={AircraftNorm} itemsFound={ItemsFound} queryHash={QueryHash}",
                aircraftNorm, collected.Count, queryHash);

            if (collected.Count == 0)
            {
                return new AdvisorResponse
                {
                    Report = $"No MMEL items were found in Cosmos for aircraft match `{aircraftNorm}` and the derived search terms. " +
                             "Confirm data was ingested and `aircraftNorm` matches stored documents (re-run ingest after adding sequenceNorm).",
                    RagContextUsed = ragChunks,
                    RetrievalNotes = extraction.Notes
                };
            }

            var ranked = collected.Values
                .Select(doc => (doc, score: ScoreDocument(doc, extraction.SearchTerms, userQuery)))
                .OrderByDescending(x => x.score)
                .Select(x => x.doc)
                .ToList();

            var primary = ranked.Take(5).ToList();
            var primaryIds = new HashSet<string>(primary.Select(p => p.Id), StringComparer.Ordinal);

            var allForRefs = new Dictionary<string, MmelItemDocument>(StringComparer.Ordinal);
            foreach (var p in primary)
            {
                allForRefs[p.Id] = p;
            }

            var pendingRefs = new Queue<string>();
            foreach (var p in primary)
            {
                foreach (var seq in RemarkReferenceExtractor.ExtractSequenceReferences(p.Remarks))
                {
                    pendingRefs.Enqueue(seq);
                }
            }

            var seenSeq = new HashSet<string>(StringComparer.Ordinal);
            while (pendingRefs.Count > 0)
            {
                var seq = pendingRefs.Dequeue();
                if (!seenSeq.Add(seq))
                {
                    continue;
                }

                var related = await _cosmos.GetByAircraftAndSequenceAsync(aircraftNorm, seq, cancellationToken);
                foreach (var r in related)
                {
                    if (allForRefs.TryAdd(r.Id, r))
                    {
                        foreach (var inner in RemarkReferenceExtractor.ExtractSequenceReferences(r.Remarks))
                        {
                            pendingRefs.Enqueue(inner);
                        }
                    }
                }
            }

            var orderedItems = allForRefs.Values
                .OrderByDescending(i => primaryIds.Contains(i.Id))
                .ThenBy(i => i.SequenceNorm)
                .ThenBy(i => i.Item, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var itemPayloads = new List<AdvisorItemPayload>();
            var carousel = new List<AdvisorImagePayload>();

            foreach (var doc in orderedItems)
            {
                var urls = new List<string>();
                foreach (var kv in doc.ImageRefs.OrderBy(k => int.TryParse(k.Key, out var n) ? n : int.MaxValue))
                {
                    try
                    {
                        var url = await _blobUrls.GetReadUrlAsync(kv.Value, cancellationToken);
                        if (!string.IsNullOrEmpty(url))
                        {
                            urls.Add(url);
                            carousel.Add(new AdvisorImagePayload
                            {
                                Url = url,
                                BlobPath = kv.Value,
                                Page = kv.Key,
                                ItemId = doc.Id,
                                Sequence = doc.Sequence
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to build URL for blob {Blob}", kv.Value);
                    }
                }

                itemPayloads.Add(new AdvisorItemPayload
                {
                    Id = doc.Id,
                    Aircraft = doc.Aircraft,
                    Sequence = doc.Sequence,
                    SystemTitle = doc.SystemTitle,
                    Item = doc.Item,
                    RepairCategory = doc.RepairCategory,
                    Installed = doc.Installed,
                    Required = doc.Required,
                    Remarks = doc.Remarks,
                    ImageUrls = urls,
                    FromCrossReference = !primaryIds.Contains(doc.Id)
                });
            }

            var dataForLlm = JsonSerializer.Serialize(itemPayloads, new JsonSerializerOptions { WriteIndented = true });
            var imageManifest = JsonSerializer.Serialize(carousel, new JsonSerializerOptions { WriteIndented = true });

            var reportSw = Stopwatch.StartNew();
            var report = await BuildReportAsync(userQuery, dataForLlm, imageManifest, cancellationToken);
            reportSw.Stop();

            _logger.LogInformation(
                "Advise completed aircraft={AircraftNorm} items={Items} images={Images} foundryReportLatencyMs={LatencyMs} totalElapsedMs={ElapsedMs} queryHash={QueryHash}",
                aircraftNorm, itemPayloads.Count, carousel.Count, reportSw.ElapsedMilliseconds, totalSw.ElapsedMilliseconds, queryHash);

            return new AdvisorResponse
            {
                Report = report,
                Items = itemPayloads,
                Images = carousel,
                RagContextUsed = ragChunks,
                RetrievalNotes = extraction.Notes
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Advise failed aircraft={AircraftNorm} queryHash={QueryHash}", aircraftNorm, queryHash);
            throw;
        }
    }

    private async Task<ExtractionResult> ExtractKeysAsync(
        string userQuery,
        string ragContext,
        IReadOnlyList<string> ragChunks,
        CancellationToken cancellationToken)
    {
        var knownNorms = _rag.GetDistinctAircraftNorms();
        var knownNormsList = string.Join(", ", knownNorms.Select(n => $"\"{n}\""));
        var systemPrompt = $"""
            You help dispatch advisors query a structured MMEL database.
            You MUST respond with a single JSON object only (no markdown fences).
            Fields:
            - aircraftNorm: MUST be the exact lowercased string from the following list of known aircraft in the database. Pick the best match for the user's query.
              Known aircraft: {knownNormsList}
            - searchTerms: 3-8 short lowercase phrases to find the malfunction in item descriptions (e.g. "pack", "air conditioning").
            - sequenceCandidates: 0-5 MMEL sequence strings if clearly implied (e.g. "21-21-01"), else [].
            - notes: brief optional string.
            """;

        var userPrompt = $"""
            User message: {userQuery}

            RAG excerpts (markdown):
            {ragContext}
            """;

        try
        {
            var raw = await _foundryAgent.CompleteChatAsync(systemPrompt, userPrompt, cancellationToken);
            var json = ExtractJsonObject(raw);
            var dto = JsonSerializer.Deserialize<ExtractionDto>(json, JsonOpts);
            if (dto is not null && !string.IsNullOrWhiteSpace(dto.AircraftNorm))
            {
                return new ExtractionResult(
                    dto.AircraftNorm,
                    dto.SearchTerms ?? [],
                    dto.SequenceCandidates ?? [],
                    dto.Notes ?? string.Empty);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "LLM extraction failed; using heuristic fallback");
        }

        return HeuristicExtraction(userQuery, ragChunks);
    }

    private async Task<string> BuildReportAsync(
        string userQuery,
        string itemsJson,
        string imagesJson,
        CancellationToken cancellationToken)
    {
        const string systemPrompt = """
            You are an aircraft dispatch assistant. Write a concise, factual dispatch-oriented report (Markdown).
            Rules:
            - Base the answer ONLY on the provided MMEL item JSON and image list.
            - Mention repair category, installed/required counts, and summarize remarks/conditions.
            - When remarks reference other sequences, explain how those linked items affect dispatch (using the included related items).
            - You MUST include every image URL from the image list exactly once in the report body using Markdown image syntax: ![Sequence page N](url) with a short caption so a tablet carousel can match them.
            - Do not invent regulations or items not in the JSON.
            """;

        var userPrompt = $"""
            User situation: {userQuery}

            MMEL items (JSON):
            {itemsJson}

            All images for carousel (JSON array with url, page, sequence, itemId):
            {imagesJson}
            """;

        return await _foundryAgent.CompleteChatAsync(systemPrompt, userPrompt, cancellationToken);
    }

    private static int ScoreDocument(MmelItemDocument doc, IReadOnlyList<string> terms, string userQuery)
    {
        var score = 0;
        var hay = doc.ItemNorm + " " + doc.RemarksNorm;
        foreach (var t in terms)
        {
            var n = t.Trim().ToLowerInvariant();
            if (n.Length > 0 && hay.Contains(n, StringComparison.Ordinal))
            {
                score += 3;
            }
        }

        foreach (var tok in Tokenize(userQuery))
        {
            if (tok.Length > 2 && hay.Contains(tok, StringComparison.Ordinal))
            {
                score += 1;
            }
        }

        return score;
    }

    private static HashSet<string> Tokenize(string text)
    {
        var separators = new[] { ' ', '\t', '\n', '\r', ',', '.', ';', ':', '(', ')', '-', '/', '\\' };
        return text.Split(separators, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.ToLowerInvariant())
            .Where(s => s.Length > 2)
            .ToHashSet();
    }

    private static ExtractionResult HeuristicExtraction(string userQuery, IReadOnlyList<string> ragChunks)
    {
        var aircraftNorm = string.Empty;
        foreach (var chunk in ragChunks)
        {
            var m = Regex.Match(chunk, @"\*\*Aircraft:\*\*\s*(.+)", RegexOptions.IgnoreCase);
            if (m.Success)
            {
                aircraftNorm = m.Groups[1].Value.Trim().ToLowerInvariant();
                break;
            }
        }

        if (string.IsNullOrEmpty(aircraftNorm))
        {
            aircraftNorm = "unknown";
        }

        var terms = Tokenize(userQuery).Take(8).ToList();
        return new ExtractionResult(aircraftNorm, terms, [], "Heuristic extraction (LLM unavailable or invalid JSON).");
    }

    private static string ExtractJsonObject(string raw)
    {
        var t = raw.Trim();
        var fence = Regex.Match(t, @"```(?:json)?\s*(\{.*\})\s*```", RegexOptions.Singleline);
        if (fence.Success)
        {
            return fence.Groups[1].Value.Trim();
        }

        var start = t.IndexOf('{');
        var end = t.LastIndexOf('}');
        if (start >= 0 && end > start)
        {
            return t.Substring(start, end - start + 1);
        }

        return t;
    }

    private static string ComputeQueryHash(string query)
    {
        var bytes = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(query));
        return Convert.ToHexString(bytes, 0, 8).ToLowerInvariant();
    }

    private sealed class ExtractionDto
    {
        [JsonPropertyName("aircraftNorm")]
        public string AircraftNorm { get; set; } = string.Empty;

        [JsonPropertyName("searchTerms")]
        public List<string>? SearchTerms { get; set; }

        [JsonPropertyName("sequenceCandidates")]
        public List<string>? SequenceCandidates { get; set; }

        [JsonPropertyName("notes")]
        public string? Notes { get; set; }
    }

    private sealed record ExtractionResult(
        string AircraftNorm,
        List<string> SearchTerms,
        List<string> SequenceCandidates,
        string Notes);
}
