using System.Net;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace backend.Functions;

public sealed class IngestMmelFunction
{
    private readonly IMmelIngestionService _ingestionService;
    private readonly ILogger<IngestMmelFunction> _logger;

    public IngestMmelFunction(IMmelIngestionService ingestionService, ILogger<IngestMmelFunction> logger)
    {
        _ingestionService = ingestionService;
        _logger = logger;
    }

    [Function("IngestMmel")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "ingest")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var file  = query.Get("file");
        var purge = string.Equals(query.Get("purge"), "true", StringComparison.OrdinalIgnoreCase);

        try
        {
            if (purge)
            {
                await _ingestionService.PurgeAsync(cancellationToken);
            }

            var result = await _ingestionService.IngestAsync(file, cancellationToken);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                result.FilesProcessed,
                result.ItemsUpserted,
                result.ImagesUploaded
            }, cancellationToken);
            return response;
        }
        catch (DirectoryNotFoundException ex)
        {
            _logger.LogError(ex, "Ingest failed: directory not found");
            var err = req.CreateResponse(HttpStatusCode.BadRequest);
            await err.WriteStringAsync(ex.Message, CancellationToken.None);
            return err;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogError(ex, "Ingest failed: invalid operation");
            var err = req.CreateResponse(HttpStatusCode.BadRequest);
            await err.WriteStringAsync(ex.Message, CancellationToken.None);
            return err;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ingest failed with unhandled exception");
            var status = ex is OperationCanceledException
                ? HttpStatusCode.RequestTimeout
                : HttpStatusCode.InternalServerError;
            var err = req.CreateResponse(status);
            await err.WriteStringAsync(ex.ToString(), CancellationToken.None);
            return err;
        }
    }
}
