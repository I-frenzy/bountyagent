// Minimal ABI for BountyEngine — shared by the worker. Keep in sync with
// src/BountyEngine.sol. (The web dApp keeps its own typed copy.)
export const BOUNTY_ENGINE_ABI = [
  {
    type: "event",
    name: "TaskCreated",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "mode", type: "uint8", indexed: false },
      { name: "reward", type: "uint256", indexed: false },
      { name: "validatorOrVerifier", type: "address", indexed: false },
      { name: "resolveDeadline", type: "uint64", indexed: false },
      { name: "spec", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskCompleted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
      { name: "mode", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "validator", type: "address" },
          { name: "verifier", type: "address" },
          { name: "reward", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "resolveDeadline", type: "uint64" },
          { name: "mode", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "winner", type: "address" },
          { name: "spec", type: "string" },
          { name: "taskData", type: "bytes" },
        ],
      },
    ],
  },
  // --- create (creator-side; used by demo scripts) ---
  {
    type: "function",
    name: "createTask",
    stateMutability: "payable",
    inputs: [
      { name: "spec", type: "string" },
      { name: "validator", type: "address" },
      { name: "resolveDeadline", type: "uint64" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    type: "function",
    name: "createVerifiedTask",
    stateMutability: "payable",
    inputs: [
      { name: "spec", type: "string" },
      { name: "verifier", type: "address" },
      { name: "taskData", type: "bytes" },
      { name: "resolveDeadline", type: "uint64" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    type: "function",
    name: "completeTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
  },
  // --- curated ---
  {
    type: "function",
    name: "submitResult",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "resultURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasSubmitted",
    stateMutability: "view",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  // --- verified (commit-reveal) ---
  {
    type: "function",
    name: "commitAnswer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revealAndClaim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "answer", type: "bytes" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "computeCommitment",
    stateMutability: "pure",
    inputs: [
      { name: "answer", type: "bytes" },
      { name: "salt", type: "bytes32" },
      { name: "solver", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "commitmentOf",
    stateMutability: "view",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "bytes32" }],
  },
];

export const MODE = { Curated: 0, Verified: 1 };
export const STATUS = { Open: 0, Completed: 1, Cancelled: 2 };
