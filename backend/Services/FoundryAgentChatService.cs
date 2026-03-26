using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Core;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>Invokes a Microsoft Foundry Agent Application via the stateless Responses API (Entra ID auth).</summary>
public interface IFoundryAgentChatService
{
    Task<string> CompleteChatAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken);
}

public sealed class FoundryAgentChatService : IFoundryAgentChatService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly FoundryOptions _options;
    private readonly ILogger<FoundryAgentChatService> _logger;
    private readonly TokenCredential _credential;

    public FoundryAgentChatService(
        IHttpClientFactory httpClientFactory,
        IOptions<FoundryOptions> options,
        ILogger<FoundryAgentChatService> logger,
        TokenCredential credential)
    {
        _httpClientFactory = httpClientFactory;
        _options = options.Value;
        _logger = logger;
        _credential = credential;
    }

    public async Task<string> CompleteChatAsync(string systemPrompt, string userPrompt, CancellationToken cancellationToken)
    {
        var baseUrl = _options.ApplicationBaseUrl?.Trim().TrimEnd('/') ?? string.Empty;
        if (string.IsNullOrEmpty(baseUrl))
        {
            throw new InvalidOperationException(
                "Foundry__ApplicationBaseUrl is required. Set it to your Agent Application protocols/openai URL (see README).");
        }

        var scope = string.IsNullOrWhiteSpace(_options.TokenScope)
            ? "https://ai.azure.com/.default"
            : _options.TokenScope.Trim();

        var tokenRequest = new TokenRequestContext([scope]);
        var accessToken = await _credential.GetTokenAsync(tokenRequest, cancellationToken);

        var apiVersion = string.IsNullOrWhiteSpace(_options.ApiVersion)
            ? "2025-11-15-preview"
            : _options.ApiVersion.Trim();

        var url =
            $"{baseUrl}/responses?api-version={Uri.EscapeDataString(apiVersion)}";

        // The Responses API separates system-level guidance ("instructions") from the
        // user turn ("input"). Sending both as a combined string in "input" works but
        // loses role semantics and makes system instructions visible to context windows
        // as user content. "model" is omitted intentionally — the Agent Application
        // endpoint resolves it from the published agent definition server-side.
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken.Token);
        request.Content = JsonContent.Create(new
        {
            instructions = systemPrompt,
            input = userPrompt
        });

        var client = _httpClientFactory.CreateClient(nameof(FoundryAgentChatService));
        client.Timeout = TimeSpan.FromMinutes(5);

        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError(
                "Foundry Responses API failed: {Status} {Body}",
                (int)response.StatusCode,
                body.Length > 2000 ? body[..2000] + "…" : body);
            response.EnsureSuccessStatusCode();
        }

        return ExtractOutputText(body);
    }

    private static string ExtractOutputText(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return string.Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("output_text", out var outputText) &&
                outputText.ValueKind == JsonValueKind.String)
            {
                return outputText.GetString() ?? string.Empty;
            }

            // Walk output[].content[] and collect only "output_text" blocks.
            // Filtering by type avoids accidentally including "refusal" blocks,
            // which also carry a "text" field but represent a safety refusal.
            if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            {
                var sb = new System.Text.StringBuilder();
                foreach (var item in output.EnumerateArray())
                {
                    if (!item.TryGetProperty("content", out var content) ||
                        content.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var part in content.EnumerateArray())
                    {
                        if (part.TryGetProperty("type", out var type) &&
                            type.ValueKind == JsonValueKind.String &&
                            type.GetString() == "output_text" &&
                            part.TryGetProperty("text", out var text) &&
                            text.ValueKind == JsonValueKind.String)
                        {
                            sb.Append(text.GetString());
                        }
                    }
                }

                var s = sb.ToString().Trim();
                if (s.Length > 0)
                {
                    return s;
                }
            }
        }
        catch (JsonException)
        {
            // fall through
        }

        return json.Trim();
    }
}
