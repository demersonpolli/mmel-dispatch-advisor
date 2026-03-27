using Azure.Storage.Blobs;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IBlobImageStore
{
    Task<string> UploadBase64JpegAsync(string blobPath, string base64Content, CancellationToken cancellationToken);

    /// <summary>Lightweight connectivity check used by the health endpoint.</summary>
    Task<bool> PingAsync(CancellationToken cancellationToken);

    /// <summary>Deletes and recreates the blob container, removing all images.</summary>
    Task PurgeAllAsync(CancellationToken cancellationToken);
}

public sealed class BlobImageStore : IBlobImageStore
{
    private readonly BlobContainerClient _containerClient;

    public BlobImageStore(IOptions<BlobOptions> options)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ConnectionString))
        {
            throw new InvalidOperationException("Blob__ConnectionString is required.");
        }

        _containerClient = new BlobContainerClient(settings.ConnectionString, settings.ContainerName);
    }

    public async Task<bool> PingAsync(CancellationToken cancellationToken)
    {
        await _containerClient.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
        return true;
    }

    public async Task PurgeAllAsync(CancellationToken cancellationToken)
    {
        await _containerClient.DeleteIfExistsAsync(cancellationToken: cancellationToken);

        // Container deletion is asynchronous in Azure; retry until the container can be recreated.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await _containerClient.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
                return;
            }
            catch (Azure.RequestFailedException ex) when (ex.ErrorCode == "ContainerBeingDeleted" && attempt < 30)
            {
                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
            }
        }
    }

    public async Task<string> UploadBase64JpegAsync(string blobPath, string base64Content, CancellationToken cancellationToken)
    {
        var bytes = Convert.FromBase64String(base64Content);
        await using var stream = new MemoryStream(bytes);

        var blobClient = _containerClient.GetBlobClient(blobPath);
        await blobClient.UploadAsync(stream, overwrite: true, cancellationToken);
        return blobPath;
    }
}
