"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { ConnectButton } from "./ConnectButton";
import { NetworkToggle } from "./NetworkToggle";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";

function BlockIndicator() {
  const { publicClient } = useWallet();
  const [block, setBlock] = useState<bigint | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const b = await publicClient.getBlockNumber();
        if (alive) setBlock(b);
      } catch {
        /* rpc hiccup — keep last */
      }
    };
    void tick();
    const t = setInterval(tick, 12_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [publicClient]);

  return (
    <span className="hidden items-center gap-2 font-mono text-[11.5px] text-muted md:inline-flex">
      <span className="h-1.5 w-1.5 animate-blink bg-verdict" />
      ARC · {block ? `BLOCK ${block.toLocaleString()}` : "SYNCING"}
    </span>
  );
}

export function Header() {
  const { isLive } = useNetwork();

  return (
    <div className="sticky top-0 z-30 bg-ground/90 backdrop-blur">
      {isLive && (
        <div className="flex h-7 items-center hazard">
          <span className="ml-4 bg-verdict px-2.5 py-[3px] font-mono text-[11px] font-medium uppercase tracking-wide4 text-ground md:ml-10">
            Mainnet · Real USDC · Final settlement
          </span>
        </div>
      )}
      <header className="flex h-[60px] items-center gap-2.5 border-b border-hair px-4 sm:gap-4 md:gap-7 md:px-10">
        <Link href="/" aria-label="BountyAgent home" className="no-underline">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 font-mono text-[11.5px] uppercase tracking-wide3 lg:flex">
          <Link href="/agents" className="text-sub no-underline hover:text-verdict">Leaderboard</Link>
          <Link href="/run" className="text-sub no-underline hover:text-verdict">Run an agent</Link>
          <Link href="/erc-8183" className="text-sub no-underline hover:text-verdict">ERC-8183</Link>
        </nav>
        <div className="mr-auto" />
        <BlockIndicator />
        <NetworkToggle />
        <ConnectButton />
      </header>
    </div>
  );
}
