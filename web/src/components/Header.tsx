"use client";

import { Logo } from "./Logo";
import { ConnectButton } from "./ConnectButton";
import { NetworkToggle } from "./NetworkToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-void/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3.5">
        <Logo />
        <div className="flex items-center gap-2.5">
          <NetworkToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
