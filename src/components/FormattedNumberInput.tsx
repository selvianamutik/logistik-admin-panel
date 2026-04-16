"use client";

import { useRef, useState, type InputHTMLAttributes } from "react";

// ─── Formatter helpers ────────────────────────────────────────────────────────

function buildFormatter(maxFractionDigits: number) {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

export function formatFormattedNumberValue(
  value: number | null | undefined,
  supportsFraction: boolean,
  maxFractionDigits: number,
  zeroAsEmpty: boolean,
): string {
  if (value == null || (zeroAsEmpty && value === 0)) return "";
  const formatter = buildFormatter(supportsFraction ? maxFractionDigits : 0);
  return formatter.format(value);
}

export function parseFormattedNumberInput(
  raw: string,
  supportsFraction: boolean,
  maxFractionDigits: number,
): number {
  let normalized = raw.replace(/\./g, "");
  if (supportsFraction) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(",", "");
  }
  const parsed = parseFloat(normalized);
  if (isNaN(parsed)) return 0;
  const factor = Math.pow(10, maxFractionDigits);
  return supportsFraction
    ? Math.round(parsed * factor) / factor
    : Math.trunc(parsed);
}

// ─── Component ────────────────────────────────────────────────────────────────

type FormattedNumberInputProps = Omit <
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
      // Only digits and dots (thousands separator)
      return raw.replace(/[^\d.]/g, "");
    }
    // Only digits, dots (thousands sep), and ONE comma (decimal sep)
    const firstComma = raw.indexOf(",");
    if (firstComma === -1) return raw.replace(/[^\d.]/g, "");
    const beforeComma = raw.slice(0, firstComma).replace(/[^\d.]/g, "");
    // After comma: only digits, max maxFractionDigits
    const afterComma = raw
      .slice(firstComma + 1)
      .replace(/[^\d]/g, "")
      .slice(0, maxFractionDigits);
    return `${beforeComma},${afterComma}`;
  }

  function formatLive(raw: string): string {
    if (raw === "" || raw === ",") return raw;

    const sanitized = sanitizeRaw(raw);
    const commaIndex = sanitized.indexOf(",");
    const hasComma = commaIndex !== -1;
    const integerStr = hasComma
      ? sanitized.slice(0, commaIndex)
      : sanitized.replace(/\./g, ""); // strip existing thousand dots before reformatting
    const decimalStr = hasComma ? sanitized.slice(commaIndex + 1) : null;

    // Format integer part with thousand separators
    const intNum = parseInt(integerStr.replace(/\./g, "") || "0", 10);
    const formattedInt = isNaN(intNum)
      ? "0"
      : buildFormatter(0).format(intNum);

    if (!hasComma) return intNum === 0 && integerStr === "" ? "" : formattedInt;

    // Preserve the decimal part exactly as typed (trailing zeros, incomplete input)
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
        setIsFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        // On blur: fully normalize (drop trailing comma, trailing zeros, etc.)
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

        // Count meaningful chars (digits + comma) before cursor to restore position
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
