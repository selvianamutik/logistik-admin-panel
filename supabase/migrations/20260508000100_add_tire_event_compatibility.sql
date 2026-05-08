alter table public.tire_events
    add column if not exists compatible_service_ref text references public.services(source_document_id) on delete set null,
    add column if not exists compatible_service_name text;

create index if not exists idx_tire_events_compatible_service_ref
    on public.tire_events (compatible_service_ref);
