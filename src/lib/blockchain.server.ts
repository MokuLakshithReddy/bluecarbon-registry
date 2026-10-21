/**
 * Blockchain Anchoring & On-Chain Verification Service
 *
 * Audit Reference:
 * - Finding 3 & 5: Genuine EVM anchoring, contract authorization, receipt verification, event validation
 * - Finding 4: High-precision fixed-point scaling (milli-tCO2e / kg CO2e) to eliminate rounding loss
 */
import { ethers } from "ethers";

export interface AnchorPayload {
  project_code: string;
  project_name: string;
  ecosystem: string;
  state: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  area_hectares: number | null;
  restoration_start: string | null;
  restoration_end: string | null;
  verified_tco2e: number | null;
  methodology: string;
  evidence_count: number;
  evidence_hashes: string[];
  verifier_id: string;
  verified_at: string;
}

export interface AnchorResult {
  record_hash: string;
  tx_hash: string;
  block_number: number | null;
  network: string;
  status: "CONFIRMED" | "PENDING" | "FAILED" | "SIMULATED";
  simulated: boolean;
  explorer_url: string | null;
  confirmations?: number;
  error?: string | null;
}

export interface ExpectedRecordPayload {
  project_code?: string;
  verified_tco2e?: number;
  verifier_address?: string;
}

export interface OnChainVerificationReport {
  isVerified: boolean;
  txHash: string;
  recordHash: string;
  blockNumber: number | null;
  confirmations: number;
  network: string;
  simulated: boolean;
  receiptStatus: "SUCCESS" | "REVERTED" | "NOT_FOUND";
  verifiedAt: string;
  contractAddress?: string | null | undefined;
  anchoredProjectCode?: string | null | undefined;
  anchoredCarbonTco2e?: number | null | undefined;
  eventVerified?: boolean | undefined;
  contractVerified?: boolean | undefined;
  error?: string | null | undefined;
}

/** Precision Scaling: 1 tCO2e = 1,000 milli-tCO2e (kilograms CO2e). Eliminates decimal truncation. */
export const CARBON_SCALE_FACTOR = 1000n;

export function toMilliTco2e(tco2e: number): bigint {
  return BigInt(Math.max(0, Math.round(tco2e * 1000)));
}

export function fromMilliTco2e(milli: bigint | number): number {
  return Number(milli) / 1000;
}

export const BLUE_CARBON_REGISTRY_ABI = [
  "function owner() external view returns (address)",
  "function isAuthorizedVerifier(address) external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function grantRole(bytes32 role, address account) external",
  "function revokeRole(bytes32 role, address account) external",
  "function authorizeVerifier(address verifier) external",
  "function revokeVerifier(address verifier) external",
  "function anchorRecord(bytes32 recordHash, string calldata projectCode, uint256 verifiedCarbonMilliTco2e) external",
  "function mintCreditBatch(bytes32 recordHash, uint256 totalCarbonMilli, (string projectCode, uint256 vintageYear, string ecosystem, string methodology, string verificationBody, address recipient) input) external",
  "function transferCredits(bytes32 recordHash, address to, uint256 amountMilliTco2e) external",
  "function retireCredits(bytes32 recordHash, uint256 amountMilliTco2e, string calldata beneficiary, string calldata retirementReason) external returns (bytes32 certificateId)",
  "function balanceOf(bytes32 recordHash, address account) external view returns (uint256)",
  "function verifyRecord(bytes32 recordHash) external view returns (bool exists, string memory projectCode, uint256 verifiedCarbonMilliTco2e, uint256 blockNumber, uint256 timestamp, address verifier)",
  "function getCreditBatch(bytes32 recordHash) external view returns (string memory projectCode, uint256 vintageYear, string memory ecosystem, string memory methodology, string memory verificationBody, uint256 totalMintedMilli, uint256 circulatingMilli, uint256 bufferPoolMilli, uint256 retiredMilli)",
  "function getRetirementCertificate(bytes32 certificateId) external view returns (bytes32 recordHash, address retiree, string memory beneficiary, string memory retirementReason, uint256 amountMilliTco2e, uint256 timestamp)",
  "function scheduleAdminAction(uint8 actionType, address target, bytes32 role) external returns (bytes32)",
  "function executeAdminAction(uint8 actionType, address target, bytes32 role) external",
  "function scheduleTimelock(bytes32 actionHash) external",
  "function executeTimelock(bytes32 actionHash) external",
  "function setTimelockEnforcement(bool enforced) external",
  "function timelockEnforced() external view returns (bool)",
  "function computeActionHash(uint8 actionType, address target, bytes32 role) external view returns (bytes32)",
  "function getLatestAnchor(string calldata projectCode) external view returns (bytes32)",
  "event RecordAnchored(bytes32 indexed recordHash, string projectCode, uint256 verifiedCarbonMilliTco2e, uint256 timestamp, address indexed verifier)",
  "event CreditBatchMinted(bytes32 indexed recordHash, string projectCode, uint256 totalMintedMilli, uint256 circulatingMilli, uint256 bufferPoolMilli, uint256 vintageYear, address indexed recipient)",
  "event CreditsTransferred(bytes32 indexed recordHash, address indexed from, address indexed to, uint256 amountMilliTco2e)",
  "event CreditsRetired(bytes32 indexed certificateId, bytes32 indexed recordHash, address indexed retiree, string beneficiary, uint256 amountMilliTco2e, string retirementReason, uint256 timestamp)",
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event VerifierAuthorized(address indexed verifier, address indexed authorizer)",
  "event VerifierRevoked(address indexed verifier, address indexed revoker)",
  "event AdminActionScheduled(bytes32 indexed actionHash, uint8 actionType, address indexed target, bytes32 role, uint256 readyTimestamp)",
  "event AdminActionExecuted(bytes32 indexed actionHash, uint8 actionType, address indexed target, bytes32 role)",
  "event TimelockEnforcementChanged(bool enforced, address indexed changer)",
  "event TimelockScheduled(bytes32 indexed actionHash, uint256 readyTimestamp)",
  "event TimelockExecuted(bytes32 indexed actionHash)",
  "error InsufficientBalance(uint256 requested, uint256 available)",
  "error InvalidCarbonQuantity()",
  "error AnchorQuantityMismatch(uint256 existingQuantity, uint256 batchQuantity)",
  "error AnchorProjectMismatch(string existingProject, string batchProject)",
  "error TimelockEnforcedUseQueuedAction()",
  "error ZeroAddress()",
];

/** Stable, key-sorted JSON so the exact same record structure always hashes identically. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BlockchainProvider {
  readonly network: string;
  readonly simulated: boolean;
  anchor(recordHash: string, payload: AnchorPayload): Promise<Omit<AnchorResult, "record_hash">>;
  verify(
    txHash: string,
    recordHash: string,
    expectedPayload?: ExpectedRecordPayload,
  ): Promise<OnChainVerificationReport>;
}

// -----------------------------------------------------------------------------
// Simulated Provider (Demo/Local only - Explicitly flagged as SIMULATED)
// -----------------------------------------------------------------------------
export const simulatedProvider: BlockchainProvider = {
  network: "Simulated Testnet (Demo Only)",
  simulated: true,

  async anchor(recordHash, _payload) {
    const pseudoTx = await sha256Hex(`sim-tx:${recordHash}:${Date.now()}`);
    const pseudoBlock = 4_800_000 + (parseInt(recordHash.slice(0, 6), 16) % 500_000);

    return {
      tx_hash: `0x${pseudoTx}`,
      block_number: pseudoBlock,
      network: this.network,
      status: "SIMULATED",
      simulated: true,
      explorer_url: null,
      confirmations: 0,
    };
  },

  async verify(txHash, recordHash) {
    return {
      isVerified: false,
      txHash,
      recordHash,
      blockNumber: 4_800_123,
      confirmations: 0,
      network: this.network,
      simulated: true,
      receiptStatus: "NOT_FOUND",
      verifiedAt: new Date().toISOString(),
      eventVerified: false,
      contractVerified: false,
      error: "Simulated demonstration anchor — not verified on public blockchain.",
    };
  },
};

// -----------------------------------------------------------------------------
// Real EVM Provider (Contract Invocation via ethers)
// -----------------------------------------------------------------------------
export interface EvmConfig {
  rpcUrl: string;
  privateKey?: string | undefined;
  contract: string;
  network: string;
  explorerUrl?: string | undefined;
  confirmationsRequired: number;
  expectedChainId?: number | undefined;
}

export function readEvmConfig(): EvmConfig | null {
  const rpcUrl = process.env["BLOCKCHAIN_RPC_URL"];
  const contract = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  if (!rpcUrl || !contract) return null;

  const rawChainId = process.env["BLOCKCHAIN_CHAIN_ID"];
  const expectedChainId = rawChainId ? Number(rawChainId) : undefined;

  return {
    rpcUrl,
    privateKey: process.env["BLOCKCHAIN_PRIVATE_KEY"],
    contract,
    network: process.env["BLOCKCHAIN_NETWORK"] ?? "Polygon Amoy Testnet",
    explorerUrl: process.env["BLOCKCHAIN_EXPLORER_URL"] ?? "https://amoy.polygonscan.com",
    confirmationsRequired: Number(process.env["BLOCKCHAIN_CONFIRMATIONS_REQUIRED"] ?? 2),
    expectedChainId,
  };
}

function getJsonRpcProvider(cfg: EvmConfig): ethers.JsonRpcProvider {
  const chainId =
    cfg.expectedChainId ??
    (cfg.network.toLowerCase().includes("amoy")
      ? 80002
      : cfg.network.toLowerCase().includes("sepolia")
        ? 11155111
        : 137);
  const net = new ethers.Network(cfg.network, chainId);
  return new ethers.JsonRpcProvider(cfg.rpcUrl, net, { staticNetwork: net });
}

export interface EvmRpcLikeProvider {
  send?: (method: string, params: unknown[]) => Promise<unknown>;
  getNetwork: () => Promise<{ chainId: bigint | number }>;
  getCode: (address: string) => Promise<string | null | undefined>;
  getBlockNumber: () => Promise<number>;
}

export interface EvmValidationParams {
  provider: ethers.Provider | ethers.JsonRpcProvider | EvmRpcLikeProvider;
  contractAddress: string;
  expectedChainId?: number | undefined;
  minBytecodeLength?: number | undefined;
}

export interface EvmValidationStatus {
  isValid: boolean;
  chainId: number;
  hasBytecode: boolean;
  bytecodeLength: number;
  blockNumber: number;
  error?: string | undefined;
}

/**
 * Unified EVM network identity and contract deployment validation.
 * Uniformly validates chain ID, bytecode deployment, and RPC block sync across
 * transaction execution, verification, and disaster recovery.
 */
export async function validateEVMNetworkAndContract(
  params: EvmValidationParams,
): Promise<EvmValidationStatus> {
  const { provider, contractAddress, expectedChainId, minBytecodeLength = 2 } = params;

  if (!ethers.isAddress(contractAddress)) {
    return {
      isValid: false,
      chainId: 0,
      hasBytecode: false,
      bytecodeLength: 0,
      blockNumber: 0,
      error: `Invalid EVM contract address format: '${contractAddress}'.`,
    };
  }

  const rpcProvider = provider as unknown as EvmRpcLikeProvider;

  // 1. Query live eth_chainId from RPC server and enforce exact match
  let chainId = 0;
  try {
    if (typeof rpcProvider.send === "function") {
      const hexChainId = (await rpcProvider.send("eth_chainId", [])) as string | number;
      chainId = typeof hexChainId === "string" ? parseInt(hexChainId, 16) : Number(hexChainId);
    } else {
      const network = await rpcProvider.getNetwork();
      chainId = Number(network.chainId);
    }
  } catch {
    const network = await rpcProvider.getNetwork();
    chainId = Number(network.chainId);
  }

  if (expectedChainId && chainId !== expectedChainId) {
    return {
      isValid: false,
      chainId,
      hasBytecode: false,
      bytecodeLength: 0,
      blockNumber: 0,
      error: `Chain ID mismatch: connected RPC reported ${chainId}, expected ${expectedChainId}.`,
    };
  }

  // 2. Query eth_getCode and enforce deployed bytecode existence
  const deployedCode = (await rpcProvider.getCode(contractAddress)) as string | null | undefined;
  const codeLength = deployedCode ? deployedCode.length : 0;
  if (!deployedCode || deployedCode === "0x" || codeLength <= minBytecodeLength) {
    return {
      isValid: false,
      chainId,
      hasBytecode: false,
      bytecodeLength: codeLength,
      blockNumber: 0,
      error: `No contract bytecode deployed at address ${contractAddress} on chain ${chainId}.`,
    };
  }

  // 3. Query current block number
  const blockNumber = Number(await rpcProvider.getBlockNumber());

  return {
    isValid: true,
    chainId,
    hasBytecode: true,
    bytecodeLength: codeLength,
    blockNumber,
  };
}

export { createRealEvmProvider as createEvmProvider };
export function createRealEvmProvider(cfg: EvmConfig): BlockchainProvider {
  return {
    network: cfg.network,
    simulated: false,

    async anchor(recordHash, payload) {
      if (!cfg.privateKey) {
        return {
          tx_hash: "",
          block_number: null,
          network: cfg.network,
          status: "FAILED",
          simulated: false,
          explorer_url: null,
          error: "BLOCKCHAIN_PRIVATE_KEY is not configured for signing real on-chain transactions.",
        };
      }

      try {
        const provider = getJsonRpcProvider(cfg);

        // Unified EVM network identity and contract deployment validation
        const validation = await validateEVMNetworkAndContract({
          provider,
          contractAddress: cfg.contract,
          expectedChainId: cfg.expectedChainId,
        });

        if (!validation.isValid) {
          return {
            tx_hash: "",
            block_number: null,
            network: cfg.network,
            status: "FAILED",
            simulated: false,
            explorer_url: null,
            error: validation.error ?? "EVM contract validation failed",
          };
        }

        const wallet = new ethers.Wallet(cfg.privateKey, provider);
        const contract = new ethers.Contract(cfg.contract, BLUE_CARBON_REGISTRY_ABI, wallet);

        const bytes32Hash = recordHash.startsWith("0x") ? recordHash : `0x${recordHash}`;
        // Preserve 3 decimal places using milli-tCO2e (kilograms CO2e)
        const milliTco2e = toMilliTco2e(payload.verified_tco2e ?? 0);

        // Submit the real contract transaction
        const anchorFn = contract.getFunction("anchorRecord");
        if (!anchorFn) {
          throw new Error("Contract method anchorRecord not found in ABI definition.");
        }
        const txResponse = (await anchorFn(
          bytes32Hash,
          payload.project_code,
          milliTco2e,
        )) as ethers.ContractTransactionResponse;

        const txHash = txResponse.hash;
        const explorerUrl = cfg.explorerUrl ? `${cfg.explorerUrl}/tx/${txHash}` : null;

        // Poll actual receipt and wait for required confirmations
        const receipt = await txResponse.wait(cfg.confirmationsRequired);

        if (!receipt || receipt.status !== 1) {
          return {
            tx_hash: txHash,
            block_number: receipt ? receipt.blockNumber : null,
            network: cfg.network,
            status: "FAILED",
            simulated: false,
            explorer_url: explorerUrl,
            error: "On-chain contract transaction reverted during execution.",
          };
        }

        // Verify receipt logs contain the expected RecordAnchored event
        const contractInterface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);
        let eventFound = false;
        let eventProjectCode: string | null = null;
        let eventCarbonMilli: bigint | null = null;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === cfg.contract.toLowerCase()) {
            try {
              const parsed = contractInterface.parseLog({
                topics: log.topics as string[],
                data: log.data,
              });
              if (parsed && parsed.name === "RecordAnchored") {
                const eventHash = String(parsed.args["recordHash"] ?? "").toLowerCase();
                if (eventHash === bytes32Hash.toLowerCase()) {
                  eventFound = true;
                  eventProjectCode = String(parsed.args["projectCode"] ?? "");
                  eventCarbonMilli = BigInt(parsed.args["verifiedCarbonMilliTco2e"] ?? 0n);
                  break;
                }
              }
            } catch {
              // Non-matching log
            }
          }
        }

        if (!eventFound) {
          return {
            tx_hash: txHash,
            block_number: receipt.blockNumber,
            network: cfg.network,
            status: "FAILED",
            simulated: false,
            explorer_url: explorerUrl,
            error:
              "On-chain transaction confirmed but RecordAnchored event was not emitted for this record.",
          };
        }

        if (eventProjectCode !== payload.project_code || eventCarbonMilli !== milliTco2e) {
          return {
            tx_hash: txHash,
            block_number: receipt.blockNumber,
            network: cfg.network,
            status: "FAILED",
            simulated: false,
            explorer_url: explorerUrl,
            error: `RecordAnchored event values mismatch (expected project ${payload.project_code}, got ${eventProjectCode}).`,
          };
        }

        return {
          tx_hash: txHash,
          block_number: receipt.blockNumber,
          network: cfg.network,
          status: "CONFIRMED",
          simulated: false,
          explorer_url: explorerUrl,
          confirmations: cfg.confirmationsRequired,
        };
      } catch (err: unknown) {
        const anyErr = err as {
          code?: string;
          replacement?: { hash?: string };
          receipt?: {
            blockNumber?: number;
            status?: number;
            hash?: string;
            logs?: Array<{ address: string; topics: string[]; data: string }>;
          };
          message?: string;
        };

        // Handle transaction replacement (repriced, sped up, cancelled/replaced)
        if (anyErr?.code === "TRANSACTION_REPLACED") {
          const repHash = anyErr.replacement?.hash || anyErr.receipt?.hash || "";

          // Explicitly detect cancelled transactions
          if ((anyErr as { cancelled?: boolean }).cancelled) {
            return {
              tx_hash: repHash,
              block_number: anyErr.receipt?.blockNumber ?? null,
              network: cfg.network,
              status: "FAILED",
              simulated: false,
              explorer_url: null,
              error:
                "Transaction was explicitly cancelled or replaced by a non-anchoring transaction.",
            };
          }

          // Explicitly detect reverted replacement transactions
          if (anyErr.receipt?.status === 0) {
            return {
              tx_hash: repHash,
              block_number: anyErr.receipt?.blockNumber ?? null,
              network: cfg.network,
              status: "FAILED",
              simulated: false,
              explorer_url: null,
              error: "Replacement transaction reverted on-chain during execution.",
            };
          }

          if (anyErr.receipt?.status === 1) {
            const repReceipt = anyErr.receipt;
            let repEventFound = false;

            if (repReceipt.logs && Array.isArray(repReceipt.logs)) {
              const iface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);
              const targetHash = (
                recordHash.startsWith("0x") ? recordHash : `0x${recordHash}`
              ).toLowerCase();
              for (const log of repReceipt.logs) {
                if (log.address?.toLowerCase() === cfg.contract.toLowerCase()) {
                  try {
                    const parsed = iface.parseLog({
                      topics: log.topics,
                      data: log.data,
                    });
                    if (
                      parsed?.name === "RecordAnchored" &&
                      String(parsed.args["recordHash"] ?? "").toLowerCase() === targetHash
                    ) {
                      repEventFound = true;
                      break;
                    }
                  } catch {
                    // Not our event
                  }
                }
              }
            }

            if (repEventFound) {
              return {
                tx_hash: repHash,
                block_number: anyErr.receipt.blockNumber ?? null,
                network: cfg.network,
                status: "CONFIRMED",
                simulated: false,
                explorer_url:
                  cfg.explorerUrl && repHash ? `${cfg.explorerUrl}/tx/${repHash}` : null,
                confirmations: cfg.confirmationsRequired,
              };
            }

            return {
              tx_hash: repHash,
              block_number: anyErr.receipt.blockNumber ?? null,
              network: cfg.network,
              status: "FAILED",
              simulated: false,
              explorer_url: null,
              error:
                "Transaction was replaced by another transaction that did not anchor this record.",
            };
          }
        }

        const errMsg = anyErr?.message || String(err);
        const bytes32 = recordHash.startsWith("0x") ? recordHash : `0x${recordHash}`;

        // Check if error is RecordAlreadyAnchored
        if (errMsg.includes("RecordAlreadyAnchored")) {
          try {
            const provider = getJsonRpcProvider(cfg);
            const contract = new ethers.Contract(cfg.contract, BLUE_CARBON_REGISTRY_ABI, provider);
            const verifyFn = contract.getFunction("verifyRecord");
            if (verifyFn) {
              const onChain = await verifyFn(bytes32);
              if (onChain && onChain[0] === true) {
                // Query the real transaction hash from on-chain RecordAnchored event logs
                const filterFn = contract.filters["RecordAnchored"];
                if (filterFn) {
                  const filter = filterFn(bytes32);
                  const events = await contract.queryFilter(filter);
                  if (events.length > 0 && events[0] && "transactionHash" in events[0]) {
                    const ev = events[0] as ethers.EventLog;
                    const realTxHash = ev.transactionHash;
                    const blockNumber = ev.blockNumber;
                    return {
                      tx_hash: realTxHash,
                      block_number: blockNumber,
                      network: cfg.network,
                      status: "CONFIRMED",
                      simulated: false,
                      explorer_url: cfg.explorerUrl ? `${cfg.explorerUrl}/tx/${realTxHash}` : null,
                      confirmations: cfg.confirmationsRequired,
                    };
                  }
                }

                return {
                  tx_hash: "",
                  block_number: Number(onChain[3]),
                  network: cfg.network,
                  status: "FAILED",
                  simulated: false,
                  explorer_url: null,
                  error:
                    "Record already anchored on-chain but transaction hash could not be retrieved from event logs.",
                };
              }
            }
          } catch {
            // Non-fatal, fall through to return error
          }
        }

        return {
          tx_hash: "",
          block_number: null,
          network: cfg.network,
          status: "FAILED",
          simulated: false,
          explorer_url: null,
          error: errMsg,
        };
      }
    },

    async verify(txHash, recordHash, expectedPayload) {
      try {
        const provider = getJsonRpcProvider(cfg);

        // Unified EVM network identity and contract deployment validation
        const validation = await validateEVMNetworkAndContract({
          provider,
          contractAddress: cfg.contract,
          expectedChainId: cfg.expectedChainId,
        });

        if (!validation.isValid) {
          return {
            isVerified: false,
            txHash,
            recordHash,
            blockNumber: null,
            confirmations: 0,
            network: cfg.network,
            simulated: false,
            receiptStatus: "NOT_FOUND",
            verifiedAt: new Date().toISOString(),
            error: validation.error ?? "EVM contract validation failed",
          };
        }

        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
          return {
            isVerified: false,
            txHash,
            recordHash,
            blockNumber: null,
            confirmations: 0,
            network: cfg.network,
            simulated: false,
            receiptStatus: "NOT_FOUND",
            verifiedAt: new Date().toISOString(),
            error:
              "Transaction receipt not found on chain. Transaction may still be pending or was dropped.",
          };
        }

        const isSuccess = receipt.status === 1;
        const currentBlock = await provider.getBlockNumber();
        const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);

        // 1. Verify transaction called the expected contract
        const toAddress = receipt.to ? receipt.to.toLowerCase() : "";
        const expectedContract = cfg.contract.toLowerCase();
        const contractAddressMatches = toAddress === expectedContract;

        // 2. Parse contract event from transaction receipt logs
        const contractInterface = new ethers.Interface(BLUE_CARBON_REGISTRY_ABI);
        const bytes32Hash = recordHash.startsWith("0x")
          ? recordHash.toLowerCase()
          : `0x${recordHash}`.toLowerCase();

        let eventFound = false;
        let eventProjectCode: string | null = null;
        let eventCarbonMilli: bigint | null = null;
        let eventVerifier: string | null = null;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === expectedContract) {
            try {
              const parsed = contractInterface.parseLog({
                topics: log.topics as string[],
                data: log.data,
              });
              if (parsed && parsed.name === "RecordAnchored") {
                const eventHash = String(parsed.args["recordHash"] ?? "").toLowerCase();
                if (eventHash === bytes32Hash) {
                  eventFound = true;
                  eventProjectCode = String(parsed.args["projectCode"] ?? "");
                  eventCarbonMilli = BigInt(parsed.args["verifiedCarbonMilliTco2e"] ?? 0n);
                  eventVerifier = String(parsed.args["verifier"] ?? "");
                  break;
                }
              }
            } catch {
              // Log not emitted by this contract interface
            }
          }
        }

        // 3. Query contract view method verifyRecord() to independently verify storage state
        let existsInContract = false;
        let onChainProjectCode: string | null = null;
        let onChainCarbonMilli: bigint | null = null;
        let onChainVerifier: string | null = null;

        try {
          const contract = new ethers.Contract(cfg.contract, BLUE_CARBON_REGISTRY_ABI, provider);
          const verifyFn = contract.getFunction("verifyRecord");
          if (verifyFn) {
            const onChainRecord = (await verifyFn(bytes32Hash)) as unknown as [
              boolean,
              string,
              bigint,
              bigint,
              bigint,
              string,
            ];
            existsInContract = onChainRecord[0] === true;
            onChainProjectCode = String(onChainRecord[1] ?? "");
            onChainCarbonMilli = BigInt(onChainRecord[2] ?? 0n);
            onChainVerifier = String(onChainRecord[5] ?? "");
          }
        } catch {
          existsInContract = false;
        }

        // 4. Comprehensive cross-comparison across event, contract storage, and expected payload
        let fieldsMatch = true;
        let fieldMismatchError: string | null = null;

        if (eventFound && existsInContract) {
          if (eventProjectCode !== onChainProjectCode) {
            fieldsMatch = false;
            fieldMismatchError = `Project code mismatch: receipt event contains '${eventProjectCode}' but contract storage contains '${onChainProjectCode}'.`;
          } else if (eventCarbonMilli !== onChainCarbonMilli) {
            fieldsMatch = false;
            fieldMismatchError = `Carbon quantity mismatch: receipt event contains ${eventCarbonMilli} milli-tCO2e but contract storage contains ${onChainCarbonMilli} milli-tCO2e.`;
          } else if (
            eventVerifier &&
            onChainVerifier &&
            eventVerifier.toLowerCase() !== onChainVerifier.toLowerCase()
          ) {
            fieldsMatch = false;
            fieldMismatchError = `Verifier address mismatch: receipt event contains '${eventVerifier}' but contract storage contains '${onChainVerifier}'.`;
          } else if (
            expectedPayload?.project_code &&
            onChainProjectCode !== expectedPayload.project_code
          ) {
            fieldsMatch = false;
            fieldMismatchError = `Expected project code '${expectedPayload.project_code}' does not match on-chain record '${onChainProjectCode}'.`;
          } else if (
            expectedPayload?.verified_tco2e != null &&
            onChainCarbonMilli !== toMilliTco2e(expectedPayload.verified_tco2e)
          ) {
            fieldsMatch = false;
            fieldMismatchError = `Expected carbon quantity ${expectedPayload.verified_tco2e} tCO2e does not match on-chain record (${fromMilliTco2e(onChainCarbonMilli ?? 0n)} tCO2e).`;
          } else if (
            expectedPayload?.verifier_address &&
            onChainVerifier &&
            onChainVerifier.toLowerCase() !== expectedPayload.verifier_address.toLowerCase()
          ) {
            fieldsMatch = false;
            fieldMismatchError = `Expected verifier address '${expectedPayload.verifier_address}' does not match on-chain verifier '${onChainVerifier}'.`;
          }
        }

        const allChecksPass =
          isSuccess &&
          contractAddressMatches &&
          eventFound &&
          existsInContract &&
          fieldsMatch &&
          confirmations >= cfg.confirmationsRequired;

        const anchoredCarbonTco2e =
          onChainCarbonMilli != null
            ? fromMilliTco2e(onChainCarbonMilli)
            : eventCarbonMilli != null
              ? fromMilliTco2e(eventCarbonMilli)
              : null;

        return {
          isVerified: allChecksPass,
          txHash,
          recordHash,
          blockNumber: receipt.blockNumber,
          confirmations,
          network: cfg.network,
          simulated: false,
          receiptStatus: isSuccess ? "SUCCESS" : "REVERTED",
          verifiedAt: new Date().toISOString(),
          contractAddress: receipt.to,
          anchoredProjectCode: onChainProjectCode || eventProjectCode,
          anchoredCarbonTco2e,
          eventVerified: eventFound,
          contractVerified: existsInContract,
          error: !isSuccess
            ? "Transaction reverted on chain."
            : !contractAddressMatches
              ? `Transaction called address ${receipt.to}, expected registry contract ${cfg.contract}.`
              : !eventFound
                ? "Transaction receipt did not emit the expected RecordAnchored event for this record hash."
                : !existsInContract
                  ? "Record hash not found in registry contract state."
                  : !fieldsMatch
                    ? fieldMismatchError
                    : confirmations < cfg.confirmationsRequired
                      ? `Insufficient confirmations: ${confirmations} of ${cfg.confirmationsRequired} required.`
                      : undefined,
        };
      } catch (err) {
        return {
          isVerified: false,
          txHash,
          recordHash,
          blockNumber: null,
          confirmations: 0,
          network: cfg.network,
          simulated: false,
          receiptStatus: "NOT_FOUND",
          verifiedAt: new Date().toISOString(),
          error: err instanceof Error ? err.message : "RPC verification query failed",
        };
      }
    },
  };
}

/**
 * Returns the configured blockchain provider.
 * If EVM environment variables are present, returns the real EVM provider.
 * Otherwise, returns the simulated demo provider with simulated: true.
 */
export function getBlockchainProvider(): BlockchainProvider {
  const evm = readEvmConfig();
  if (!evm) return simulatedProvider;
  return createRealEvmProvider(evm);
}

/** Anchors a canonical verified project record hash. */
export async function anchorVerifiedRecord(payload: AnchorPayload): Promise<AnchorResult> {
  const record_hash = await sha256Hex(canonicalize(payload));
  const provider = getBlockchainProvider();
  const result = await provider.anchor(record_hash, payload);
  return { record_hash, ...result };
}

/** Independently verifies an anchored transaction and hash against the blockchain. */
export async function verifyOnChainAnchor(
  txHash: string,
  recordHash: string,
  expectedPayload?: ExpectedRecordPayload,
): Promise<OnChainVerificationReport> {
  const provider = getBlockchainProvider();
  return provider.verify(txHash, recordHash, expectedPayload);
}
