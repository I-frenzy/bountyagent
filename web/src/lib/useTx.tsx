"use client";

import { useCallback, useState } from "react";
import type { Abi, TransactionReceipt } from "viem";
import { useWallet } from "./wallet";

type WriteArgs = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

type TxState = {
  hash?: `0x${string}`;
  receipt?: TransactionReceipt;
  isPending: boolean; // awaiting wallet signature / submit
  isConfirming: boolean; // awaiting receipt
  isSuccess: boolean;
  error: Error | null;
};

const initial: TxState = {
  hash: undefined,
  receipt: undefined,
  isPending: false,
  isConfirming: false,
  isSuccess: false,
  error: null,
};

export function useTx() {
  const { walletClient, publicClient, address } = useWallet();
  const [state, setState] = useState<TxState>(initial);

  const reset = useCallback(() => setState(initial), []);

  const write = useCallback(
    async (params: WriteArgs) => {
      if (!walletClient || !address) {
        setState({ ...initial, error: new Error("Wallet not connected") });
        return;
      }
      setState({ ...initial, isPending: true });
      try {
        const hash = await walletClient.writeContract({
          account: address,
          chain: walletClient.chain,
          address: params.address,
          abi: params.abi,
          functionName: params.functionName,
          args: params.args as never,
          value: params.value,
        });
        setState({ ...initial, hash, isPending: false, isConfirming: true });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        setState({
          hash,
          receipt,
          isPending: false,
          isConfirming: false,
          isSuccess: receipt.status === "success",
          error:
            receipt.status === "success"
              ? null
              : new Error("Transaction reverted on-chain"),
        });
      } catch (err) {
        setState({ ...initial, error: err as Error });
      }
    },
    [walletClient, publicClient, address],
  );

  return { ...state, write, reset };
}
