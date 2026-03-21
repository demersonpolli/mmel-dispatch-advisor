using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using backend.Models;
using backend.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace backend.Services;

public sealed record IngestionResult(int FilesProcessed, int ItemsUpserted, int ImagesUploaded);

public interface IMmelIngestionService
{
    Task<IngestionResult> IngestAsync(string? specificFile, CancellationToken cancellationToken);
}

public sealed class MmelIngestionService : IMmelIngestionService
{
    private readonly IngestionOptions _ingestionOptions;
    private readonly ICosmosItemRepository _repository;
    private readonly IBlobImageStore _blobImageStore;
    private readonly ILogger<MmelIngestionService> _logger;

    public MmelIngestionService(
        IOptions<IngestionOptions> ingestionOptions,
        ICosmosItemRepository repository,
        IBlobImageStore blobImageStore,
        ILogger<MmelIngestionService> logger)
    {
        _ingestionOptions = ingestionOptions.Value;
        _repository = repository;
        _blobImageStore = blobImageStore;
        _logger = logger;
    }

    public async Task<IngestionResult> IngestAsync(string? specificFile, CancellationToken cancellationToken)
    {
        var sourceDir = ResolveSourceDirectory(_ingestionOptions.SourceDirectory);
        if (!Directory.Exists(sourceDir))
        {
            throw new DirectoryNotFoundException($"Source directory not found: {sourceDir}");
        }

        var files = Directory
            .EnumerateFiles(sourceDir, "*.json", SearchOption.AllDirectories)
            .Where(path => !Path.GetFileName(path).Contains("Cover Page", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (!string.IsNullOrWhiteSpace(specificFile))
        {
            files = files.Where(path => path.EndsWith(specificFile, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        var filesProcessed = 0;
        var itemsUpserted = 0;
        var imagesUploaded = 0;

        var jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        };

        foreach (var file in files)
        {
            await using var stream = File.OpenRead(file);
            var payload = await JsonSerializer.DeserializeAsync<MmelSourceRoot>(stream, jsonOptions, cancellationToken);
            if (payload is null || payload.Systems.Count == 0)
            {
                continue;
            }

            filesProcessed++;
            _logger.LogInformation("Processing {FileName}", file);

            foreach (var system in payload.Systems)
            {
                foreach (var equipment in system.Equipment)
                {
                    foreach (var item in equipment.Items)
                    {
                        var doc = new MmelItemDocument
                        {
                            Aircraft = payload.Aircraft,
                            AircraftNorm = Normalize(payload.Aircraft),
                            Revision = payload.Revision,
                            RevisionDate = payload.RevisionDate,
                            SystemTitle = system.Title,
                            Sequence = equipment.Sequence,
                            SequenceNorm = NormalizeSequence(equipment.Sequence),
                            Item = item.Item,
                            ItemNorm = Normalize(item.Item),
                            RepairCategory = item.RepairCategory,
                            Installed = ToRawString(item.Installed),
                            Required = ToRawString(item.Required),
                            Remarks = item.Remarks,
                            RemarksNorm = Normalize(item.Remarks)
                        };

                        doc.Id = CreateDeterministicId(doc);
                        doc.ImageRefs = await UploadImagesAsync(payload, doc, item, cancellationToken);

                        await _repository.UpsertAsync(doc, cancellationToken);
                        itemsUpserted++;
                        imagesUploaded += doc.ImageRefs.Count;
                    }
                }
            }
        }

        return new IngestionResult(filesProcessed, itemsUpserted, imagesUploaded);
    }

    private async Task<Dictionary<string, string>> UploadImagesAsync(
        MmelSourceRoot source,
        MmelItemDocument doc,
        MmelItem item,
        CancellationToken cancellationToken)
    {
        var refs = new Dictionary<string, string>();
        foreach (var page in item.Pages)
        {
            if (string.IsNullOrWhiteSpace(page.Value))
            {
                continue;
            }

            var blobPath =
                $"{SafeSegment(source.Aircraft)}/rev-{SafeSegment(source.Revision)}/" +
                $"{SafeSegment(doc.SystemTitle)}/{SafeSegment(doc.Sequence)}/" +
                $"{SafeSegment(doc.Id)}/page-{SafeSegment(page.Key)}.jpg";

            var storedPath = await _blobImageStore.UploadBase64JpegAsync(blobPath, page.Value, cancellationToken);
            refs[page.Key] = storedPath;
        }

        return refs;
    }

    private static string ResolveSourceDirectory(string configuredPath)
    {
        if (Path.IsPathRooted(configuredPath))
        {
            return configuredPath;
        }

        var projectDir = AppContext.BaseDirectory;
        return Path.GetFullPath(Path.Combine(projectDir, configuredPath));
    }

    private static string ToRawString(object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        return value switch
        {
            JsonElement jsonElement => jsonElement.ToString(),
            _ => value.ToString() ?? string.Empty
        };
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();

    private static string NormalizeSequence(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var s = value.Replace('\u2212', '-').Replace('\u2013', '-').Trim();
        return s.ToLowerInvariant();
    }

    private static string SafeSegment(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var ch in value.ToLowerInvariant())
        {
            builder.Append(char.IsLetterOrDigit(ch) ? ch : '-');
        }

        return builder.ToString().Trim('-');
    }

    private static string CreateDeterministicId(MmelItemDocument doc)
    {
        var key = $"{doc.AircraftNorm}|{doc.Revision}|{doc.Sequence}|{doc.ItemNorm}";
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
