# Use ASP.NET Core + React instead of a unified Next.js stack

PersonligFinans is a dashboard-style app with a Postgres store already fixed; a unified TypeScript stack (Next.js + Prisma) was the initial recommendation for its single-deployable simplicity. We chose ASP.NET Core Web API + a separate React SPA instead, on personal familiarity with .NET.

## Consequences

Two deployables (API + SPA) instead of one, and EF Core/Npgsql for data access instead of Prisma.
