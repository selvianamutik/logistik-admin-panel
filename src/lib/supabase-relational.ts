import { randomUUID } from 'node:crypto';

import { getSupabaseClient } from './supabase';

type SupportedDocType =
    | 'companyProfile'
    | 'employee'
    | 'employeeAttendanceRecord'
    | 'expenseCategory'
    | 'user'
    | 'driver'
    | 'driverVoucher'
    | 'driverVoucherDisbursement'
    | 'driverVoucherItem'
    | 'driverBorongan'
    | 'driverBoronganItem'
    | 'driverScore'
    | 'auditLog'
    | 'customer'
    | 'supplier'
    | 'warehouseItem'
    | 'tireEvent'
    | 'tireHistoryLog'
    | 'customerProduct'
    | 'customerRecipient'
    | 'customerPickupLocation'
    | 'service'
    | 'tripRouteRate'
    | 'vehicle'
    | 'bankAccount'
    | 'bankTransaction'
    | 'expense'
    | 'purchase'
    | 'purchaseItem'
    | 'purchasePayment'
    | 'stockMovement'
    | 'order'
    | 'orderItem'
    | 'deliveryOrder'
    | 'deliveryOrderItem'
    | 'trackingLog'
    | 'invoice'
    | 'invoiceItem'
    | 'freightNota'
    | 'freightNotaItem'
    | 'payment'
    | 'customerReceipt'
    | 'invoiceAdjustment'
    | 'customerOverpaymentRefund'
    | 'income'
    | 'maintenance'
    | 'incident'
    | 'incidentSettlementLine'
    | 'incidentActionLog';

type RelationalListOptions = {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
};

type RelationalListResult<T> = {
    items: T[];
    total: number;
};

type RelationalConfig = {
    table: string;
    fieldMap: Record<string, string>;
};

type RelationalRow = Record<string, unknown> & {
    source_document_id: string;
    extra_data?: Record<string, unknown> | null;
    document_created_at?: string | null;
    document_updated_at?: string | null;
};

const META_FIELDS = new Set(['_id', '_type', '_createdAt', '_updatedAt', '_rev']);

const RELATIONAL_CONFIG: Record<SupportedDocType, RelationalConfig> = {
    companyProfile: {
        table: 'company_profiles',
        fieldMap: {
            name: 'name',
            address: 'address',
            phone: 'phone',
            email: 'email',
            npwp: 'npwp',
            bankName: 'bank_name',
            bankAccount: 'bank_account',
            bankHolder: 'bank_holder',
            themeColor: 'theme_color',
            numberingSettings: 'numbering_settings',
            invoiceSettings: 'invoice_settings',
            documentSettings: 'document_settings',
        },
    },
    employee: {
        table: 'employees',
        fieldMap: {
            employeeCode: 'employee_code',
            name: 'name',
            phone: 'phone',
            position: 'position',
            division: 'division',
            joinDate: 'join_date',
            active: 'active',
            userRef: 'user_ref',
            userName: 'user_name',
            notes: 'notes',
        },
    },
    employeeAttendanceRecord: {
        table: 'employee_attendance_records',
        fieldMap: {
            employeeRef: 'employee_ref',
            employeeCode: 'employee_code',
            employeeName: 'employee_name',
            position: 'position',
            division: 'division',
            date: 'date',
            status: 'status',
            checkInTime: 'check_in_time',
            checkOutTime: 'check_out_time',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            updatedBy: 'updated_by',
            updatedByName: 'updated_by_name',
            createdAt: 'created_at_business',
            updatedAt: 'updated_at_business',
        },
    },
    expenseCategory: {
        table: 'expense_categories',
        fieldMap: {
            name: 'name',
            active: 'active',
        },
    },
    driverVoucher: {
        table: 'driver_vouchers',
        fieldMap: {
            bonNumber: 'bon_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            deliveryOrderRef: 'delivery_order_ref',
            doNumber: 'do_number',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            route: 'route',
            issuedDate: 'issued_date',
            cashGiven: 'cash_given',
            initialCashGiven: 'initial_cash_given',
            totalIssuedAmount: 'total_issued_amount',
            topUpCount: 'top_up_count',
            driverFeeAmount: 'driver_fee_amount',
            totalClaimAmount: 'total_claim_amount',
            issueBankRef: 'issue_bank_ref',
            issueBankName: 'issue_bank_name',
            totalSpent: 'total_spent',
            balance: 'balance',
            status: 'status',
            notes: 'notes',
            settledDate: 'settled_date',
            settledBy: 'settled_by',
            settlementBankRef: 'settlement_bank_ref',
            settlementBankName: 'settlement_bank_name',
        },
    },
    driverVoucherDisbursement: {
        table: 'driver_voucher_disbursements',
        fieldMap: {
            voucherRef: 'voucher_ref',
            date: 'date',
            amount: 'amount',
            kind: 'kind',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    driverVoucherItem: {
        table: 'driver_voucher_items',
        fieldMap: {
            voucherRef: 'voucher_ref',
            expenseDate: 'expense_date',
            category: 'category',
            description: 'description',
            amount: 'amount',
        },
    },
    driverBorongan: {
        table: 'driver_borongans',
        fieldMap: {
            boronganNumber: 'borongan_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            periodStart: 'period_start',
            periodEnd: 'period_end',
            status: 'status',
            totalAmount: 'total_amount',
            totalCollie: 'total_collie',
            totalWeightKg: 'total_weight_kg',
            notes: 'notes',
            paidDate: 'paid_date',
            paidMethod: 'paid_method',
            paidBankRef: 'paid_bank_ref',
            paidBankName: 'paid_bank_name',
            paidBankNumber: 'paid_bank_number',
        },
    },
    driverBoronganItem: {
        table: 'driver_borongan_items',
        fieldMap: {
            boronganRef: 'borongan_ref',
            doRef: 'do_ref',
            doNumber: 'do_number',
            vehiclePlate: 'vehicle_plate',
            date: 'date',
            noSJ: 'no_sj',
            tujuan: 'tujuan',
            barang: 'barang',
            collie: 'collie',
            beratKg: 'berat_kg',
            tarip: 'tarip',
            uangRp: 'uang_rp',
            ket: 'ket',
        },
    },
    supplier: {
        table: 'suppliers',
        fieldMap: {
            supplierCode: 'supplier_code',
            name: 'name',
            contactPerson: 'contact_person',
            phone: 'phone',
            address: 'address',
            defaultTermDays: 'default_term_days',
            active: 'active',
            notes: 'notes',
        },
    },
    warehouseItem: {
        table: 'warehouse_items',
        fieldMap: {
            itemCode: 'item_code',
            name: 'name',
            category: 'category',
            unit: 'unit',
            trackingMode: 'tracking_mode',
            minStockQty: 'min_stock_qty',
            currentStockQty: 'current_stock_qty',
            defaultSupplierRef: 'default_supplier_ref',
            defaultSupplierName: 'default_supplier_name',
            defaultPurchasePrice: 'default_purchase_price',
            tireTypeDefault: 'tire_type_default',
            tireBrandDefault: 'tire_brand_default',
            tireSizeDefault: 'tire_size_default',
            active: 'active',
            notes: 'notes',
        },
    },
    tireEvent: {
        table: 'tire_events',
        fieldMap: {
            tireCode: 'tire_code',
            holderType: 'holder_type',
            status: 'status',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            posisi: 'posisi',
            positionKey: 'position_key',
            slotCode: 'slot_code',
            slotLabel: 'slot_label',
            externalPartyName: 'external_party_name',
            externalPlateNumber: 'external_plate_number',
            tireType: 'tire_type',
            tireBrand: 'tire_brand',
            tireSize: 'tire_size',
            linkedWarehouseItemRef: 'linked_warehouse_item_ref',
            linkedWarehouseItemCode: 'linked_warehouse_item_code',
            linkedWarehouseItemName: 'linked_warehouse_item_name',
            sourcePurchaseRef: 'source_purchase_ref',
            sourcePurchaseNumber: 'source_purchase_number',
            sourcePurchaseItemRef: 'source_purchase_item_ref',
            sourceReceiveDate: 'source_receive_date',
            installDate: 'install_date',
            replaceDate: 'replace_date',
            notes: 'notes',
        },
    },
    tireHistoryLog: {
        table: 'tire_history_logs',
        fieldMap: {
            tireEventRef: 'tire_event_ref',
            tireCode: 'tire_code',
            tireBrand: 'tire_brand',
            tireSize: 'tire_size',
            actionType: 'action_type',
            timestamp: 'timestamp',
            actorUserRef: 'actor_user_ref',
            actorUserName: 'actor_user_name',
            note: 'note',
            fromHolderType: 'from_holder_type',
            fromStatus: 'from_status',
            fromVehicleRef: 'from_vehicle_ref',
            fromVehiclePlate: 'from_vehicle_plate',
            fromSlotCode: 'from_slot_code',
            fromPlacementLabel: 'from_placement_label',
            toHolderType: 'to_holder_type',
            toStatus: 'to_status',
            toVehicleRef: 'to_vehicle_ref',
            toVehiclePlate: 'to_vehicle_plate',
            toSlotCode: 'to_slot_code',
            toPlacementLabel: 'to_placement_label',
        },
    },
    user: {
        table: 'app_users',
        fieldMap: {
            name: 'name',
            email: 'email',
            role: 'role',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            passwordHash: 'password_hash',
            active: 'active',
            createdAt: 'created_at_business',
            lastLoginAt: 'last_login_at',
        },
    },
    driver: {
        table: 'drivers',
        fieldMap: {
            name: 'name',
            phone: 'phone',
            licenseNumber: 'license_number',
            ktpNumber: 'ktp_number',
            simExpiry: 'sim_expiry',
            address: 'address',
            active: 'active',
            activeTrackingDeliveryOrderRef: 'active_tracking_delivery_order_ref',
            activeTrackingUpdatedAt: 'active_tracking_updated_at',
        },
    },
    driverScore: {
        table: 'driver_scores',
        fieldMap: {
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            scoreType: 'score_type',
            effectiveDate: 'effective_date',
            durationDays: 'duration_days',
            dueDate: 'due_date',
            notes: 'notes',
            warningAcknowledgedAt: 'warning_acknowledged_at',
            warningAcknowledgedByDriverRef: 'warning_acknowledged_by_driver_ref',
            createdAt: 'created_at_business',
        },
    },
    auditLog: {
        table: 'audit_logs',
        fieldMap: {
            actorUserRef: 'actor_user_ref',
            actorUserName: 'actor_user_name',
            actorUserEmail: 'actor_user_email',
            actorUserRole: 'actor_user_role',
            action: 'action',
            entityType: 'entity_type',
            entityRef: 'entity_ref',
            changesSummary: 'changes_summary',
            timestamp: 'timestamp',
        },
    },
    customer: {
        table: 'customers',
        fieldMap: {
            name: 'name',
            address: 'address',
            contactPerson: 'contact_person',
            phone: 'phone',
            email: 'email',
            defaultPaymentTerm: 'default_payment_term',
            npwp: 'npwp',
            active: 'active',
        },
    },
    customerProduct: {
        table: 'customer_products',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            code: 'code',
            name: 'name',
            description: 'description',
            defaultQtyKoli: 'default_qty_koli',
            defaultWeight: 'default_weight_kg',
            defaultWeightInputValue: 'default_weight_input_value',
            defaultWeightInputUnit: 'default_weight_input_unit',
            defaultVolume: 'default_volume_m3',
            defaultVolumeInputValue: 'default_volume_input_value',
            defaultVolumeInputUnit: 'default_volume_input_unit',
            notes: 'notes',
            active: 'active',
        },
    },
    customerRecipient: {
        table: 'customer_recipients',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            label: 'label',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            receiverCompany: 'receiver_company',
            notes: 'notes',
            active: 'active',
            isDefault: 'is_default',
        },
    },
    customerPickupLocation: {
        table: 'customer_pickup_locations',
        fieldMap: {
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            label: 'label',
            pickupAddress: 'pickup_address',
            notes: 'notes',
            active: 'active',
            isDefault: 'is_default',
        },
    },
    service: {
        table: 'services',
        fieldMap: {
            code: 'code',
            name: 'name',
            description: 'description',
            maxPayloadKg: 'max_payload_kg',
            overtonaseDriverRatePerKg: 'overtonase_driver_rate_per_kg',
            active: 'active',
        },
    },
    tripRouteRate: {
        table: 'trip_route_rates',
        fieldMap: {
            originArea: 'origin_area',
            destinationArea: 'destination_area',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            rate: 'rate',
            notes: 'notes',
            active: 'active',
        },
    },
    vehicle: {
        table: 'vehicles',
        fieldMap: {
            unitCode: 'unit_code',
            plateNumber: 'plate_number',
            vehicleType: 'vehicle_type',
            brandModel: 'brand_model',
            year: 'year',
            capacityKg: 'capacity_kg',
            serviceRef: 'service_ref',
            status: 'status',
        },
    },
    bankAccount: {
        table: 'bank_accounts',
        fieldMap: {
            bankName: 'bank_name',
            accountNumber: 'account_number',
            accountHolder: 'account_holder',
            accountType: 'account_type',
            systemKey: 'system_key',
            initialBalance: 'initial_balance',
            currentBalance: 'current_balance',
            active: 'active',
            notes: 'notes',
        },
    },
    bankTransaction: {
        table: 'bank_transactions',
        fieldMap: {
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            type: 'type',
            amount: 'amount',
            date: 'date',
            description: 'description',
            balanceAfter: 'balance_after',
            relatedPaymentRef: 'related_payment_ref',
            relatedReceiptRef: 'related_receipt_ref',
            relatedExpenseRef: 'related_expense_ref',
            relatedTransferRef: 'related_transfer_ref',
            relatedVoucherRef: 'related_voucher_ref',
            relatedOverpaymentRefundRef: 'related_overpayment_refund_ref',
            relatedPurchasePaymentRef: 'related_purchase_payment_ref',
            relatedPurchaseRef: 'related_purchase_ref',
        },
    },
    expense: {
        table: 'expenses',
        fieldMap: {
            categoryRef: 'category_ref',
            categoryName: 'category_name',
            date: 'date',
            amount: 'amount',
            note: 'note',
            description: 'description',
            receiptUrl: 'receipt_url',
            privacyLevel: 'privacy_level',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            relatedVehicleRef: 'related_vehicle_ref',
            relatedVehiclePlate: 'related_vehicle_plate',
            relatedIncidentRef: 'related_incident_ref',
            relatedIncidentSettlementLineRef: 'related_incident_settlement_line_ref',
            relatedMaintenanceRef: 'related_maintenance_ref',
            boronganRef: 'borongan_ref',
            voucherRef: 'voucher_ref',
        },
    },
    purchase: {
        table: 'purchases',
        fieldMap: {
            purchaseNumber: 'purchase_number',
            supplierRef: 'supplier_ref',
            supplierName: 'supplier_name',
            orderDate: 'order_date',
            dueDate: 'due_date',
            status: 'status',
            notes: 'notes',
            totalAmount: 'total_amount',
            totalOrderedQty: 'total_ordered_qty',
            totalReceivedQty: 'total_received_qty',
            paidAmount: 'paid_amount',
            outstandingAmount: 'outstanding_amount',
            lineCount: 'line_count',
            lastReceivedAt: 'last_received_at',
            lastPaidAt: 'last_paid_at',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            createdAt: 'created_at_business',
            updatedAt: 'updated_at_business',
        },
    },
    purchaseItem: {
        table: 'purchase_items',
        fieldMap: {
            purchaseRef: 'purchase_ref',
            warehouseItemRef: 'warehouse_item_ref',
            itemCode: 'item_code',
            itemName: 'item_name',
            itemUnit: 'item_unit',
            trackingMode: 'tracking_mode',
            tireTypeDefault: 'tire_type_default',
            tireBrandDefault: 'tire_brand_default',
            tireSizeDefault: 'tire_size_default',
            orderedQty: 'ordered_qty',
            receivedQty: 'received_qty',
            unitPrice: 'unit_price',
            subtotal: 'subtotal',
            notes: 'notes',
        },
    },
    purchasePayment: {
        table: 'purchase_payments',
        fieldMap: {
            purchaseRef: 'purchase_ref',
            purchaseNumber: 'purchase_number',
            supplierRef: 'supplier_ref',
            supplierName: 'supplier_name',
            date: 'date',
            amount: 'amount',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    stockMovement: {
        table: 'stock_movements',
        fieldMap: {
            warehouseItemRef: 'warehouse_item_ref',
            itemCode: 'item_code',
            itemName: 'item_name',
            unit: 'unit',
            movementDate: 'movement_date',
            type: 'type',
            sourceType: 'source_type',
            sourceRef: 'source_ref',
            sourceNumber: 'source_number',
            quantity: 'quantity',
            balanceAfter: 'balance_after',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    order: {
        table: 'orders',
        fieldMap: {
            masterResi: 'master_resi',
            cargoEntryMode: 'cargo_entry_mode',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            receiverName: 'receiver_name',
            receiverPhone: 'receiver_phone',
            receiverAddress: 'receiver_address',
            pickupAddress: 'pickup_address',
            serviceRef: 'service_ref',
            serviceName: 'service_name',
            status: 'status',
            notes: 'notes',
            createdAt: 'created_at_business',
            createdBy: 'created_by',
        },
    },
    orderItem: {
        table: 'order_items',
        fieldMap: {
            orderRef: 'order_ref',
            customerProductRef: 'customer_product_ref',
            description: 'description',
            qtyKoli: 'qty_koli',
            weight: 'weight_kg',
            volume: 'volume_m3',
            deliveredQtyKoli: 'delivered_qty_koli',
            deliveredWeight: 'delivered_weight_kg',
            status: 'status',
        },
    },
    deliveryOrder: {
        table: 'delivery_orders',
        fieldMap: {
            doNumber: 'do_number',
            orderRef: 'order_ref',
            masterResi: 'master_resi',
            customerRef: 'customer_ref',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            date: 'date',
            status: 'status',
            trackingState: 'tracking_state',
            trackingStartedAt: 'tracking_started_at',
            trackingStoppedAt: 'tracking_stopped_at',
            trackingLastSeenAt: 'tracking_last_seen_at',
            trackingLastLat: 'tracking_last_lat',
            trackingLastLng: 'tracking_last_lng',
            customerName: 'customer_name',
            receiverName: 'receiver_name',
            receiverAddress: 'receiver_address',
            pickupAddress: 'pickup_address',
            notes: 'notes',
        },
    },
    deliveryOrderItem: {
        table: 'delivery_order_items',
        fieldMap: {
            deliveryOrderRef: 'delivery_order_ref',
            orderItemRef: 'order_item_ref',
            orderItemDescription: 'order_item_description',
            orderItemQtyKoli: 'order_item_qty_koli',
            orderItemWeight: 'order_item_weight_kg',
            shippedQtyKoli: 'shipped_qty_koli',
            shippedWeight: 'shipped_weight_kg',
            actualQtyKoli: 'actual_qty_koli',
            actualWeightKg: 'actual_weight_kg',
        },
    },
    trackingLog: {
        table: 'tracking_logs',
        fieldMap: {
            refType: 'ref_type',
            refRef: 'ref_ref',
            status: 'status',
            note: 'note',
            locationText: 'location_text',
            timestamp: 'timestamp',
            userRef: 'user_ref',
            userName: 'user_name',
            latitude: 'latitude',
            longitude: 'longitude',
            accuracyM: 'accuracy_m',
            speedKph: 'speed_kph',
            source: 'source',
        },
    },
    invoice: {
        table: 'invoices',
        fieldMap: {
            invoiceNumber: 'invoice_number',
            mode: 'mode',
            orderRef: 'order_ref',
            doRef: 'do_ref',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            masterResi: 'master_resi',
            issueDate: 'issue_date',
            dueDate: 'due_date',
            status: 'status',
            totalAmount: 'total_amount',
            totalAdjustmentAmount: 'total_adjustment_amount',
            pph23Enabled: 'pph23_enabled',
            pph23RatePercent: 'pph23_rate_percent',
            pph23BaseMode: 'pph23_base_mode',
            pph23BaseAmount: 'pph23_base_amount',
            pph23Amount: 'pph23_amount',
            netAmount: 'net_amount',
            notes: 'notes',
        },
    },
    invoiceItem: {
        table: 'invoice_items',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            description: 'description',
            qty: 'qty',
            price: 'price',
            subtotal: 'subtotal',
        },
    },
    freightNota: {
        table: 'freight_notas',
        fieldMap: {
            notaNumber: 'nota_number',
            notaDisplayNumber: 'nota_display_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            issuerCompanySignatureStampUrl: 'issuer_company_signature_stamp_url',
            issuerCompanySignatureName: 'issuer_company_signature_name',
            issuerCompanyNpwp: 'issuer_company_npwp',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            customerAddress: 'customer_address',
            customerContactPerson: 'customer_contact_person',
            customerPhone: 'customer_phone',
            issueDate: 'issue_date',
            dueDate: 'due_date',
            status: 'status',
            totalAmount: 'total_amount',
            totalAdjustmentAmount: 'total_adjustment_amount',
            pph23Enabled: 'pph23_enabled',
            pph23RatePercent: 'pph23_rate_percent',
            pph23BaseMode: 'pph23_base_mode',
            pph23BaseAmount: 'pph23_base_amount',
            pph23Amount: 'pph23_amount',
            netAmount: 'net_amount',
            totalPaidEffective: 'total_paid_effective',
            refundedOverpaymentAmount: 'refunded_overpayment_amount',
            openOverpaymentAmount: 'open_overpayment_amount',
            totalCollie: 'total_collie',
            totalWeightKg: 'total_weight_kg',
            billingMode: 'billing_mode',
            bankAccountRef: 'bank_account_ref',
            instructionAccounts: 'instruction_accounts',
            footerNote: 'footer_note',
            notes: 'notes',
        },
    },
    freightNotaItem: {
        table: 'freight_nota_items',
        fieldMap: {
            notaRef: 'nota_ref',
            doRef: 'do_ref',
            deliveryOrderItemRef: 'delivery_order_item_ref',
            doNumber: 'do_number',
            vehiclePlate: 'vehicle_plate',
            date: 'date',
            noSJ: 'no_sj',
            dari: 'dari',
            tujuan: 'tujuan',
            barang: 'barang',
            collie: 'collie',
            beratKg: 'berat_kg',
            tarip: 'tarip',
            uangRp: 'uang_rp',
            ket: 'ket',
        },
    },
    payment: {
        table: 'payments',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            receiptRef: 'receipt_ref',
            receiptNumber: 'receipt_number',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            date: 'date',
            amount: 'amount',
            method: 'method',
            note: 'note',
            attachmentUrl: 'attachment_url',
        },
    },
    customerReceipt: {
        table: 'customer_receipts',
        fieldMap: {
            receiptNumber: 'receipt_number',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            totalAmount: 'total_amount',
            allocatedAmount: 'allocated_amount',
            unappliedAmount: 'unapplied_amount',
            refundedOverpaymentAmount: 'refunded_overpayment_amount',
            openOverpaymentAmount: 'open_overpayment_amount',
            overpaymentStatus: 'overpayment_status',
            allocationCount: 'allocation_count',
            method: 'method',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            note: 'note',
        },
    },
    invoiceAdjustment: {
        table: 'invoice_adjustments',
        fieldMap: {
            invoiceRef: 'invoice_ref',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            amount: 'amount',
            kind: 'kind',
            status: 'status',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            editedAt: 'edited_at',
            editedBy: 'edited_by',
            editedByName: 'edited_by_name',
            voidedAt: 'voided_at',
            voidedBy: 'voided_by',
            voidedByName: 'voided_by_name',
        },
    },
    customerOverpaymentRefund: {
        table: 'customer_overpayment_refunds',
        fieldMap: {
            sourceType: 'source_type',
            sourceReceiptRef: 'source_receipt_ref',
            sourceReceiptNumber: 'source_receipt_number',
            sourceInvoiceRef: 'source_invoice_ref',
            sourceInvoiceNumber: 'source_invoice_number',
            customerRef: 'customer_ref',
            customerName: 'customer_name',
            date: 'date',
            amount: 'amount',
            bankAccountRef: 'bank_account_ref',
            bankAccountName: 'bank_account_name',
            bankAccountNumber: 'bank_account_number',
            bankTransactionRef: 'bank_transaction_ref',
            note: 'note',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
        },
    },
    income: {
        table: 'incomes',
        fieldMap: {
            sourceType: 'source_type',
            paymentRef: 'payment_ref',
            receiptRef: 'receipt_ref',
            date: 'date',
            amount: 'amount',
            note: 'note',
        },
    },
    maintenance: {
        table: 'maintenances',
        fieldMap: {
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            type: 'type',
            scheduleType: 'schedule_type',
            plannedDate: 'planned_date',
            plannedOdometer: 'planned_odometer',
            status: 'status',
            completedDate: 'completed_date',
            odometerAtService: 'odometer_at_service',
            vendor: 'vendor',
            notes: 'notes',
            completionNotes: 'completion_notes',
            attachmentUrls: 'attachment_urls',
            materialUsages: 'material_usages',
            materialUsageCount: 'material_usage_count',
            materialCostTotal: 'material_cost_total',
            totalCost: 'total_cost',
            relatedExpenseRef: 'related_expense_ref',
            cost: 'cost',
        },
    },
    incident: {
        table: 'incidents',
        fieldMap: {
            incidentNumber: 'incident_number',
            issuerCompanyName: 'issuer_company_name',
            issuerCompanyAddress: 'issuer_company_address',
            issuerCompanyPhone: 'issuer_company_phone',
            issuerCompanyEmail: 'issuer_company_email',
            issuerCompanyLogoUrl: 'issuer_company_logo_url',
            dateTime: 'date_time',
            vehicleRef: 'vehicle_ref',
            vehiclePlate: 'vehicle_plate',
            driverRef: 'driver_ref',
            driverName: 'driver_name',
            relatedDeliveryOrderRef: 'related_delivery_order_ref',
            relatedDONumber: 'related_do_number',
            incidentType: 'incident_type',
            urgency: 'urgency',
            locationText: 'location_text',
            odometer: 'odometer',
            description: 'description',
            status: 'status',
            attachmentUrls: 'attachment_urls',
            assignedToUserRef: 'assigned_to_user_ref',
            assignedToUserName: 'assigned_to_user_name',
        },
    },
    incidentSettlementLine: {
        table: 'incident_settlement_lines',
        fieldMap: {
            incidentRef: 'incident_ref',
            incidentNumber: 'incident_number',
            lineType: 'line_type',
            category: 'category',
            date: 'date',
            amount: 'amount',
            description: 'description',
            payeeName: 'payee_name',
            recipientType: 'recipient_type',
            note: 'note',
            status: 'status',
            linkedExpenseRef: 'linked_expense_ref',
            linkedExpenseDate: 'linked_expense_date',
            linkedExpenseAmount: 'linked_expense_amount',
            linkedExpenseCategoryRef: 'linked_expense_category_ref',
            linkedExpenseCategoryName: 'linked_expense_category_name',
            postedAt: 'posted_at',
            postedBy: 'posted_by',
            postedByName: 'posted_by_name',
            createdAt: 'created_at_business',
            createdBy: 'created_by',
            createdByName: 'created_by_name',
            updatedAt: 'updated_at_business',
            updatedBy: 'updated_by',
            updatedByName: 'updated_by_name',
            voidedAt: 'voided_at',
            voidedBy: 'voided_by',
            voidedByName: 'voided_by_name',
        },
    },
    incidentActionLog: {
        table: 'incident_action_logs',
        fieldMap: {
            incidentRef: 'incident_ref',
            timestamp: 'timestamp',
            note: 'note',
            userRef: 'user_ref',
            userName: 'user_name',
        },
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number) {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    if (typeof max === 'number' && parsed > max) {
        return max;
    }
    return parsed;
}

function getConfig(docType: string) {
    return RELATIONAL_CONFIG[docType as SupportedDocType] || null;
}

function toDocTypeList() {
    return Object.keys(RELATIONAL_CONFIG) as SupportedDocType[];
}

function readField(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (!isRecord(current)) {
            return undefined;
        }
        return current[segment];
    }, source);
}

function compareValues(left: unknown, right: unknown) {
    const normalizedLeft = left ?? '';
    const normalizedRight = right ?? '';

    if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
        return normalizedLeft - normalizedRight;
    }

    return String(normalizedLeft).localeCompare(String(normalizedRight));
}

function matchesFilterValue(actual: unknown, expected: unknown) {
    if (expected === '' || expected === null || expected === undefined) {
        return true;
    }

    if (Array.isArray(expected)) {
        if (expected.length === 0) return true;
        if (Array.isArray(actual)) {
            return actual.some(item => expected.includes(item));
        }
        return expected.includes(actual as never);
    }

    if (Array.isArray(actual)) {
        return actual.includes(expected as never);
    }

    return actual === expected;
}

function matchesFilter(doc: Record<string, unknown>, filterObj: Record<string, unknown>) {
    for (const [field, expected] of Object.entries(filterObj)) {
        if (!matchesFilterValue(readField(doc, field), expected)) {
            return false;
        }
    }
    return true;
}

function matchesDefinedFields(doc: Record<string, unknown>, fields: string[]) {
    return fields.every(field => {
        const value = readField(doc, field);
        if (Array.isArray(value)) {
            return value.length > 0;
        }
        return value !== undefined && value !== null && value !== '';
    });
}

function matchesOrFilters(
    doc: Record<string, unknown>,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>
) {
    if (orFilters.length === 0) return true;
    return orFilters.some(orFilter =>
        orFilter.fields.some(field => readField(doc, field) === orFilter.value)
    );
}

function matchesSearch(doc: Record<string, unknown>, search: string, searchFields: string[]) {
    if (!search.trim() || searchFields.length === 0) return true;
    const needle = search.trim().toLowerCase();
    return searchFields.some(field => {
        const value = readField(doc, field);
        return typeof value === 'string' && value.toLowerCase().includes(needle);
    });
}

function sortDocuments(
    docs: Array<Record<string, unknown>>,
    sortField?: string,
    sortDir: 'asc' | 'desc' = 'desc'
) {
    const targetField = sortField?.trim() || '_updatedAt';
    const multiplier = sortDir === 'asc' ? 1 : -1;

    return [...docs].sort((left, right) =>
        compareValues(readField(left, targetField), readField(right, targetField)) * multiplier
    );
}

function mapRowToDocument(docType: SupportedDocType, row: RelationalRow) {
    const config = RELATIONAL_CONFIG[docType];
    const extraData = isRecord(row.extra_data) ? row.extra_data : {};
    const doc: Record<string, unknown> = {
        ...extraData,
        _id: row.source_document_id,
        _type: docType,
        _createdAt: row.document_created_at || undefined,
        _updatedAt: row.document_updated_at || undefined,
    };

    for (const [field, column] of Object.entries(config.fieldMap)) {
        const value = row[column];
        if (value !== null && value !== undefined) {
            doc[field] = value;
        }
    }

    return doc;
}

function mapDocumentToRow(docType: SupportedDocType, doc: { _id?: string; _type?: string; [key: string]: unknown }) {
    const config = RELATIONAL_CONFIG[docType];
    const usedKeys = new Set<string>([...META_FIELDS, ...Object.keys(config.fieldMap)]);
    const extraData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(doc)) {
        if (!usedKeys.has(key)) {
            extraData[key] = value;
        }
    }

    const row: Record<string, unknown> = {
        source_document_id: typeof doc._id === 'string' && doc._id.trim() ? doc._id.trim() : randomUUID(),
        document_created_at: doc._createdAt ?? null,
        document_updated_at: doc._updatedAt ?? null,
        extra_data: extraData,
    };

    for (const [field, column] of Object.entries(config.fieldMap)) {
        row[column] = Object.prototype.hasOwnProperty.call(doc, field) ? doc[field] : null;
    }

    return row;
}

async function fetchRows(path: string) {
    const response = await getSupabaseClient().fetch(path);
    return await response.json() as RelationalRow[];
}

function isMissingRelationalTableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /Could not find the table/i.test(message) || /relation .* does not exist/i.test(message);
}

export function supportsRelationalDocType(docType: string): docType is SupportedDocType {
    return Boolean(getConfig(docType));
}

export async function relationalGetById<T = Record<string, unknown>>(docType: SupportedDocType, id: string): Promise<T | null> {
    const config = RELATIONAL_CONFIG[docType];

    try {
        const rows = await fetchRows(
            `${config.table}?select=*&source_document_id=eq.${encodeURIComponent(id)}&limit=1`
        );
        return rows[0] ? mapRowToDocument(docType, rows[0]) as T : null;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalGetAll<T = Record<string, unknown>>(docType: SupportedDocType): Promise<T[]> {
    const config = RELATIONAL_CONFIG[docType];

    try {
        const rows = await fetchRows(`${config.table}?select=*`);
        return rows.map(row => mapRowToDocument(docType, row) as T);
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return [];
        }
        throw error;
    }
}

export async function relationalGetByFilter<T = Record<string, unknown>>(
    docType: SupportedDocType,
    filterObj: Record<string, unknown>
): Promise<T[]> {
    const docs = await relationalGetAll<Record<string, unknown>>(docType);
    return docs.filter(doc => matchesFilter(doc, filterObj)) as T[];
}

export async function relationalList<T = Record<string, unknown>>(
    docType: SupportedDocType,
    options: RelationalListOptions = {}
): Promise<RelationalListResult<T>> {
    const docs = await relationalGetAll<Record<string, unknown>>(docType);
    const filtered = docs
        .filter(doc => matchesFilter(doc, options.filterObj ?? {}))
        .filter(doc => matchesDefinedFields(doc, options.definedFields ?? []))
        .filter(doc => matchesOrFilters(doc, options.orFilters ?? []))
        .filter(doc => matchesSearch(doc, options.search ?? '', options.searchFields ?? []));
    const sorted = sortDocuments(filtered, options.sortField, options.sortDir);
    const page = normalizePositiveInteger(options.page, 1);
    const pageSize = normalizePositiveInteger(options.pageSize, 10, 500);
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize) as T[];

    return {
        items,
        total: filtered.length,
    };
}

export async function relationalUpsertDocument<T = Record<string, unknown>>(
    doc: { _id?: string; _type: string; [key: string]: unknown }
): Promise<T | null> {
    if (!supportsRelationalDocType(doc._type)) {
        return null;
    }

    const config = RELATIONAL_CONFIG[doc._type];

    try {
        const response = await getSupabaseClient().fetch(config.table, {
            method: 'POST',
            headers: {
                Prefer: 'resolution=merge-duplicates,return=representation',
            },
            body: JSON.stringify(mapDocumentToRow(doc._type, doc)),
        });
        const rows = await response.json() as RelationalRow[];
        return rows[0] ? mapRowToDocument(doc._type, rows[0]) as T : null;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return null;
        }
        throw error;
    }
}

export async function relationalDeleteDocument(docType: SupportedDocType, id: string) {
    const config = RELATIONAL_CONFIG[docType];

    try {
        await getSupabaseClient().fetch(
            `${config.table}?source_document_id=eq.${encodeURIComponent(id)}`,
            { method: 'DELETE' }
        );
        return true;
    } catch (error) {
        if (isMissingRelationalTableError(error)) {
            return false;
        }
        throw error;
    }
}

export async function relationalFindDocumentByIdAcrossTypes<T = Record<string, unknown>>(id: string): Promise<T | null> {
    for (const docType of toDocTypeList()) {
        const found = await relationalGetById<T>(docType, id);
        if (found) {
            return found;
        }
    }
    return null;
}
