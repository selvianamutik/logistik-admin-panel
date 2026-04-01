import type {
  BankTransaction,
  CustomerOverpaymentRefund,
  Expense,
  Payment,
} from "./types";

export type BankTransactionSourceLink = {
  href: string;
  label: string;
};

type TransactionLinkPermissions = {
  canOpenInvoices?: boolean;
  canOpenDriverVouchers?: boolean;
  canOpenDriverBorongans?: boolean;
  canOpenVehicles?: boolean;
  canOpenIncidents?: boolean;
};

export function buildPaymentLookup(
  payments: Array<Pick<Payment, "_id" | "invoiceRef" | "receiptNumber">>,
) {
  return new Map(payments.map((payment) => [payment._id, payment]));
}

export function buildRefundLookup(
  refunds: Array<
    Pick<
      CustomerOverpaymentRefund,
      "_id" | "sourceInvoiceRef" | "sourceReceiptRef" | "sourceType"
    >
  >,
) {
  return new Map(refunds.map((refund) => [refund._id, refund]));
}

export function buildExpenseLookup(
  expenses: Array<
    Pick<
      Expense,
      "_id" | "voucherRef" | "boronganRef" | "relatedVehicleRef" | "relatedIncidentRef"
    >
  >,
) {
  return new Map(expenses.map((expense) => [expense._id, expense]));
}

export function resolveBankTransactionSourceLink(params: {
  transaction: Pick<
    BankTransaction,
    | "relatedPaymentRef"
    | "relatedExpenseRef"
    | "relatedVoucherRef"
    | "relatedOverpaymentRefundRef"
  >;
  paymentsById?: Map<string, Pick<Payment, "_id" | "invoiceRef" | "receiptNumber">>;
  refundsById?: Map<
    string,
    Pick<
      CustomerOverpaymentRefund,
      "_id" | "sourceInvoiceRef" | "sourceReceiptRef" | "sourceType"
    >
  >;
  expensesById?: Map<
    string,
    Pick<
      Expense,
      "_id" | "voucherRef" | "boronganRef" | "relatedVehicleRef" | "relatedIncidentRef"
    >
  >;
  invoiceIdsWithPages?: Set<string>;
  permissions?: TransactionLinkPermissions;
}): BankTransactionSourceLink | null {
  const {
    transaction,
    paymentsById,
    refundsById,
    expensesById,
    invoiceIdsWithPages,
    permissions,
  } = params;

  if (
    transaction.relatedPaymentRef &&
    paymentsById?.has(transaction.relatedPaymentRef)
  ) {
    const payment = paymentsById.get(transaction.relatedPaymentRef);
    if (
      payment?.invoiceRef &&
      permissions?.canOpenInvoices &&
      (!invoiceIdsWithPages || invoiceIdsWithPages.has(payment.invoiceRef))
    ) {
      return {
        href: `/invoices/${payment.invoiceRef}`,
        label: payment.receiptNumber
          ? `Buka Nota dari ${payment.receiptNumber}`
          : "Buka Nota",
      };
    }
  }

  if (
    transaction.relatedOverpaymentRefundRef &&
    refundsById?.has(transaction.relatedOverpaymentRefundRef)
  ) {
    const refund = refundsById.get(transaction.relatedOverpaymentRefundRef);
    if (
      refund?.sourceInvoiceRef &&
      permissions?.canOpenInvoices &&
      (!invoiceIdsWithPages || invoiceIdsWithPages.has(refund.sourceInvoiceRef))
    ) {
      return {
        href: `/invoices/${refund.sourceInvoiceRef}`,
        label: "Buka Nota Sumber Refund",
      };
    }
  }

  if (transaction.relatedVoucherRef && permissions?.canOpenDriverVouchers) {
    return {
      href: `/driver-vouchers/${transaction.relatedVoucherRef}`,
      label: "Buka Uang Jalan Trip",
    };
  }

  if (
    transaction.relatedExpenseRef &&
    expensesById?.has(transaction.relatedExpenseRef)
  ) {
    const expense = expensesById.get(transaction.relatedExpenseRef);
    if (expense?.voucherRef && permissions?.canOpenDriverVouchers) {
      return {
        href: `/driver-vouchers/${expense.voucherRef}`,
        label: "Buka Uang Jalan Trip",
      };
    }
    if (expense?.boronganRef && permissions?.canOpenDriverBorongans) {
      return {
        href: `/borongan/${expense.boronganRef}`,
        label: "Buka Borongan Supir",
      };
    }
    if (expense?.relatedIncidentRef && permissions?.canOpenIncidents) {
      return {
        href: `/fleet/incidents/${expense.relatedIncidentRef}`,
        label: "Buka Insiden",
      };
    }
    if (expense?.relatedVehicleRef && permissions?.canOpenVehicles) {
      return {
        href: `/fleet/vehicles/${expense.relatedVehicleRef}`,
        label: "Buka Kendaraan",
      };
    }
  }

  return null;
}
