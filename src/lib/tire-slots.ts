import type { TireAxleLayoutMode, TireLayoutConfig } from './types';

export type TireHolderType = 'INTERNAL_VEHICLE' | 'EXTERNAL_VEHICLE' | 'WAREHOUSE';
export type TireAssetStatus = 'IN_USE' | 'SPARE' | 'IN_WAREHOUSE' | 'LOANED_OUT' | 'SCRAPPED';

export const TIRE_HOLDER_TYPE_OPTIONS: Array<{ value: TireHolderType; label: string }> = [
  { value: 'INTERNAL_VEHICLE', label: 'Kendaraan Internal' },
  { value: 'EXTERNAL_VEHICLE', label: 'Kendaraan / pihak luar' },
  { value: 'WAREHOUSE', label: 'Gudang / stok' },
];

export const TIRE_STATUS_OPTIONS: Array<{ value: TireAssetStatus; label: string }> = [
  { value: 'IN_USE', label: 'Terpasang' },
  { value: 'IN_WAREHOUSE', label: 'Di Gudang' },
  { value: 'LOANED_OUT', label: 'Dipinjam Keluar' },
  { value: 'SCRAPPED', label: 'Afkir / Rusak Berat' },
];

export const INTERNAL_TIRE_SLOT_CODES = [
  '1L', '1R',
  '2L', '2R',
  '2LI', '2LO', '2RI', '2RO',
  '3L', '3R',
  '3LI', '3LO', '3RI', '3RO',
  '4L', '4R',
  '4LI', '4LO', '4RI', '4RO',
  '5L', '5R',
  '5LI', '5LO', '5RI', '5RO',
  '6L', '6R',
  '6LI', '6LO', '6RI', '6RO',
  '7L', '7R',
  '7LI', '7LO', '7RI', '7RO',
  '8L', '8R',
  '8LI', '8LO', '8RI', '8RO',
  'SP1', 'SP2', 'SP3', 'SP4', 'SP5',
] as const;

export type InternalTireSlotCode = string;

export const TIRE_AXLE_LAYOUT_OPTIONS: Array<{ value: TireAxleLayoutMode; label: string; description: string }> = [
  { value: 'NONE', label: 'Kosong', description: 'As ini tidak dipakai pada kategori ini.' },
  { value: 'SINGLE', label: 'Single', description: '1 ban kiri + 1 ban kanan.' },
  { value: 'DUAL', label: 'Ganda', description: 'Inner + outer kiri-kanan.' },
];

const LIGHT_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2L', '2R'];
const MEDIUM_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2LI', '2LO', '2RI', '2RO'];
const HEAVY_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2LI', '2LO', '2RI', '2RO', '3LI', '3LO', '3RI', '3RO'];
const DEFAULT_SPARE_SLOTS: InternalTireSlotCode[] = ['SP1'];
export const MAX_TIRE_SPARE_SLOTS = 12;

const LEGACY_TIRE_POSITION_SLOT_MAP: Record<string, InternalTireSlotCode> = {
  FRONT_LEFT: '1L',
  FRONT_RIGHT: '1R',
  REAR_LEFT: '2L',
  REAR_RIGHT: '2R',
  SPARE: 'SP1',
};

const LEGACY_TIRE_POSITION_LABEL_MAP: Record<string, string> = {
  FRONT_LEFT: 'Depan Kiri',
  FRONT_RIGHT: 'Depan Kanan',
  REAR_LEFT: 'Belakang Kiri',
  REAR_RIGHT: 'Belakang Kanan',
  SPARE: 'Serep',
};

export function formatTireSlotLabel(slotCode: string) {
  const normalized = slotCode.trim().toUpperCase();
  const spareMatch = normalized.match(/^SP(\d+)$/);
  if (spareMatch) {
    return `Serep ${spareMatch[1]}`;
  }

  const slotMatch = normalized.match(/^(\d+)(L|R)(I|O)?$/);
  if (!slotMatch) {
    return normalized;
  }

  const axle = Number(slotMatch[1]);
  const side = slotMatch[2] === 'L' ? 'Kiri' : 'Kanan';
  const depth = slotMatch[3] === 'I' ? 'Dalam' : slotMatch[3] === 'O' ? 'Luar' : '';

  if (axle === 1) {
    return depth ? `Depan ${side} ${depth}` : `Depan ${side}`;
  }

  return depth ? `As ${axle} ${side} ${depth}` : `As ${axle} ${side}`;
}

export function normalizeTireSlotCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function buildSpareSlotCodes(count: number) {
  return Array.from({ length: count }, (_, index) => `SP${index + 1}` as InternalTireSlotCode);
}

function parseInternalTireSlotCode(value: string) {
  const normalized = normalizeTireSlotCode(value);
  const spareMatch = normalized.match(/^SP(\d+)$/);
  if (spareMatch) {
    return {
      normalized,
      kind: 'spare' as const,
      spareIndex: Number(spareMatch[1]),
    };
  }

  const axleMatch = normalized.match(/^(\d+)(L|R)(I|O)?$/);
  if (!axleMatch) {
    return null;
  }

  return {
    normalized,
    kind: 'road' as const,
    axleNumber: Number(axleMatch[1]),
    side: axleMatch[2],
    depth: axleMatch[3] || '',
  };
}

export function compareTireSlotCodes(left: string, right: string) {
  const leftSlot = parseInternalTireSlotCode(left);
  const rightSlot = parseInternalTireSlotCode(right);

  if (!leftSlot && !rightSlot) {
    return normalizeTireSlotCode(left).localeCompare(normalizeTireSlotCode(right), 'id');
  }
  if (!leftSlot) return 1;
  if (!rightSlot) return -1;

  if (leftSlot.kind !== rightSlot.kind) {
    return leftSlot.kind === 'road' ? -1 : 1;
  }

  if (leftSlot.kind === 'spare' && rightSlot.kind === 'spare') {
    return leftSlot.spareIndex - rightSlot.spareIndex;
  }

  if (leftSlot.kind === 'road' && rightSlot.kind === 'road') {
    if (leftSlot.axleNumber !== rightSlot.axleNumber) {
      return leftSlot.axleNumber - rightSlot.axleNumber;
    }

    const sideOrder = { L: 0, R: 1 } as const;
    if (leftSlot.side !== rightSlot.side) {
      return sideOrder[leftSlot.side as keyof typeof sideOrder] - sideOrder[rightSlot.side as keyof typeof sideOrder];
    }

    const depthOrder = { '': 0, I: 1, O: 2 } as const;
    return depthOrder[leftSlot.depth as keyof typeof depthOrder] - depthOrder[rightSlot.depth as keyof typeof depthOrder];
  }

  return leftSlot.normalized.localeCompare(rightSlot.normalized, 'id');
}

export function isKnownInternalTireSlotCode(value: string) {
  return parseInternalTireSlotCode(value) !== null;
}

function pickBaseRoadLayout(vehicleType?: string, serviceName?: string): InternalTireSlotCode[] {
  const hint = `${vehicleType || ''} ${serviceName || ''}`.trim().toLowerCase();
  if (!hint) {
    return LIGHT_TIRE_LAYOUT;
  }
  if (hint.includes('trailer') || hint.includes('tronton')) {
    return HEAVY_TIRE_LAYOUT;
  }
  if (
    hint.includes('truck') ||
    hint.includes('fuso') ||
    hint.includes('wingbox') ||
    hint.includes('cdd')
  ) {
    return MEDIUM_TIRE_LAYOUT;
  }
  return LIGHT_TIRE_LAYOUT;
}

export function buildDefaultTireLayoutConfig(vehicleType?: string, serviceName?: string): TireLayoutConfig {
  const baseRoadLayout = pickBaseRoadLayout(vehicleType, serviceName);
  const maxAxleNumberFromBase = baseRoadLayout.reduce((max, slotCode) => {
    const match = slotCode.match(/^(\d+)/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  const initialAxleCount = Math.max(2, maxAxleNumberFromBase || 2);
  const axleLayouts = Array.from({ length: initialAxleCount }, (_, axleIndex) => {
    const axleNumber = axleIndex + 1;
    const hasDual = baseRoadLayout.some(slotCode => slotCode.startsWith(`${axleNumber}L`) && (slotCode.endsWith('I') || slotCode.endsWith('O')));
    const hasSingle = baseRoadLayout.some(slotCode => slotCode === `${axleNumber}L` || slotCode === `${axleNumber}R`);
    if (hasDual) return 'DUAL';
    if (hasSingle) return 'SINGLE';
    return 'NONE';
  });

  return {
    axleLayouts,
    spareCount: DEFAULT_SPARE_SLOTS.length,
  };
}

export function normalizeTireLayoutConfig(
  input: Partial<TireLayoutConfig> | null | undefined,
  fallback?: Partial<TireLayoutConfig> | null
): TireLayoutConfig {
  const fallbackConfig = fallback || {};
  const fallbackAxleLayouts = Array.isArray(fallbackConfig.axleLayouts) ? fallbackConfig.axleLayouts : undefined;
  const requestedLength = Array.isArray(input?.axleLayouts)
    ? input.axleLayouts.length
    : Array.isArray(fallbackAxleLayouts)
      ? fallbackAxleLayouts.length
      : 2;
  const axleCount = Math.max(2, requestedLength || 2);
  const baseAxleLayouts = Array.from({ length: axleCount }, (_, index) => {
    const candidate = Array.isArray(input?.axleLayouts) ? input?.axleLayouts[index] : undefined;
    const fallbackCandidate = fallbackAxleLayouts?.[index];
    if (candidate === 'SINGLE' || candidate === 'DUAL' || candidate === 'NONE') return candidate;
    if (fallbackCandidate === 'SINGLE' || fallbackCandidate === 'DUAL' || fallbackCandidate === 'NONE') return fallbackCandidate;
    return index === 0 ? 'SINGLE' : index === 1 ? 'SINGLE' : 'NONE';
  });
  const rawSpareCount = typeof input?.spareCount === 'number' ? input.spareCount : typeof fallbackConfig.spareCount === 'number' ? fallbackConfig.spareCount : 1;

  return {
    axleLayouts: baseAxleLayouts,
    spareCount: Math.max(0, Math.min(MAX_TIRE_SPARE_SLOTS, Math.round(rawSpareCount))),
  };
}

export function buildTireSlotCodesFromLayoutConfig(input: Partial<TireLayoutConfig> | null | undefined) {
  const config = normalizeTireLayoutConfig(input);
  const roadSlots = config.axleLayouts.flatMap((layout, index) => {
    const axle = String(index + 1);
    if (layout === 'DUAL') {
      return [`${axle}LI`, `${axle}LO`, `${axle}RI`, `${axle}RO`] as InternalTireSlotCode[];
    }
    if (layout === 'SINGLE') {
      return [`${axle}L`, `${axle}R`] as InternalTireSlotCode[];
    }
    return [];
  });
  const spareSlots = buildSpareSlotCodes(config.spareCount);

  return {
    roadSlots,
    spareSlots,
    allSlots: [...roadSlots, ...spareSlots],
  };
}

export function getSuggestedVehicleTireLayout(
  vehicleType?: string,
  serviceName?: string,
  existingSlotCodes: string[] = [],
  explicitLayoutConfig?: Partial<TireLayoutConfig> | null
) {
  const normalizedExisting = Array.from(
    new Set(
      existingSlotCodes
        .map(slotCode => normalizeTireSlotCode(slotCode))
        .filter(slotCode => isKnownInternalTireSlotCode(slotCode))
    )
  ).sort(compareTireSlotCodes);

  const baseLayoutConfig = explicitLayoutConfig
    ? normalizeTireLayoutConfig(explicitLayoutConfig, buildDefaultTireLayoutConfig(vehicleType, serviceName))
    : buildDefaultTireLayoutConfig(vehicleType, serviceName);
  const baseRoadSlots = buildTireSlotCodesFromLayoutConfig(baseLayoutConfig).roadSlots;
  const roadSlots = Array.from(
    new Set([
      ...baseRoadSlots,
      ...normalizedExisting.filter(slotCode => !slotCode.startsWith('SP')),
    ])
  ).sort(compareTireSlotCodes) as InternalTireSlotCode[];

  const spareSlots = Array.from(
    new Set([
      ...buildTireSlotCodesFromLayoutConfig(baseLayoutConfig).spareSlots,
      ...normalizedExisting.filter(slotCode => slotCode.startsWith('SP')),
    ])
  ).sort(compareTireSlotCodes) as InternalTireSlotCode[];

  return {
    roadSlots,
    spareSlots,
    allSlots: [...roadSlots, ...spareSlots],
  };
}

export function getLegacyTirePositionLabel(posisi?: string) {
  const normalized = posisi?.trim().toUpperCase() || '';
  return LEGACY_TIRE_POSITION_LABEL_MAP[normalized] || posisi?.trim() || '';
}

export function resolveTireSlotCode(input: { slotCode?: string; posisi?: string }) {
  const normalizedSlot = input.slotCode ? normalizeTireSlotCode(input.slotCode) : '';
  if (normalizedSlot && isKnownInternalTireSlotCode(normalizedSlot)) {
    return normalizedSlot;
  }
  const normalizedPosisi = input.posisi?.trim().toUpperCase() || '';
  return LEGACY_TIRE_POSITION_SLOT_MAP[normalizedPosisi];
}

export function resolveTireHolderType(input: {
  holderType?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  externalPartyName?: string;
  externalPlateNumber?: string;
}): TireHolderType {
  if (input.holderType === 'EXTERNAL_VEHICLE' || input.holderType === 'WAREHOUSE') {
    return input.holderType;
  }
  if (input.externalPartyName || input.externalPlateNumber) {
    return 'EXTERNAL_VEHICLE';
  }
  if (input.vehicleRef || input.vehiclePlate) {
    return 'INTERNAL_VEHICLE';
  }
  return 'WAREHOUSE';
}

export function resolveTireAssetStatus(input: {
  status?: string;
  holderType?: string;
  slotCode?: string;
  posisi?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  externalPartyName?: string;
  externalPlateNumber?: string;
}): TireAssetStatus {
  if (
    input.status === 'IN_WAREHOUSE' ||
    input.status === 'LOANED_OUT' ||
    input.status === 'SCRAPPED'
  ) {
    return input.status;
  }

  const holderType = resolveTireHolderType(input);
  if (holderType === 'EXTERNAL_VEHICLE') {
    return 'LOANED_OUT';
  }
  if (holderType === 'WAREHOUSE') {
    return 'IN_WAREHOUSE';
  }

  return 'IN_USE';
}

export function buildTirePlacementLabel(input: {
  holderType?: string;
  status?: string;
  vehiclePlate?: string;
  slotCode?: string;
  externalPartyName?: string;
  externalPlateNumber?: string;
}) {
  const slotLabel = input.slotCode ? formatTireSlotLabel(input.slotCode) : undefined;
  if (input.holderType === 'INTERNAL_VEHICLE') {
    return `${input.vehiclePlate || 'Kendaraan internal'} - ${slotLabel || 'Posisi tidak diketahui'}`;
  }
  if (input.holderType === 'EXTERNAL_VEHICLE') {
    const target = input.externalPartyName || input.externalPlateNumber || 'Pihak luar';
    return input.externalPlateNumber ? `${target} (${input.externalPlateNumber})` : target;
  }
  return 'Gudang / stok';
}

export function resolveTirePlacementLabel(input: {
  holderType?: string;
  status?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  slotCode?: string;
  posisi?: string;
  externalPartyName?: string;
  externalPlateNumber?: string;
}) {
  const holderType = resolveTireHolderType(input);
  const status = resolveTireAssetStatus(input);
  const slotCode = resolveTireSlotCode(input);

  if (holderType === 'INTERNAL_VEHICLE') {
    if (slotCode) {
      return buildTirePlacementLabel({
        holderType,
        status,
        vehiclePlate: input.vehiclePlate,
        slotCode,
      });
    }
    const legacyLabel = getLegacyTirePositionLabel(input.posisi);
    return input.vehiclePlate ? `${input.vehiclePlate} - ${legacyLabel || 'Posisi tidak diketahui'}` : legacyLabel || 'Posisi tidak diketahui';
  }

  if (holderType === 'EXTERNAL_VEHICLE') {
    return buildTirePlacementLabel({
      holderType,
      status,
      externalPartyName: input.externalPartyName,
      externalPlateNumber: input.externalPlateNumber,
    });
  }

  return input.posisi?.trim() || buildTirePlacementLabel({ holderType, status });
}
