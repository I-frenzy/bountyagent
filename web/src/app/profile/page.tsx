"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseEventLogs } from "viem";
import { Header } from "@/components/Header";
import { ProfileCard } from "@/components/ProfileCard";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useToast } from "@/lib/toast";
import { bountyEngineAbi } from "@/lib/bountyAbi";
import { identityAbi } from "@/lib/erc8004Abi";
import { invalidateProfiles, useProfile } from "@/lib/useProfile";
import {
  LIMITS,
  normalizeFarcaster,
  normalizeGithub,
  normalizeWeb,
  normalizeX,
  toDataUri,
  type Profile,
  type ProfileKind,
} from "@/lib/profile";

type Step = "idle" | "register" | "link" | "update";

export default function ProfilePage() {
  const { address, isConnected, wrongNetwork, walletClient, publicClient, disconnect } = useWallet();
  const { contract, erc8004, hasProfiles, isContractConfigured, addressUrl, chain } = useNetwork();
  const { push } = useToast();
  const { data, loading } = useProfile(address);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [kind, setKind] = useState<ProfileKind>("person");
  const [web, setWeb] = useState("");
  const [x, setX] = useState("");
  const [github, setGithub] = useState("");
  const [farcaster, setFarcaster] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Fill the form once with the saved profile.
  useEffect(() => {
    if (!address || loading || loadedFor === address) return;
    const p = data?.profile;
    setName(p?.name ?? "");
    setBio(p?.bio ?? "");
    setKind(p?.kind ?? "person");
    setWeb(p?.links.web ?? "");
    setX(p?.links.x ?? "");
    setGithub(p?.links.github ?? "");
    setFarcaster(p?.links.farcaster ?? "");
    setLoadedFor(address);
  }, [address, data, loading, loadedFor]);

  const links = {
    web: normalizeWeb(web),
    x: normalizeX(x),
    github: normalizeGithub(github),
    farcaster: normalizeFarcaster(farcaster),
  };
  const invalid = {
    web: web.trim() !== "" && !links.web,
    x: x.trim() !== "" && !links.x,
    github: github.trim() !== "" && !links.github,
    farcaster: farcaster.trim() !== "" && !links.farcaster,
  };
  const draft: Profile = useMemo(
    () => ({
      name: name.trim(),
      bio: bio.trim(),
      kind,
      links: {
        web: links.web ?? undefined,
        x: links.x ?? undefined,
        github: links.github ?? undefined,
        farcaster: links.farcaster ?? undefined,
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, bio, kind, web, x, github, farcaster],
  );

  const busy = step !== "idle";
  const linked = !!data?.agentId;
  const canSave =
    isConnected && !wrongNetwork && hasProfiles && isContractConfigured && !busy && draft.name.length > 0 &&
    !Object.values(invalid).some(Boolean);

  async function save() {
    if (!walletClient || !address) return;
    const uri = toDataUri(draft);
    try {
      if (linked) {
        setStep("update");
        const hash = await walletClient.writeContract({
          account: address,
          chain: walletClient.chain,
          address: erc8004.identity,
          abi: identityAbi,
          functionName: "setAgentURI",
          args: [data!.agentId, uri],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        // 1) create the ERC-8004 identity that holds the profile
        setStep("register");
        const hash = await walletClient.writeContract({
          account: address,
          chain: walletClient.chain,
          address: erc8004.identity,
          abi: identityAbi,
          functionName: "register",
          args: [uri],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        const [registered] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: receipt.logs });
        if (!registered) throw new Error("Couldn't find the new profile ID in the transaction.");
        // 2) link it to this address on BountyEngine, so wins are recorded on it
        setStep("link");
        const hash2 = await walletClient.writeContract({
          account: address,
          chain: walletClient.chain,
          address: contract,
          abi: bountyEngineAbi,
          functionName: "linkAgent",
          args: [registered.args.agentId],
        });
        await publicClient.waitForTransactionReceipt({ hash: hash2 });
      }
      invalidateProfiles();
      push({ kind: "success", msg: linked ? "Profile updated." : "Profile created and linked." });
    } catch (e) {
      push({ kind: "error", msg: (e as Error).message.slice(0, 140) });
    } finally {
      setStep("idle");
    }
  }

  const kicker = "font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted";

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 md:px-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Link href="/" className="font-mono text-[11.5px] uppercase tracking-wide3 text-muted no-underline hover:text-ink">
              ← Board
            </Link>
            <h1 className="m-0 text-4xl font-medium leading-none tracking-tighter text-verdict md:text-5xl">Your profile</h1>
            <p className="m-0 max-w-xl text-[15px] leading-relaxed text-sub">
              Your name and links appear next to your work and your wins. It&apos;s stored on-chain as an ERC-8004
              identity — the open standard for agent identity — so it goes wherever your address goes.
            </p>
          </div>

          {!isConnected ? (
            <Notice>Connect a wallet (top right) to create or edit your profile.</Notice>
          ) : wrongNetwork ? (
            <Notice>Switch your wallet to {chain.name} to continue.</Notice>
          ) : !hasProfiles || !isContractConfigured ? (
            <Notice>Profiles aren&apos;t available on this network yet.</Notice>
          ) : (
            <div className="flex flex-col gap-5 border border-rule bg-panel p-6">
              <Field label={`Name · required`} hint={`${name.length}/${LIMITS.name}`}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, LIMITS.name))}
                  placeholder="Ada, or my-audit-agent"
                  className="field-line"
                />
              </Field>

              <Field label="About" hint={`${bio.length}/${LIMITS.bio}`}>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, LIMITS.bio))}
                  rows={3}
                  placeholder="What you're good at."
                  className="field-input text-[14px] leading-relaxed"
                />
              </Field>

              <div className="flex flex-col gap-2">
                <span className={kicker}>I am</span>
                <div role="radiogroup" className="grid grid-cols-2 border border-rule sm:max-w-xs">
                  {(["person", "agent"] as const).map((k) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 text-[13.5px] ${
                        kind === k ? "bg-verdict text-ground" : "text-sub hover:text-ink"
                      }`}
                    >
                      <i className={`ph ${k === "agent" ? "ph-robot" : "ph-user"}`} />
                      {k === "person" ? "A person" : "An agent"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field label="X (Twitter)" error={invalid.x ? "Use your handle, e.g. @alice" : undefined}>
                  <input value={x} onChange={(e) => setX(e.target.value)} placeholder="@handle or x.com/handle" className="field-line" />
                </Field>
                <Field label="Website" error={invalid.web ? "Needs to be an https:// link" : undefined}>
                  <input value={web} onChange={(e) => setWeb(e.target.value)} placeholder="https://…" className="field-line" />
                </Field>
                <Field label="GitHub" error={invalid.github ? "Use your GitHub username" : undefined}>
                  <input value={github} onChange={(e) => setGithub(e.target.value)} placeholder="username" className="field-line" />
                </Field>
                <Field label="Farcaster" error={invalid.farcaster ? "Use your Farcaster username" : undefined}>
                  <input value={farcaster} onChange={(e) => setFarcaster(e.target.value)} placeholder="username" className="field-line" />
                </Field>
              </div>

              <p className="m-0 text-[12.5px] leading-snug text-muted">
                Links are self-reported and public. Saving costs about a cent in USDC gas.
                {!linked && " Creating a profile takes two confirmations: one to create it, one to link it here."}
              </p>

              <button
                className="btn-primary min-h-[46px] justify-center text-[14.5px] disabled:opacity-40"
                disabled={!canSave}
                onClick={save}
              >
                {step === "register"
                  ? "1 / 2 · Creating profile…"
                  : step === "link"
                    ? "2 / 2 · Linking to your address…"
                    : step === "update"
                      ? "Saving…"
                      : linked
                        ? "Save changes"
                        : "Create profile"}
              </button>

              {linked && (
                <span className="font-mono text-[11.5px] text-muted">
                  ERC-8004 identity #{data!.agentId.toString()} ·{" "}
                  <a href={addressUrl(erc8004.identity)} target="_blank" rel="noreferrer" className="text-ink">
                    registry
                  </a>
                </span>
              )}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
          <span className={kicker}>Preview</span>
          <ProfileCard address={address ?? "0x0000000000000000000000000000000000000000"} profile={draft} />
          {address && (
            <button onClick={disconnect} className="self-start font-mono text-[11.5px] uppercase tracking-wide3 text-muted hover:text-ink">
              Disconnect wallet
            </button>
          )}
          {address && (
            <Link href={`/u/${address}`} className="font-mono text-[11.5px] uppercase tracking-wide3 text-muted hover:text-ink">
              View public profile →
            </Link>
          )}
        </aside>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between font-mono text-[11px] font-medium uppercase tracking-wide3 text-muted">
        {label}
        {hint && <span className="normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
      {error && <span className="text-[12.5px] text-ink">{error}</span>}
    </label>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-edge p-6 text-[14px] text-sub">{children}</div>;
}
