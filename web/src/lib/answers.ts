import { decodeAbiParameters, hexToString, isHex, size, type Hex } from "viem";

export type DecodedAnswer =
  | { kind: "text"; value: string } // e.g. a preimage word
  | { kind: "number"; value: string } // e.g. the backdoor input
  | { kind: "contract"; value: `0x${string}` } // a deployed implementation (TestVectorVerifier)
  | { kind: "hex"; value: Hex };

/**
 * Makes a verified answer readable. `tag` is the spec's `solver:` tag when the
 * bounty was posted from a known template; otherwise we guess from the shape.
 */
export function decodeAnswer(answer: Hex, tag?: string): DecodedAnswer {
  try {
    if (tag === "backdoor") {
      return { kind: "number", value: decodeAbiParameters([{ type: "uint256" }], answer)[0].toString() };
    }
    if (tag === "testvector" || tag === "implementation") {
      return { kind: "contract", value: decodeAbiParameters([{ type: "address" }], answer)[0] };
    }
    if (size(answer) === 32) {
      // A 32-byte word with 12 leading zero bytes is almost certainly an address.
      if (/^0x0{24}[0-9a-f]{40}$/i.test(answer) && !/^0x0{64}$/.test(answer)) {
        return { kind: "contract", value: decodeAbiParameters([{ type: "address" }], answer)[0] };
      }
      const n = BigInt(answer);
      if (n < 10n ** 30n) return { kind: "number", value: n.toString() };
    }
    const s = hexToString(answer);
    if (/^[\x20-\x7E -￿\n\t]*$/.test(s) && s.length > 0) return { kind: "text", value: s };
  } catch {
    /* fall through */
  }
  return { kind: "hex", value: isHex(answer) ? answer : "0x" };
}
