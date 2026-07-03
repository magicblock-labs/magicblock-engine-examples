import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magic Gachapon",
  description: "MagicBlock VRF demo for minting Metaplex NFTs",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "64x64" }],
  },
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
