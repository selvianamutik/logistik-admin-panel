/* ============================================================
   LOGISTIK — General Data API
   Centralized CRUD API — Sanity CMS Backend
   ============================================================ */

import { NextResponse } from 'next/server';
import { getSession, hashPassword } from '@/lib/auth';
import { filterExpensesByRole, sanitizeVehicleForRole } from '@/lib/rbac';
import {
    getSanityClient,
    SANITY_TYPE_MAP,
    sanityGetAll,
    sanityGetById,
    sanityGetByFilter,
    sanityCreate,
    sanityUpdate,
    sanityDelete,
    sanityGetCompanyProfile,
    sanityGetNextNumber,
} from '@/lib/sanity';
import type { Expense, Vehicle, Invoice, Payment } from '@/lib/types';

// ── Audit Log helper ──
async function addAuditLog(
    session: { _id: string; name: string },
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: session._id,
            actorUserName: session.name,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        // Don't fail the main operation if audit logging fails
        console.warn('Audit log write failed');
    }
}

// ── GET: Read data ──
export async function GET(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    const filter = searchParams.get('filter');

    if (!entity || !SANITY_TYPE_MAP[entity]) {
        return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
    }

    const docType = SANITY_TYPE_MAP[entity];

    try {
        // Company profile (singleton)
        if (entity === 'company') {
            const profile = await sanityGetCompanyProfile();
            return NextResponse.json({ data: profile });
        }

        // Single document by ID
        if (id) {
            let item = await sanityGetById(id);
            if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            // RLC: sanitize vehicle for ADMIN
            if (entity === 'vehicles' && session.role !== 'OWNER') {
                item = sanitizeVehicleForRole(item as unknown as Vehicle, session.role) as unknown as Record<string, unknown>;
            }
            return NextResponse.json({ data: item });
        }

        // Fetch all with optional filter
        let items: Record<string, unknown>[];

        if (filter) {
            try {
                const filterObj = JSON.parse(filter);
                items = await sanityGetByFilter(docType, filterObj);
            } catch {
                items = await sanityGetAll(docType);
            }
        } else {
            items = await sanityGetAll(docType);
        }

        // RLC: filter expenses by privacy
        if (entity === 'expenses') {
            items = filterExpensesByRole(items as unknown as Expense[], session.role) as unknown as Record<string, unknown>[];
        }

        // RLC: sanitize vehicles for ADMIN
        if (entity === 'vehicles' && session.role !== 'OWNER') {
            items = (items as unknown as Vehicle[]).map(v => sanitizeVehicleForRole(v, session.role)) as unknown as Record<string, unknown>[];
        }

        // Admin cannot see audit logs
        if (entity === 'audit-logs' && session.role !== 'OWNER') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        return NextResponse.json({ data: items });
    } catch (err) {
        console.error('API GET Error:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}

// ── POST: Create / Update / Delete ──
export async function POST(request: Request) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await request.json();
        const { entity, data, action } = body;

        if (!entity || !SANITY_TYPE_MAP[entity]) {
            return NextResponse.json({ error: 'Invalid entity type' }, { status: 400 });
        }

        const docType = SANITY_TYPE_MAP[entity];

        // ── UPDATE ──
        if (action === 'update') {
            const { id, updates } = data;
            const updated = await sanityUpdate(id, updates);
            if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

            addAuditLog(session, 'UPDATE', entity, id, `Updated ${entity}: ${JSON.stringify(updates).slice(0, 200)}`);
            return NextResponse.json({ data: updated });
        }

        // ── DELETE ──
        if (action === 'delete') {
            const { id } = data;
            await sanityDelete(id);

            addAuditLog(session, 'DELETE', entity, id, `Deleted ${entity} ${id}`);
            return NextResponse.json({ success: true });
        }

        // ── COMPANY PROFILE UPDATE (singleton) ──
        if (entity === 'company') {
            // Find existing company profile
            const existing = await sanityGetCompanyProfile();
            if (existing?._id) {
                const updated = await sanityUpdate(existing._id, data);
                addAuditLog(session, 'UPDATE', 'companyProfile', existing._id, 'Company profile updated');
                return NextResponse.json({ data: updated });
            } else {
                // Create new company profile
                const created = await sanityCreate({ _type: 'companyProfile', ...data });
                return NextResponse.json({ data: created });
            }
        }

        // ── CREATE NEW DOCUMENT ──
        const newDoc: { _type: string;[key: string]: unknown } = { _type: docType, ...data };

        // Auto-generate numbers
        if (entity === 'orders') {
            newDoc.masterResi = await sanityGetNextNumber('resi');
            newDoc.status = 'OPEN';
            newDoc.createdAt = new Date().toISOString();
            newDoc.createdBy = session._id;
        }

        if (entity === 'delivery-orders') {
            newDoc.doNumber = await sanityGetNextNumber('do');
            newDoc.status = 'CREATED';
        }

        if (entity === 'invoices') {
            newDoc.invoiceNumber = await sanityGetNextNumber('invoice');
            newDoc.status = 'UNPAID';
        }

        if (entity === 'incidents') {
            newDoc.incidentNumber = await sanityGetNextNumber('incident');
            newDoc.status = 'OPEN';
        }

        if (entity === 'users') {
            if (data.password) {
                newDoc.passwordHash = hashPassword(data.password);
                delete newDoc.password;
            }
            newDoc.active = true;
            newDoc.createdAt = new Date().toISOString();
        }

        // Create the document in Sanity
        const created = await sanityCreate(newDoc);
        const newId = (created as Record<string, unknown>)._id as string;

        // Payment: auto-create income + update invoice status + bank transaction
        if (entity === 'payments') {
            // Create income record
            await sanityCreate({
                _type: 'income',
                sourceType: 'INVOICE_PAYMENT',
                paymentRef: newId,
                date: data.date,
                amount: data.amount,
                note: `Pembayaran invoice`,
            });

            // Bank transaction: CREDIT to selected bank account
            if (data.bankAccountRef) {
                const bankAcc = await sanityGetById<{ _id: string; currentBalance: number; bankName: string }>(data.bankAccountRef);
                if (bankAcc) {
                    const newBalance = (bankAcc.currentBalance || 0) + data.amount;
                    await sanityCreate({
                        _type: 'bankTransaction',
                        bankAccountRef: data.bankAccountRef,
                        bankAccountName: bankAcc.bankName,
                        type: 'CREDIT',
                        amount: data.amount,
                        date: data.date,
                        description: `Pembayaran invoice masuk`,
                        balanceAfter: newBalance,
                        relatedPaymentRef: newId,
                    });
                    await sanityUpdate(data.bankAccountRef, { currentBalance: newBalance });
                }
            }

            // Update invoice status
            if (data.invoiceRef) {
                const invoice = await sanityGetById<Invoice>(data.invoiceRef);
                if (invoice) {
                    const allPayments = await getSanityClient().fetch<Payment[]>(
                        `*[_type == "payment" && invoiceRef == $ref]`,
                        { ref: data.invoiceRef }
                    );
                    const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0) + data.amount;
                    const newStatus = totalPaid >= invoice.totalAmount ? 'PAID' : 'PARTIAL';
                    await sanityUpdate(data.invoiceRef, { status: newStatus });
                }
            }
        }

        // Expense: bank transaction DEBIT
        if (entity === 'expenses' && data.bankAccountRef) {
            const bankAcc = await sanityGetById<{ _id: string; currentBalance: number; bankName: string }>(data.bankAccountRef);
            if (bankAcc) {
                const newBalance = (bankAcc.currentBalance || 0) - data.amount;
                await sanityCreate({
                    _type: 'bankTransaction',
                    bankAccountRef: data.bankAccountRef,
                    bankAccountName: bankAcc.bankName,
                    type: 'DEBIT',
                    amount: data.amount,
                    date: data.date,
                    description: data.description || data.note || 'Pengeluaran',
                    balanceAfter: newBalance,
                    relatedExpenseRef: newId,
                });
                await sanityUpdate(data.bankAccountRef, { currentBalance: newBalance });
            }
        }

        // Bank Account: set currentBalance = initialBalance on create
        if (entity === 'bank-accounts') {
            await sanityUpdate(newId, { currentBalance: data.initialBalance || 0 });
        }

        // Transfer between bank accounts
        if (entity === 'bank-transactions' && data.action === 'transfer') {
            const fromAcc = await sanityGetById<{ _id: string; currentBalance: number; bankName: string }>(data.fromAccountRef);
            const toAcc = await sanityGetById<{ _id: string; currentBalance: number; bankName: string }>(data.toAccountRef);
            if (fromAcc && toAcc) {
                const transferId = `transfer-${Date.now()}`;
                const fromBalance = (fromAcc.currentBalance || 0) - data.amount;
                const toBalance = (toAcc.currentBalance || 0) + data.amount;

                // TRANSFER_OUT from source
                await sanityCreate({
                    _type: 'bankTransaction',
                    bankAccountRef: data.fromAccountRef,
                    bankAccountName: fromAcc.bankName,
                    type: 'TRANSFER_OUT',
                    amount: data.amount,
                    date: data.date || new Date().toISOString().slice(0, 10),
                    description: `Transfer ke ${toAcc.bankName}`,
                    balanceAfter: fromBalance,
                    relatedTransferRef: transferId,
                });

                // TRANSFER_IN to destination
                await sanityCreate({
                    _type: 'bankTransaction',
                    bankAccountRef: data.toAccountRef,
                    bankAccountName: toAcc.bankName,
                    type: 'TRANSFER_IN',
                    amount: data.amount,
                    date: data.date || new Date().toISOString().slice(0, 10),
                    description: `Transfer dari ${fromAcc.bankName}`,
                    balanceAfter: toBalance,
                    relatedTransferRef: transferId,
                });

                // Update both balances
                await sanityUpdate(data.fromAccountRef, { currentBalance: fromBalance });
                await sanityUpdate(data.toAccountRef, { currentBalance: toBalance });

                return NextResponse.json({ success: true, transferId });
            }
        }

        addAuditLog(
            session,
            'CREATE',
            entity,
            newId,
            `Created ${entity}: ${(newDoc as Record<string, unknown>).masterResi || (newDoc as Record<string, unknown>).doNumber || (newDoc as Record<string, unknown>).invoiceNumber || (newDoc as Record<string, unknown>).incidentNumber || (newDoc as Record<string, unknown>).name || newId}`
        );

        return NextResponse.json({ data: created, id: newId });
    } catch (err) {
        console.error('API POST Error:', err);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
