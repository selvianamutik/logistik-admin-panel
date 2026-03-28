import {
    getSanityClient,
    sanityCreate,
    sanityGetById,
    sanityGetCompanyProfile,
    sanityUpdate,
} from '@/lib/sanity';
import { normalizeUserRole } from '@/lib/rbac';
import type { CompanyProfile, User } from '@/lib/types';

export type ApiSession = { _id: string; name: string; role: User['role'] };
export type PublicUser = Omit<User, 'passwordHash'>;
export type AuditLogActor = Pick<ApiSession, '_id' | 'name'>;

export type BankAccountSummary = {
    _id: string;
    _rev?: string;
    currentBalance: number;
    bankName: string;
    accountNumber?: string;
    accountType?: 'BANK' | 'CASH';
    systemKey?: string;
    accountHolder?: string;
    active?: boolean;
};

export const CASH_ACCOUNT_SYSTEM_KEY = 'cash-on-hand';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeOptionalText(value: unknown) {
    const normalized = normalizeText(value);
    return normalized || undefined;
}

export function normalizeNumber(value: unknown) {
    return typeof value === 'number' ? value : Number(value);
}

export function assertIsoDate(value: string, label: string) {
    if (!ISO_DATE_RE.test(value)) {
        throw new Error(`${label} tidak valid`);
    }
}

export function extractRefId(value: unknown) {
    if (typeof value === 'string' && value) {
        return value;
    }

    if (isPlainObject(value) && typeof value._ref === 'string' && value._ref) {
        return value._ref;
    }

    return null;
}

export function sanitizeUserForClient(user: User): PublicUser {
    const { passwordHash, ...safeUser } = user;
    void passwordHash;
    return {
        ...safeUser,
        role: normalizeUserRole(user.role),
    };
}

export function sanitizeCompanyProfileForRole(
    company: CompanyProfile,
    role: User['role']
): CompanyProfile {
    if (role === 'OWNER') {
        return company;
    }

    const normalizedRole = normalizeUserRole(role);
    const canSeeInvoiceFinanceContext = normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';

    return {
        ...company,
        npwp: canSeeInvoiceFinanceContext ? company.npwp : undefined,
        bankName: canSeeInvoiceFinanceContext ? company.bankName : undefined,
        bankAccount: canSeeInvoiceFinanceContext ? company.bankAccount : undefined,
        bankHolder: canSeeInvoiceFinanceContext ? company.bankHolder : undefined,
        headerStampUrl: undefined,
        signatureStampUrl: undefined,
        numberingSettings: {
            resiPrefix: '',
            resiCounter: 0,
            resiPeriod: undefined,
            doPrefix: '',
            doCounter: 0,
            doPeriod: undefined,
            invoicePrefix: '',
            invoiceCounter: 0,
            invoicePeriod: undefined,
            notaPrefix: undefined,
            notaCounter: undefined,
            notaPeriod: undefined,
            notaSeriesCode: company.numberingSettings?.notaSeriesCode,
            receiptPrefix: undefined,
            receiptCounter: undefined,
            receiptPeriod: undefined,
            boronganPrefix: undefined,
            boronganCounter: undefined,
            boronganPeriod: undefined,
            bonPrefix: undefined,
            bonCounter: undefined,
            bonPeriod: undefined,
            incidentPrefix: '',
            incidentCounter: 0,
            incidentPeriod: undefined,
        },
        invoiceSettings: {
            defaultTermDays: company.invoiceSettings?.defaultTermDays ?? 14,
            dueDateDays: company.invoiceSettings?.dueDateDays ?? company.invoiceSettings?.defaultTermDays ?? 14,
            footerNote: canSeeInvoiceFinanceContext ? company.invoiceSettings?.footerNote || '' : '',
            invoiceMode: canSeeInvoiceFinanceContext ? company.invoiceSettings?.invoiceMode || 'DO' : 'DO',
            invoiceBankAccountRefs: canSeeInvoiceFinanceContext
                ? Array.isArray(company.invoiceSettings?.invoiceBankAccountRefs)
                    ? company.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                    : []
                : [],
            defaultInvoiceBankAccountRef: canSeeInvoiceFinanceContext &&
                typeof company.invoiceSettings?.defaultInvoiceBankAccountRef === 'string'
                ? company.invoiceSettings.defaultInvoiceBankAccountRef
                : undefined,
        },
        documentSettings: {
            showContact: company.documentSettings?.showContact ?? true,
            dateFormat: company.documentSettings?.dateFormat || 'DD/MM/YYYY',
        },
    };
}

export async function ensureCashAccount() {
    const existing = await getSanityClient().fetch<BankAccountSummary | null>(
        `*[_type == "bankAccount" && systemKey == $key][0]{
            _id,
            _rev,
            currentBalance,
            bankName,
            accountNumber,
            accountType,
            systemKey,
            accountHolder,
            active
        }`,
        { key: CASH_ACCOUNT_SYSTEM_KEY }
    );
    if (existing) {
        if (existing.active === false) {
            return sanityUpdate<BankAccountSummary>(existing._id, { active: true });
        }
        return existing;
    }

    const company = await sanityGetCompanyProfile() as { name?: string } | null;
    return sanityCreate<BankAccountSummary>({
        _id: 'bank-cash-on-hand',
        _type: 'bankAccount',
        bankName: 'Kas Tunai',
        accountNumber: 'CASH',
        accountHolder: company?.name || 'Perusahaan',
        accountType: 'CASH',
        systemKey: CASH_ACCOUNT_SYSTEM_KEY,
        initialBalance: 0,
        currentBalance: 0,
        active: true,
        notes: 'Akun sistem untuk mencatat kas tunai operasional.',
    });
}

export async function getLedgerAccount(accountRef: string) {
    const account = await sanityGetById<BankAccountSummary>(accountRef);
    if (!account || account.active === false) {
        return null;
    }
    return account;
}

export function isMutationConflictError(err: unknown) {
    const statusCode =
        isPlainObject(err) && typeof err.statusCode === 'number'
            ? err.statusCode
            : isPlainObject(err) && typeof err.status === 'number'
                ? err.status
                : undefined;
    const message =
        err instanceof Error
            ? err.message
            : isPlainObject(err) && typeof err.message === 'string'
                ? err.message
                : '';

    return statusCode === 409 || /revision/i.test(message) || /conflict/i.test(message);
}

export async function writeAuditLog(
    actor: AuditLogActor,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.warn('Audit log write failed', error);
    }
}
