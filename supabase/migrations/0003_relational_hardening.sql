create index if not exists idx_order_items_order_ref on public.order_items (order_ref);
create index if not exists idx_order_items_customer_product_ref on public.order_items (customer_product_ref);

create index if not exists idx_delivery_order_items_delivery_order_ref on public.delivery_order_items (delivery_order_ref);
create index if not exists idx_delivery_order_items_order_item_ref on public.delivery_order_items (order_item_ref);

create index if not exists idx_freight_nota_items_do_ref on public.freight_nota_items (do_ref);
create index if not exists idx_freight_nota_items_delivery_order_item_ref on public.freight_nota_items (delivery_order_item_ref);

create index if not exists idx_payments_bank_account_ref on public.payments (bank_account_ref, date desc);
create index if not exists idx_customer_receipts_bank_account_ref on public.customer_receipts (bank_account_ref, date desc);
create index if not exists idx_invoice_adjustments_customer_ref on public.invoice_adjustments (customer_ref, date desc);
create index if not exists idx_customer_overpayment_refunds_bank_account_ref on public.customer_overpayment_refunds (bank_account_ref, date desc);
create index if not exists idx_customer_overpayment_refunds_customer_ref on public.customer_overpayment_refunds (customer_ref, date desc);

create index if not exists idx_bank_transactions_related_payment_ref on public.bank_transactions (related_payment_ref);
create index if not exists idx_bank_transactions_related_receipt_ref on public.bank_transactions (related_receipt_ref);
create index if not exists idx_bank_transactions_related_overpayment_refund_ref on public.bank_transactions (related_overpayment_refund_ref);
