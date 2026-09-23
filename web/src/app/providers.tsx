"use client";

import type { ReactNode } from "react";
import { NetworkProvider } from "@/lib/network";
import { WalletProvider } from "@/lib/wallet";
import { ToastProvider } from "@/lib/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NetworkProvider>
      <WalletProvider>
        <ToastProvider>{children}</ToastProvider>
      </WalletProvider>
    </NetworkProvider>
  );
}
