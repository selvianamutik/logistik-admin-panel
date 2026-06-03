create table if not exists public.supplier_item_prices (
    source_document_id text primary key,
    supplier_ref text not null references public.suppliers(source_document_id) on delete restrict,
    supplier_code text,
    supplier_name text,
    warehouse_item_ref text not null references public.warehouse_items(source_document_id) on delete restrict,
    item_code text,
    item_name text,
    item_unit text,
    supplier_sku text,
    supplier_item_name text,
    default_purchase_price numeric not null default 0,
    min_order_qty numeric,
    lead_time_days integer,
    effective_from date,
    effective_to date,
    active boolean not null default true,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    created_at_business timestamptz,
    updated_at_business timestamptz,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

alter table public.supplier_item_prices enable row level security;

create index if not exists idx_supplier_item_prices_supplier_ref
    on public.supplier_item_prices (supplier_ref, active);
create index if not exists idx_supplier_item_prices_warehouse_item_ref
    on public.supplier_item_prices (warehouse_item_ref, active);
create unique index if not exists idx_supplier_item_prices_active_unique
    on public.supplier_item_prices (supplier_ref, warehouse_item_ref)
    where active = true;

alter table public.purchase_items
    add column if not exists supplier_item_price_ref text references public.supplier_item_prices(source_document_id) on delete set null,
    add column if not exists price_source text,
    add column if not exists price_effective_date date,
    add column if not exists original_unit_price numeric,
    add column if not exists price_overridden boolean,
    add column if not exists price_override_reason text;

create index if not exists idx_purchase_items_supplier_item_price_ref
    on public.purchase_items (supplier_item_price_ref);

alter table public.stock_movements
    add column if not exists unit_cost_snapshot numeric,
    add column if not exists subtotal_cost numeric,
    add column if not exists cost_method text;
