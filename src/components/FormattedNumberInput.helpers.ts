export type FormattedNumberParseOptions = {
  allowDecimal?: boolean;
  maxFractionDigits?: number;
};

export function buildFormattedNumberFormatter(maxFractionDigits: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

export function formatFormattedNumberValue(
  value: number | null | undefined,
  allowDecimal: boolean,
  maxFractionDigits: number,
  zeroAsEmpty: boolean,
) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (zeroAsEmpty && value === 0) return "";

  return buildFormattedNumberFormatter(allowDecimal ? 20 : maxFractionDigits).format(value);
}

function parseGroupedDigits(parts: string[]) {
  const [first = "", ...rest] = parts;
  const normalizedFirst = first.replace(/\D/g, "");
  const normalizedRest = rest.map(part => part.replace(/\D/g, ""));
  const hasThousandsGrouping =
    normalizedRest.length > 0 &&
    normalizedRest.every(part => part.length === 3);

  if (!hasThousandsGrouping) {
    return null;
  }

  const digits = [normalizedFirst, ...normalizedRest]
    .join("")
    .replace(/^0+(?=\d)/, "");
  return digits ? Number(digits) : 0;
}

function parseIntegerLikeInput(cleaned: string) {
  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const activeSeparator = commaCount > 0 ? "," : dotCount > 0 ? "." : null;

  if (!activeSeparator) {
    const digits = cleaned.replace(/\D/g, "");
    return digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
  }

  const parts = cleaned.split(activeSeparator);
  if (parts.length === 2) {
    const [left = "", right = ""] = parts;
    const integerPart = left.replace(/\D/g, "");
    const fractionPart = right.replace(/\D/g, "");

    if (fractionPart.length === 0) {
      return integerPart ? Number(integerPart.replace(/^0+(?=\d)/, "")) : 0;
    }

    if (fractionPart.length === 3 && integerPart.length > 0) {
      const grouped = parseGroupedDigits(parts);
      if (grouped !== null) {
        return grouped;
      }
    }

    return integerPart ? Number(integerPart.replace(/^0+(?=\d)/, "")) : 0;
  }

  const grouped = parseGroupedDigits(parts);
  if (grouped !== null) {
    return grouped;
  }

  const digits = cleaned.replace(/\D/g, "");
  return digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
}

function parseDecimalParts(integerPartRaw: string, fractionPartRaw: string) {
  const integerPart = integerPartRaw.replace(/\D/g, "");
  const fractionPart = fractionPartRaw.replace(/\D/g, "");

  if (!integerPart && !fractionPart) return 0;
  if (!fractionPart) {
    return integerPart ? Number(integerPart.replace(/^0+(?=\d)/, "")) : 0;
  }

  return Number(`${integerPart || "0"}.${fractionPart}`);
}

export function parseFormattedNumberInput(
  rawValue: string,
  allowDecimal: boolean,
  maxFractionDigits: number,
) {
  const isNegative = /^\s*-/.test(rawValue);
  const cleaned = rawValue.replace(/[^\d,.\s]/g, "").trim();
  if (!cleaned) return 0;

  const supportsFraction = allowDecimal && maxFractionDigits > 0;
  if (!supportsFraction) {
    const parsed = parseIntegerLikeInput(cleaned);
    return isNegative && parsed !== 0 ? -parsed : parsed;
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalIndex = Math.max(lastComma, lastDot);
    const parsed = parseDecimalParts(
      cleaned.slice(0, decimalIndex),
      cleaned.slice(decimalIndex + 1),
    );
    return isNegative && parsed !== 0 ? -parsed : parsed;
  }

  const activeSeparator = commaCount > 0 ? "," : dotCount > 0 ? "." : null;
  if (activeSeparator) {
    const parts = cleaned.split(activeSeparator);

    if (parts.length === 2) {
      const [left = "", right = ""] = parts;
      const integerPart = left.replace(/\D/g, "");
      const fractionPart = right.replace(/\D/g, "");

      if (fractionPart.length === 3 && integerPart.length > 0) {
        const grouped = parseGroupedDigits(parts);
        if (grouped !== null) {
          return isNegative && grouped !== 0 ? -grouped : grouped;
        }
      }

      if (fractionPart.length > 0) {
        const parsed = parseDecimalParts(left, right);
        return isNegative && parsed !== 0 ? -parsed : parsed;
      }

      const digits = integerPart;
      const parsed = digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
      return isNegative && parsed !== 0 ? -parsed : parsed;
    } else if (parts.length > 2) {
      const grouped = parseGroupedDigits(parts);
      if (grouped !== null) {
        return isNegative && grouped !== 0 ? -grouped : grouped;
      }

      const left = parts.slice(0, -1).join(activeSeparator);
      const right = parts.at(-1) || "";
      const fractionPart = right.replace(/\D/g, "");
      if (fractionPart.length > 0) {
        const parsed = parseDecimalParts(left, right);
        return isNegative && parsed !== 0 ? -parsed : parsed;
      }
    }
  }

  const digits = cleaned.replace(/\D/g, "");
  const parsed = digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
  return isNegative && parsed !== 0 ? -parsed : parsed;
}

export function parseFormattedNumberish(
  value: unknown,
  options: FormattedNumberParseOptions = {},
) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return parseFormattedNumberInput(
      value,
      options.allowDecimal ?? true,
      options.maxFractionDigits ?? 2,
    );
  }

  return Number(value);
}
