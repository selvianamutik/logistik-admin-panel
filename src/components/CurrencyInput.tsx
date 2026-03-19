"use client";

import type { InputHTMLAttributes } from "react";

const currencyInputFormatter = new Intl.NumberFormat("id-ID");

type CurrencyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number | null | undefined;
  onValueChange: (value: number) => void;
};

function normalizeCurrencyInput(rawValue: string) {
  return rawValue.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
}

export function formatCurrencyInputValue(value: number | null | undefined) {
  if (!value || value <= 0) return "";
  return currencyInputFormatter.format(Math.trunc(value));
}

export default function CurrencyInput({
  value,
  onValueChange,
  className,
  inputMode,
  autoComplete,
  ...props
}: CurrencyInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || "numeric"}
      autoComplete={autoComplete || "off"}
      className={["form-input", "currency-input", className]
        .filter(Boolean)
        .join(" ")}
      value={formatCurrencyInputValue(value)}
      onChange={(event) => {
        const digits = normalizeCurrencyInput(event.target.value);
        onValueChange(digits ? Number(digits) : 0);
      }}
    />
  );
}
