export type WeightInputUnit = 'KG' | 'TON';
export type VolumeInputUnit = 'M3' | 'LITER' | 'KL';

export const WEIGHT_INPUT_UNIT_OPTIONS: Array<{ value: WeightInputUnit; label: string }> = [
  { value: 'KG', label: 'Kg' },
  { value: 'TON', label: 'Ton' },
];

export const VOLUME_INPUT_UNIT_OPTIONS: Array<{ value: VolumeInputUnit; label: string }> = [
  { value: 'M3', label: 'm3' },
  { value: 'LITER', label: 'Liter' },
  { value: 'KL', label: 'KL' },
];

function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

export function convertWeightToKg(value: number, unit: WeightInputUnit) {
  return unit === 'TON' ? value * 1000 : value;
}

export function convertVolumeToM3(value: number, unit: VolumeInputUnit) {
  if (unit === 'LITER') {
    return value / 1000;
  }
  return value;
}

export function formatWeightDisplay(input: {
  weightKg?: number;
  weightInputValue?: number;
  weightInputUnit?: WeightInputUnit;
  includeCanonical?: boolean;
}) {
  const weightKg = Number(input.weightKg || 0);
  const inputValue = Number(input.weightInputValue || 0);
  const unit = input.weightInputUnit || 'KG';

  if (inputValue > 0) {
    const inputLabel = `${formatNumber(inputValue)} ${unit === 'TON' ? 'ton' : 'kg'}`;
    if (input.includeCanonical && unit === 'TON') {
      return `${inputLabel} (${formatNumber(weightKg)} kg)`;
    }
    return inputLabel;
  }

  if (weightKg <= 0) {
    return '-';
  }

  return `${formatNumber(weightKg)} kg`;
}

export function formatVolumeDisplay(input: {
  volumeM3?: number;
  volumeInputValue?: number;
  volumeInputUnit?: VolumeInputUnit;
  includeCanonical?: boolean;
}) {
  const volumeM3 = Number(input.volumeM3 || 0);
  const inputValue = Number(input.volumeInputValue || 0);
  const unit = input.volumeInputUnit || 'M3';

  if (inputValue > 0) {
    const unitLabel = unit === 'M3' ? 'm3' : unit === 'KL' ? 'KL' : 'liter';
    const inputLabel = `${formatNumber(inputValue)} ${unitLabel}`;
    if (input.includeCanonical && unit !== 'M3') {
      return `${inputLabel} (${formatNumber(volumeM3)} m3)`;
    }
    return inputLabel;
  }

  if (volumeM3 <= 0) {
    return '-';
  }

  return `${formatNumber(volumeM3)} m3`;
}

export function formatCargoSummary(input: {
  qtyKoli?: number;
  weightKg?: number;
  weightInputValue?: number;
  weightInputUnit?: WeightInputUnit;
  volumeM3?: number;
  volumeInputValue?: number;
  volumeInputUnit?: VolumeInputUnit;
}) {
  const segments: string[] = [];
  const qtyKoli = Number(input.qtyKoli || 0);
  if (qtyKoli > 0) {
    segments.push(`${formatNumber(qtyKoli)} koli`);
  }

  const weightLabel = formatWeightDisplay({
    weightKg: input.weightKg,
    weightInputValue: input.weightInputValue,
    weightInputUnit: input.weightInputUnit,
    includeCanonical: true,
  });
  if (weightLabel !== '-') {
    segments.push(weightLabel);
  }

  const volumeLabel = formatVolumeDisplay({
    volumeM3: input.volumeM3,
    volumeInputValue: input.volumeInputValue,
    volumeInputUnit: input.volumeInputUnit,
    includeCanonical: true,
  });
  if (volumeLabel !== '-') {
    segments.push(volumeLabel);
  }

  return segments.length > 0 ? segments.join(' / ') : '-';
}
