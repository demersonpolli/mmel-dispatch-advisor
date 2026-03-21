using System.Net;
using System.Text.Json;
using backend.Models;
using backend.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace backend.Functions;

public sealed class DispatchAdvisorFunction
{
    private readonly IDispatchAdvisorService _advisor;

    public DispatchAdvisorFunction(IDispatchAdvisorService advisor)
    {
        _advisor = advisor;
    }

    [Function("DispatchAdvisor")]
    public async Task<HttpResponseData> Run(
        [HttpTrigger(AuthorizationLevel.Function, "post", Route = "advise")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        AdvisorRequest? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync<AdvisorRequest>(req.Body, cancellationToken: cancellationToken);
        }
        catch (JsonException)
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            await bad.WriteStringAsync("Invalid JSON body. Expected { \"query\": \"...\" }.", cancellationToken);
            return bad;
        }

        if (body is null || string.IsNullOrWhiteSpace(body.Query))
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            await bad.WriteStringAsync("Body must include a non-empty \"query\" string.", cancellationToken);
            return bad;
        }

        try
        {
            var result = await _advisor.AdviseAsync(body.Query, cancellationToken);
            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(result, cancellationToken);
            return response;
        }
        catch (InvalidOperationException ex)
        {
            var err = req.CreateResponse(HttpStatusCode.BadRequest);
            await err.WriteStringAsync(ex.Message, cancellationToken);
            return err;
        }
        catch (Exception ex)
        {
            var err = req.CreateResponse(HttpStatusCode.InternalServerError);
            await err.WriteStringAsync(ex.Message, cancellationToken);
            return err;
        }
    }
}
