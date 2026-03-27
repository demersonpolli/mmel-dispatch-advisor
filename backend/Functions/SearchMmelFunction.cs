using System.Net;
using backend.Models;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace backend.Functions;

public sealed class SearchMmelFunction
{
    private readonly ICosmosItemRepository _repository;
    private readonly IBlobReadUrlService _blobUrls;
    private readonly ILogger<SearchMmelFunction> _logger;

    public SearchMmelFunction(
        ICosmosItemRepository repository,
        IBlobReadUrlService blobUrls,
        ILogger<SearchMmelFunction> logger)
    {
        _repository = repository;
        _blobUrls = blobUrls;
        _logger = logger;
    }

    [Function("SearchMmel")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", Route = "search")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var aircraft = query.Get("aircraft");
        var term = query.Get("q");
        var sequence = query.Get("sequence");

        if (string.IsNullOrWhiteSpace(aircraft) || (string.IsNullOrWhiteSpace(term) && string.IsNullOrWhiteSpace(sequence)))
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            await bad.WriteStringAsync("Query params 'aircraft' and either 'q' or 'sequence' are required.", cancellationToken);
            return bad;
        }

        // If sequence is provided but term is empty, use a placeholder to satisfy the search logic if needed, 
        // or we can handle it in the repository.
        term ??= string.Empty;

        var pageSize = 25;
        if (int.TryParse(query.Get("limit"), out var parsedLimit))
        {
            pageSize = Math.Clamp(parsedLimit, 1, 200);
        }

        var continuationToken = query.Get("continuationToken");

        var aircraftNorm = aircraft.Trim().ToLowerInvariant();
        var sequenceNorm = string.IsNullOrWhiteSpace(sequence)
            ? null
            : RemarkReferenceExtractor.NormalizeSequenceToken(sequence);

        try
        {
            var page = await _repository.SearchPagedAsync(
                aircraftNorm, term, sequenceNorm, pageSize, continuationToken, cancellationToken);

            var payloads = new List<AdvisorItemPayload>(page.Items.Count);
            foreach (var doc in page.Items)
            {
                payloads.Add(await ToPayloadAsync(doc, cancellationToken));
            }

            var response = req.CreateResponse(HttpStatusCode.OK);

            if (!string.IsNullOrEmpty(page.ContinuationToken))
            {
                response.Headers.Add("X-Continuation-Token", page.ContinuationToken);
            }

            await response.WriteAsJsonAsync(payloads, cancellationToken);
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search failed for aircraft={Aircraft} q={Term}", aircraftNorm, term);
            var err = req.CreateResponse(HttpStatusCode.InternalServerError);
            await err.WriteStringAsync(ex.Message, cancellationToken);
            return err;
        }
    }

    private async Task<AdvisorItemPayload> ToPayloadAsync(MmelItemDocument doc, CancellationToken cancellationToken)
    {
        var imageUrls = new List<string>();
        foreach (var kv in doc.ImageRefs.OrderBy(k => int.TryParse(k.Key, out var n) ? n : int.MaxValue))
        {
            try
            {
                var url = await _blobUrls.GetReadUrlAsync(kv.Value, cancellationToken);
                if (!string.IsNullOrEmpty(url))
                {
                    imageUrls.Add(url);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not resolve URL for blob {Blob}", kv.Value);
            }
        }

        return new AdvisorItemPayload
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
            ImageUrls = imageUrls,
            FromCrossReference = false
        };
    }
}
