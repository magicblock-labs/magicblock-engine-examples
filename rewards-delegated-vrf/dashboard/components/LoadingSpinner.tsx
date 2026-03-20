"use client";

import React from "react";
import { Loader } from "lucide-react";

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader className="w-6 h-6 text-indigo-500 animate-spin" />
      <span className="ml-2 text-gray-400">Loading data...</span>
    </div>
  );
}
