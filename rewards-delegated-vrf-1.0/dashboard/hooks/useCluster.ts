"use client";

import { useContext, createContext } from "react";

export interface ClusterContextType {
  endpoint: string;
  clusterName: string;
}

export const ClusterContext = createContext<ClusterContextType | null>(null);

export const useCluster = (): ClusterContextType => {
  const context = useContext(ClusterContext);
  if (!context) {
    throw new Error("useCluster must be used within a ClusterProvider");
  }
  return context;
};
