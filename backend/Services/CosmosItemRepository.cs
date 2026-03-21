using backend.Models;
using backend.Options;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Options;

namespace backend.Services;

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

    /// <summary>Exact lookup by aircraft and normalized sequence (for cross-references).</summary>
    Task<IReadOnlyList<MmelItemDocument>> GetByAircraftAndSequenceAsync(
        string aircraftNorm,
        string sequenceNorm,
        CancellationToken cancellationToken);
}

public sealed class CosmosItemRepository : ICosmosItemRepository
{
    private readonly Container _container;

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

        var database = client.CreateDatabaseIfNotExistsAsync(settings.DatabaseName).GetAwaiter().GetResult();
        _container = database.Database.CreateContainerIfNotExistsAsync(
            new ContainerProperties(settings.ContainerName, "/aircraftNorm")).GetAwaiter().GetResult().Container;
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
