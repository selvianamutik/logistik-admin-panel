drop table if exists public.app_documents cascade;
drop function if exists public.set_app_documents_updated_at() cascade;

create table if not exists public.audit_logs (
    source_document_id text primary key,
    actor_user_ref text references public.app_users(source_document_id) on delete set null,
    actor_user_name text,
    actor_user_email text,
    actor_user_role text,
    action text not null,
    entity_type text not null,
    entity_ref text,
    changes_summary text not null,
    timestamp timestamptz not null default now(),
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_actor_user_ref on public.audit_logs (actor_user_ref, timestamp desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_ref);
create index if not exists idx_audit_logs_timestamp on public.audit_logs (timestamp desc);

create table if not exists public.tire_history_logs (
    source_document_id text primary key,
    tire_event_ref text not null references public.tire_events(source_document_id) on delete cascade,
    tire_code text not null,
    tire_brand text,
    tire_size text,
    action_type text not null,
    timestamp timestamptz not null default now(),
    actor_user_ref text references public.app_users(source_document_id) on delete set null,
    actor_user_name text,
    note text,
    from_holder_type text,
    from_status text,
    from_vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    from_vehicle_plate text,
    from_slot_code text,
    from_placement_label text,
    to_holder_type text,
    to_status text,
    to_vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    to_vehicle_plate text,
    to_slot_code text,
    to_placement_label text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_tire_history_logs_tire_event_ref on public.tire_history_logs (tire_event_ref, timestamp desc);
create index if not exists idx_tire_history_logs_tire_code on public.tire_history_logs (tire_code, timestamp desc);
create index if not exists idx_tire_history_logs_timestamp on public.tire_history_logs (timestamp desc);

create table if not exists public.rate_limit_buckets (
    id text primary key,
    count integer not null default 0,
    reset_at bigint not null,
    updated_at timestamptz not null default now()
);
create index if not exists idx_rate_limit_buckets_reset_at on public.rate_limit_buckets (reset_at);
