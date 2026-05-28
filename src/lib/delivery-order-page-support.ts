import { DEFAULT_PAGE_SIZE } from './pagination';
import { escapePrintHtml } from './print';
import type { DeliveryOrder, Service } from './types';
import { DO_STATUS_MAP, formatDate, formatDateTime, formatShipperDeliveryOrderNumber } from './utils';

export function getNextDeliveryOrderAction(deliveryOrder: DeliveryOrder) {
    if (deliveryOrder.pendingDriverStatus) {
        return 'Approve / tolak update driver';
    }

    switch (deliveryOrder.status) {
        case 'ARRIVED':
            return 'Selesaikan trip';
        case 'ON_DELIVERY':
            return deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED'
                ? 'Pantau perjalanan'
                : 'Aktifkan tracking / pantau';
        case 'CREATED':
            return 'Pastikan trip siap berangkat';
        case 'DELIVERED':
            return 'Cek POD / arsip';
        case 'CANCELLED':
            return 'Tidak ada tindak lanjut';
        default:
            return 'Buka detail trip';
    }
}

export function buildDeliveryOrdersQuery(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    statusFilter?: string;
    serviceFilter?: string;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
}) {
    const search = params.search?.trim() || '';
    const paramsBuilder = new URLSearchParams({
        entity: 'delivery-orders',
        page: String(params.page ?? 1),
        pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    });

    if (params.sortField) {
        paramsBuilder.set('sortField', params.sortField);
        paramsBuilder.set('sortDir', params.sortDir === 'asc' ? 'asc' : 'desc');
    } else {
        paramsBuilder.set('sortPreset', 'work-queue');
    }

    if (search) {
        paramsBuilder.set('q', search);
        paramsBuilder.set('searchFields', [
            'doNumber',
            'customerDoNumber',
            'shipperReferences[].referenceNumber',
            'shipperReferences[].billingCustomerName',
            'shipperReferences[].receiverName',
            'shipperReferences[].receiverCompany',
            'shipperReferences[].receiverAddress',
            'customerName',
            'vehiclePlate',
            'driverName',
            'serviceName',
            'vehicleServiceName',
            'vehicleCategoryOverrideReason',
            'actualDropPoints[].locationName',
            'actualDropPoints[].locationAddress',
        ].join(','));
    }

    if (params.statusFilter) {
        paramsBuilder.set('filter', JSON.stringify({ status: params.statusFilter }));
    }

    if (params.serviceFilter) {
        paramsBuilder.set('orFilters', JSON.stringify([
            { fields: ['serviceRef', 'vehicleServiceRef'], value: params.serviceFilter },
        ]));
    }

    return paramsBuilder.toString();
}

export function getRequestedDeliveryOrderServiceLabel(deliveryOrder: DeliveryOrder, services: Service[]) {
    const service = services.find(item => item._id === deliveryOrder.serviceRef);
    if (service) {
        return `${service.code} - ${service.name}`;
    }
    return deliveryOrder.serviceName || '-';
}

export function getActualDeliveryOrderServiceLabel(deliveryOrder: DeliveryOrder, services: Service[]) {
    if (deliveryOrder.vehicleServiceRef) {
        const service = services.find(item => item._id === deliveryOrder.vehicleServiceRef);
        if (service) {
            return `${service.code} - ${service.name}`;
        }
    }
    return deliveryOrder.vehicleServiceName || getRequestedDeliveryOrderServiceLabel(deliveryOrder, services);
}

export function getDeliveryOrderServiceLabel(deliveryOrder: DeliveryOrder, services: Service[]) {
    const requested = getRequestedDeliveryOrderServiceLabel(deliveryOrder, services);
    const actual = getActualDeliveryOrderServiceLabel(deliveryOrder, services);
    if (deliveryOrder.vehicleCategoryOverrideReason && actual !== requested) {
        return `${requested} -> ${actual}`;
    }
    return requested;
}

export function getSelectableDeliveryOrderServices(params: {
    services: Service[];
    serviceFilter: string;
    deliveryOrders?: DeliveryOrder[];
}) {
    const { services, serviceFilter, deliveryOrders = [] } = params;
    return services.filter(service =>
        service.active !== false ||
        service._id === serviceFilter ||
        deliveryOrders.some(item => item.serviceRef === service._id || item.vehicleServiceRef === service._id)
    );
}

export function buildDeliveryOrderExportRows(deliveryOrders: DeliveryOrder[], services: Service[]) {
    return deliveryOrders.map(deliveryOrder => ({
        customerDoNumber: formatShipperDeliveryOrderNumber(deliveryOrder, { mode: 'full' }),
        doNumber: deliveryOrder.doNumber || '-',
        masterResi: deliveryOrder.masterResi || '-',
        customerName: deliveryOrder.customerName || '-',
        serviceLabel: getDeliveryOrderServiceLabel(deliveryOrder, services),
        vehiclePlate: deliveryOrder.vehiclePlate || '-',
        driverName: deliveryOrder.driverName || '-',
        date: formatDate(deliveryOrder.date),
        status: DO_STATUS_MAP[deliveryOrder.status]?.label || deliveryOrder.status,
        actualDropPoints: deliveryOrder.actualDropPoints?.length || 0,
    }));
}

export function buildDeliveryOrdersPrintHtml(deliveryOrders: DeliveryOrder[], services: Service[]) {
    return `
        <table>
            <thead>
                <tr>
                    <th>No. SJ Pengirim</th>
                    <th>No. DO Internal</th>
                    <th>Resi</th>
                    <th>Customer</th>
                    <th>Kategori</th>
                    <th>Kendaraan</th>
                    <th>Driver</th>
                    <th>Tanggal</th>
                    <th>Status</th>
                    <th>Drop Aktual</th>
                </tr>
            </thead>
            <tbody>
                ${deliveryOrders.map(item => `
                    <tr>
                        <td class="b">${escapePrintHtml(formatShipperDeliveryOrderNumber(item, { mode: 'full' }))}</td>
                        <td>${escapePrintHtml(item.doNumber || '-')}</td>
                        <td>${escapePrintHtml(item.masterResi || '-')}</td>
                        <td>${escapePrintHtml(item.customerName || '-')}</td>
                        <td>${escapePrintHtml(getDeliveryOrderServiceLabel(item, services))}</td>
                        <td>${escapePrintHtml(item.vehiclePlate || '-')}</td>
                        <td>${escapePrintHtml(item.driverName || '-')}</td>
                        <td>${escapePrintHtml(formatDate(item.date))}</td>
                        <td>${escapePrintHtml(DO_STATUS_MAP[item.status]?.label || item.status)}</td>
                        <td>${escapePrintHtml(item.actualDropPoints?.length ? `${item.actualDropPoints.length} titik` : '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

export function getDeliveryOrderTrackingSummary(deliveryOrder: DeliveryOrder) {
    if (deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED') {
        return `${deliveryOrder.trackingState} | ${deliveryOrder.trackingLastSeenAt ? formatDateTime(deliveryOrder.trackingLastSeenAt) : 'Belum ada update'}`;
    }
    return 'Belum aktif';
}

export function getDeliveryOrderDropSummary(deliveryOrder: DeliveryOrder) {
    if (deliveryOrder.actualDropPoints?.length) {
        return `${deliveryOrder.actualDropPoints.length} titik | ${deliveryOrder.actualDropPoints[0]?.locationName || '-'}`;
    }
    return 'Belum dicatat';
}

export function getDeliveryOrderApprovalSummary(deliveryOrder: DeliveryOrder) {
    if (deliveryOrder.pendingDriverStatus) {
        return `${DO_STATUS_MAP[deliveryOrder.pendingDriverStatus]?.label || deliveryOrder.pendingDriverStatus} | ${deliveryOrder.pendingDriverStatusRequestedAt ? formatDateTime(deliveryOrder.pendingDriverStatusRequestedAt) : 'Menunggu approval'}`;
    }
    return 'Tidak ada';
}
