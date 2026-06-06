import { getBankPreset } from '@/lib/bank-account-page-support';

export default function BankLogo({ name, size = 40 }: { name: string; size?: number }) {
  const preset = getBankPreset(name);
  const initials = (name || preset.label || "Bank").trim().slice(0, 3).toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "0.5rem",
        background: preset.gradient,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: Math.max(12, size * 0.32),
        flexShrink: 0,
        boxShadow: `0 2px 8px ${preset.color}30`,
      }}
      aria-label={name}
      title={name}
    >
      {initials}
    </div>
  );
}
