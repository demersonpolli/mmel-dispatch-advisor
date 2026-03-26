using System.Net;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace backend.Functions;

public sealed class HealthFunction
{
    private readonly ICosmosItemRepository _cosmos;
    private readonly IBlobImageStore _blob;
    private readonly IRagMarkdownService _rag;
    private readonly ILogger<HealthFunction> _logger;

    public HealthFunction(
        ICosmosItemRepository cosmos,
        IBlobImageStore blob,
        IRagMarkdownService rag,
        ILogger<HealthFunction> logger)
    {
        _cosmos = cosmos;
        _blob = blob;
        _rag = rag;
        _logger = logger;
    }

    [Function("Health")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var cosmosStatus = "ok";
        var blobStatus = "ok";
        var ragStatus = "ok";

        try
        {
            await _cosmos.PingAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cosmos DB health check failed");
            cosmosStatus = $"error: {ex.Message}";
        }

        try
        {
            await _blob.PingAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Blob Storage health check failed");
            blobStatus = $"error: {ex.Message}";
        }

        var chunkCount = _rag.ChunkCount;
        if (chunkCount == 0)
        {
            ragStatus = "warning: no chunks loaded (mmel_rag.md may be missing or empty)";
        }

        var allOk = cosmosStatus == "ok" && blobStatus == "ok";
        var status = allOk ? "healthy" : "degraded";
        var statusCode = allOk ? HttpStatusCode.OK : HttpStatusCode.ServiceUnavailable;

        var response = req.CreateResponse(statusCode);
        await response.WriteAsJsonAsync(new
        {
            status,
            cosmos = cosmosStatus,
            blob = blobStatus,
            rag = ragStatus,
            ragChunks = chunkCount
        }, cancellationToken);
        return response;
    }
}
