using Azure.Core;
using Azure.Identity;
using backend.Options;
using backend.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices((context, services) =>
    {
        services.Configure<CosmosOptions>(context.Configuration.GetSection("Cosmos"));
        services.Configure<BlobOptions>(context.Configuration.GetSection("Blob"));
        services.Configure<IngestionOptions>(context.Configuration.GetSection("Ingestion"));
        services.Configure<RagOptions>(context.Configuration.GetSection("Rag"));
        services.Configure<FoundryOptions>(context.Configuration.GetSection("Foundry"));

        services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
        services.AddHttpClient();

        services.AddSingleton<ICosmosItemRepository, CosmosItemRepository>();
        services.AddSingleton<IBlobImageStore, BlobImageStore>();
        services.AddSingleton<IBlobReadUrlService, BlobReadUrlService>();
        services.AddSingleton<IRagMarkdownService, RagMarkdownService>();
        services.AddSingleton<IFoundryAgentChatService, FoundryAgentChatService>();
        services.AddSingleton<IDispatchAdvisorService, DispatchAdvisorService>();
        services.AddSingleton<IMmelIngestionService, MmelIngestionService>();
    })
    .Build();

host.Run();
