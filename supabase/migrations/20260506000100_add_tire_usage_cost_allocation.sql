alter table public.tire_events
    add column if not exists purchase_cost numeric,
    add column if not exists original_cost numeric,
    add column if not exists total_used_percent numeric,
    add column if not exists remaining_percent numeric,
    add column if not exists remaining_value numeric,
    add column if not exists maintenance_cost_posted_percent numeric,
    add column if not exists maintenance_cost_posted_amount numeric,
    add column if not exists last_maintenance_cost_ref text references public.maintenances(source_document_id) on delete set null;

alter table public.tire_history_logs
    add column if not exists usage_percent numeric,
    add column if not exists usage_cost numeric,
    add column if not exists cost_allocation_type text,
    add column if not exists related_maintenance_ref text references public.maintenances(source_document_id) on delete set null,
    add column if not exists cost_source_vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    add column if not exists cost_source_vehicle_plate text,
    add column if not exists remaining_percent_after numeric,
    add column if not exists remaining_value_after numeric;

create index if not exists idx_tire_history_logs_cost_source_vehicle_ref
    on public.tire_history_logs (cost_source_vehicle_ref, timestamp desc);

create index if not exists idx_tire_history_logs_related_maintenance_ref
    on public.tire_history_logs (related_maintenance_ref);
