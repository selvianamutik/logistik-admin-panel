import { getAllDocuments, getDocumentById } from '@/lib/repositories/document-store';
import { isPlainObject } from '@/lib/api/data-helpers';
import { getDeliveryOrderTripCashLink } from '@/lib/api/data-query-support';
import { deriveDeliveryOrdersForResponse } from '@/lib/api/response-derivations';
import {
    mapDeliveryOrdersToSuratJalanDocuments,
    mapDeliveryOrdersToSuratJalanDocumentItems,
    mapDeliveryOrderToSuratJalanDocumentItems,
    mapTrackingLogsToTripTrackingEvents,
    mapDeliveryOrderToSuratJalanDocuments,
    mapDeliveryOrderToTrip,
    mapSuratJalanItemRecordToDocumentItem,
    mapSuratJalanRecordToDocument,
    mapTripRecordToTrip,
    parseSuratJalanDocumentId,
} from '@/lib/trip-document-mappers';
import type { SuratJalanItemRecord, SuratJalanRecord, TripRecord } from '@/lib/trip-document-types';
import type { Customer, CustomerProduct, CustomerRecipient, DeliveryOrder, DeliveryOrderItem, DriverVoucher, Order, TrackingLog, TripRouteRate } from '@/lib/types';

type ProjectedSuratJalanDocument = ReturnType<typeof mapDeliveryOrderToSuratJalanDocuments>[number];
type ProjectedSuratJalanDocumentItem = ReturnType<typeof mapDeliveryOrdersToSuratJalanDocumentItems>[number];

type ProjectedEntity = 'trips' | 'surat-jalan' | 'surat-jalan-items' | 'trip-tracking' | 'trip-detail' | 'surat-jalan-detail' | 'trip-detail-references';
type ProjectedReadPermissions = {
    canViewCustomerDetails?: boolean;
    canManageTripFee?: boolean;
    canEditShipperReference?: boolean;
    canEditDeliveryCargo?: boolean;
    canEditDeliveryTarget?: boolean;
};

type ProjectedListParams = {
    entity: ProjectedEntity;
    id?: string | null;
    filter?: string | null;
    searchQuery?: string | null;
    searchFields?: string[];
    sortField?: string | null;
    sortDir?: 'asc' | 'desc' | null;
    page: number;
    pageSize: number;
    countOnly?: boolean;
    permissions?: ProjectedReadPermissions;
};

function matchesProjectedSearchValue(value: unknown, needle: string): boolean {
    if (!needle) return true;
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value).toLowerCase().includes(needle);
    }
    if (Array.isArray(value)) {
        return value.some(item => matchesProjectedSearchValue(item, needle));
    }
    if (typeof value === 'object') {
        return Object.values(value).some(item => matchesProjectedSearchValue(item, needle));
    }
    return false;
}

function filterProjectedItemsBySearch<T extends object>(
    items: T[],
    searchQuery?: string | null,
    searchFields?: string[]
) {
    const needle = (searchQuery || '').trim().toLowerCase();
    if (!needle) {
        return items;
    }

    const fields = (searchFields || []).filter(Boolean);
    if (fields.length === 0) {
        return items.filter(item => matchesProjectedSearchValue(item, needle));
    }

    return items.filter(item => {
        const record = item as Record<string, unknown>;
        return fields.some(field => matchesProjectedSearchValue(record[field], needle));
    });
}

function sortProjectedItems<T extends object>(
    items: T[],
    sortField?: string | null,
    sortDir?: 'asc' | 'desc' | null,
    fallbackField?: string
) {
    const field = (sortField || '').trim() || fallbackField;
    if (!field) {
        return items;
    }

    const direction = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((left, right) => {
        const leftValue = (left as Record<string, unknown>)[field];
        const rightValue = (right as Record<string, unknown>)[field];
        return String(leftValue || '').localeCompare(String(rightValue || '')) * direction;
    });
}

function paginateProjectedItems<T>(items: T[], page: number, pageSize: number) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, pageSize);
    const start = (safePage - 1) * safePageSize;
    return items.slice(start, start + safePageSize);
}

function formatTripRouteKey(rate: TripRouteRate) {
    return `${rate.originArea || ''} ${rate.destinationArea || ''} ${rate.serviceName || ''}`.trim();
}

function hasAnyCargo(cargo?: { qtyKoli?: number; weightKg?: number; volumeM3?: number } | null) {
    return Boolean(
        (cargo?.qtyKoli || 0) > 0 ||
        (cargo?.weightKg || 0) > 0 ||
        (cargo?.volumeM3 || 0) > 0
    );
}

function mergeSuratJalanDocumentWithLiveCargo(
    document: ProjectedSuratJalanDocument,
    liveDocument?: ProjectedSuratJalanDocument
): ProjectedSuratJalanDocument {
    if (!liveDocument) {
        return document;
    }

    const isDraftDocumentWithoutActualCargo =
        document.tripStatus === 'CREATED' &&
        liveDocument.itemCount === 0 &&
        ['ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(liveDocument.tripStatus || '') &&
        !hasAnyCargo(document.billableCargo) &&
        !hasAnyCargo(document.holdCargo) &&
        !hasAnyCargo(document.returnCargo) &&
        !hasAnyCargo(liveDocument.billableCargo) &&
        !hasAnyCargo(liveDocument.holdCargo) &&
        !hasAnyCargo(liveDocument.returnCargo);

    return {
        ...document,
        tripStatus: isDraftDocumentWithoutActualCargo ? document.tripStatus : liveDocument.tripStatus,
        itemCount: liveDocument.itemCount,
        cargoSummary: liveDocument.cargoSummary,
        billableCargo: liveDocument.billableCargo,
        holdCargo: liveDocument.holdCargo,
        returnCargo: liveDocument.returnCargo,
    };
}

function mergeSuratJalanDocumentItemWithLiveCargo(
    item: ProjectedSuratJalanDocumentItem,
    liveItem?: ProjectedSuratJalanDocumentItem
): ProjectedSuratJalanDocumentItem {
    if (!liveItem) {
        return item;
    }

    return {
        ...item,
        orderItemDescription: liveItem.orderItemDescription || item.orderItemDescription,
        plannedCargo: liveItem.plannedCargo,
        actualCargo: liveItem.actualCargo,
    };
}

function parseProjectedFilter(filter: string | null) {
    if (!filter) {
        return null;
    }

    const parsed = JSON.parse(filter) as unknown;
    if (!isPlainObject(parsed)) {
        throw new Error('Filter query tidak valid');
    }

    return parsed as Record<string, unknown>;
}

function matchesProjectedFilter(
    item: Record<string, unknown>,
    filterObj: Record<string, unknown> | null
) {
    if (!filterObj) {
        return true;
    }

    return Object.entries(filterObj).every(([key, value]) => {
        const itemValue = item[key];
        if (Array.isArray(value)) {
            return value.some(entry => entry === itemValue);
        }
        return itemValue === value;
    });
}

async function loadProjectedSourceData() {
    const allDeliveryOrders = await getAllDocuments<DeliveryOrder>('deliveryOrder');
    const derivedDeliveryOrders = await deriveDeliveryOrdersForResponse(allDeliveryOrders);
    const allTripRecords = await getAllDocuments<TripRecord>('trip');
    const allSuratJalanRecords = await getAllDocuments<SuratJalanRecord>('suratJalan');
    const allSuratJalanItemRecords = await getAllDocuments<SuratJalanItemRecord>('suratJalanItem');
    const allDeliveryOrderItems = await getAllDocuments<DeliveryOrderItem>('deliveryOrderItem');
    const allTrackingLogs = await getAllDocuments<TrackingLog>('trackingLog');
    const allDriverVouchers = await getAllDocuments<DriverVoucher>('driverVoucher');
    return {
        derivedDeliveryOrders,
        allTripRecords,
        allSuratJalanRecords,
        allSuratJalanItemRecords,
        allDeliveryOrderItems,
        allTrackingLogs,
        allDriverVouchers,
    };
}

export async function getProjectedDocumentRead(params: ProjectedListParams) {
    const {
        entity,
        id,
        filter,
        searchQuery,
        searchFields = [],
        sortField,
        sortDir,
        page,
        pageSize,
        countOnly = false,
        permissions,
    } = params;

    const { derivedDeliveryOrders, allTripRecords, allSuratJalanRecords, allSuratJalanItemRecords, allDeliveryOrderItems, allTrackingLogs, allDriverVouchers } = await loadProjectedSourceData();
    const filterObj = parseProjectedFilter(filter || null);
    const realTrips = allTripRecords.map(mapTripRecordToTrip);
    const realTripById = new Map(realTrips.map(item => [item._id, item] as const));

    if (entity === 'trips') {
        const itemsByDeliveryOrderRef = allDeliveryOrderItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
            const rows = acc.get(item.deliveryOrderRef) || [];
            rows.push(item);
            acc.set(item.deliveryOrderRef, rows);
            return acc;
        }, new Map());
        const derivedTrips = derivedDeliveryOrders.map(deliveryOrder =>
            mapDeliveryOrderToTrip(deliveryOrder, itemsByDeliveryOrderRef.get(deliveryOrder._id) || [])
        );
        const derivedTripByLegacyKey = new Map(
            derivedTrips.map(item => [item._id, item] as const)
        );
        const realTripByLegacyKey = new Map(
            realTrips.map(item => [item.sourceDeliveryOrderRef || item._id, item] as const)
        );
        const trips = [
            ...realTrips.map(item => {
                const derivedTrip = derivedTripByLegacyKey.get(item.sourceDeliveryOrderRef || item._id);
                return {
                    ...item,
                    status: derivedTrip?.status || item.status,
                    shipperReferenceCount: derivedTrip?.shipperReferenceCount || item.shipperReferenceCount,
                };
            }),
            ...derivedTrips.filter(item => !realTripByLegacyKey.has(item._id)),
        ];
        if (id) {
            const trip = trips.find(item => item._id === id || item.sourceDeliveryOrderRef === id) || null;
            return {
                data: trip,
                meta: undefined,
            };
        }

        const filtered = filterProjectedItemsBySearch(
            trips.filter(item => matchesProjectedFilter(item as unknown as Record<string, unknown>, filterObj)),
            searchQuery,
            searchFields.length > 0
                ? searchFields
                : ['tripNumber', 'masterResi', 'customerName', 'vehiclePlate', 'driverName', 'pickupAddress', 'receiverAddress', 'tripOriginArea', 'tripDestinationArea']
        );
        const sorted = sortProjectedItems(filtered, sortField, sortDir, 'date');
        return {
            data: countOnly ? [] : paginateProjectedItems(sorted, page, pageSize),
            meta: {
                page,
                pageSize,
                total: sorted.length,
            },
        };
    }

    if (entity === 'trip-detail') {
        const deliveryOrder = id
            ? derivedDeliveryOrders.find(item => item._id === id) || null
            : null;
        if (!deliveryOrder) {
            return {
                data: null,
                meta: undefined,
            };
        }

        const deliveryOrderItems = allDeliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
        const trackingEvents = sortProjectedItems(
            mapTrackingLogsToTripTrackingEvents(
                allTrackingLogs.filter(log => log.refType === 'DO' && log.refRef === deliveryOrder._id)
            ),
            'timestamp',
            'asc'
        );
        const sourceOrder = deliveryOrder.orderRef
            ? await getDocumentById<Order>(deliveryOrder.orderRef, 'order')
            : null;
        const linkedVoucher = allDriverVouchers.find(item => item.deliveryOrderRef === deliveryOrder._id) || null;
        const tripCashLink = await getDeliveryOrderTripCashLink(deliveryOrder._id).catch(() => null);

        return {
            data: {
                _id: deliveryOrder._id,
                _type: 'tripDetail',
                trip: (() => {
                    const derivedTrip = mapDeliveryOrderToTrip(deliveryOrder, deliveryOrderItems);
                    const realTrip = realTrips.find(item => item._id === id || item.sourceDeliveryOrderRef === deliveryOrder._id);
                    return realTrip
                        ? { ...realTrip, status: derivedTrip.status, shipperReferenceCount: derivedTrip.shipperReferenceCount }
                        : derivedTrip;
                })(),
                deliveryOrder,
                sourceOrder,
                deliveryOrderItems,
                suratJalanDocuments: (() => {
                    const derivedDocuments = mapDeliveryOrderToSuratJalanDocuments(deliveryOrder, deliveryOrderItems);
                    const derivedDocumentById = new Map(derivedDocuments.map(item => [item._id, item] as const));
                    const realDocuments = allSuratJalanRecords
                        .filter(item => item.tripRef === deliveryOrder._id || item.deliveryOrderRef === deliveryOrder._id)
                        .filter(item => derivedDocumentById.has(item._id))
                        .map(item => {
                            const realDocument = mapSuratJalanRecordToDocument(item, realTripById.get(item.tripRef) || null);
                            return mergeSuratJalanDocumentWithLiveCargo(realDocument, derivedDocumentById.get(realDocument._id));
                        });
                    const realDocumentById = new Map(realDocuments.map(item => [item._id, item] as const));
                    return [
                        ...realDocuments,
                        ...derivedDocuments.filter(item => !realDocumentById.has(item._id)),
                    ];
                })(),
                trackingEvents,
                linkedVoucher,
                tripCashLink,
            },
            meta: undefined,
        };
    }

    if (entity === 'trip-detail-references') {
        const deliveryOrder = id
            ? derivedDeliveryOrders.find(item => item._id === id) || null
            : null;
        if (!deliveryOrder) {
            return {
                data: null,
                meta: undefined,
            };
        }

        const [
            allCustomers,
            allCustomerProducts,
            allCustomerRecipients,
            allTripRouteRates,
        ] = await Promise.all([
            getAllDocuments<Customer>('customer'),
            getAllDocuments<CustomerProduct>('customerProduct'),
            getAllDocuments<CustomerRecipient>('customerRecipient'),
            getAllDocuments<TripRouteRate>('tripRouteRate'),
        ]);
        const customer = deliveryOrder.customerRef
            ? allCustomers.find(item => item._id === deliveryOrder.customerRef) || null
            : null;

        return {
            data: {
                _id: deliveryOrder._id,
                _type: 'tripDetailReferences',
                customerData: permissions?.canViewCustomerDetails && deliveryOrder.customerRef
                    ? (customer ? { deliveryOrderPrefix: customer.deliveryOrderPrefix } : null)
                    : null,
                billingCustomers: permissions?.canEditShipperReference
                    ? allCustomers
                        .filter(customer => customer.active !== false || customer._id === deliveryOrder.customerRef)
                        .map(customer => ({ _id: customer._id, name: customer.name, active: customer.active }))
                        .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'id'))
                    : [],
                customerProducts: permissions?.canEditDeliveryCargo && deliveryOrder.customerRef
                    ? allCustomerProducts
                        .filter(product => product.customerRef === deliveryOrder.customerRef && product.active !== false)
                        .sort((left, right) => (left.name || '').localeCompare(right.name || '', 'id'))
                    : [],
                customerRecipients: (permissions?.canEditDeliveryTarget || permissions?.canEditShipperReference)
                    ? allCustomerRecipients
                        .filter(recipient => recipient.active !== false)
                        .sort((left, right) => (left.label || '').localeCompare(right.label || '', 'id'))
                    : [],
                tripRouteRates: permissions?.canManageTripFee
                    ? allTripRouteRates
                        .filter(rate => rate.active !== false)
                        .sort((left, right) => formatTripRouteKey(left).localeCompare(formatTripRouteKey(right), 'id'))
                    : [],
            },
            meta: undefined,
        };
    }

    if (entity === 'surat-jalan-detail') {
        if (!id) {
            return {
                data: null,
                meta: undefined,
            };
        }
        const parsedId = parseSuratJalanDocumentId(id);
        const deliveryOrder = derivedDeliveryOrders.find(item => item._id === parsedId.tripRef) || null;
        if (!deliveryOrder) {
            return {
                data: null,
                meta: undefined,
            };
        }

        const deliveryOrderItems = allDeliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
        const derivedDocuments = mapDeliveryOrderToSuratJalanDocuments(deliveryOrder, deliveryOrderItems);
        const derivedDocumentById = new Map(derivedDocuments.map(item => [item._id, item] as const));
        const realDocuments = allSuratJalanRecords
            .filter(item => item.tripRef === deliveryOrder._id || item.deliveryOrderRef === deliveryOrder._id)
            .filter(item => derivedDocumentById.has(item._id))
            .map(item => {
                const realDocument = mapSuratJalanRecordToDocument(item, realTripById.get(item.tripRef) || null);
                return mergeSuratJalanDocumentWithLiveCargo(realDocument, derivedDocumentById.get(realDocument._id));
            });
        const documents = [
            ...realDocuments,
            ...derivedDocuments.filter(item => !realDocuments.some(realItem => realItem._id === item._id)),
        ];
        const suratJalanDocument = documents.find(item =>
            item._id === id ||
            (item.tripRef === parsedId.tripRef && (item.referenceKey || 'primary') === parsedId.referenceKey)
        ) || null;
        if (!suratJalanDocument) {
            return {
                data: null,
                meta: undefined,
            };
        }

        const sourceOrder = deliveryOrder.orderRef
            ? await getDocumentById<Order>(deliveryOrder.orderRef, 'order')
            : null;

        return {
            data: {
                _id: suratJalanDocument._id,
                _type: 'suratJalanDetail',
                suratJalanDocument,
                trip: realTrips.find(item => item._id === deliveryOrder._id || item.sourceDeliveryOrderRef === deliveryOrder._id)
                    || mapDeliveryOrderToTrip(deliveryOrder),
                deliveryOrder,
                sourceOrder,
                documentItems: (() => {
                    const derivedItems = mapDeliveryOrderToSuratJalanDocumentItems(deliveryOrder, deliveryOrderItems)
                        .filter(item => item.suratJalanRef === suratJalanDocument._id);
                    const derivedItemById = new Map(derivedItems.map(item => [item._id, item] as const));
                    const derivedItemByDeliveryOrderItemRef = new Map(
                        derivedItems
                            .filter(item => item.sourceDeliveryOrderItemRef)
                            .map(item => [item.sourceDeliveryOrderItemRef, item] as const)
                    );
                    const realItems = allSuratJalanItemRecords
                        .filter(item => item.suratJalanRef === suratJalanDocument._id)
                        .map(item => {
                            const realItem = mapSuratJalanItemRecordToDocumentItem(item);
                            return mergeSuratJalanDocumentItemWithLiveCargo(
                                realItem,
                                derivedItemById.get(realItem._id) ||
                                    derivedItemByDeliveryOrderItemRef.get(realItem.sourceDeliveryOrderItemRef)
                            );
                        });
                    const realItemById = new Map(realItems.map(item => [item._id, item] as const));
                    return [
                        ...realItems,
                        ...derivedItems.filter(item => !realItemById.has(item._id)),
                    ];
                })(),
            },
            meta: undefined,
        };
    }

    if (entity === 'surat-jalan') {
        const derivedDocuments = mapDeliveryOrdersToSuratJalanDocuments(derivedDeliveryOrders, allDeliveryOrderItems);
        const derivedDocumentById = new Map(derivedDocuments.map(item => [item._id, item] as const));
        const realDocuments = allSuratJalanRecords
            .filter(item => derivedDocumentById.has(item._id))
            .map(item =>
                mergeSuratJalanDocumentWithLiveCargo(
                    mapSuratJalanRecordToDocument(item, realTripById.get(item.tripRef) || null),
                    derivedDocumentById.get(item._id)
                )
            );
        const realDocumentById = new Map(realDocuments.map(item => [item._id, item] as const));
        const documents = [
            ...realDocuments,
            ...derivedDocuments.filter(item => !realDocumentById.has(item._id)),
        ];
        if (id) {
            const parsedId = parseSuratJalanDocumentId(id);
            return {
                data: documents.find(item =>
                    item._id === id ||
                    (item.tripRef === parsedId.tripRef && (item.referenceKey || 'primary') === parsedId.referenceKey)
                ) || null,
                meta: undefined,
            };
        }

        const filtered = filterProjectedItemsBySearch(
            documents.filter(item => matchesProjectedFilter(item as unknown as Record<string, unknown>, filterObj)),
            searchQuery,
            searchFields.length > 0
                ? searchFields
                : ['suratJalanNumber', 'tripNumber', 'masterResi', 'customerName', 'pickupAddress', 'receiverName', 'receiverCompany', 'receiverAddress', 'vehiclePlate', 'driverName']
        );
        const sorted = sortProjectedItems(filtered, sortField, sortDir, 'tripDate');
        return {
            data: countOnly ? [] : paginateProjectedItems(sorted, page, pageSize),
            meta: {
                page,
                pageSize,
                total: sorted.length,
            },
        };
    }

    const derivedDocumentItems = mapDeliveryOrdersToSuratJalanDocumentItems(derivedDeliveryOrders, allDeliveryOrderItems);
    const derivedDocumentItemById = new Map(derivedDocumentItems.map(item => [item._id, item] as const));
    const derivedDocumentItemByDeliveryOrderItemRef = new Map(
        derivedDocumentItems
            .filter(item => item.sourceDeliveryOrderItemRef)
            .map(item => [`${item.suratJalanRef}:${item.sourceDeliveryOrderItemRef}`, item] as const)
    );
    const realDocumentItems = allSuratJalanItemRecords.map(item => {
        const realItem = mapSuratJalanItemRecordToDocumentItem(item);
        return mergeSuratJalanDocumentItemWithLiveCargo(
            realItem,
            derivedDocumentItemById.get(realItem._id) ||
                derivedDocumentItemByDeliveryOrderItemRef.get(`${realItem.suratJalanRef}:${realItem.sourceDeliveryOrderItemRef}`)
        );
    });
    const realDocumentItemById = new Map(realDocumentItems.map(item => [item._id, item] as const));
    const documentItems = [
        ...realDocumentItems,
        ...derivedDocumentItems.filter(item => !realDocumentItemById.has(item._id)),
    ];
    if (entity === 'trip-tracking') {
        const tripEvents = mapTrackingLogsToTripTrackingEvents(allTrackingLogs);
        if (id) {
            return {
                data: tripEvents.find(item => item._id === id) || null,
                meta: undefined,
            };
        }

        const filtered = filterProjectedItemsBySearch(
            tripEvents.filter(item => matchesProjectedFilter(item as unknown as Record<string, unknown>, filterObj)),
            searchQuery,
            searchFields.length > 0 ? searchFields : ['status', 'note', 'locationText', 'userName']
        );
        const sorted = sortProjectedItems(filtered, sortField, sortDir, 'timestamp');
        return {
            data: countOnly ? [] : paginateProjectedItems(sorted, page, pageSize),
            meta: {
                page,
                pageSize,
                total: sorted.length,
            },
        };
    }

    if (id) {
        return {
            data: documentItems.find(item => item._id === id) || null,
            meta: undefined,
        };
    }

    const filtered = filterProjectedItemsBySearch(
        documentItems.filter(item => matchesProjectedFilter(item as unknown as Record<string, unknown>, filterObj)),
        searchQuery,
        searchFields.length > 0
            ? searchFields
            : ['suratJalanNumber', 'orderItemDescription']
    );
    const sorted = sortProjectedItems(filtered, sortField, sortDir, 'orderItemDescription');
    return {
        data: countOnly ? [] : paginateProjectedItems(sorted, page, pageSize),
        meta: {
            page,
            pageSize,
            total: sorted.length,
        },
    };
}
