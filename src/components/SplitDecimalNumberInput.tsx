"use client";

import { useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import FormattedNumberInput from "./FormattedNumberInput";

type SplitDecimalNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  value: number | string | null | undefined;
  onValueChange: (value: number | string) => void;
  maxFractionDigits: number;
};

function splitNumber(value: number | string | null | undefined, maxFractionDigits: number) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const decimalMatch = trimmed.match(/^(\d*)[,.](\d*)$/);
    if (decimalMatch) {
      return {
        integerValue: Number(decimalMatch[1] || 0),
        fractionText: maxFractionDigits > 0 ? decimalMatch[2] : "",
      };
    }

    const integerDigits = trimmed.replace(/\D/g, "");
    return {
      integerValue: integerDigits ? Number(integerDigits) : 0,
      fractionText: "",
    };
  }

  const numeric = Number.isFinite(value) && value ? Math.abs(value) : 0;
  const integerValue = Math.floor(numeric);
  const formatted = new Intl.NumberFormat("en-US", {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(numeric);
  const fractionText = maxFractionDigits > 0 ? (formatted.split(".")[1] || "") : "";

  return { integerValue, fractionText };
}

function composeNumber(integerValue: number, fractionText: string) {
  const integerPart = Number.isFinite(integerValue) && integerValue > 0 ? Math.floor(integerValue) : 0;
  const fractionPart = fractionText ? Number(`0.${fractionText}`) : 0;
  return integerPart + fractionPart;
}

function composeRawValue(integerValue: number, fractionText: string) {
  const integerPart = Number.isFinite(integerValue) && integerValue > 0 ? String(Math.floor(integerValue)) : "0";
  return fractionText ? `${integerPart},${fractionText}` : integerPart;
}

const integerFormatter = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});

export default function SplitDecimalNumberInput({
  value,
  onValueChange,
  maxFractionDigits,
  disabled,
  className,
  ...props
}: SplitDecimalNumberInputProps) {
  const supportsFraction = maxFractionDigits > 0;
  const { integerValue, fractionText } = useMemo(
    () => splitNumber(value, maxFractionDigits),
    [value, maxFractionDigits],
  );
  const [fractionDraft, setFractionDraft] = useState(fractionText);
  const [fractionFocused, setFractionFocused] = useState(false);
  const [lastEmittedValue, setLastEmittedValue] = useState<number | null>(null);
  const [lastEmittedFraction, setLastEmittedFraction] = useState("");
  const fractionInputRef = useRef<HTMLInputElement>(null);
  const valueMatchesLastEmit =
    lastEmittedValue !== null &&
    typeof value === "number" &&
    Math.abs(value - lastEmittedValue) < 1e-12;
  const displayedFraction = fractionFocused
    ? fractionDraft
    : valueMatchesLastEmit
      ? lastEmittedFraction
      : fractionText;

  function emitValue(nextInteger: number, nextFraction: string) {
    const nextValue = composeNumber(nextInteger, nextFraction);
    setLastEmittedValue(nextValue);
    setLastEmittedFraction(nextFraction);
    onValueChange(composeRawValue(nextInteger, nextFraction));
  }

  function focusFractionInput(nextFraction = displayedFraction) {
    setFractionDraft(nextFraction);
    setFractionFocused(true);
    requestAnimationFrame(() => {
      fractionInputRef.current?.focus();
      const cursor = nextFraction.length;
      fractionInputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  if (!supportsFraction) {
    return (
      <FormattedNumberInput
        {...props}
        allowDecimal={false}
        value={integerValue}
        onValueChange={value => onValueChange(value)}
        disabled={disabled}
        className={className}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 0.75rem minmax(3rem, 4.5rem)",
        alignItems: "center",
        gap: "0.35rem",
      }}
    >
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete={props.autoComplete || "off"}
        className="form-input currency-input"
        value={integerValue > 0 ? integerFormatter.format(integerValue) : ""}
        onChange={event => {
          const nextInteger = Number(event.target.value.replace(/\D/g, "") || 0);
          emitValue(nextInteger, displayedFraction);
        }}
        onKeyDown={event => {
          props.onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "," && event.key !== ".") {
            return;
          }
          event.preventDefault();
          focusFractionInput();
        }}
        onPaste={event => {
          props.onPaste?.(event);
          if (event.defaultPrevented) {
            return;
          }
          const pasted = event.clipboardData.getData("text").trim();
          const decimalPaste = pasted.match(/^(\d*)[,.](\d+)$/);
          if (!decimalPaste) {
            return;
          }
          event.preventDefault();
          const nextInteger = Number((decimalPaste[1] || "").replace(/\D/g, "") || integerValue || 0);
          const nextFraction = decimalPaste[2].replace(/\D/g, "");
          setFractionDraft(nextFraction);
          emitValue(nextInteger, nextFraction);
          focusFractionInput(nextFraction);
        }}
        disabled={disabled}
      />
      <span style={{ textAlign: "center", color: "var(--color-gray-500)", fontWeight: 600 }}>,</span>
      <input
        type="text"
        ref={fractionInputRef}
        inputMode="numeric"
        autoComplete="off"
        className="form-input"
        value={displayedFraction}
        onFocus={() => {
          setFractionDraft(fractionText);
          setFractionFocused(true);
        }}
        onBlur={() => setFractionFocused(false)}
        onChange={event => {
          const nextFraction = event.target.value.replace(/\D/g, "");
          setFractionDraft(nextFraction);
          emitValue(integerValue, nextFraction);
        }}
        disabled={disabled}
        placeholder="0"
        aria-label="Digit koma"
        style={{ textAlign: "center" }}
      />
    </div>
  );
}
