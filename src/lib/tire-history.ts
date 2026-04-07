import {
  resolveTireAssetStatus,
  resolveTireHolderType,
  resolveTirePlacementLabel,
  resolveTireSlotCode,
} from './tire-slots';
import type { TireEvent, TireHistoryLog } from './types';

export const TIRE_HISTORY_ACTION_LABELS: Record<TireHistoryLog['actionType'], string> = {
    CREATED: 'Pencatatan Awal',
    MOVED: 'Pindah Lokasi',
    STATUS_CHANGED: 'Ubah Status',
    SCRAPPED: 'Afkir',
    UPDATED: 'Update Data',
};

export function getTireHistoryActionLabel(actionType: TireHistoryLog['actionType']) {
    return TIRE_HISTORY_ACTION_LABELS[actionType] || actionType;
}

export function getTireHistoryActionColor(actionType: TireHistoryLog['actionType']) {
    if (actionType === 'CREATED') return 'success';
    if (actionType === 'MOVED') return 'primary';
    if (actionType === 'STATUS_CHANGED') return 'warning';
    if (actionType === 'SCRAPPED') return 'danger';
    return 'gray';
}

export function getTireHistoryTransitionLabel(log: TireHistoryLog) {
  if (log.fromPlacementLabel && log.toPlacementLabel) {
    return `${log.fromPlacementLabel} -> ${log.toPlacementLabel}`;
  }
    if (log.toPlacementLabel) {
        return log.toPlacementLabel;
    }
    if (log.fromPlacementLabel) {
        return log.fromPlacementLabel;
  }
  return '-';
}

export type TireHistorySnapshot = {
  holderType?: string;
  status?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  slotCode?: string;
  placementLabel?: string;
};

type TireHistoryActor = Pick<{ _id: string; name: string }, '_id' | 'name'>;

function extractRefId(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { _ref?: unknown })._ref === 'string') {
    return (value as { _ref: string })._ref;
  }
  return '';
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

export function buildTireHistorySnapshot(doc: Record<string, unknown> | TireEvent): TireHistorySnapshot {
  return {
    holderType: resolveTireHolderType(doc),
    status: resolveTireAssetStatus(doc),
    vehicleRef: extractRefId((doc as Record<string, unknown>).vehicleRef) || undefined,
    vehiclePlate: normalizeOptionalText((doc as Record<string, unknown>).vehiclePlate),
    slotCode: resolveTireSlotCode({
      slotCode: normalizeOptionalText((doc as Record<string, unknown>).slotCode),
      posisi: normalizeOptionalText((doc as Record<string, unknown>).posisi),
    }),
    placementLabel: resolveTirePlacementLabel(doc),
  };
}

export function deriveTireHistoryAction(previous: TireHistorySnapshot | null, next: TireHistorySnapshot) {
  if (!previous) return 'CREATED' satisfies TireHistoryLog['actionType'];
  if (previous.status !== 'SCRAPPED' && next.status === 'SCRAPPED') return 'SCRAPPED' satisfies TireHistoryLog['actionType'];
  if (previous.placementLabel !== next.placementLabel) return 'MOVED' satisfies TireHistoryLog['actionType'];
  if (previous.status !== next.status) return 'STATUS_CHANGED' satisfies TireHistoryLog['actionType'];
  return 'UPDATED' satisfies TireHistoryLog['actionType'];
}

export function buildTireHistoryNote(actionType: TireHistoryLog['actionType'], previous: TireHistorySnapshot | null, next: TireHistorySnapshot) {
  if (actionType === 'CREATED') {
    return `Ban dicatat dengan lokasi awal ${next.placementLabel || '-'}`;
  }
  if (actionType === 'SCRAPPED') {
    return `Ban diafkirkan dari ${previous?.placementLabel || '-'} ke ${next.placementLabel || '-'}`;
  }
  if (actionType === 'MOVED') {
    return `Ban dipindahkan dari ${previous?.placementLabel || '-'} ke ${next.placementLabel || '-'}`;
  }
  if (actionType === 'STATUS_CHANGED') {
    return `Status ban berubah dari ${previous?.status || '-'} ke ${next.status || '-'}`;
  }
  return `Data ban diperbarui di ${next.placementLabel || '-'}`;
}

export function buildTireHistoryLogDoc(params: {
  tireEventRef: string;
  tireCode: string;
  tireBrand?: string;
  tireSize?: string;
  previous: TireHistorySnapshot | null;
  next: TireHistorySnapshot;
  session: TireHistoryActor;
  note?: string;
}) {
  const actionType = deriveTireHistoryAction(params.previous, params.next);
  return {
    _id: crypto.randomUUID(),
    _type: 'tireHistoryLog',
    tireEventRef: params.tireEventRef,
    tireCode: params.tireCode,
    tireBrand: params.tireBrand,
    tireSize: params.tireSize,
    actionType,
    timestamp: new Date().toISOString(),
    actorUserRef: params.session._id,
    actorUserName: params.session.name,
    note: params.note || buildTireHistoryNote(actionType, params.previous, params.next),
    fromHolderType: params.previous?.holderType,
    fromStatus: params.previous?.status,
    fromVehicleRef: params.previous?.vehicleRef,
    fromVehiclePlate: params.previous?.vehiclePlate,
    fromSlotCode: params.previous?.slotCode,
    fromPlacementLabel: params.previous?.placementLabel,
    toHolderType: params.next.holderType,
    toStatus: params.next.status,
    toVehicleRef: params.next.vehicleRef,
    toVehiclePlate: params.next.vehiclePlate,
    toSlotCode: params.next.slotCode,
    toPlacementLabel: params.next.placementLabel,
  };
}
