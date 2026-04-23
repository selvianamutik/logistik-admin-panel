-- Defense-in-depth for the server-only Supabase backend.
-- The app reads/writes through Next.js API routes using the service-role key.
-- Enabling RLS without public policies keeps direct anon/authenticated REST access closed,
-- while service_role continues to bypass RLS for the server-side repository layer.

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'company_profiles',
        'employees',
        'employee_attendance_records',
        'expense_categories',
        'app_users',
        'drivers',
        'driver_scores',
        'driver_vouchers',
        'driver_voucher_disbursements',
        'driver_voucher_items',
        'driver_borongans',
        'driver_borongan_items',
        'audit_logs',
        'customers',
        'customer_products',
        'customer_billing_rates',
        'customer_recipients',
        'customer_pickup_locations',
        'suppliers',
        'warehouse_items',
        'tire_events',
        'tire_history_logs',
        'services',
        'trip_route_rates',
        'vehicles',
        'bank_accounts',
        'bank_transactions',
        'expenses',
        'purchases',
        'purchase_items',
        'purchase_payments',
        'stock_movements',
        'orders',
        'order_items',
        'delivery_orders',
        'delivery_order_items',
        'tracking_logs',
        'invoices',
        'invoice_items',
        'freight_notas',
        'freight_nota_items',
        'payments',
        'customer_receipts',
        'invoice_adjustments',
        'customer_overpayment_refunds',
        'incomes',
        'maintenances',
        'incidents',
        'incident_settlement_lines',
        'incident_action_logs',
        'rate_limit_buckets'
    ]
    loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('alter table public.%I enable row level security', table_name);
        end if;
    end loop;
end $$;

create extension if not exists pg_trgm;

-- High-traffic work queues and invoice pages.
create index if not exists idx_orders_status_created_at
    on public.orders (status, document_created_at desc);
create index if not exists idx_orders_customer_ref_created_at
    on public.orders (customer_ref, document_created_at desc);
create index if not exists idx_orders_master_resi_trgm
    on public.orders using gin (master_resi gin_trgm_ops);
create index if not exists idx_orders_customer_name_trgm
    on public.orders using gin (customer_name gin_trgm_ops);

create index if not exists idx_delivery_orders_status_date
    on public.delivery_orders (status, date desc);
create index if not exists idx_delivery_orders_driver_ref_status
    on public.delivery_orders (driver_ref, status);
create index if not exists idx_delivery_orders_vehicle_ref_status
    on public.delivery_orders (vehicle_ref, status);
create index if not exists idx_delivery_orders_do_number_trgm
    on public.delivery_orders using gin (do_number gin_trgm_ops);
create index if not exists idx_delivery_orders_customer_do_number_trgm
    on public.delivery_orders using gin (customer_do_number gin_trgm_ops);
create index if not exists idx_delivery_orders_customer_name_trgm
    on public.delivery_orders using gin (customer_name gin_trgm_ops);
create index if not exists idx_delivery_orders_driver_name_trgm
    on public.delivery_orders using gin (driver_name gin_trgm_ops);
create index if not exists idx_delivery_orders_vehicle_plate_trgm
    on public.delivery_orders using gin (vehicle_plate gin_trgm_ops);

create index if not exists idx_driver_vouchers_status_issued_date
    on public.driver_vouchers (status, issued_date desc);
create index if not exists idx_driver_vouchers_driver_ref_status
    on public.driver_vouchers (driver_ref, status);
create index if not exists idx_driver_vouchers_delivery_order_ref
    on public.driver_vouchers (delivery_order_ref);
create index if not exists idx_driver_vouchers_bon_number_trgm
    on public.driver_vouchers using gin (bon_number gin_trgm_ops);
create index if not exists idx_driver_vouchers_driver_name_trgm
    on public.driver_vouchers using gin (driver_name gin_trgm_ops);
create index if not exists idx_driver_vouchers_do_number_trgm
    on public.driver_vouchers using gin (do_number gin_trgm_ops);

create index if not exists idx_freight_notas_status_issue_date
    on public.freight_notas (status, issue_date desc);
create index if not exists idx_freight_notas_customer_ref_issue_date
    on public.freight_notas (customer_ref, issue_date desc);
create index if not exists idx_freight_notas_nota_number_trgm
    on public.freight_notas using gin (nota_number gin_trgm_ops);
create index if not exists idx_freight_notas_customer_name_trgm
    on public.freight_notas using gin (customer_name gin_trgm_ops);

-- Child-row lookups used by derived status, invoice editing, and settlement screens.
create index if not exists idx_payments_invoice_ref_date
    on public.payments (invoice_ref, date desc);
create index if not exists idx_freight_nota_items_nota_ref
    on public.freight_nota_items (nota_ref);
create index if not exists idx_freight_nota_items_customer_ref
    on public.freight_nota_items (customer_ref);
create index if not exists idx_customer_receipts_customer_ref_date
    on public.customer_receipts (customer_ref, date desc);
create index if not exists idx_invoice_adjustments_invoice_ref_status
    on public.invoice_adjustments (invoice_ref, status);
create index if not exists idx_customer_overpayment_refunds_source_invoice_ref
    on public.customer_overpayment_refunds (source_invoice_ref);

-- Inventory and finance list/detail joins.
create index if not exists idx_bank_transactions_bank_account_ref_date
    on public.bank_transactions (bank_account_ref, date desc);
create index if not exists idx_expenses_date_privacy
    on public.expenses (date desc, privacy_level);
create index if not exists idx_purchases_supplier_ref_order_date
    on public.purchases (supplier_ref, order_date desc);
create index if not exists idx_stock_movements_warehouse_item_ref_movement_date
    on public.stock_movements (warehouse_item_ref, movement_date desc);
