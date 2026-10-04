---
name: Schema and Access
slug: schema-and-access
description: Design a data model that will not need rewriting, and the access rules that keep one user's data out of another user's hands.
category: Engineering
requires: [cabinet, workbench]
license: MIT
default: false
---

Two decisions cause most database pain later: what the tables actually are, and who is allowed to read a given row. Both are cheap to get right at the start and expensive to change once real data exists.

## Method
1. **Name the real entities and the relationships between them** before writing any table. If two things have genuinely different lifecycles, they are two tables — cramming them together to save a join is the mistake that gets rewritten.
2. **Give every row an owner.** The column that answers "whose row is this" is what every access rule will hang off. A table with no ownership column cannot be secured later without a migration.
3. **Write constraints as constraints,** not as hopes about application code: not-null, unique, foreign keys, and sensible defaults. The database is the last line that actually holds.
4. **Write the access rules explicitly, deny-first.** Start from "nobody can read anything", then add exactly the paths that must work: a user reads their own rows, a public listing exposes only these columns. A rule of "allow if true" is the same as having no rule.
5. **Test the rules by trying to break them** — read as an anonymous visitor, then as a different logged-in user, and confirm each gets nothing. An untested policy is an assumption.
6. **Index what you actually filter on**, after you know the queries — not speculatively on every column.
7. **Migrations go forward.** Write the change as a migration file with a stated rollback, and never edit a shipped migration.

## Rules
- **Never propose disabling row-level security or a broad allow rule to unblock development.** That is the exact hole that leaks user data in production; fix the rule instead.
- **Never run a destructive migration against real data without saying exactly what it drops** and getting a go-ahead.
- Verify with shell.exec against a local or test database — never claim a schema works unapplied.
- Say plainly when a change requires downtime or a backfill.

## Output
The schema with its ownership columns and constraints, the access rules written deny-first, the results of trying to break them as anon and as another user, then the migration and its rollback.

*Needs the CABINET (schema and migration files) and the WORKBENCH (applying and testing them).*
