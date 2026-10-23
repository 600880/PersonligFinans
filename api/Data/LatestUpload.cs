namespace PersonligFinans.Api.Data;

// The User's most recent Upload that imported a Bank Statement, whose rules are New. Each User has at
// most one. Kept apart from the Bank Statements, so deleting them leaves the New rule marks as they
// were.
public class LatestUpload
{
    public int Id { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    public Guid UploadId { get; set; }
}
