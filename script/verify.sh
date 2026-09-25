#!/usr/bin/env bash
# Verify every BountyAgent contract listed in deployments/arc-<network>.json
# on Arc's Blockscout explorer (no API key needed).
#
#   script/verify.sh testnet
#   script/verify.sh mainnet
#
# The explorer rate-limits per IP; if it answers "Too many requests", wait
# for the reset and run this again — already-verified contracts are skipped.
#
# KNOWN ISSUE (confirmed 2026-09-25, mainnet, every contract, twice):
# explorer.arc.io's /api sits behind a Cloudflare *managed* JS challenge that
# forge's HTTP client cannot pass, so this fails with "failed (rate limit?
# rerun later)" every time — it is NOT a rate limit, and re-running this won't
# help. Verify manually from a real browser instead: Blockscout UI → the
# contract's address → Verify & Publish → Solidity (standard-json), using the
# same source path + constructor args this script computes for each `verify()`
# call. See docs/MAINNET.md §4 for the full note.
set -euo pipefail

NET="${1:-testnet}"
FILE="deployments/arc-${NET}.json"
[ -f "$FILE" ] || { echo "no $FILE — deploy first"; exit 1; }

if [ "$NET" = "mainnet" ]; then
  CHAIN=5042; API="https://explorer.arc.io/api/"; RPC="https://rpc.mainnet.arc.io"
else
  CHAIN=5042002; API="https://explorer.testnet.arc.io/api/"; RPC="https://rpc.testnet.arc.io"
fi

FORGE="${FORGE:-forge}"; CAST="${CAST:-cast}"
get() { node -e "const d=require('./$FILE'); const v=$1; process.stdout.write(v ?? '')"; }
ext() { node -e "const d=require('./$FILE'); const e=d.external||{}; const k=Object.keys(e).find(k=>k.startsWith('$1')); process.stdout.write(k?e[k]:'')"; }

verified() {
  curl -s --max-time 30 "${API%api/}api/v2/smart-contracts/$1" | node -e \
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.exit(JSON.parse(s).is_verified?0:1)}catch{process.exit(1)}})"
}

verify() { # address, source:Name, [constructor args]
  local addr="$1" src="$2" args="${3:-}"
  [ -z "$addr" ] && return 0
  if verified "$addr"; then echo "✓ already verified  $src  $addr"; return 0; fi
  echo "→ verifying $src  $addr"
  $FORGE verify-contract "$addr" "$src" --chain-id "$CHAIN" --verifier blockscout --verifier-url "$API" \
    ${args:+--constructor-args "$args"} --watch || echo "  ! failed (rate limit? rerun later)"
}

IDENTITY=$(ext "ERC-8004 IdentityRegistry"); REPUTATION=$(ext "ERC-8004 ReputationRegistry")
COMMERCE=$(get "d.contracts.AgenticCommerce"); [ -z "$COMMERCE" ] && COMMERCE=$(ext "AgenticCommerce")

verify "$(get d.contracts.BountyEngine)" src/BountyEngine.sol:BountyEngine \
  "$($CAST abi-encode 'f(address,address)' "$IDENTITY" "$REPUTATION")"
verify "$(get d.contracts.PreimageVerifier)" src/verifiers/PreimageVerifier.sol:PreimageVerifier
verify "$(get d.contracts.BackdoorVerifier)" src/verifiers/BackdoorVerifier.sol:BackdoorVerifier
verify "$(get d.contracts.TestVectorVerifier)" src/verifiers/TestVectorVerifier.sol:TestVectorVerifier
verify "$(get d.contracts.VulnerableTarget)" src/demo/VulnerableTarget.sol:VulnerableTarget
verify "$(get d.contracts.PopcountReference)" src/demo/PopcountReference.sol:PopcountReference
verify "$(get d.contracts.VerifierEvaluator)" src/erc8183/VerifierEvaluator.sol:VerifierEvaluator \
  "$($CAST abi-encode 'f(address)' "$COMMERCE")"

# Our own ERC-8183 instance (mainnet): the proxy and the implementation behind it.
OWN=$(get "d.contracts.AgenticCommerce")
if [ -n "$OWN" ]; then
  IMPL=$($CAST parse-bytes32-address "$($CAST storage "$OWN" 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc --rpc-url "$RPC")")
  DEPLOYER=$(get d.deployer)
  INIT=$($CAST calldata 'initialize(address,address)' 0x3600000000000000000000000000000000000000 "$DEPLOYER")
  verify "$IMPL" src/erc8183/AgenticCommerce.sol:AgenticCommerce
  verify "$OWN" lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
    "$($CAST abi-encode 'f(address,bytes)' "$IMPL" "$INIT")"
fi
echo "done."
