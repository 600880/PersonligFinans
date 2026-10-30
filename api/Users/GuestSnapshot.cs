using System.Text.Json;
using PersonligFinans.Api.CategorizationRules;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.Users;

// The Guest snapshot: the fixed data the Guest is Restored to each time someone continues as it, and
// whenever the app starts. It was taken once, by hand, from what the Guest held, and lives in
// GuestSnapshot/ as JSON that refers to rows by their natural keys rather than their ids, so it
// fits any database: a Category by its name, a rule by its keyword. Each kept Receipt's image is a
// file of its own beside it. See docs/adr/0005-guest-is-one-shared-user.md.
public static class GuestSnapshot
{
    public record SnapshotCategory(string Name, string Description, string Colour, bool BuiltIn);

    public record SnapshotRule(string Keyword, string Category, DateTimeOffset CreatedAt, bool AiGenerated, Guid? UploadId);

    // A Transaction's Category and rule by name and keyword: a Category without a rule is Locked.
    // Bookmark is null for none, and its Folder null for "Bookmarks". Receipt is the file name of
    // its kept Receipt's image, or null for none.
    public record SnapshotTransaction(
        DateOnly PostedDate,
        string Description,
        decimal Amount,
        string? Note,
        string? Category,
        string? Rule,
        SnapshotBookmark? Bookmark,
        string? Receipt);

    public record SnapshotBookmark(string? Folder);

    public record SnapshotBankStatement(
        string AccountNumber,
        DateOnly PeriodStart,
        DateOnly PeriodEnd,
        decimal OpeningBalance,
        decimal ClosingBalance,
        DateTimeOffset ImportedAt,
        Guid UploadId,
        List<SnapshotTransaction> Transactions);

    // LastUsedFolder null means "Bookmarks"; LatestUploadId null means no Upload has imported a Bank
    // Statement, so no rule is New.
    public record Snapshot(
        List<SnapshotCategory> Categories,
        List<SnapshotRule> Rules,
        List<string> Folders,
        List<SnapshotBankStatement> BankStatements,
        List<SnapshotTransaction> ManualTransactions,
        string? LastUsedFolder,
        Guid? LatestUploadId);

    // The snapshot and its images are embedded in the assembly under these names (see the .csproj),
    // so they ship with the app and its tests without any path to find.
    private const string ResourcePrefix = "GuestSnapshot/";

    private static readonly Lazy<Snapshot> Data = new(() =>
    {
        using var stream = Resource("guest-snapshot.json");
        return JsonSerializer.Deserialize<Snapshot>(stream, JsonSerializerOptions.Web)
            ?? throw new InvalidOperationException("The Guest snapshot is empty.");
    });

    public static Snapshot Read() => Data.Value;

    // Restores the Guest that the context acts as: replaces everything it owns with the snapshot,
    // as it was, every mark included. Its AI requests are left alone, so continuing as the Guest
    // again never gives it a fresh Daily AI limit. Under the rule-change lock, like Delete your User,
    // so it never lands halfway through an import by another visitor of the Guest.
    public static async Task RestoreAsync(AppDbContext db)
    {
        var snapshot = Read();
        await using var transaction = await Categorizer.BeginRuleChangeAsync(db);
        await db.DeleteEverythingOwnedAsync();

        var owner = db.OwnerOfNewRows;
        var categories = snapshot.Categories.ToDictionary(
            c => c.Name,
            c => new Category
            {
                UserId = owner, Name = c.Name, Description = c.Description, Colour = c.Colour, BuiltIn = c.BuiltIn,
            });
        var rules = snapshot.Rules.ToDictionary(
            r => r.Keyword,
            r => new CategorizationRule
            {
                UserId = owner,
                Keyword = r.Keyword,
                Category = categories[r.Category],
                CreatedAt = r.CreatedAt.ToUniversalTime(),
                AiGenerated = r.AiGenerated,
                UploadId = r.UploadId,
            });
        var folders = snapshot.Folders.ToDictionary(name => name, name => new Folder { UserId = owner, Name = name });
        db.Categories.AddRange(categories.Values);
        db.CategorizationRules.AddRange(rules.Values);
        db.Folders.AddRange(folders.Values);

        // Bookmarks and Receipts refer to their Transaction by its id alone, so they are added once
        // the Transactions are saved and have one.
        var transactions = new List<(Transaction Row, SnapshotTransaction Snapshot)>();
        Transaction Add(SnapshotTransaction t, BankStatement? statement)
        {
            var row = new Transaction
            {
                UserId = owner,
                PostedDate = t.PostedDate,
                Description = t.Description,
                Amount = t.Amount,
                Note = t.Note,
                Category = t.Category is null ? null : categories[t.Category],
                CategorizationRule = t.Rule is null ? null : rules[t.Rule],
                BankStatement = statement,
            };
            transactions.Add((row, t));
            return row;
        }
        foreach (var s in snapshot.BankStatements)
        {
            var statement = new BankStatement
            {
                UserId = owner,
                AccountNumber = s.AccountNumber,
                PeriodStart = s.PeriodStart,
                PeriodEnd = s.PeriodEnd,
                OpeningBalance = s.OpeningBalance,
                ClosingBalance = s.ClosingBalance,
                ImportedAt = s.ImportedAt.ToUniversalTime(),
                UploadId = s.UploadId,
            };
            foreach (var t in s.Transactions)
                statement.Transactions.Add(Add(t, statement));
            db.BankStatements.Add(statement);
        }
        db.Transactions.AddRange(snapshot.ManualTransactions.Select(t => Add(t, null)));
        await db.SaveChangesAsync();

        foreach (var (row, t) in transactions)
        {
            if (t.Bookmark is not null)
                db.Bookmarks.Add(new Bookmark
                {
                    UserId = owner,
                    TransactionId = row.Id,
                    FolderId = t.Bookmark.Folder is null ? null : folders[t.Bookmark.Folder].Id,
                });
            if (t.Receipt is not null)
                db.Receipts.Add(new Receipt { UserId = owner, TransactionId = row.Id, Image = Image(t.Receipt) });
        }
        if (snapshot.LastUsedFolder is not null)
            db.LastUsedFolders.Add(new LastUsedFolder { UserId = owner, FolderId = folders[snapshot.LastUsedFolder].Id });
        if (snapshot.LatestUploadId is { } uploadId)
            db.LatestUploads.Add(new LatestUpload { UserId = owner, UploadId = uploadId });
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    private static byte[] Image(string fileName)
    {
        using var stream = Resource(fileName);
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        return bytes.ToArray();
    }

    private static Stream Resource(string fileName) =>
        typeof(GuestSnapshot).Assembly.GetManifestResourceStream(ResourcePrefix + fileName)
            ?? throw new InvalidOperationException($"The Guest snapshot has no {fileName}.");
}
