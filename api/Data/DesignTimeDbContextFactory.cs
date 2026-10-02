using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PersonligFinans.Api.Data;

// Lets `dotnet ef migrations add` build the model without a real connection string.
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>();
        DatabaseSetup.Configure(options, "Host=localhost;Database=design_time");
        return new AppDbContext(options.Options);
    }
}
