export type TireHolderType = 'INTERNAL_VEHICLE' | 'EXTERNAL_VEHICLE' | 'WAREHOUSE';
export type TireAssetStatus = 'IN_USE' | 'SPARE' | 'IN_WAREHOUSE' | 'LOANED_OUT' | 'SCRAPPED';

export const TIRE_HOLDER_TYPE_OPTIONS: Array<{ value: TireHolderType; label: string }> = [
  { value: 'INTERNAL_VEHICLE', label: 'Kendaraan Internal' },
  { value: 'EXTERNAL_VEHICLE', label: 'Kendaraan / pihak luar' },
  { value: 'WAREHOUSE', label: 'Gudang / stok' },
];

export const TIRE_STATUS_OPTIONS: Array<{ value: TireAssetStatus; label: string }> = [
  { value: 'IN_USE', label: 'Terpasang' },
  { value: 'SPARE', label: 'Serep' },
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
  'SP1', 'SP2', 'SP3',
] as const;

export type InternalTireSlotCode = typeof INTERNAL_TIRE_SLOT_CODES[number];

const LIGHT_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2L', '2R'];
const MEDIUM_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2LI', '2LO', '2RI', '2RO'];
const HEAVY_TIRE_LAYOUT: InternalTireSlotCode[] = ['1L', '1R', '2LI', '2LO', '2RI', '2RO', '3LI', '3LO', '3RI', '3RO'];
const DEFAULT_SPARE_SLOTS: InternalTireSlotCode[] = ['SP1'];

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

export function compareTireSlotCodes(left: string, right: string) {
  const normalizedLeft = normalizeTireSlotCode(left);
  const normalizedRight = normalizeTireSlotCode(right);
  const leftIndex = INTERNAL_TIRE_SLOT_CODES.indexOf(normalizedLeft as InternalTireSlotCode);
  const rightIndex = INTERNAL_TIRE_SLOT_CODES.indexOf(normalizedRight as InternalTireSlotCode);
  if (leftIndex === -1 && rightIndex === -1) {
    return normalizedLeft.localeCompare(normalizedRight, 'id');
  }
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return leftIndex - rightIndex;
}

export function isKnownInternalTireSlotCode(value: string) {
  return INTERNAL_TIRE_SLOT_CODES.includes(value as InternalTireSlotCode);
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

export function getSuggestedVehicleTireLayout(
  vehicleType?: string,
  serviceName?: string,
  existingSlotCodes: string[] = []
) {
  const normalizedExisting = Array.from(
    new Set(
      existingSlotCodes
        .map(slotCode => normalizeTireSlotCode(slotCode))
        .filter(slotCode => isKnownInternalTireSlotCode(slotCode))
    )
  ).sort(compareTireSlotCodes);

  const baseRoadSlots = pickBaseRoadLayout(vehicleType, serviceName);
  const roadSlots = Array.from(
    new Set([
      ...baseRoadSlots,
      ...normalizedExisting.filter(slotCode => !slotCode.startsWith('SP')),
    ])
  ).sort(compareTireSlotCodes) as InternalTireSlotCode[];

  const spareSlots = Array.from(
    new Set([
      ...DEFAULT_SPARE_SLOTS,
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
    input.status === 'SPARE' ||
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

  const slotCode = resolveTireSlotCode(input);
  if (slotCode?.startsWith('SP')) {
    return 'SPARE';
  }

  const normalizedPosisi = input.posisi?.trim().toUpperCase() || '';
  if (normalizedPosisi === 'SPARE') {
    return 'SPARE';
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
    if (input.status === 'SPARE') {
      return `${input.vehiclePlate || 'Kendaraan internal'} - ${slotLabel || 'Serep'}`;
    }
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
