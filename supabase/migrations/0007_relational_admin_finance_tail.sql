create table if not exists public.employees (
    source_document_id text primary key,
    employee_code text not null,
    name text not null,
    phone text,
    position text,
    division text,
    join_date date,
    active boolean not null default true,
    user_ref text references public.app_users(source_document_id) on delete set null,
    user_name text,
    notes text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create unique index if not exists idx_employees_code on public.employees (employee_code);
create index if not exists idx_employees_user_ref on public.employees (user_ref);

create table if not exists public.employee_attendance_records (
    source_document_id text primary key,
    employee_ref text not null references public.employees(source_document_id) on delete cascade,
    employee_code text,
    employee_name text,
    position text,
    division text,
    date date not null,
    status text not null,
    check_in_time text,
    check_out_time text,
    note text,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    updated_by text references public.app_users(source_document_id) on delete set null,
    updated_by_name text,
    created_at_business timestamptz,
    updated_at_business timestamptz,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_employee_attendance_records_employee_ref on public.employee_attendance_records (employee_ref, date desc);

create table if not exists public.incomes (
    source_document_id text primary key,
    source_type text not null,
    payment_ref text references public.payments(source_document_id) on delete set null,
    receipt_ref text references public.customer_receipts(source_document_id) on delete set null,
    date date not null,
    amount numeric not null,
    note text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);
create index if not exists idx_incomes_payment_ref on public.incomes (payment_ref);
create index if not exists idx_incomes_receipt_ref on public.incomes (receipt_ref);
create index if not exists idx_incomes_date on public.incomes (date desc);
