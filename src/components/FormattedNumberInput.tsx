"use client";

import type { InputHTMLAttributes } from "react";
import {
  formatFormattedNumberValue,
  parseFormattedNumberInput,
} from "@/lib/formatted-number";

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

export { formatFormattedNumberValue, parseFormattedNumberInput };

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
