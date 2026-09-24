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
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-[38px] items-center gap-2 border border-edge px-3.5 font-sans text-sm text-ink hover:border-verdict"
      >
        <i className="ph ph-download-simple" />
        Install MetaMask
        <i className="ph ph-arrow-up-right text-muted" />
      </a>
    );
  }

  if (!isConnected) {
    return (
      <button className="btn-primary min-h-[38px] px-3.5" onClick={connect} disabled={connecting}>
        {connecting ? (
          <>
            <i className="ph ph-circle-notch animate-spin" />
            Check MetaMask…
          </>
        ) : (
          <>
            <i className="ph ph-wallet" />
            Connect wallet
          </>
        )}
      </button>
    );
  }

  if (wrongNetwork) {
    return (
      <button
        className="hazard-soft inline-flex min-h-[38px] items-center gap-2 px-3.5 font-sans text-sm font-medium text-ground"
        onClick={switchNetwork}
      >
        <i className="ph-bold ph-warning" />
        Switch to {chain.name}
      </button>
    );
  }

  return (
    <button
      className="inline-flex min-h-[38px] items-center gap-2.5 border border-rule px-3 font-mono text-[13px] text-ink hover:border-edge"
      onClick={disconnect}
      title="Click to disconnect"
    >
      {/* barcode-like address glyph */}
      <span
        aria-hidden
        className="h-[18px] w-[18px]"
        style={{ background: "repeating-linear-gradient(90deg,#FFFFFF 0 3px,#4D4D4D 3px 6px)" }}
      />
      {shortAddr(address!)}
      <i className="ph ph-caret-down text-muted" />
    </button>
  );
}
