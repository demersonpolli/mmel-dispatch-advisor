using System.Net;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace backend.Functions;

public sealed class AircraftFunction
{
    private readonly ICosmosItemRepository _repository;
    private readonly ILogger<AircraftFunction> _logger;

    public AircraftFunction(ICosmosItemRepository repository, ILogger<AircraftFunction> logger)
    {
        _repository = repository;
        _logger = logger;
    }

    [Function("Aircraft")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "aircraft")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        try
        {
            var entries = await _repository.GetDistinctAircraftAsync(cancellationToken);
            var payload = entries.Select(e => new { name = e.DisplayName, norm = e.Norm }).ToList();

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Cache-Control", "max-age=3600");
            await response.WriteAsJsonAsync(payload, cancellationToken);
            return response;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to retrieve distinct aircraft from Cosmos");
            var err = req.CreateResponse(HttpStatusCode.InternalServerError);
            await err.WriteStringAsync(ex.Message, cancellationToken);
            return err;
        }
    }
}
