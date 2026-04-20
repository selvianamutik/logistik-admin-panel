create table if not exists public.tire_events (
    source_document_id text primary key,
    tire_code text not null,
    holder_type text not null,
    status text not null,
    vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    vehicle_plate text,
    posisi text not null,
    position_key text,
    slot_code text,
    slot_label text,
    external_party_name text,
    external_plate_number text,
    tire_type text not null,
    tire_brand text not null,
    tire_size text not null,
    linked_warehouse_item_ref text references public.warehouse_items(source_document_id) on delete set null,
    linked_warehouse_item_code text,
    linked_warehouse_item_name text,
    source_purchase_ref text references public.purchases(source_document_id) on delete set null,
    source_purchase_number text,
    source_purchase_item_ref text references public.purchase_items(source_document_id) on delete set null,
    source_receive_date date,
    install_date date not null,
    replace_date date,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_tire_events_code on public.tire_events (tire_code);
create index if not exists idx_tire_events_vehicle_ref on public.tire_events (vehicle_ref);
create index if not exists idx_tire_events_warehouse_item_ref on public.tire_events (linked_warehouse_item_ref);
