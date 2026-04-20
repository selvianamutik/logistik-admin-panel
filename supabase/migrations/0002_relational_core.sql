create table if not exists public.company_profiles (
    source_document_id text primary key,
    name text,
    address text,
    phone text,
    email text,
    npwp text,
    bank_name text,
    bank_account text,
    bank_holder text,
    theme_color text,
    numbering_settings jsonb not null default '{}'::jsonb,
    invoice_settings jsonb not null default '{}'::jsonb,
    document_settings jsonb not null default '{}'::jsonb,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.drivers (
    source_document_id text primary key,
    name text not null,
    phone text,
    license_number text,
    ktp_number text,
    sim_expiry date,
    address text,
    active boolean not null default true,
    active_tracking_delivery_order_ref text,
    active_tracking_updated_at timestamptz,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.customers (
    source_document_id text primary key,
    name text not null,
    address text,
    contact_person text,
    phone text,
    email text,
    default_payment_term integer,
    npwp text,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.customer_products (
    source_document_id text primary key,
    customer_ref text not null references public.customers(source_document_id) on delete cascade,
    customer_name text,
    code text,
    name text not null,
    description text,
    default_qty_koli numeric,
    default_weight_kg numeric,
    default_weight_input_value numeric,
    default_weight_input_unit text,
    default_volume_m3 numeric,
    default_volume_input_value numeric,
    default_volume_input_unit text,
    notes text,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_customer_products_customer_ref on public.customer_products (customer_ref);

create table if not exists public.customer_recipients (
    source_document_id text primary key,
    customer_ref text not null references public.customers(source_document_id) on delete cascade,
    customer_name text,
    label text not null,
    receiver_name text not null,
    receiver_phone text,
    receiver_address text not null,
    receiver_company text,
    notes text,
    active boolean not null default true,
    is_default boolean not null default false,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_customer_recipients_customer_ref on public.customer_recipients (customer_ref);

create table if not exists public.customer_pickup_locations (
    source_document_id text primary key,
    customer_ref text not null references public.customers(source_document_id) on delete cascade,
    customer_name text,
    label text not null,
    pickup_address text not null,
    notes text,
    active boolean not null default true,
    is_default boolean not null default false,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_customer_pickup_locations_customer_ref on public.customer_pickup_locations (customer_ref);

create table if not exists public.services (
    source_document_id text primary key,
    code text,
    name text not null,
    description text,
    max_payload_kg numeric,
    overtonase_driver_rate_per_kg numeric,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.trip_route_rates (
    source_document_id text primary key,
    origin_area text not null,
    destination_area text not null,
    service_ref text references public.services(source_document_id) on delete set null,
    service_name text,
    rate numeric not null,
    notes text,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_trip_route_rates_service_ref on public.trip_route_rates (service_ref);
create index if not exists idx_trip_route_rates_route on public.trip_route_rates (origin_area, destination_area);

create table if not exists public.vehicles (
    source_document_id text primary key,
    unit_code text,
    plate_number text,
    vehicle_type text,
    brand_model text,
    year integer,
    capacity_kg numeric,
    service_ref text references public.services(source_document_id) on delete set null,
    status text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.app_users (
    source_document_id text primary key,
    name text not null,
    email text not null,
    role text not null,
    driver_ref text references public.drivers(source_document_id) on delete set null,
    driver_name text,
    password_hash text,
    active boolean not null default true,
    created_at_business timestamptz,
    last_login_at timestamptz,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create unique index if not exists idx_app_users_email on public.app_users (lower(email));

create table if not exists public.bank_accounts (
    source_document_id text primary key,
    bank_name text not null,
    account_number text not null,
    account_holder text not null,
    account_type text,
    system_key text,
    initial_balance numeric not null default 0,
    current_balance numeric not null default 0,
    active boolean not null default true,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_bank_accounts_system_key on public.bank_accounts (system_key) where system_key is not null;

create table if not exists public.bank_transactions (
    source_document_id text primary key,
    bank_account_ref text not null references public.bank_accounts(source_document_id) on delete cascade,
    bank_account_name text,
    bank_account_number text,
    type text not null,
    amount numeric not null,
    date date not null,
    description text not null,
    balance_after numeric not null default 0,
    related_payment_ref text,
    related_receipt_ref text,
    related_expense_ref text,
    related_transfer_ref text,
    related_voucher_ref text,
    related_overpayment_refund_ref text,
    related_purchase_payment_ref text,
    related_purchase_ref text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_bank_transactions_account_ref on public.bank_transactions (bank_account_ref, date desc);

create table if not exists public.orders (
    source_document_id text primary key,
    master_resi text not null,
    cargo_entry_mode text,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
    receiver_name text,
    receiver_phone text,
    receiver_address text,
    pickup_address text,
    service_ref text references public.services(source_document_id) on delete set null,
    service_name text,
    status text not null,
    notes text,
    created_at_business timestamptz,
    created_by text references public.app_users(source_document_id) on delete set null,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create unique index if not exists idx_orders_master_resi on public.orders (master_resi);

create table if not exists public.order_items (
    source_document_id text primary key,
    order_ref text not null references public.orders(source_document_id) on delete cascade,
    customer_product_ref text,
    description text not null,
    qty_koli numeric,
    weight_kg numeric,
    volume_m3 numeric,
    delivered_qty_koli numeric,
    delivered_weight_kg numeric,
    status text not null,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.delivery_orders (
    source_document_id text primary key,
    do_number text not null,
    order_ref text not null references public.orders(source_document_id) on delete cascade,
    master_resi text,
    customer_ref text references public.customers(source_document_id) on delete set null,
    vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    vehicle_plate text,
    driver_ref text references public.drivers(source_document_id) on delete set null,
    driver_name text,
    date date,
    status text not null,
    tracking_state text,
    tracking_started_at timestamptz,
    tracking_stopped_at timestamptz,
    tracking_last_seen_at timestamptz,
    tracking_last_lat double precision,
    tracking_last_lng double precision,
    customer_name text,
    receiver_name text,
    receiver_address text,
    pickup_address text,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create unique index if not exists idx_delivery_orders_do_number on public.delivery_orders (do_number);
create index if not exists idx_delivery_orders_driver_ref on public.delivery_orders (driver_ref);
create index if not exists idx_delivery_orders_status on public.delivery_orders (status);

create table if not exists public.delivery_order_items (
    source_document_id text primary key,
    delivery_order_ref text not null references public.delivery_orders(source_document_id) on delete cascade,
    order_item_ref text references public.order_items(source_document_id) on delete set null,
    order_item_description text,
    order_item_qty_koli numeric,
    order_item_weight_kg numeric,
    shipped_qty_koli numeric,
    shipped_weight_kg numeric,
    actual_qty_koli numeric,
    actual_weight_kg numeric,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.tracking_logs (
    source_document_id text primary key,
    ref_type text not null,
    ref_ref text not null,
    status text not null,
    note text,
    location_text text,
    timestamp timestamptz,
    user_ref text,
    user_name text,
    latitude double precision,
    longitude double precision,
    accuracy_m double precision,
    speed_kph double precision,
    source text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create index if not exists idx_tracking_logs_ref on public.tracking_logs (ref_type, ref_ref);
create index if not exists idx_tracking_logs_timestamp on public.tracking_logs (timestamp desc);

create table if not exists public.driver_scores (
    source_document_id text primary key,
    driver_ref text not null references public.drivers(source_document_id) on delete cascade,
    driver_name text,
    score_type text not null,
    effective_date date not null,
    duration_days integer not null,
    due_date date not null,
    notes text,
    warning_acknowledged_at timestamptz,
    warning_acknowledged_by_driver_ref text references public.drivers(source_document_id) on delete set null,
    created_at_business timestamptz,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create index if not exists idx_driver_scores_driver_ref on public.driver_scores (driver_ref, effective_date desc);

create table if not exists public.invoices (
    source_document_id text primary key,
    invoice_number text not null,
    mode text not null,
    order_ref text references public.orders(source_document_id) on delete set null,
    do_ref text references public.delivery_orders(source_document_id) on delete set null,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
    master_resi text,
    issue_date date not null,
    due_date date not null,
    status text not null,
    total_amount numeric not null,
    total_adjustment_amount numeric,
    pph23_enabled boolean,
    pph23_rate_percent numeric,
    pph23_base_mode text,
    pph23_base_amount numeric,
    pph23_amount numeric,
    net_amount numeric,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_invoices_number on public.invoices (invoice_number);
create index if not exists idx_invoices_customer_ref on public.invoices (customer_ref);

create table if not exists public.invoice_items (
    source_document_id text primary key,
    invoice_ref text not null references public.invoices(source_document_id) on delete cascade,
    description text not null,
    qty numeric,
    price numeric not null,
    subtotal numeric not null,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_invoice_items_invoice_ref on public.invoice_items (invoice_ref);

create table if not exists public.freight_notas (
    source_document_id text primary key,
    nota_number text not null,
    nota_display_number text,
    issuer_company_name text,
    issuer_company_address text,
    issuer_company_phone text,
    issuer_company_email text,
    issuer_company_logo_url text,
    issuer_company_signature_stamp_url text,
    issuer_company_signature_name text,
    issuer_company_npwp text,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text not null,
    customer_address text,
    customer_contact_person text,
    customer_phone text,
    issue_date date not null,
    due_date date,
    status text not null,
    total_amount numeric not null,
    total_adjustment_amount numeric,
    pph23_enabled boolean,
    pph23_rate_percent numeric,
    pph23_base_mode text,
    pph23_base_amount numeric,
    pph23_amount numeric,
    net_amount numeric,
    total_paid_effective numeric,
    refunded_overpayment_amount numeric,
    open_overpayment_amount numeric,
    total_collie numeric,
    total_weight_kg numeric,
    billing_mode text,
    bank_account_ref text references public.bank_accounts(source_document_id) on delete set null,
    instruction_accounts jsonb not null default '[]'::jsonb,
    footer_note text,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_freight_notas_number on public.freight_notas (nota_number);
create index if not exists idx_freight_notas_customer_ref on public.freight_notas (customer_ref);

create table if not exists public.freight_nota_items (
    source_document_id text primary key,
    nota_ref text not null references public.freight_notas(source_document_id) on delete cascade,
    do_ref text references public.delivery_orders(source_document_id) on delete set null,
    delivery_order_item_ref text references public.delivery_order_items(source_document_id) on delete set null,
    do_number text,
    vehicle_plate text,
    date date not null,
    no_sj text not null,
    dari text not null,
    tujuan text not null,
    barang text,
    collie numeric,
    berat_kg numeric not null,
    tarip numeric not null,
    uang_rp numeric not null,
    ket text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_freight_nota_items_nota_ref on public.freight_nota_items (nota_ref);

create table if not exists public.payments (
    source_document_id text primary key,
    invoice_ref text not null,
    receipt_ref text,
    receipt_number text,
    bank_account_ref text references public.bank_accounts(source_document_id) on delete set null,
    bank_account_name text,
    bank_account_number text,
    date date not null,
    amount numeric not null,
    method text not null,
    note text,
    attachment_url text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_payments_invoice_ref on public.payments (invoice_ref, date desc);
create index if not exists idx_payments_receipt_ref on public.payments (receipt_ref, date desc);

create table if not exists public.customer_receipts (
    source_document_id text primary key,
    receipt_number text not null,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text not null,
    date date not null,
    total_amount numeric not null,
    allocated_amount numeric,
    unapplied_amount numeric,
    refunded_overpayment_amount numeric,
    open_overpayment_amount numeric,
    overpayment_status text,
    allocation_count integer not null default 0,
    method text not null,
    bank_account_ref text references public.bank_accounts(source_document_id) on delete set null,
    bank_account_name text,
    bank_account_number text,
    note text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_customer_receipts_number on public.customer_receipts (receipt_number);
create index if not exists idx_customer_receipts_customer_ref on public.customer_receipts (customer_ref);

create table if not exists public.invoice_adjustments (
    source_document_id text primary key,
    invoice_ref text not null,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
    date date not null,
    amount numeric not null,
    kind text not null,
    status text not null,
    note text,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    edited_at timestamptz,
    edited_by text references public.app_users(source_document_id) on delete set null,
    edited_by_name text,
    voided_at timestamptz,
    voided_by text references public.app_users(source_document_id) on delete set null,
    voided_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_invoice_adjustments_invoice_ref on public.invoice_adjustments (invoice_ref, date desc);

create table if not exists public.customer_overpayment_refunds (
    source_document_id text primary key,
    source_type text not null,
    source_receipt_ref text references public.customer_receipts(source_document_id) on delete set null,
    source_receipt_number text,
    source_invoice_ref text,
    source_invoice_number text,
    customer_ref text references public.customers(source_document_id) on delete set null,
    customer_name text,
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
create index if not exists idx_customer_overpayment_refunds_source_receipt_ref on public.customer_overpayment_refunds (source_receipt_ref);
create index if not exists idx_customer_overpayment_refunds_source_invoice_ref on public.customer_overpayment_refunds (source_invoice_ref);
