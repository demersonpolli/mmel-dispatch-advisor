using Azure.Core;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

public interface IBlobReadUrlService
{
    Task<string> GetReadUrlAsync(string blobPath, CancellationToken cancellationToken);
}

/// <summary>
/// Produces time-limited read SAS URLs for MMEL page images.
/// Priority order:
///   1. Account-key SAS   — when the connection string contains the storage account key (CanGenerateSasUri=true).
///   2. User delegation SAS — when running under a managed identity or service principal
///      that holds the Storage Blob Delegator role on the storage account.
///      The delegation key is cached for 23 hours and refreshed automatically.
///   3. Public base URL fallback — when Blob__PublicBlobBaseUrl is configured.
/// </summary>
public sealed class BlobReadUrlService : IBlobReadUrlService
{
    private readonly BlobContainerClient _container;
    private readonly BlobServiceClient _serviceClient;
    private readonly BlobOptions _options;
    private readonly ILogger<BlobReadUrlService> _logger;

    private UserDelegationKey? _delegationKey;
    private DateTimeOffset _delegationKeyExpiry = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _keyLock = new(1, 1);

    public BlobReadUrlService(
        IOptions<BlobOptions> options,
        TokenCredential credential,
        ILogger<BlobReadUrlService> logger)
    {
        _options = options.Value;
        _logger = logger;

        if (string.IsNullOrWhiteSpace(_options.ConnectionString))
        {
            throw new InvalidOperationException("Blob__ConnectionString is required.");
        }

        _container = new BlobContainerClient(_options.ConnectionString, _options.ContainerName);

        // BlobServiceClient backed by the managed identity credential — used only when
        // CanGenerateSasUri is false (i.e. no account key in the connection string).
        var serviceUri = new Uri($"https://{_container.AccountName}.blob.core.windows.net");
        _serviceClient = new BlobServiceClient(serviceUri, credential);
    }

    public async Task<string> GetReadUrlAsync(string blobPath, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(blobPath))
        {
            return string.Empty;
        }

        var blobClient = _container.GetBlobClient(blobPath);
        var expiryMinutes = Math.Clamp(_options.SasExpiryMinutes, 5, 24 * 60);
        var expiresOn = DateTimeOffset.UtcNow.AddMinutes(expiryMinutes);

        // --- Path 1: account-key SAS (synchronous, no network call) ---
        if (blobClient.CanGenerateSasUri)
        {
            var sas = new BlobSasBuilder
            {
                BlobContainerName = _container.Name,
                BlobName = blobPath,
                Resource = "b",
                ExpiresOn = expiresOn
            };
            sas.SetPermissions(BlobSasPermissions.Read);
            return blobClient.GenerateSasUri(sas).AbsoluteUri;
        }

        // --- Path 2: user delegation SAS (managed identity / service principal) ---
        try
        {
            var delegationKey = await GetOrRefreshDelegationKeyAsync(expiresOn, cancellationToken);

            var sas = new BlobSasBuilder
            {
                BlobContainerName = _container.Name,
                BlobName = blobPath,
                Resource = "b",
                ExpiresOn = expiresOn
            };
            sas.SetPermissions(BlobSasPermissions.Read);

            var sasParams = sas.ToSasQueryParameters(delegationKey, _container.AccountName);
            var builder = new UriBuilder(blobClient.Uri) { Query = sasParams.ToString() };
            return builder.Uri.AbsoluteUri;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "User delegation SAS failed for {BlobPath}. Falling back to public URL if configured.",
                blobPath);
        }

        // --- Path 3: public base URL fallback ---
        if (!string.IsNullOrWhiteSpace(_options.PublicBlobBaseUrl))
        {
            return $"{_options.PublicBlobBaseUrl.TrimEnd('/')}/{blobPath}";
        }

        throw new InvalidOperationException(
            $"Cannot generate a read URL for blob '{blobPath}'. " +
            "Ensure the connection string contains the account key (for account-key SAS), " +
            "or that the managed identity has the 'Storage Blob Delegator' role (for user delegation SAS), " +
            "or set Blob__PublicBlobBaseUrl as a fallback.");
    }

    /// <summary>
    /// Returns a cached <see cref="UserDelegationKey"/> valid until at least
    /// <paramref name="requiredUntil"/> + 5 minutes, fetching a new one if needed.
    /// </summary>
    private async Task<UserDelegationKey> GetOrRefreshDelegationKeyAsync(
        DateTimeOffset requiredUntil,
        CancellationToken cancellationToken)
    {
        // Fast path: cached key covers the required window with margin.
        if (_delegationKey is not null && _delegationKeyExpiry > requiredUntil.AddMinutes(5))
        {
            return _delegationKey;
        }

        await _keyLock.WaitAsync(cancellationToken);
        try
        {
            // Double-check after acquiring the lock.
            if (_delegationKey is not null && _delegationKeyExpiry > requiredUntil.AddMinutes(5))
            {
                return _delegationKey;
            }

            var keyStart = DateTimeOffset.UtcNow;
            var keyExpiry = keyStart.AddHours(23); // max 7 days; 23 h gives a comfortable refresh margin
            var response = await _serviceClient.GetUserDelegationKeyAsync(keyStart, keyExpiry, cancellationToken);

            _delegationKey = response.Value;
            _delegationKeyExpiry = keyExpiry;

            _logger.LogInformation(
                "Refreshed user delegation SAS key for account {Account}, valid until {Expiry}",
                _container.AccountName, keyExpiry);

            return _delegationKey;
        }
        finally
        {
            _keyLock.Release();
        }
    }
}
