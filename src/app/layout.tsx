import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LOGISTIK - Admin Panel",
  description: "Panel administrasi internal perusahaan ekspedisi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
