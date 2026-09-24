// The "labor" an agent performs off-chain for CURATED tasks. Uses Gemini when a
// key is present to produce a real deliverable; otherwise a deterministic
// analyzer that still does genuine work for tasks it can handle (code review).

// Try the caller's model first, then progressively older/steadier ones — Gemini
// returns 503 when a specific model is overloaded, so a fallback list + a short
// retry makes real LLM work reliable for the demo.
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL || "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
].filter((m, i, a) => a.indexOf(m) === i);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function doWork(spec) {
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    let lastErr;
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await geminiWork(spec, key, model);
        } catch (err) {
          lastErr = err;
          const transient = /HTTP (429|500|503)/.test(err.message);
          if (transient && attempt === 0) {
            await sleep(1200);
            continue; // retry same model once
          }
          break; // move to next model
        }
      }
    }
    console.warn(`  ! Gemini unavailable (${lastErr?.message}); using deterministic analyzer`);
  }
  return deterministicWork(spec);
}

async function geminiWork(spec, key, model) {
  // Instruct the model to hand back the FINISHED deliverable — the actual work a
  // human validator would read and judge — not a restatement of the task.
  const prompt = [
    "You are an autonomous AI worker agent competing for an on-chain bounty.",
    "Do the task and return ONLY the finished deliverable — the real answer/work,",
    "never a restatement of the task or a status update.",
    "",
    "Rules:",
    "- Be concrete and specific. Show the actual result.",
    "- Security review → list findings as `SEVERITY: issue @ location — fix`.",
    "- Analysis/opinion → give the answer first, then one line of reasoning.",
    "- Summary/extraction → give the content directly, as tight bullets.",
    "- Use short lines / bullets. No preamble, no sign-off.",
    "- Keep it under 1000 characters so it settles cheaply on-chain.",
    "",
    "TASK:",
    spec,
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700, topP: 0.9 },
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error?.message ?? "";
    } catch {}
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text).join("").trim();
  if (!text) throw new Error(`empty response (finish: ${cand?.finishReason ?? "?"})`);
  return clip(text, 1400);
}

// Deterministic analyzer — genuine work for tasks it can actually do without a
// model (Solidity security review). It reads the snippet and reports concrete
// findings with severity + location + fix, exactly what a validator judges.
function deterministicWork(spec) {
  const looksLikeSolidity = /function\s+\w+|\bpragma\b|\bmsg\.(value|sender)\b|\.call\{|require\(/.test(spec);
  const wantsAudit = /audit|review|reentran|vulnerab|security|findings?/i.test(spec);

  if (looksLikeSolidity || wantsAudit) {
    const findings = [];
    const flat = spec.replace(/\n/g, " ");
    const hasExternalCall = /\.call\{|\.transfer\(|\.send\(/.test(spec);
    const hasGuard = /nonreentrant|reentrancyguard|_lock|mutex/i.test(spec);
    const stateAfterCall = /\.call\{[^]*?\}\s*\(\s*""\s*\)[^]*?(=[^=]|\+\+|--)/.test(flat);
    const uncheckedCall = /\.call\{[^}]*\}\s*\(\s*""\s*\)\s*;/.test(flat) && !/\(\s*bool/.test(flat);
    const usesTxOrigin = /tx\.origin/.test(spec);
    const uncheckedTransfer = /\.transfer\(|\.send\(/.test(spec);

    if (hasExternalCall && !hasGuard)
      findings.push("HIGH: external value call with no reentrancy guard — apply checks-effects-interactions or a nonReentrant modifier.");
    if (stateAfterCall)
      findings.push("HIGH: state is mutated AFTER the external call — move all state writes before the call (reentrancy).");
    if (uncheckedCall)
      findings.push("MEDIUM: low-level call return value ignored — check the returned bool and revert on failure.");
    if (usesTxOrigin)
      findings.push("MEDIUM: tx.origin used for auth — use msg.sender; tx.origin is phishable.");
    if (uncheckedTransfer && !hasExternalCall)
      findings.push("LOW: .transfer/.send has a fixed 2300 gas stipend — prefer a checked .call for forward-compat.");
    if (hasGuard)
      findings.push("INFO: a reentrancy guard is present — confirm it wraps every fund-moving path.");
    if (findings.length === 0)
      findings.push("LOW: no obvious reentrancy in the snippet — recommend fuzzing balance edge cases and re-entrant callbacks.");

    return `Security review — ${findings.length} finding${findings.length > 1 ? "s" : ""}:\n- ${findings.join("\n- ")}`;
  }

  // Non-code task with no model available: be honest, not boilerplate.
  return (
    "Unable to complete to a judgeable standard: this task needs a language model " +
    "and no GEMINI_API_KEY is configured for this agent. Configure a key and the " +
    "agent will return a real answer. (This agent specialises in on-chain / Solidity work.)"
  );
}

function clip(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}
