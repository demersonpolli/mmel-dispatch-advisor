using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Azure.Core;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>Calls the Azure AI model inference Chat Completions endpoint (Entra ID auth).
/// Works with Microsoft models (Phi-4, Llama, Mistral) and OpenAI models deployed on
/// an Azure AI Services resource via /models/chat/completions.</summary>
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
                "Foundry__ApplicationBaseUrl is required. Set it to the Azure AI Services endpoint, " +
                "e.g. https://<resource>.services.ai.azure.com");
        }

        var tokenRequest = new TokenRequestContext([_options.TokenScope.Trim()]);
        var accessToken = await _credential.GetTokenAsync(tokenRequest, cancellationToken);

        var deployment = _options.ModelDeployment?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(deployment))
        {
            throw new InvalidOperationException(
                "Foundry__ModelDeployment is required. Set it to your Azure OpenAI deployment name, e.g. gpt-4.1");
        }

        var url = $"{baseUrl}/openai/deployments/{Uri.EscapeDataString(deployment)}/chat/completions" +
                  $"?api-version={Uri.EscapeDataString(_options.ApiVersion.Trim())}";

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken.Token);

        request.Content = JsonContent.Create(new
        {
            messages = new[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user",   content = userPrompt   }
            }
        });

        var client = _httpClientFactory.CreateClient(nameof(FoundryAgentChatService));
        client.Timeout = TimeSpan.FromMinutes(5);

        using var response = await client.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError(
                "Foundry Chat Completions API failed: {Status} {Body}",
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

            // Chat Completions format: choices[0].message.content
            if (root.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array)
            {
                foreach (var choice in choices.EnumerateArray())
                {
                    if (choice.TryGetProperty("message", out var msg) &&
                        msg.TryGetProperty("content", out var content) &&
                        content.ValueKind == JsonValueKind.String)
                    {
                        var s = content.GetString()?.Trim() ?? string.Empty;
                        if (s.Length > 0) return s;
                    }
                }
            }

            // Responses API fallback: output_text shorthand
            if (root.TryGetProperty("output_text", out var outputText) &&
                outputText.ValueKind == JsonValueKind.String)
            {
                return outputText.GetString() ?? string.Empty;
            }

            // Responses API fallback: output[].content[type=output_text]
            if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            {
                var sb = new System.Text.StringBuilder();
                foreach (var item in output.EnumerateArray())
                {
                    if (!item.TryGetProperty("content", out var content) ||
                        content.ValueKind != JsonValueKind.Array)
                        continue;

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
                if (s.Length > 0) return s;
            }
        }
        catch (JsonException)
        {
            // fall through
        }

        return json.Trim();
    }
}
