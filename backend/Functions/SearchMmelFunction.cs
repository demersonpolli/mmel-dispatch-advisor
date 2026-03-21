using System.Net;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace backend.Functions;

public sealed class SearchMmelFunction
{
    private readonly ICosmosItemRepository _repository;

    public SearchMmelFunction(ICosmosItemRepository repository)
    {
        _repository = repository;
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

        if (string.IsNullOrWhiteSpace(aircraft) || string.IsNullOrWhiteSpace(term))
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            await bad.WriteStringAsync("Query params 'aircraft' and 'q' are required.", cancellationToken);
            return bad;
        }

        var limit = 25;
        if (int.TryParse(query.Get("limit"), out var parsedLimit))
        {
            limit = Math.Clamp(parsedLimit, 1, 200);
        }

        var aircraftNorm = aircraft.Trim().ToLowerInvariant();
        var sequenceNorm = string.IsNullOrWhiteSpace(sequence)
            ? null
            : RemarkReferenceExtractor.NormalizeSequenceToken(sequence);

        var results = await _repository.SearchAsync(aircraftNorm, term, sequenceNorm, limit, cancellationToken);
        var response = req.CreateResponse(HttpStatusCode.OK);
        await response.WriteAsJsonAsync(results, cancellationToken);
        return response;
    }
}
