create table if not exists public.incident_settlement_lines (
    source_document_id text primary key,
    incident_ref text not null references public.incidents(source_document_id) on delete cascade,
    incident_number text,
    line_type text not null,
    category text not null,
    date date not null,
    amount numeric not null,
    description text not null,
    payee_name text,
    recipient_type text,
    note text,
    status text not null,
    linked_expense_ref text references public.expenses(source_document_id) on delete set null,
    linked_expense_date date,
    linked_expense_amount numeric,
    linked_expense_category_ref text references public.expense_categories(source_document_id) on delete set null,
    linked_expense_category_name text,
    posted_at timestamptz,
    posted_by text references public.app_users(source_document_id) on delete set null,
    posted_by_name text,
    created_at_business timestamptz,
    created_by text references public.app_users(source_document_id) on delete set null,
    created_by_name text,
    updated_at_business timestamptz,
    updated_by text references public.app_users(source_document_id) on delete set null,
    updated_by_name text,
    voided_at timestamptz,
    voided_by text references public.app_users(source_document_id) on delete set null,
    voided_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create index if not exists idx_incident_settlement_lines_incident_ref
    on public.incident_settlement_lines (incident_ref, date desc);
create index if not exists idx_incident_settlement_lines_status
    on public.incident_settlement_lines (status);
create index if not exists idx_incident_settlement_lines_linked_expense_ref
    on public.incident_settlement_lines (linked_expense_ref);
