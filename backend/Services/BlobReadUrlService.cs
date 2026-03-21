using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IBlobReadUrlService
{
    string GetReadUrl(string blobPath);
}

/// <summary>Produces time-limited read SAS URLs, or public base URL when configured.</summary>
public sealed class BlobReadUrlService : IBlobReadUrlService
{
    private readonly BlobContainerClient _container;
    private readonly BlobOptions _options;

    public BlobReadUrlService(IOptions<BlobOptions> options)
    {
        _options = options.Value;
        if (string.IsNullOrWhiteSpace(_options.ConnectionString))
        {
            throw new InvalidOperationException("Blob__ConnectionString is required.");
        }

        _container = new BlobContainerClient(_options.ConnectionString, _options.ContainerName);
    }

    public string GetReadUrl(string blobPath)
    {
        if (string.IsNullOrWhiteSpace(blobPath))
        {
            return string.Empty;
        }

        var blobClient = _container.GetBlobClient(blobPath);

        if (blobClient.CanGenerateSasUri)
        {
            var sas = new BlobSasBuilder
            {
                BlobContainerName = _container.Name,
                BlobName = blobPath,
                Resource = "b",
                ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(_options.SasExpiryMinutes, 5, 24 * 60))
            };
            sas.SetPermissions(BlobSasPermissions.Read);
            return blobClient.GenerateSasUri(sas).AbsoluteUri;
        }

        if (!string.IsNullOrWhiteSpace(_options.PublicBlobBaseUrl))
        {
            var baseUrl = _options.PublicBlobBaseUrl.TrimEnd('/');
            return $"{baseUrl}/{blobPath}";
        }

        throw new InvalidOperationException(
            "Cannot generate blob read URL: account may use AAD-only auth. Set Blob__PublicBlobBaseUrl or use a connection string with account key.");
    }
}
