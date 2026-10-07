# 03: Multi-page statements and wrapped rows

**What to build:** A real monthly Bank Statement spans several pages and wraps some descriptions onto a second line. All of its rows are imported exactly once, and nothing that isn't a row becomes a Transaction. See the parent spec: `.scratch/upload-bank-statement/spec.md`.

**Blocked by:** 01 (Upload a one-page Bank Statement end to end)

**Status:** ready-for-agent

- [ ] Rows on every page are imported.
- [ ] Page-carry lines ("Overført til neste side", "Overført fra forrige side"), repeated page headers (date, page number, name/address, repeated "Kontoutskrift …" header and column headings), footer/bank address lines, "Betalte omkostninger i år" and the legal notice about Valutaregisteret are ignored.
- [ ] Continuation lines (e.g. a lone "1.0000" after "Kurs:") are joined to the preceding row rather than becoming a row or causing a parse failure.
- [ ] The test-time PDF generator can produce a two-page statement with page-carry lines and a wrapped row, matching the real layout. An API integration test imports it and asserts the full row count and that reconciliation passes.
- [ ] Parser unit tests cover ignored lines, continuation lines and rows split across pages.
