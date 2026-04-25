create table if not exists public.chart_of_accounts (
    id uuid primary key default gen_random_uuid(),
    source_document_id text not null unique,
    code text not null unique,
    name text not null,
    account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_REVENUE')),
    normal_balance text not null check (normal_balance in ('DEBIT', 'CREDIT')),
    system_key text unique,
    parent_ref text,
    active boolean not null default true,
    description text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
    id uuid primary key default gen_random_uuid(),
    source_document_id text not null unique,
    entry_number text not null unique,
    entry_date date not null,
    memo text not null,
    source_type text,
    source_ref text,
    source_event text,
    source_number text,
    source_label text,
    status text not null default 'POSTED' check (status in ('POSTED', 'VOID')),
    total_debit numeric(18, 2) not null default 0,
    total_credit numeric(18, 2) not null default 0,
    posted_at timestamptz,
    posted_by text,
    posted_by_name text,
    voided_at timestamptz,
    voided_by text,
    voided_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now(),
    constraint journal_entries_balanced check (round(total_debit::numeric, 2) = round(total_credit::numeric, 2))
);

create unique index if not exists idx_journal_entries_source_event_unique
    on public.journal_entries (source_type, source_ref, source_event)
    where source_type is not null and source_ref is not null and source_event is not null;

create table if not exists public.journal_lines (
    id uuid primary key default gen_random_uuid(),
    source_document_id text not null unique,
    journal_entry_ref text not null references public.journal_entries(source_document_id) on delete cascade,
    line_number integer not null,
    account_ref text not null references public.chart_of_accounts(source_document_id),
    account_code text not null,
    account_name text not null,
    account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_REVENUE')),
    debit numeric(18, 2) not null default 0 check (debit >= 0),
    credit numeric(18, 2) not null default 0 check (credit >= 0),
    memo text,
    entity_ref text,
    entity_type text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now(),
    constraint journal_line_single_side check (
        (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
    )
);

create unique index if not exists idx_journal_lines_entry_line_unique
    on public.journal_lines (journal_entry_ref, line_number);

create table if not exists public.accounting_periods (
    id uuid primary key default gen_random_uuid(),
    source_document_id text not null unique,
    period text not null unique,
    start_date date not null,
    end_date date not null,
    status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
    closed_at timestamptz,
    closed_by text,
    closed_by_name text,
    extra_data jsonb not null default '{}'::jsonb,
    document_created_at timestamptz,
    document_updated_at timestamptz,
    synced_at timestamptz not null default now()
);

alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.accounting_periods enable row level security;

create index if not exists idx_chart_of_accounts_type_code
    on public.chart_of_accounts (account_type, code);
create index if not exists idx_journal_entries_entry_date
    on public.journal_entries (entry_date desc);
create index if not exists idx_journal_entries_source_ref
    on public.journal_entries (source_ref);
create index if not exists idx_journal_lines_account_ref
    on public.journal_lines (account_ref);
create index if not exists idx_journal_lines_entity_ref
    on public.journal_lines (entity_ref);

insert into public.chart_of_accounts (
    source_document_id,
    code,
    name,
    account_type,
    normal_balance,
    system_key,
    active,
    description
) values
    ('coa-cash_on_hand', '1100', 'Kas Tunai', 'ASSET', 'DEBIT', 'cash_on_hand', true, null),
    ('coa-bank', '1110', 'Bank', 'ASSET', 'DEBIT', 'bank', true, null),
    ('coa-accounts_receivable', '1200', 'Piutang Usaha', 'ASSET', 'DEBIT', 'accounts_receivable', true, null),
    ('coa-inventory', '1300', 'Persediaan Barang Gudang', 'ASSET', 'DEBIT', 'inventory', true, null),
    ('coa-driver_advance', '1400', 'Uang Muka Supir / Bon', 'ASSET', 'DEBIT', 'driver_advance', true, null),
    ('coa-prepaid_pph23', '1500', 'PPh 23 Dipotong di Muka', 'ASSET', 'DEBIT', 'prepaid_pph23', true, null),
    ('coa-fixed_assets', '1700', 'Aktiva Tetap', 'ASSET', 'DEBIT', 'fixed_assets', true, null),
    ('coa-accumulated_depreciation', '1790', 'Akumulasi Penyusutan', 'ASSET', 'CREDIT', 'accumulated_depreciation', true, null),
    ('coa-accounts_payable', '2100', 'Hutang Dagang', 'LIABILITY', 'CREDIT', 'accounts_payable', true, null),
    ('coa-accrued_expense', '2200', 'Hutang Biaya', 'LIABILITY', 'CREDIT', 'accrued_expense', true, null),
    ('coa-customer_deposit', '2300', 'Titipan / Kelebihan Bayar Customer', 'LIABILITY', 'CREDIT', 'customer_deposit', true, null),
    ('coa-tax_payable', '2400', 'Hutang Pajak', 'LIABILITY', 'CREDIT', 'tax_payable', true, null),
    ('coa-equity_capital', '3100', 'Modal', 'EQUITY', 'CREDIT', 'equity_capital', true, null),
    ('coa-retained_earnings', '3200', 'Laba Ditahan', 'EQUITY', 'CREDIT', 'retained_earnings', true, null),
    ('coa-freight_revenue', '4100', 'Pendapatan Ongkos', 'REVENUE', 'CREDIT', 'freight_revenue', true, null),
    ('coa-sales_deduction', '4200', 'Klaim / Potongan Penjualan', 'CONTRA_REVENUE', 'DEBIT', 'sales_deduction', true, null),
    ('coa-operational_expense', '5100', 'Biaya Operasional', 'EXPENSE', 'DEBIT', 'operational_expense', true, null),
    ('coa-trip_misc_expense', '5200', 'Biaya Lain-lain Trip', 'EXPENSE', 'DEBIT', 'trip_misc_expense', true, null),
    ('coa-driver_fee_expense', '5300', 'Upah Borongan Supir', 'EXPENSE', 'DEBIT', 'driver_fee_expense', true, null),
    ('coa-maintenance_expense', '5400', 'Biaya Maintenance Armada', 'EXPENSE', 'DEBIT', 'maintenance_expense', true, null),
    ('coa-incident_expense', '5500', 'Biaya Insiden', 'EXPENSE', 'DEBIT', 'incident_expense', true, null),
    ('coa-inventory_usage_expense', '5600', 'Pemakaian Barang Gudang', 'EXPENSE', 'DEBIT', 'inventory_usage_expense', true, null)
on conflict (source_document_id) do update set
    code = excluded.code,
    name = excluded.name,
    account_type = excluded.account_type,
    normal_balance = excluded.normal_balance,
    system_key = excluded.system_key,
    active = excluded.active,
    description = excluded.description;
