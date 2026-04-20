create table if not exists public.suppliers (
    source_document_id text primary key,
    supplier_code text not null,
    name text not null,
    contact_person text,
    phone text,
    address text,
    default_term_days integer,
    active boolean not null default true,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_suppliers_code on public.suppliers (supplier_code);
create index if not exists idx_suppliers_name on public.suppliers (lower(name));

create table if not exists public.warehouse_items (
    source_document_id text primary key,
    item_code text not null,
    name text not null,
    category text,
    unit text not null,
    tracking_mode text,
    min_stock_qty numeric,
    current_stock_qty numeric,
    default_supplier_ref text references public.suppliers(source_document_id) on delete set null,
    default_supplier_name text,
    default_purchase_price numeric,
    tire_type_default text,
    tire_brand_default text,
    tire_size_default text,
    active boolean not null default true,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_warehouse_items_code on public.warehouse_items (item_code);
create index if not exists idx_warehouse_items_supplier_ref on public.warehouse_items (default_supplier_ref);
create index if not exists idx_warehouse_items_name on public.warehouse_items (lower(name));

create table if not exists public.purchases (
    source_document_id text primary key,
    purchase_number text not null,
    supplier_ref text not null references public.suppliers(source_document_id) on delete restrict,
    supplier_name text,
    order_date date not null,
    due_date date,
    status text not null,
    notes text,
    total_amount numeric,
    total_ordered_qty numeric,
    total_received_qty numeric,
    paid_amount numeric,
    outstanding_amount numeric,
    line_count integer,
    last_received_at timestamptz,
    last_paid_at timestamptz,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    created_at_business timestamptz,
    updated_at_business timestamptz,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_purchases_number on public.purchases (purchase_number);
create index if not exists idx_purchases_supplier_ref on public.purchases (supplier_ref, order_date desc);

create table if not exists public.purchase_items (
    source_document_id text primary key,
    purchase_ref text not null references public.purchases(source_document_id) on delete cascade,
    warehouse_item_ref text not null references public.warehouse_items(source_document_id) on delete restrict,
    item_code text,
    item_name text,
    item_unit text,
    tracking_mode text,
    tire_type_default text,
    tire_brand_default text,
    tire_size_default text,
    ordered_qty numeric not null,
    received_qty numeric,
    unit_price numeric not null,
    subtotal numeric not null,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_purchase_items_purchase_ref on public.purchase_items (purchase_ref);
create index if not exists idx_purchase_items_warehouse_item_ref on public.purchase_items (warehouse_item_ref);

create table if not exists public.purchase_payments (
    source_document_id text primary key,
    purchase_ref text not null references public.purchases(source_document_id) on delete cascade,
    purchase_number text,
    supplier_ref text references public.suppliers(source_document_id) on delete set null,
    supplier_name text,
    date date not null,
    amount numeric not null,
    bank_account_ref text not null references public.bank_accounts(source_document_id) on delete restrict,
    bank_account_name text,
    bank_account_number text,
    bank_transaction_ref text,
    note text,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_purchase_payments_purchase_ref on public.purchase_payments (purchase_ref, date desc);
create index if not exists idx_purchase_payments_bank_account_ref on public.purchase_payments (bank_account_ref, date desc);

create table if not exists public.stock_movements (
    source_document_id text primary key,
    warehouse_item_ref text not null references public.warehouse_items(source_document_id) on delete cascade,
    item_code text,
    item_name text,
    unit text,
    movement_date date not null,
    type text not null,
    source_type text not null,
    source_ref text,
    source_number text,
    quantity numeric not null,
    balance_after numeric,
    note text,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_warehouse_item_ref on public.stock_movements (warehouse_item_ref, movement_date desc);
create index if not exists idx_stock_movements_source_ref on public.stock_movements (source_ref);
