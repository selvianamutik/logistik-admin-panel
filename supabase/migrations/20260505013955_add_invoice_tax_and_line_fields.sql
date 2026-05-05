alter table public.freight_notas
    add column if not exists tax_invoice_number text;

alter table public.freight_nota_items
    add column if not exists plt text,
    add column if not exists pc text,
    add column if not exists kbl text,
    add column if not exists invoice_line_date date;
