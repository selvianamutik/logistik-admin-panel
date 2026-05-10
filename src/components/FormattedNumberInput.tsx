"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";
import {
  buildFormattedNumberFormatter,
  formatFormattedNumberValue,
  parseFormattedNumberInput,
} from "./FormattedNumberInput.helpers";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const valueAsDisplay = formatFormattedNumberValue(
    value,
    supportsFraction,
    maxFractionDigits,
    zeroAsEmpty,
  );

  const [display, setDisplay] = useState(valueAsDisplay);
  const inputDisplay = isFocused ? display : valueAsDisplay;

  function sanitizeRaw(raw: string): string {
    if (!supportsFraction) {
      return raw.replace(/[^\d.]/g, "");
    }

    const firstComma = raw.indexOf(",");
    if (firstComma === -1) return raw.replace(/[^\d.]/g, "");
    const beforeComma = raw.slice(0, firstComma).replace(/[^\d.]/g, "");
    const afterComma = raw.slice(firstComma + 1).replace(/[^\d]/g, "");
    return `${beforeComma},${afterComma}`;
  }

  function formatLive(raw: string): string {
    if (raw === "" || raw === ",") return raw;

    if (supportsFraction && !raw.includes(",") && (raw.match(/\./g) || []).length === 1) {
      const [rawInteger = "", rawFraction = ""] = raw.split(".");
      const fraction = rawFraction.replace(/\D/g, "");
      if (fraction.length > 0 && fraction.length < 3) {
        const integerDigits = rawInteger.replace(/\D/g, "");
        const intNum = parseInt(integerDigits || "0", 10);
        const formattedInt = isNaN(intNum)
          ? "0"
          : buildFormattedNumberFormatter(0).format(intNum);
        return `${formattedInt},${fraction}`;
      }
    }

    const sanitized = sanitizeRaw(raw);
    const commaIndex = sanitized.indexOf(",");
    const hasComma = commaIndex !== -1;
    const integerStr = hasComma
      ? sanitized.slice(0, commaIndex)
      : sanitized.replace(/\./g, "");
    const decimalStr = hasComma ? sanitized.slice(commaIndex + 1) : null;

    const intNum = parseInt(integerStr.replace(/\./g, "") || "0", 10);
    const formattedInt = isNaN(intNum)
      ? "0"
      : buildFormattedNumberFormatter(0).format(intNum);

    if (!hasComma) return intNum === 0 && integerStr === "" ? "" : formattedInt;

    return `${formattedInt},${decimalStr}`;
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode={inputMode || (supportsFraction ? "decimal" : "numeric")}
      autoComplete={autoComplete || "off"}
      className={["form-input", "currency-input", className]
        .filter(Boolean)
        .join(" ")}
      value={inputDisplay}
      onFocus={(event) => {
        setDisplay(event.currentTarget.value || valueAsDisplay);
        setIsFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        const normalized = formatFormattedNumberValue(
          parseFormattedNumberInput(display, supportsFraction, maxFractionDigits),
          supportsFraction,
          maxFractionDigits,
          zeroAsEmpty,
        );
        setDisplay(normalized);
        props.onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        const cursorPos = event.target.selectionStart ?? raw.length;

        const sigBeforeCursor = raw
          .slice(0, cursorPos)
          .replace(/[^\d,]/g, "").length;

        const formatted = formatLive(raw);
        setDisplay(formatted);

        const parsed = parseFormattedNumberInput(
          formatted,
          supportsFraction,
          maxFractionDigits,
        );
        onValueChange(parsed);

        requestAnimationFrame(() => {
          if (!inputRef.current) return;
          let count = 0;
          let newCursor = formatted.length;
          for (let i = 0; i < formatted.length; i++) {
            if (/[\d,]/.test(formatted[i])) count++;
            if (count === sigBeforeCursor) {
              newCursor = i + 1;
              break;
            }
          }
          inputRef.current.setSelectionRange(newCursor, newCursor);
        });
      }}
    />
  );
}
