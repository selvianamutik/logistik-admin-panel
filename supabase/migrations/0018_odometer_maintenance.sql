alter table public.services
    add column if not exists oil_maintenance_km numeric,
    add column if not exists tire_layout_config jsonb;

alter table public.vehicles
    add column if not exists capacity_volume_m3 numeric,
    add column if not exists service_name text,
    add column if not exists tire_layout_config jsonb,
    add column if not exists last_odometer numeric,
    add column if not exists last_odometer_at date,
    add column if not exists oil_maintenance_interval_km numeric,
    add column if not exists oil_last_service_odometer numeric,
    add column if not exists oil_next_service_odometer numeric,
    add column if not exists oil_service_remaining_km numeric,
    add column if not exists oil_maintenance_status text,
    add column if not exists last_trip_odometer_delta_km numeric;

alter table public.delivery_orders
    add column if not exists trip_closed_by_admin_at timestamptz,
    add column if not exists trip_closed_by_admin_ref text references public.app_users(source_document_id) on delete set null,
    add column if not exists trip_closed_by_admin_name text,
    add column if not exists trip_start_odometer_km numeric,
    add column if not exists trip_end_odometer_km numeric,
    add column if not exists trip_distance_km numeric,
    add column if not exists odometer_confirmed_at timestamptz,
    add column if not exists odometer_confirmed_by_ref text references public.app_users(source_document_id) on delete set null,
    add column if not exists odometer_confirmed_by_name text;

alter table public.trips
    add column if not exists trip_closed_by_admin_at timestamptz,
    add column if not exists trip_closed_by_admin_ref text references public.app_users(source_document_id) on delete set null,
    add column if not exists trip_closed_by_admin_name text,
    add column if not exists trip_start_odometer_km numeric,
    add column if not exists trip_end_odometer_km numeric,
    add column if not exists trip_distance_km numeric,
    add column if not exists odometer_confirmed_at timestamptz,
    add column if not exists odometer_confirmed_by_ref text references public.app_users(source_document_id) on delete set null,
    add column if not exists odometer_confirmed_by_name text;

alter table public.tire_events
    add column if not exists accumulated_km numeric,
    add column if not exists last_odometer_km numeric,
    add column if not exists last_km_update_at timestamptz;

alter table public.tire_history_logs
    add column if not exists odometer_before_km numeric,
    add column if not exists odometer_after_km numeric,
    add column if not exists distance_km numeric;

alter table public.maintenances
    add column if not exists source text,
    add column if not exists related_delivery_order_ref text references public.delivery_orders(source_document_id) on delete set null,
    add column if not exists trigger_odometer numeric;

create index if not exists idx_maintenances_vehicle_status_type on public.maintenances (vehicle_ref, status, type);
create index if not exists idx_tire_events_vehicle_status on public.tire_events (vehicle_ref, status);
