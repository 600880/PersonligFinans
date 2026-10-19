using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PersonligFinans.Api.Users;

namespace PersonligFinans.Api.Data;

// Also holds Identity's Users, their claims, logins and tokens. A user-only context, since the app
// has no roles.
public class AppDbContext(DbContextOptions<AppDbContext> options, CurrentUser currentUser)
    : IdentityUserContext<IdentityUser>(options)
{
    public const int DescriptionMaxLength = 200;
    public const int NoteMaxLength = 256;
    public const int AccountNumberMaxLength = 20;
    public const int KeywordMaxLength = 100;
    public const int CategoryNameMaxLength = 50;
    public const int CategoryDescriptionMaxLength = 200;
    public const int CategoryColourMaxLength = 7;

    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<BankStatement> BankStatements => Set<BankStatement>();
    public DbSet<CategorizationRule> CategorizationRules => Set<CategorizationRule>();
    public DbSet<AiRequest> AiRequests => Set<AiRequest>();
    public DbSet<SentPasswordResetEmail> SentPasswordResetEmails => Set<SentPasswordResetEmail>();

    // The User this context works for, or null for nobody. Its queries see only that User's
    // Transactions, Bank Statements, Categories and Categorization Rules, through the query filters.
    // Read at each query.
    public string? CurrentUserId => currentUser.Id;

    // The owner every write gives a new Transaction, Bank Statement, Category or Categorization Rule
    // explicitly: the current User. Acting for nobody, there is no one to own it, so the write fails
    // here rather than in the database.
    public string OwnerOfNewRows => CurrentUserId
        ?? throw new InvalidOperationException("Only a signed-in User can own new rows.");

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Identity names its tables itself, which the snake_case naming convention leaves alone.
        modelBuilder.Entity<IdentityUser>().ToTable("asp_net_users");
        modelBuilder.Entity<IdentityUserClaim<string>>().ToTable("asp_net_user_claims");
        modelBuilder.Entity<IdentityUserLogin<string>>().ToTable("asp_net_user_logins");
        modelBuilder.Entity<IdentityUserToken<string>>().ToTable("asp_net_user_tokens");

        // Names are unique among the User's Categories ignoring case, through an index on
        // (user_id, lower(name)) that the migration creates by hand, since EF Core can't model an
        // expression index.
        modelBuilder.Entity<Category>(category =>
        {
            OwnedByAUser(category);
            category.Property(c => c.Name).HasMaxLength(CategoryNameMaxLength);
            category.Property(c => c.Description).HasMaxLength(CategoryDescriptionMaxLength);
            category.Property(c => c.Colour).HasMaxLength(CategoryColourMaxLength);
        });

        modelBuilder.Entity<Transaction>(transaction =>
        {
            OwnedByAUser(transaction);
            transaction.ToTable(t => t.HasCheckConstraint("ck_transactions_amount_nonzero", "amount <> 0"));
            transaction.Property(t => t.Description).HasMaxLength(DescriptionMaxLength);
            transaction.Property(t => t.Amount).HasPrecision(12, 2);
            transaction.Property(t => t.Note).HasMaxLength(NoteMaxLength);
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

        // Keywords are also unique among the User's rules ignoring case, through an index on
        // (user_id, lower(keyword)) that the migration creates by hand, since EF Core can't model an
        // expression index.
        modelBuilder.Entity<CategorizationRule>(rule =>
        {
            OwnedByAUser(rule);
            rule.Property(r => r.Keyword).HasMaxLength(KeywordMaxLength);
            rule.HasOne(r => r.Category)
                .WithMany()
                .HasForeignKey(r => r.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<BankStatement>(statement =>
        {
            OwnedByAUser(statement);
            statement.Property(s => s.AccountNumber).HasMaxLength(AccountNumberMaxLength);
            statement.Property(s => s.OpeningBalance).HasPrecision(12, 2);
            statement.Property(s => s.ClosingBalance).HasPrecision(12, 2);
            // A User imports a Bank Statement at most once.
            statement.HasIndex(s => new { s.UserId, s.AccountNumber, s.PeriodStart, s.PeriodEnd }).IsUnique();
        });

        // Not owned like the rows above: the AI request ledger counts every User's AI requests
        // towards the global cap, so there is no query filter, and nothing shows them to a User.
        // They are only ever counted, by User and by time, within one day.
        modelBuilder.Entity<AiRequest>(request =>
        {
            request.HasOne<IdentityUser>()
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            request.HasIndex(r => new { r.UserId, r.MadeAt });
            request.HasIndex(r => r.MadeAt);
        });

        // Not owned either: nobody is signed in when a reset email is sent, since whoever asks for one
        // can't sign in, and the daily cap counts every User's. So there is no query filter, and
        // nothing shows them to a User. They are only ever counted, by User and by time, and deleted
        // once no cap counts them any more.
        modelBuilder.Entity<SentPasswordResetEmail>(email =>
        {
            email.HasOne<IdentityUser>()
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            email.HasIndex(e => new { e.UserId, e.SentAt });
            email.HasIndex(e => e.SentAt);
        });
    }

    // Each User sees only their own rows, so no query can reach another User's data by leaving out a
    // condition. Signed out, the current User is nobody, so no row is seen.
    private void OwnedByAUser<TEntity>(EntityTypeBuilder<TEntity> entity) where TEntity : class
    {
        entity.HasOne<IdentityUser>()
            .WithMany()
            .HasForeignKey("UserId")
            .OnDelete(DeleteBehavior.Restrict);
        entity.HasQueryFilter(row => EF.Property<string>(row, "UserId") == CurrentUserId);
    }
}
