using Microsoft.EntityFrameworkCore;

namespace PersonligFinans.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public const int DescriptionMaxLength = 200;
    public const int ReferenceMaxLength = 100;

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Transaction> Transactions => Set<Transaction>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Category>(category =>
        {
            category.Property(c => c.Name).HasMaxLength(50);
            category.HasIndex(c => c.Name).IsUnique();
            category.HasData(SeedCategories.All);
        });

        modelBuilder.Entity<Transaction>(transaction =>
        {
            transaction.ToTable(t => t.HasCheckConstraint("ck_transactions_amount_nonzero", "amount <> 0"));
            transaction.Property(t => t.Description).HasMaxLength(DescriptionMaxLength);
            transaction.Property(t => t.Amount).HasPrecision(12, 2);
            transaction.Property(t => t.Reference).HasMaxLength(ReferenceMaxLength);
            transaction.HasOne(t => t.Category)
                .WithMany()
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}
