"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
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
  const formattedValue = formatFormattedNumberValue(
    value,
    supportsFraction,
    maxFractionDigits,
    zeroAsEmpty,
  );
  const [draftValue, setDraftValue] = useState(formattedValue);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(formattedValue);
    }
  }, [formattedValue, isFocused]);

  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || (supportsFraction ? "decimal" : "numeric")}
      autoComplete={autoComplete || "off"}
      className={["form-input", "currency-input", className]
        .filter(Boolean)
        .join(" ")}
      value={isFocused ? draftValue : formattedValue}
      onFocus={(event) => {
        setIsFocused(true);
        setDraftValue(event.target.value || formattedValue);
        props.onFocus?.(event);
      }}
      onChange={(event) => {
        setDraftValue(event.target.value);
        onValueChange(
          parseFormattedNumberInput(
            event.target.value,
            supportsFraction,
            maxFractionDigits,
          ),
        );
      }}
      onBlur={(event) => {
        setIsFocused(false);
        setDraftValue(
          formatFormattedNumberValue(
            parseFormattedNumberInput(
              event.target.value,
              supportsFraction,
              maxFractionDigits,
            ),
            supportsFraction,
            maxFractionDigits,
            zeroAsEmpty,
          ),
        );
        props.onBlur?.(event);
      }}
    />
  );
}
