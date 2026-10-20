using System.Globalization;

namespace PersonligFinans.Api;

// The order the User's own names are listed in: the Norwegian alphabet, where Æ, Ø and Å come last,
// ignoring case. The client sorts an added or renamed name the same way.
public static class NorwegianAlphabet
{
    public static readonly StringComparer IgnoringCase =
        StringComparer.Create(CultureInfo.GetCultureInfo("nb-NO"), ignoreCase: true);
}
