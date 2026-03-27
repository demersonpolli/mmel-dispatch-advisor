using System.Text.Json.Serialization;
using backend.Models;
using backend.Options;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Options;

namespace backend.Services;

/// <summary>One page of search results plus an opaque Cosmos continuation token for the next page.</summary>
public sealed record SearchPage(IReadOnlyList<MmelItemDocument> Items, string? ContinuationToken);

/// <summary>An aircraft's display name and its lowercased partition-key norm.</summary>
public sealed record AircraftEntry(string DisplayName, string Norm);

public interface ICosmosItemRepository
{
    Task UpsertAsync(MmelItemDocument document, CancellationToken cancellationToken);

    /// <summary>Search by aircraft norm and text in item or remarks; optional sequence filter for indexed lookup.</summary>
    Task<IReadOnlyList<MmelItemDocument>> SearchAsync(
        string aircraftNorm,
        string term,
        string? sequenceNorm,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// Paged search — reads exactly one Cosmos page of up to <paramref name="pageSize"/> items.
    /// Pass <paramref name="continuationToken"/> from the previous response to advance to the next page.
    /// <see cref="SearchPage.ContinuationToken"/> is <c>null</c> when no further pages exist.
    /// </summary>
    Task<SearchPage> SearchPagedAsync(
        string aircraftNorm,
        string term,
        string? sequenceNorm,
        int pageSize,
        string? continuationToken,
        CancellationToken cancellationToken);

    /// <summary>Exact lookup by aircraft and normalized sequence (for cross-references).</summary>
    Task<IReadOnlyList<MmelItemDocument>> GetByAircraftAndSequenceAsync(
        string aircraftNorm,
        string sequenceNorm,
        CancellationToken cancellationToken);

    /// <summary>Lightweight connectivity check used by the health endpoint.</summary>
    Task<bool> PingAsync(CancellationToken cancellationToken);

    /// <summary>Deletes and recreates the container, removing all documents.</summary>
    Task PurgeAllAsync(CancellationToken cancellationToken);

    /// <summary>Returns distinct (display name, norm) pairs for every aircraft in the container.</summary>
    Task<IReadOnlyList<AircraftEntry>> GetDistinctAircraftAsync(CancellationToken cancellationToken);
}

public sealed class CosmosItemRepository : ICosmosItemRepository
{
    private Container _container;
    private readonly Database _database;
    private readonly ContainerProperties _containerProps;

    public CosmosItemRepository(IOptions<CosmosOptions> options)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ConnectionString))
        {
            throw new InvalidOperationException("Cosmos__ConnectionString is required.");
        }

        var client = new CosmosClient(settings.ConnectionString, new CosmosClientOptions
        {
            SerializerOptions = new CosmosSerializationOptions
            {
                PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
            }
        });

        _containerProps = new ContainerProperties(settings.ContainerName, "/aircraftNorm");
        _database  = client.CreateDatabaseIfNotExistsAsync(settings.DatabaseName).GetAwaiter().GetResult().Database;
        _container = _database.CreateContainerIfNotExistsAsync(_containerProps).GetAwaiter().GetResult().Container;
    }

    public async Task UpsertAsync(MmelItemDocument document, CancellationToken cancellationToken)
    {
        await _container.UpsertItemAsync(document, new PartitionKey(document.AircraftNorm), cancellationToken: cancellationToken);
    }

    public async Task<IReadOnlyList<MmelItemDocument>> SearchAsync(
        string aircraftNorm,
        string term,
        string? sequenceNorm,
        int limit,
        CancellationToken cancellationToken)
    {
        var aircraft = aircraftNorm.Trim().ToLowerInvariant();
        var t = term.Trim().ToLowerInvariant();

        QueryDefinition query;
        if (!string.IsNullOrWhiteSpace(sequenceNorm))
        {
            var seq = sequenceNorm.Trim().ToLowerInvariant();
            query = new QueryDefinition(
                    """
                    SELECT TOP @limit * FROM c
                    WHERE c.aircraftNorm = @aircraft
                      AND c.sequenceNorm = @seq
                      AND (CONTAINS(c.itemNorm, @term) OR CONTAINS(c.remarksNorm, @term))
                    """)
                .WithParameter("@limit", limit)
                .WithParameter("@aircraft", aircraft)
                .WithParameter("@seq", seq)
                .WithParameter("@term", t);
        }
        else
        {
            query = new QueryDefinition(
                    """
                    SELECT TOP @limit * FROM c
                    WHERE c.aircraftNorm = @aircraft
                      AND (CONTAINS(c.itemNorm, @term) OR CONTAINS(c.remarksNorm, @term))
                    """)
                .WithParameter("@limit", limit)
                .WithParameter("@aircraft", aircraft)
                .WithParameter("@term", t);
        }

        return await QueryAllAsync(query, cancellationToken);
    }

    public async Task<IReadOnlyList<MmelItemDocument>> GetByAircraftAndSequenceAsync(
        string aircraftNorm,
        string sequenceNorm,
        CancellationToken cancellationToken)
    {
        var query = new QueryDefinition(
                """
                SELECT * FROM c
                WHERE c.aircraftNorm = @aircraft AND c.sequenceNorm = @seq
                """)
            .WithParameter("@aircraft", aircraftNorm.Trim().ToLowerInvariant())
            .WithParameter("@seq", sequenceNorm.Trim().ToLowerInvariant());

        return await QueryAllAsync(query, cancellationToken);
    }

    public async Task<SearchPage> SearchPagedAsync(
        string aircraftNorm,
        string term,
        string? sequenceNorm,
        int pageSize,
        string? continuationToken,
        CancellationToken cancellationToken)
    {
        var aircraft = aircraftNorm.Trim().ToLowerInvariant();
        var t = term.Trim().ToLowerInvariant();

        QueryDefinition query;
        if (!string.IsNullOrWhiteSpace(sequenceNorm))
        {
            var seq = sequenceNorm.Trim().ToLowerInvariant();
            query = new QueryDefinition(
                    """
                    SELECT * FROM c
                    WHERE c.aircraftNorm = @aircraft
                      AND c.sequenceNorm = @seq
                      AND (CONTAINS(c.itemNorm, @term) OR CONTAINS(c.remarksNorm, @term))
                    """)
                .WithParameter("@aircraft", aircraft)
                .WithParameter("@seq", seq)
                .WithParameter("@term", t);
        }
        else
        {
            query = new QueryDefinition(
                    """
                    SELECT * FROM c
                    WHERE c.aircraftNorm = @aircraft
                      AND (CONTAINS(c.itemNorm, @term) OR CONTAINS(c.remarksNorm, @term))
                    """)
                .WithParameter("@aircraft", aircraft)
                .WithParameter("@term", t);
        }

        var requestOptions = new QueryRequestOptions { MaxItemCount = pageSize };
        var iterator = _container.GetItemQueryIterator<MmelItemDocument>(
            query,
            continuationToken: string.IsNullOrWhiteSpace(continuationToken) ? null : continuationToken,
            requestOptions: requestOptions);

        if (!iterator.HasMoreResults)
        {
            return new SearchPage([], null);
        }

        var page = await iterator.ReadNextAsync(cancellationToken);
        return new SearchPage(page.ToList(), page.ContinuationToken);
    }

    public async Task<bool> PingAsync(CancellationToken cancellationToken)
    {
        await _container.ReadContainerAsync(cancellationToken: cancellationToken);
        return true;
    }

    public async Task PurgeAllAsync(CancellationToken cancellationToken)
    {
        await _container.DeleteContainerAsync(cancellationToken: cancellationToken);
        _container = (await _database.CreateContainerIfNotExistsAsync(_containerProps, cancellationToken: cancellationToken)).Container;
    }

    public async Task<IReadOnlyList<AircraftEntry>> GetDistinctAircraftAsync(CancellationToken cancellationToken)
    {
        var query = new QueryDefinition("SELECT DISTINCT c.aircraft, c.aircraftNorm FROM c");
        using var iter = _container.GetItemQueryIterator<AircraftRow>(
            query, requestOptions: new QueryRequestOptions { MaxItemCount = 50 });
        var result = new List<AircraftEntry>();
        while (iter.HasMoreResults)
        {
            var page = await iter.ReadNextAsync(cancellationToken);
            foreach (var row in page)
                if (!string.IsNullOrWhiteSpace(row.Aircraft))
                    result.Add(new AircraftEntry(row.Aircraft, row.AircraftNorm));
        }
        return result.OrderBy(e => e.DisplayName).ToList();
    }

    private sealed class AircraftRow
    {
        [JsonPropertyName("aircraft")] public string Aircraft { get; set; } = string.Empty;
        [JsonPropertyName("aircraftNorm")] public string AircraftNorm { get; set; } = string.Empty;
    }

    private async Task<IReadOnlyList<MmelItemDocument>> QueryAllAsync(QueryDefinition query, CancellationToken cancellationToken)
    {
        var iterator = _container.GetItemQueryIterator<MmelItemDocument>(query);
        var results = new List<MmelItemDocument>();

        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(cancellationToken);
            results.AddRange(page);
        }

        return results;
    }
}
