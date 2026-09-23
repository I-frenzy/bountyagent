"use client";

import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { shortAddr } from "@/lib/format";

export function ConnectButton() {
  const { address, isConnected, connect, disconnect, connecting, hasWallet, wrongNetwork, switchNetwork } =
    useWallet();
  const { chain } = useNetwork();

  if (!hasWallet) {
    return (
      <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="btn-ghost">
        Install wallet
      </a>
    );
  }

  if (!isConnected) {
    return (
      <button className="btn-primary" onClick={connect} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (wrongNetwork) {
    return (
      <button className="btn bg-pending/15 border border-pending/40 text-pending" onClick={switchNetwork}>
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <button
      className="btn-ghost group"
      onClick={disconnect}
      title="Click to disconnect"
    >
      <span className="h-2 w-2 rounded-full bg-settle" />
      <span className="mono">{shortAddr(address!)}</span>
    </button>
  );
}
