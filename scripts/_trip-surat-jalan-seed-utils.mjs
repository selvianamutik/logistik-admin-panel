function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function toNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function createCargoSummary() {
    return { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
}

function addCargoSummary(target, source) {
    target.qtyKoli += toNumber(source.qtyKoli);
    target.weightKg += toNumber(source.weightKg);
    target.volumeM3 += toNumber(source.volumeM3);
    return target;
}

function getWeightKg(point) {
    const direct = toNumber(point.weightKg ?? point.actualWeightKg);
    if (direct > 0) return direct;
    const input = toNumber(point.weightInputValue ?? point.actualWeightInputValue);
    const unit = String(point.weightInputUnit ?? point.actualWeightInputUnit ?? 'KG').toUpperCase();
    return unit === 'TON' ? input * 1000 : input;
}

function getVolumeM3(point) {
    const direct = toNumber(point.volumeM3 ?? point.actualVolumeM3);
    if (direct > 0) return direct;
    const input = toNumber(point.volumeInputValue ?? point.actualVolumeInputValue);
    const unit = String(point.volumeInputUnit ?? point.actualVolumeInputUnit ?? 'M3').toUpperCase();
    return unit === 'LITER' ? input / 1000 : input;
}

function normalizeCargoPoint(point) {
    return {
        qtyKoli: toNumber(point.qtyKoli),
        weightKg: getWeightKg(point),
        volumeM3: getVolumeM3(point),
    };
}

function isBillableStopType(stopType) {
    return String(stopType || '').toUpperCase() === 'DROP';
}

function isHoldStopType(stopType) {
    return ['HOLD', 'TRANSIT'].includes(String(stopType || '').toUpperCase());
}

function isReturnStopType(stopType) {
    return ['RETURN', 'RETUR'].includes(String(stopType || '').toUpperCase());
}

function getReferenceIdentity(reference, fallbackIndex) {
    return reference?._key || reference?.referenceNumber || `reference-${fallbackIndex + 1}`;
}

function getPrimarySuratJalanNumber(deliveryOrder) {
    return deliveryOrder.customerDoNumber || deliveryOrder.doNumber || deliveryOrder._id;
}

function mapDeliveryOrderToTripDoc(deliveryOrder) {
    return {
        _id: deliveryOrder._id,
        _type: 'trip',
        _createdAt: deliveryOrder._createdAt,
        _updatedAt: deliveryOrder._updatedAt,
        deliveryOrderRef: deliveryOrder._id,
        orderRef: deliveryOrder.orderRef,
        tripNumber: deliveryOrder.doNumber || deliveryOrder._id,
        masterResi: deliveryOrder.masterResi,
        customerRef: deliveryOrder.customerRef,
        customerName: deliveryOrder.customerName,
        vehicleRef: deliveryOrder.vehicleRef,
        vehiclePlate: deliveryOrder.vehiclePlate,
        driverRef: deliveryOrder.driverRef,
        driverName: deliveryOrder.driverName,
        tripDate: deliveryOrder.date,
        status: deliveryOrder.status,
        pickupAddress: deliveryOrder.pickupAddress,
        receiverName: deliveryOrder.receiverName,
        receiverPhone: deliveryOrder.receiverPhone,
        receiverAddress: deliveryOrder.receiverAddress,
        receiverCompany: deliveryOrder.receiverCompany,
        serviceRef: deliveryOrder.serviceRef,
        serviceName: deliveryOrder.serviceName,
        vehicleServiceRef: deliveryOrder.vehicleServiceRef,
        vehicleServiceName: deliveryOrder.vehicleServiceName,
        vehicleCategoryOverrideReason: deliveryOrder.vehicleCategoryOverrideReason,
        tripRouteRateRef: deliveryOrder.tripRouteRateRef,
        tripOriginArea: deliveryOrder.tripOriginArea,
        tripDestinationArea: deliveryOrder.tripDestinationArea,
        trackingState: deliveryOrder.trackingState,
        trackingStartedAt: deliveryOrder.trackingStartedAt,
        trackingStoppedAt: deliveryOrder.trackingStoppedAt,
        trackingLastSeenAt: deliveryOrder.trackingLastSeenAt,
        pendingDriverStatus: deliveryOrder.pendingDriverStatus,
        cargoFinalizedAt: deliveryOrder.cargoFinalizedAt,
        taripBorongan: deliveryOrder.taripBorongan,
        notes: deliveryOrder.notes,
    };
}

function mapDeliveryOrderToSuratJalanDocs(deliveryOrder, doItems) {
    const shipperReferences = toArray(deliveryOrder.shipperReferences);
    const actualDropPoints = toArray(deliveryOrder.actualDropPoints);
    const references = shipperReferences.length > 0 ? shipperReferences : [null];

    return references.map((reference, index) => {
        const suratJalanNumber = reference?.referenceNumber || getPrimarySuratJalanNumber(deliveryOrder);
        const referenceKey = reference ? getReferenceIdentity(reference, index) : undefined;
        const matchedItems = reference
            ? doItems.filter(item =>
                item.shipperReferenceKey === reference._key ||
                item.shipperReferenceNumber === reference.referenceNumber
            )
            : doItems.filter(item => !item.shipperReferenceKey && !item.shipperReferenceNumber);

        const cargoSummary = matchedItems.reduce((sum, item) => addCargoSummary(sum, {
            qtyKoli: item.orderItemQtyKoli || item.shippedQtyKoli || 0,
            weightKg: item.orderItemWeight || item.shippedWeight || 0,
            volumeM3: item.orderItemVolumeM3 || 0,
        }), createCargoSummary());

        const billableCargo = createCargoSummary();
        const holdCargo = createCargoSummary();
        const returnCargo = createCargoSummary();

        for (const point of actualDropPoints) {
            const sameReference = reference
                ? point.shipperReferenceKey === reference._key || point.shipperReferenceNumber === reference.referenceNumber
                : !point.shipperReferenceKey && !point.shipperReferenceNumber;
            if (!sameReference) continue;
            const cargoPoint = normalizeCargoPoint(point);
            if (isBillableStopType(point.stopType)) addCargoSummary(billableCargo, cargoPoint);
            if (isHoldStopType(point.stopType)) addCargoSummary(holdCargo, cargoPoint);
            if (isReturnStopType(point.stopType)) addCargoSummary(returnCargo, cargoPoint);
        }

        return {
            _id: `${deliveryOrder._id}:${referenceKey || 'primary'}`,
            _type: 'suratJalan',
            _createdAt: deliveryOrder._createdAt,
            _updatedAt: deliveryOrder._updatedAt,
            tripRef: deliveryOrder._id,
            deliveryOrderRef: deliveryOrder._id,
            orderRef: deliveryOrder.orderRef,
            customerRef: deliveryOrder.customerRef,
            customerName: deliveryOrder.customerName,
            referenceKey,
            suratJalanNumber,
            pickupAddress: reference?.pickupAddress || deliveryOrder.pickupAddress,
            receiverName: reference?.receiverName || deliveryOrder.receiverName,
            receiverCompany: reference?.receiverCompany || deliveryOrder.receiverCompany,
            receiverAddress: reference?.receiverAddress || deliveryOrder.receiverAddress,
            tripDate: deliveryOrder.date,
            tripStatus: deliveryOrder.status,
            vehiclePlate: deliveryOrder.vehiclePlate,
            driverName: deliveryOrder.driverName,
            itemCount: matchedItems.length,
            cargoSummary,
            billableCargo,
            holdCargo,
            returnCargo,
        };
    });
}

function mapSuratJalanItems(suratJalanDocs, doItems) {
    return suratJalanDocs.flatMap(doc => {
        const matchedItems = doc.referenceKey
            ? doItems.filter(item =>
                item.shipperReferenceKey === doc.referenceKey ||
                item.shipperReferenceNumber === doc.suratJalanNumber
            )
            : doItems.filter(item => !item.shipperReferenceKey && !item.shipperReferenceNumber);

        return matchedItems.map(item => ({
            _id: `${doc._id}:${item._id}`,
            _type: 'suratJalanItem',
            _createdAt: item._createdAt || doc._createdAt,
            _updatedAt: item._updatedAt || doc._updatedAt,
            suratJalanRef: doc._id,
            tripRef: doc.tripRef,
            deliveryOrderItemRef: item._id,
            referenceKey: doc.referenceKey,
            suratJalanNumber: doc.suratJalanNumber,
            orderItemDescription: item.orderItemDescription,
            plannedCargo: {
                qtyKoli: item.orderItemQtyKoli || item.shippedQtyKoli || 0,
                weightKg: item.orderItemWeight || item.shippedWeight || 0,
                volumeM3: item.orderItemVolumeM3 || 0,
            },
            actualCargo: {
                qtyKoli: item.actualQtyKoli || 0,
                weightKg: item.actualWeightKg || 0,
                volumeM3: item.actualVolumeM3 || 0,
            },
        }));
    });
}

export function deriveTripSuratJalanDocs(docs) {
    const deliveryOrders = docs.filter(doc => doc && doc._type === 'deliveryOrder');
    const deliveryOrderItems = docs.filter(doc => doc && doc._type === 'deliveryOrderItem');
    const itemsByDoRef = deliveryOrderItems.reduce((acc, item) => {
        const rows = acc.get(item.deliveryOrderRef) || [];
        rows.push(item);
        acc.set(item.deliveryOrderRef, rows);
        return acc;
    }, new Map());

    const tripDocs = [];
    const suratJalanDocs = [];
    const suratJalanItemDocs = [];

    for (const deliveryOrder of deliveryOrders) {
        const doItems = itemsByDoRef.get(deliveryOrder._id) || [];
        const nextTrip = mapDeliveryOrderToTripDoc(deliveryOrder);
        const nextSuratJalanDocs = mapDeliveryOrderToSuratJalanDocs(deliveryOrder, doItems);
        const nextSuratJalanItemDocs = mapSuratJalanItems(nextSuratJalanDocs, doItems);
        tripDocs.push(nextTrip);
        suratJalanDocs.push(...nextSuratJalanDocs);
        suratJalanItemDocs.push(...nextSuratJalanItemDocs);
    }

    return {
        deliveryOrders,
        deliveryOrderItems,
        tripDocs,
        suratJalanDocs,
        suratJalanItemDocs,
    };
}
