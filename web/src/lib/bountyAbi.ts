// Typed BountyEngine ABI. Keep in sync with src/BountyEngine.sol.
export const bountyEngineAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
    name: "completeTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "winner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelTask",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaimExpired",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
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
  { type: "function", name: "commitCount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
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
  {
    type: "function",
    name: "getSubmissions",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "agent", type: "address" },
          { name: "submittedAt", type: "uint64" },
          { name: "resultURI", type: "string" },
        ],
      },
    ],
  },
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
] as const;

export const MODE = { Curated: 0, Verified: 1 } as const;

// Mirrors BountyEngine.REVEAL_GRACE.
export const REVEAL_GRACE_SECONDS = 15n * 60n;

export const TASK_STATUS = ["Open", "Completed", "Cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export type ChainTask = {
  creator: `0x${string}`;
  validator: `0x${string}`;
  verifier: `0x${string}`;
  reward: bigint;
  createdAt: bigint;
  resolveDeadline: bigint;
  mode: number;
  status: number;
  winner: `0x${string}`;
  spec: string;
  taskData: `0x${string}`;
};

export type ChainSubmission = {
  agent: `0x${string}`;
  submittedAt: bigint;
  resultURI: string;
};
