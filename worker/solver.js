// Solvers for VERIFIED tasks. Each returns the exact `answer` bytes the
// on-chain verifier expects, or null if this worker can't solve the task.
//
// The task type is declared in the spec via a `solver:<kind>` tag so a worker
// knows how to approach it (the demo dApp emits these; real tasks would carry
// their own machine-readable hints or the agent would reason from the spec).

import { keccak256, stringToHex, encodeAbiParameters, decodeAbiParameters } from "viem";

export function solveVerified(spec, taskData) {
  const s = spec.toLowerCase();

  // --- preimage: find a word whose keccak256 matches the target hash --------
  if (s.includes("solver:preimage")) {
    const m = spec.match(/candidates?:\s*([^\n]+)/i);
    const words = m ? m[1].split(",").map((w) => w.trim()).filter(Boolean) : [];
    let target;
    try {
      [target] = decodeAbiParameters([{ type: "bytes32" }], taskData);
    } catch {
      return null;
    }
    for (const w of words) {
      const answer = stringToHex(w);
      if (keccak256(answer).toLowerCase() === String(target).toLowerCase()) {
        return { answer, human: `preimage = "${w}"` };
      }
    }
    return null;
  }

  // --- backdoor: read the source, find the magic `== N` backdoor value ------
  if (s.includes("solver:backdoor")) {
    // grab every "== <number>" and pick the smallest (the intended big
    // threshold uses `>`; the backdoor uses `==`).
    const matches = [...spec.matchAll(/==\s*(\d[\d_]*)/g)].map((x) =>
      BigInt(x[1].replace(/_/g, "")),
    );
    if (matches.length === 0) return null;
    const val = matches.sort((a, b) => (a < b ? -1 : 1))[0];
    const answer = encodeAbiParameters([{ type: "uint256" }], [val]);
    return { answer, human: `input = ${val}` };
  }

  return null;
}
