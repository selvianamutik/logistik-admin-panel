"use client";

import type { InputHTMLAttributes } from "react";

type FormattedNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
  allowDecimal?: boolean;
  maxFractionDigits?: number;
  zeroAsEmpty?: boolean;
};

export function formatFormattedNumberValue(
  value: number | null | undefined,
  allowDecimal: boolean,
  maxFractionDigits: number,
  zeroAsEmpty: boolean,
) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (zeroAsEmpty && value === 0) return "";

  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: allowDecimal ? maxFractionDigits : 0,
  }).format(value);
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

  const digits = [normalizedFirst, ...normalizedRest].join("").replace(/^0+(?=\d)/, "");
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

function parseDecimalParts(
  integerPartRaw: string,
  fractionPartRaw: string,
  maxFractionDigits: number,
) {
  const integerPart = integerPartRaw.replace(/\D/g, "");
  const fractionPart = fractionPartRaw.replace(/\D/g, "").slice(0, maxFractionDigits);
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
  const cleaned = rawValue.replace(/[^\d,.\s]/g, "").trim();
  if (!cleaned) return 0;

  const supportsFraction = allowDecimal && maxFractionDigits > 0;
  if (!supportsFraction) {
    return parseIntegerLikeInput(cleaned);
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalIndex = Math.max(lastComma, lastDot);
    return parseDecimalParts(
      cleaned.slice(0, decimalIndex),
      cleaned.slice(decimalIndex + 1),
      maxFractionDigits,
    );
  }

  const activeSeparator = commaCount > 0 ? "," : dotCount > 0 ? "." : null;
  if (activeSeparator) {
    const parts = cleaned.split(activeSeparator);

    if (parts.length === 2) {
      const [left = "", right = ""] = parts;
      const fractionPart = right.replace(/\D/g, "");
      if (fractionPart.length > 0 && fractionPart.length <= maxFractionDigits) {
        return parseDecimalParts(left, right, maxFractionDigits);
      }
      if (fractionPart.length === 0) {
        const digits = left.replace(/\D/g, "");
        return digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
      }
      const grouped = parseGroupedDigits(parts);
      if (grouped !== null) {
        return grouped;
      }
    } else if (parts.length > 2) {
      const grouped = parseGroupedDigits(parts);
      if (grouped !== null) {
        return grouped;
      }
      const left = parts.slice(0, -1).join(activeSeparator);
      const right = parts.at(-1) || "";
      const fractionPart = right.replace(/\D/g, "");
      if (fractionPart.length > 0 && fractionPart.length <= maxFractionDigits) {
        return parseDecimalParts(left, right, maxFractionDigits);
      }
    }
  }

  const digits = cleaned.replace(/\D/g, "");
  return digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
}

export default function FormattedNumberInput({
  value,
  onValueChange,
  className,
  inputMode,
  autoComplete,
  allowDecimal = true,
  maxFractionDigits = 2,
  zeroAsEmpty = true,
  ...props
}: FormattedNumberInputProps) {
  const supportsFraction = allowDecimal && maxFractionDigits > 0;

  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || (supportsFraction ? "decimal" : "numeric")}
      autoComplete={autoComplete || "off"}
      className={["form-input", "currency-input", className]
        .filter(Boolean)
        .join(" ")}
      value={formatFormattedNumberValue(
        value,
        supportsFraction,
        maxFractionDigits,
        zeroAsEmpty,
      )}
      onChange={(event) => {
        onValueChange(
          parseFormattedNumberInput(
            event.target.value,
            supportsFraction,
            maxFractionDigits,
          ),
        );
      }}
    />
  );
}
