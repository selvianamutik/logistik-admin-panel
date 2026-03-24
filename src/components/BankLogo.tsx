import { getBankPreset } from '@/lib/bank-account-page-support';

export default function BankLogo({ name }: { name: string }) {
  const preset = getBankPreset(name);
  if (preset.logo) {
    return (
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "0.5rem",
          background: "#fff",
          border: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: 4,
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preset.logo}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: "0.5rem",
        background: preset.gradient,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {name.slice(0, 3).toUpperCase()}
    </div>
  );
}
