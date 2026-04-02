import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PT Gading Mas Surya - Admin Panel",
  description: "Panel administrasi internal PT Gading Mas Surya",
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
