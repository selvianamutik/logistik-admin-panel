alter table public.orders
    add column if not exists receiver_company text;

alter table public.delivery_orders
    add column if not exists customer_do_prefix text,
    add column if not exists customer_do_sequence integer,
    add column if not exists customer_do_period text,
    add column if not exists customer_do_number text,
    add column if not exists receiver_phone text,
    add column if not exists receiver_company text,
    add column if not exists service_ref text references public.services(source_document_id) on delete set null,
    add column if not exists service_name text,
    add column if not exists vehicle_service_ref text references public.services(source_document_id) on delete set null,
    add column if not exists vehicle_service_name text,
    add column if not exists vehicle_category_override_reason text,
    add column if not exists trip_route_rate_ref text references public.trip_route_rates(source_document_id) on delete set null,
    add column if not exists trip_origin_area text,
    add column if not exists trip_destination_area text,
    add column if not exists base_tarip_borongan numeric,
    add column if not exists tarip_borongan numeric,
    add column if not exists keterangan_borongan text,
    add column if not exists freight_nota_ref text references public.freight_notas(source_document_id) on delete set null,
    add column if not exists freight_nota_number text;

alter table public.delivery_order_items
    add column if not exists pickup_stop_key text,
    add column if not exists pickup_address text,
    add column if not exists shipper_reference_key text,
    add column if not exists shipper_reference_number text,
    add column if not exists order_item_volume_m3 numeric,
    add column if not exists order_item_weight_input_value numeric,
    add column if not exists order_item_weight_input_unit text,
    add column if not exists order_item_volume_input_value numeric,
    add column if not exists order_item_volume_input_unit text,
    add column if not exists held_qty_koli numeric,
    add column if not exists held_weight_kg numeric,
    add column if not exists held_volume_m3 numeric,
    add column if not exists shipped_volume_m3 numeric,
    add column if not exists actual_volume_m3 numeric;

alter table public.freight_nota_items
    add column if not exists delivery_order_item_refs jsonb default '[]'::jsonb,
    add column if not exists customer_ref text references public.customers(source_document_id) on delete set null,
    add column if not exists customer_name text,
    add column if not exists volume_m3 numeric;

alter table public.freight_notas
    add column if not exists total_volume_m3 numeric;

create table if not exists public.customer_billing_rates (
    source_document_id text primary key,
    customer_ref text not null references public.customers(source_document_id) on delete cascade,
    customer_name text,
    service_ref text references public.services(source_document_id) on delete set null,
    service_name text,
    basis text not null,
    rate numeric not null,
    route_from text,
    route_to text,
    notes text,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

alter table public.customer_billing_rates enable row level security;

create index if not exists idx_customer_billing_rates_customer_ref
    on public.customer_billing_rates (customer_ref);

create index if not exists idx_customer_billing_rates_lookup
    on public.customer_billing_rates (customer_ref, service_ref, basis, active);

create index if not exists idx_delivery_orders_customer_do_number
    on public.delivery_orders (customer_ref, customer_do_number);

create index if not exists idx_delivery_orders_freight_nota_ref
    on public.delivery_orders (freight_nota_ref);

create index if not exists idx_delivery_order_items_shipper_reference_number
    on public.delivery_order_items (delivery_order_ref, shipper_reference_number);

create index if not exists idx_freight_nota_items_customer_ref
    on public.freight_nota_items (customer_ref);
