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

        try
        {
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
            var err = req.CreateResponse(HttpStatusCode.BadRequest);
            await err.WriteStringAsync(ex.Message, CancellationToken.None);
            return err;
        }
        catch (InvalidOperationException ex)
        {
            var err = req.CreateResponse(HttpStatusCode.BadRequest);
            await err.WriteStringAsync(ex.Message, CancellationToken.None);
            return err;
        }
        catch (Exception ex)
        {
            var status = ex is OperationCanceledException
                ? HttpStatusCode.RequestTimeout
                : HttpStatusCode.InternalServerError;
            var err = req.CreateResponse(status);
            await err.WriteStringAsync(ex.Message, CancellationToken.None);
            return err;
        }
    }
}
