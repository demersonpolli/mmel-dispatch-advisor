using Azure.Storage.Blobs;
using backend.Options;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IBlobImageStore
{
    Task<string> UploadBase64JpegAsync(string blobPath, string base64Content, CancellationToken cancellationToken);
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

    public async Task<string> UploadBase64JpegAsync(string blobPath, string base64Content, CancellationToken cancellationToken)
    {
        await _containerClient.CreateIfNotExistsAsync(cancellationToken: cancellationToken);

        var bytes = Convert.FromBase64String(base64Content);
        await using var stream = new MemoryStream(bytes);

        var blobClient = _containerClient.GetBlobClient(blobPath);
        await blobClient.UploadAsync(stream, overwrite: true, cancellationToken);
        return blobPath;
    }
}
