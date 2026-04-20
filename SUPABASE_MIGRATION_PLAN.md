# Supabase Migration Status

This repo now treats the relational Supabase schema as the active backend path.

## Active migration stack

- [0002_relational_core.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0002_relational_core.sql)
- [0003_relational_hardening.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0003_relational_hardening.sql)
- [0004_relational_operations.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0004_relational_operations.sql)
- [0005_relational_inventory.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0005_relational_inventory.sql)
- [0006_relational_driver_ops.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0006_relational_driver_ops.sql)
- [0007_relational_admin_finance_tail.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0007_relational_admin_finance_tail.sql)
- [0008_relational_tire_assets.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0008_relational_tire_assets.sql)
- [0010_relational_incident_settlement.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0010_relational_incident_settlement.sql)
- [0011_relational_system_support.sql](/D:/Work/Web/logistik-admin-panel/supabase/migrations/0011_relational_system_support.sql)

## Current state

- Runtime app code uses the relational Supabase repository path.
- `npm run reseed:supabase` is relational-only.
- `node scripts/import-supabase.mjs ...` imports only relationally supported entities.
- `auditLog`, `tireHistoryLog`, and login rate-limit buckets now have relational tables.
- The old single-table document bridge migration has been removed.

## Verification

- `node scripts/typecheck.mjs`
- `npm run audit:supabase`

Both checks passed after the Supabase-only cleanup.
