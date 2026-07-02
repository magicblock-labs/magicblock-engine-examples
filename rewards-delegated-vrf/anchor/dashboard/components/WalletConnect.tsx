"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  {
    ssr: false,
    loading: () => <div className="h-10 w-40 bg-gray-700 rounded-lg" />,
  }
);

export function WalletConnect() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-10 w-40 bg-gray-700 rounded-lg" />;
  }

  return (
    <div className="flex justify-end">
      <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-700 !rounded-lg" />
    </div>
  );
}
