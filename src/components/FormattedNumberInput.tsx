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

function formatFormattedNumberValue(
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

function parseFormattedNumberInput(
  rawValue: string,
  allowDecimal: boolean,
  maxFractionDigits: number,
) {
  const cleaned = rawValue.replace(/[^\d,.\s]/g, "").trim();
  if (!cleaned) return 0;

  if (!allowDecimal) {
    const digits = cleaned.replace(/\D/g, "");
    return digits ? Number(digits.replace(/^0+(?=\d)/, "")) : 0;
  }

  if (cleaned.includes(",")) {
    const lastComma = cleaned.lastIndexOf(",");
    const integerPart = cleaned.slice(0, lastComma).replace(/\D/g, "");
    const fractionPart = cleaned
      .slice(lastComma + 1)
      .replace(/\D/g, "")
      .slice(0, maxFractionDigits);
    if (!integerPart && !fractionPart) return 0;
    return Number(`${integerPart || "0"}.${fractionPart}`);
  }

  const dotCount = (cleaned.match(/\./g) || []).length;
  if (dotCount === 1) {
    const [left = "", right = ""] = cleaned.split(".");
    const integerPart = left.replace(/\D/g, "");
    const fractionPart = right.replace(/\D/g, "");
    const treatAsThousands = fractionPart.length === 3 && integerPart.length > 0;
    const treatAsDecimal =
      !treatAsThousands &&
      fractionPart.length > 0 &&
      fractionPart.length <= maxFractionDigits;

    if (treatAsDecimal) {
      return Number(`${integerPart || "0"}.${fractionPart}`);
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
  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || (allowDecimal ? "decimal" : "numeric")}
      autoComplete={autoComplete || "off"}
      className={["form-input", "currency-input", className]
        .filter(Boolean)
        .join(" ")}
      value={formatFormattedNumberValue(
        value,
        allowDecimal,
        maxFractionDigits,
        zeroAsEmpty,
      )}
      onChange={(event) => {
        onValueChange(
          parseFormattedNumberInput(
            event.target.value,
            allowDecimal,
            maxFractionDigits,
          ),
        );
      }}
    />
  );
}
