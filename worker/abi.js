// Minimal ABI for BountyEngine — shared by the worker. Keep in sync with
// src/BountyEngine.sol. (The web dApp keeps its own typed copy.)
export const BOUNTY_ENGINE_ABI = [
  {
    type: "event",
    name: "TaskCreated",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "validator", type: "address", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "spec", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ResultSubmitted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "submissionIndex", type: "uint256", indexed: false },
      { name: "resultURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskCompleted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
    ],
  },
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
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "validator", type: "address" },
          { name: "reward", type: "uint256" },
          { name: "createdAt", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "winner", type: "address" },
          { name: "spec", type: "string" },
        ],
      },
    ],
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
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];
