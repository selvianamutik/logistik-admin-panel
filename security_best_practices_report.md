# Security Best Practices Report

The app is now oriented around a Supabase relational backend. The highest-value security work from here is to keep privileged database credentials server-only, apply migrations consistently, and avoid exposing unrestricted database access to browser code.

## Current Notes

- `SUPABASE_SERVICE_ROLE_KEY` must remain server-side only and must never be exposed through `NEXT_PUBLIC_*` variables.
- Public tables should be reviewed for RLS policies before production launch.
- Runtime access currently goes through server routes and repository helpers, which keeps service-role usage out of client components.
- Login rate-limit buckets and audit logs now use relational Supabase tables.
