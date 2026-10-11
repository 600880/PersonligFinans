using System.Text.RegularExpressions;
using PersonligFinans.Api.Data;

namespace PersonligFinans.Api.BankStatements;

// Turns a Bank Statement row's raw "Forklaring" text into the Description of an imported
// Transaction: the merchant or payee name without the bank's card, currency and date details.
public static partial class DescriptionCleaner
{
    // "*1111 31.07 Nok 296.60 Rema 1000 Sentrum Kurs: 1.0000" → "Rema 1000 Sentrum".
    // Foreign currencies ("Eur 25.00 … Kurs: 11.6400") look the same; "Kurs:" may be absent.
    [GeneratedRegex(@"^\*\d{4} \d{2}\.\d{2} [A-Za-z]{3} [\d.]+ (?<merchant>.+?)(?: Kurs:.*)?$")]
    private static partial Regex CardPattern();

    // "Til: Fjordkraft AS Betalt: 17.08.26" → "Fjordkraft AS", and
    // "Til: 9999.88.77777 Betalt: 13.08.26" → "Overføring til konto 9999.88.77777".
    [GeneratedRegex(@"^Til: (?<payee>.+?) Betalt: \d{2}\.\d{2}\.\d{2}$")]
    private static partial Regex PaymentPattern();

    // A payee that is only an account number: "Til: 9999.88.77777 Betalt: 13.08.26".
    [GeneratedRegex(@"^\d{4}\.\d{2}\.\d{5}$")]
    private static partial Regex AccountNumberPattern();

    // Payments to a bare account number get this prefix, so one Categorization Rule can match them all.
    public const string AccountTransferPrefix = "Overføring til konto";

    // "Varer 04.08 Rema Storgata Nedre Torget Oslo" → "Rema Storgata Nedre Torget Oslo".
    [GeneratedRegex(@"^Varer \d{2}\.\d{2} (?<shop>.+)$")]
    private static partial Regex GoodsPattern();

    // Other rows (e.g. "Overføring mellom egne kontoer") are kept as-is. The result is truncated
    // to the Description max length.
    public static string Clean(string text)
    {
        var description = text;
        if (CardPattern().Match(text) is { Success: true } card)
            description = card.Groups["merchant"].Value;
        else if (PaymentPattern().Match(text) is { Success: true } payment)
        {
            var payee = payment.Groups["payee"].Value;
            description = AccountNumberPattern().IsMatch(payee) ? $"{AccountTransferPrefix} {payee}" : payee;
        }
        else if (GoodsPattern().Match(text) is { Success: true } goods)
            description = goods.Groups["shop"].Value;

        return description.Length > AppDbContext.DescriptionMaxLength
            ? description[..AppDbContext.DescriptionMaxLength]
            : description;
    }
}
