using Microsoft.EntityFrameworkCore;

namespace PersonligFinans.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public const int DescriptionMaxLength = 200;
    public const int ReferenceMaxLength = 100;
    public const int AccountNumberMaxLength = 20;
    public const int KeywordMaxLength = 100;
    public const int CategoryNameMaxLength = 50;
    public const int CategoryDescriptionMaxLength = 200;

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<BankStatement> BankStatements => Set<BankStatement>();
    public DbSet<CategorizationRule> CategorizationRules => Set<CategorizationRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Names are unique ignoring case, through an index on lower(name) that the migration
        // creates by hand, since EF Core can't model an expression index.
        modelBuilder.Entity<Category>(category =>
        {
            category.Property(c => c.Name).HasMaxLength(CategoryNameMaxLength);
            category.Property(c => c.Description).HasMaxLength(CategoryDescriptionMaxLength);
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
            transaction.HasOne(t => t.BankStatement)
                .WithMany(s => s.Transactions)
                .HasForeignKey(t => t.BankStatementId)
                .OnDelete(DeleteBehavior.Cascade);
            transaction.HasOne(t => t.CategorizationRule)
                .WithMany()
                .HasForeignKey(t => t.CategorizationRuleId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        // Keywords are also unique ignoring case, through an index on lower(keyword) that the
        // migration creates by hand, since EF Core can't model an expression index.
        modelBuilder.Entity<CategorizationRule>(rule =>
        {
            rule.Property(r => r.Keyword).HasMaxLength(KeywordMaxLength);
            rule.HasOne(r => r.Category)
                .WithMany()
                .HasForeignKey(r => r.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BankStatement>(statement =>
        {
            statement.Property(s => s.AccountNumber).HasMaxLength(AccountNumberMaxLength);
            statement.Property(s => s.OpeningBalance).HasPrecision(12, 2);
            statement.Property(s => s.ClosingBalance).HasPrecision(12, 2);
            // A Bank Statement is imported at most once.
            statement.HasIndex(s => new { s.AccountNumber, s.PeriodStart, s.PeriodEnd }).IsUnique();
        });
    }
}
