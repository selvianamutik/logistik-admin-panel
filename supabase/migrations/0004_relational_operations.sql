create table if not exists public.expense_categories (
    source_document_id text primary key,
    name text not null,
    active boolean not null default true,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_expense_categories_name on public.expense_categories (lower(name));

create table if not exists public.expenses (
    source_document_id text primary key,
    category_ref text not null references public.expense_categories(source_document_id) on delete restrict,
    category_name text,
    date date not null,
    amount numeric not null,
    note text,
    description text,
    receipt_url text,
    privacy_level text not null default 'internal',
    bank_account_ref text references public.bank_accounts(source_document_id) on delete set null,
    bank_account_name text,
    bank_account_number text,
    related_vehicle_ref text references public.vehicles(source_document_id) on delete set null,
    related_vehicle_plate text,
    related_incident_ref text,
    related_incident_settlement_line_ref text,
    related_maintenance_ref text,
    borongan_ref text,
    voucher_ref text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_expenses_category_ref on public.expenses (category_ref, date desc);
create index if not exists idx_expenses_bank_account_ref on public.expenses (bank_account_ref, date desc);
create index if not exists idx_expenses_related_vehicle_ref on public.expenses (related_vehicle_ref, date desc);
create index if not exists idx_expenses_related_incident_ref on public.expenses (related_incident_ref);
create index if not exists idx_expenses_related_maintenance_ref on public.expenses (related_maintenance_ref);

create table if not exists public.maintenances (
    source_document_id text primary key,
    vehicle_ref text not null references public.vehicles(source_document_id) on delete cascade,
    vehicle_plate text,
    type text not null,
    schedule_type text not null,
    planned_date date,
    planned_odometer numeric,
    status text not null,
    completed_date date,
    odometer_at_service numeric,
    vendor text,
    notes text,
    completion_notes text,
    attachment_urls jsonb not null default '[]'::jsonb,
    material_usages jsonb not null default '[]'::jsonb,
    material_usage_count integer,
    material_cost_total numeric,
    total_cost numeric,
    related_expense_ref text references public.expenses(source_document_id) on delete set null,
    cost numeric,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_maintenances_vehicle_ref on public.maintenances (vehicle_ref, planned_date desc);
create index if not exists idx_maintenances_related_expense_ref on public.maintenances (related_expense_ref);

create table if not exists public.incidents (
    source_document_id text primary key,
    incident_number text not null,
    issuer_company_name text,
    issuer_company_address text,
    issuer_company_phone text,
    issuer_company_email text,
    issuer_company_logo_url text,
    date_time timestamptz not null,
    vehicle_ref text not null references public.vehicles(source_document_id) on delete restrict,
    vehicle_plate text,
    driver_ref text references public.drivers(source_document_id) on delete set null,
    driver_name text,
    related_delivery_order_ref text references public.delivery_orders(source_document_id) on delete set null,
    related_do_number text,
    incident_type text not null,
    urgency text not null,
    location_text text not null,
    odometer numeric not null,
    description text not null,
    status text not null,
    attachment_urls jsonb not null default '[]'::jsonb,
    assigned_to_user_ref text references public.app_users(source_document_id) on delete set null,
    assigned_to_user_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_incidents_number on public.incidents (incident_number);
create index if not exists idx_incidents_vehicle_ref on public.incidents (vehicle_ref, date_time desc);
create index if not exists idx_incidents_driver_ref on public.incidents (driver_ref, date_time desc);
create index if not exists idx_incidents_delivery_order_ref on public.incidents (related_delivery_order_ref);

create table if not exists public.incident_action_logs (
    source_document_id text primary key,
    incident_ref text not null references public.incidents(source_document_id) on delete cascade,
    timestamp timestamptz not null,
    note text not null,
    user_ref text references public.app_users(source_document_id) on delete set null,
    user_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_incident_action_logs_incident_ref on public.incident_action_logs (incident_ref, timestamp desc);
