create table if not exists public.driver_vouchers (
    source_document_id text primary key,
    bon_number text not null,
    issuer_company_name text,
    issuer_company_address text,
    issuer_company_phone text,
    issuer_company_email text,
    issuer_company_logo_url text,
    driver_ref text not null references public.drivers(source_document_id) on delete restrict,
    driver_name text,
    delivery_order_ref text references public.delivery_orders(source_document_id) on delete set null,
    do_number text,
    vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    vehicle_plate text,
    route text,
    issued_date date not null,
    cash_given numeric not null,
    initial_cash_given numeric,
    total_issued_amount numeric,
    top_up_count integer,
    driver_fee_amount numeric,
    total_claim_amount numeric,
    issue_bank_ref text references public.bank_accounts(source_document_id) on delete set null,
    issue_bank_name text,
    total_spent numeric not null,
    balance numeric not null,
    status text not null,
    notes text,
    settled_date date,
    settled_by text references public.app_users(source_document_id) on delete set null,
    settlement_bank_ref text references public.bank_accounts(source_document_id) on delete set null,
    settlement_bank_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_driver_vouchers_number on public.driver_vouchers (bon_number);
create index if not exists idx_driver_vouchers_driver_ref on public.driver_vouchers (driver_ref, issued_date desc);

create table if not exists public.driver_voucher_disbursements (
    source_document_id text primary key,
    voucher_ref text not null references public.driver_vouchers(source_document_id) on delete cascade,
    date date not null,
    amount numeric not null,
    kind text not null,
    bank_account_ref text references public.bank_accounts(source_document_id) on delete set null,
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
create index if not exists idx_driver_voucher_disbursements_voucher_ref on public.driver_voucher_disbursements (voucher_ref, date desc);

create table if not exists public.driver_voucher_items (
    source_document_id text primary key,
    voucher_ref text not null references public.driver_vouchers(source_document_id) on delete cascade,
    expense_date date,
    category text not null,
    description text not null,
    amount numeric not null,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_driver_voucher_items_voucher_ref on public.driver_voucher_items (voucher_ref);

create table if not exists public.driver_borongans (
    source_document_id text primary key,
    borongan_number text not null,
    issuer_company_name text,
    issuer_company_address text,
    issuer_company_phone text,
    issuer_company_email text,
    issuer_company_logo_url text,
    driver_ref text references public.drivers(source_document_id) on delete set null,
    driver_name text not null,
    period_start date not null,
    period_end date not null,
    status text not null,
    total_amount numeric not null,
    total_collie numeric not null,
    total_weight_kg numeric not null,
    notes text,
    paid_date date,
    paid_method text,
    paid_bank_ref text references public.bank_accounts(source_document_id) on delete set null,
    paid_bank_name text,
    paid_bank_number text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_driver_borongans_number on public.driver_borongans (borongan_number);
create index if not exists idx_driver_borongans_driver_ref on public.driver_borongans (driver_ref, period_end desc);

create table if not exists public.driver_borongan_items (
    source_document_id text primary key,
    borongan_ref text not null references public.driver_borongans(source_document_id) on delete cascade,
    do_ref text references public.delivery_orders(source_document_id) on delete set null,
    do_number text,
    vehicle_plate text,
    date date not null,
    no_sj text not null,
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
create index if not exists idx_driver_borongan_items_borongan_ref on public.driver_borongan_items (borongan_ref);
create index if not exists idx_driver_borongan_items_do_ref on public.driver_borongan_items (do_ref);
