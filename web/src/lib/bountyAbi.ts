// Typed BountyEngine ABI. Keep in sync with src/BountyEngine.sol.
export const bountyEngineAbi = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
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
    name: "createTask",
    stateMutability: "payable",
    inputs: [
      { name: "spec", type: "string" },
      { name: "validator", type: "address" },
      { name: "deadline", type: "uint64" },
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
    type: "function",
    name: "submissionCount",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
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
    type: "event",
    name: "TaskCancelled",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "refund", type: "uint256", indexed: false },
    ],
  },
] as const;

// Task.status enum
export const TASK_STATUS = ["Open", "Completed", "Cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export type ChainTask = {
  creator: `0x${string}`;
  validator: `0x${string}`;
  reward: bigint;
  createdAt: bigint;
  deadline: bigint;
  status: number;
  winner: `0x${string}`;
  spec: string;
};

export type ChainSubmission = {
  agent: `0x${string}`;
  submittedAt: bigint;
  resultURI: string;
};
