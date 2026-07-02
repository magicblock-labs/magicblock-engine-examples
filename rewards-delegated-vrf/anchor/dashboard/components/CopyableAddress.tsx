"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyableAddressProps {
  address: string;
  displayLength?: number; // If set, truncates display only (full address always in tooltip/copy)
  className?: string;
  showIcon?: boolean;
}

export const CopyableAddress: React.FC<CopyableAddressProps> = ({
  address,
  displayLength,
  className = "text-blue-200 text-xs font-mono cursor-pointer hover:text-blue-100",
  showIcon = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayAddress = displayLength && address.length > displayLength
    ? `${address.slice(0, displayLength)}...`
    : address;

  return (
    <div
      className={`${className} flex items-center gap-2 group`}
      title={address}
      onClick={handleCopy}
    >
      <span className="break-all">{displayAddress}</span>
      {showIcon && (
        <span className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </span>
      )}
    </div>
  );
};
