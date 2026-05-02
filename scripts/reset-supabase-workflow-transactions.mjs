import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { isMissingSupabaseTableError } from './_supabase-relational.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

const WORKFLOW_TRANSACTION_TABLES = [
    'incident_action_logs',
    'incident_settlement_lines',
    'incidents',
    'maintenances',
    'customer_overpayment_refunds',
    'invoice_adjustments',
    'customer_receipts',
    'payments',
    'freight_nota_items',
    'freight_notas',
    'invoice_items',
    'invoices',
    'driver_borongan_items',
    'driver_borongans',
    'driver_voucher_items',
    'driver_voucher_disbursements',
    'driver_vouchers',
    'driver_scores',
    'tracking_logs',
    'surat_jalan_items',
    'surat_jalan_documents',
    'trips',
    'delivery_order_items',
    'delivery_orders',
    'order_items',
    'orders',
    'journal_lines',
    'journal_entries',
];

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

async function deleteAllRows(table) {
    await supabaseRequest(`${table}?source_document_id=not.is.null`, {
        method: 'DELETE',
    });
    await supabaseRequest(`${table}?source_document_id=is.null`, {
        method: 'DELETE',
    });
}

async function main() {
    for (const table of WORKFLOW_TRANSACTION_TABLES) {
        console.log(`Resetting workflow transaction table: ${table}`);
        try {
            await deleteAllRows(table);
        } catch (error) {
            if (isMissingSupabaseTableError(error)) {
                console.warn(`Skipping reset for ${table}: table not found`);
                continue;
            }
            throw error;
        }
    }

    console.log('Workflow transaction reset selesai.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
