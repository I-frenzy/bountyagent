"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./wallet";
import { useNetwork } from "./network";
import { bountyEngineAbi } from "./bountyAbi";
import { identityAbi } from "./erc8004Abi";
import { parseAgentUri, type Profile } from "./profile";

export type LoadedProfile = {
  agentId: bigint;
  /** null if the identity's registration file isn't an on-chain data URI we can read. */
  profile: Profile | null;
};

// Shared across components: the board shows the same people many times.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<LoadedProfile | null> }>();
const listeners = new Set<() => void>();

/** Drop cached profiles (e.g. after someone saves theirs) and re-render users. */
export function invalidateProfiles() {
  cache.clear();
  listeners.forEach((l) => l());
}

/**
 * The profile linked to `address` on this network's BountyEngine: the ERC-8004
 * identity it claimed via `linkAgent`, read from the identity registry. Reads
 * are batched through Multicall3 by the shared public client.
 */
export function useProfile(address?: string | null) {
  const { publicClient } = useWallet();
  const { contract, erc8004, hasProfiles, isContractConfigured, chain } = useNetwork();
  const [state, setState] = useState<{ loading: boolean; data: LoadedProfile | null }>({ loading: !!address, data: null });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    if (!address || !hasProfiles || !isContractConfigured) {
      setState({ loading: false, data: null });
      return;
    }
    const key = `${chain.id}:${contract}:${address.toLowerCase()}`;
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.at > TTL_MS) {
      const value = (async (): Promise<LoadedProfile | null> => {
        const agentId = (await publicClient.readContract({
          address: contract,
          abi: bountyEngineAbi,
          functionName: "agentIdOf",
          args: [address as `0x${string}`],
        })) as bigint;
        if (agentId === 0n) return null;
        try {
          const uri = (await publicClient.readContract({
            address: erc8004.identity,
            abi: identityAbi,
            functionName: "tokenURI",
            args: [agentId],
          })) as string;
          return { agentId, profile: parseAgentUri(uri) };
        } catch {
          return { agentId, profile: null };
        }
      })().catch(() => null);
      entry = { at: Date.now(), value };
      cache.set(key, entry);
    }
    let alive = true;
    setState((s) => ({ loading: true, data: s.data }));
    entry.value.then((data) => alive && setState({ loading: false, data }));
    return () => {
      alive = false;
    };
  }, [address, publicClient, contract, erc8004.identity, hasProfiles, isContractConfigured, chain.id, version]);

  return state;
}
