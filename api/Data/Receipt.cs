namespace PersonligFinans.Api.Data;

// A Receipt kept with the Transaction it was saved as. It can never be added afterwards or removed
// on its own.
public class Receipt
{
    // The Transaction it was saved with, which has at most one, so it is also the Receipt's key.
    // Deleting the Transaction deletes it.
    public int TransactionId { get; set; }

    // The User it belongs to.
    public required string UserId { get; set; }

    // The JPEG the picked photo was reduced to in the browser. Always a JPEG, so its media type isn't
    // stored.
    public required byte[] Image { get; set; }
}
