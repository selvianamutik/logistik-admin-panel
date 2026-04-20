# Supabase Backend

This project now seeds and resets against the relational Supabase schema only.

## Strategy

The active setup flow targets only relational tables in `public` for runtime reads, writes, seeding, resetting, and importing.

## Required environment variables

```env
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Setup

1. Create a Supabase project.
2. Run [0002_relational_core.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0002_relational_core.sql) in the SQL editor.
3. Run [0003_relational_hardening.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0003_relational_hardening.sql) in the SQL editor.
4. Run [0004_relational_operations.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0004_relational_operations.sql) in the SQL editor.
5. Run [0005_relational_inventory.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0005_relational_inventory.sql) in the SQL editor.
6. Run [0006_relational_driver_ops.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0006_relational_driver_ops.sql) in the SQL editor.
7. Run [0007_relational_admin_finance_tail.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0007_relational_admin_finance_tail.sql) in the SQL editor.
8. Run [0008_relational_tire_assets.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0008_relational_tire_assets.sql) in the SQL editor.
9. Run [0010_relational_incident_settlement.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0010_relational_incident_settlement.sql) in the SQL editor.
10. Run [0011_relational_system_support.sql](/d:/Work/Web/logistik-admin-panel/supabase/migrations/0011_relational_system_support.sql) in the SQL editor.
11. Seed baseline app data directly from repo seed:

```bash
npm run reseed:supabase
```

12. Optional: import an existing export file into Supabase:

```bash
node scripts/import-supabase.mjs artifacts/your-export.json
```

## Notes

- `npm run reseed:supabase` clears and repopulates only the relational tables.
- `node scripts/import-supabase.mjs ...` now imports only relationally supported document types and prints a skipped-type report for everything else.
- If `0002_relational_core.sql` has not been applied yet, the reset/seed scripts will skip missing relational tables and warn instead of silently recreating a bridge-only dataset.
- Number generation is handled optimistically against the `companyProfile` document to match the current app behavior.
