using System.Net;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace backend.Functions;

public sealed class IngestMmelFunction
{
    private readonly IMmelIngestionService _ingestionService;

    public IngestMmelFunction(IMmelIngestionService ingestionService)
    {
        _ingestionService = ingestionService;
    }

    [Function("IngestMmel")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "ingest")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var query = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
        var file = query.Get("file");

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
}
