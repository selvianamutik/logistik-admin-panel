import type { TireHistoryLog } from './types';

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
