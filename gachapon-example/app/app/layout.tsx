import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gachapon Tester",
  description: "Three.js animation tester for the gachapon example",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
