-- Keep trip/SJ storage tables closed to direct anon/auth REST access.
-- The app reads/writes these tables through the server-side service role API.

alter table public.trips enable row level security;
alter table public.surat_jalan_documents enable row level security;
alter table public.surat_jalan_items enable row level security;
