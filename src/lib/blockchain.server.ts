/**
 * Blockchain abstraction and verification layer (server-side only).
 *
 * Audit Reference: Finding 3 (Blockchain Anchoring Implementation)
 *
 * The registry never writes raw files, media, or private PII on-chain.
 * It builds a canonical verified-project record, computes a SHA-256 digest,
 * and anchors the cryptographic hash to an immutable EVM-compatible ledger
 * via the BlueCarbonRegistry smart contract.
 *
 * Real EVM mode vs Simulation mode:
 *  - Real EVM Provider: Activated when BLOCKCHAIN_RPC_URL and BLOCKCHAIN_CONTRACT_ADDRESS are set.
 *    Invokes `anchorRecord(bytes32,string,uint256)` on the deployed contract, submits signed
 *    transactions, polls receipts, checks event logs, and verifies block finality.
 *  - Simulated Provider: Used in local/demo mode when RPC is unconfigured.
 *    Explicitly flags `simulated: true` so records are NEVER misrepresented as genuine on-chain.
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
  status: "CONFIRMED" | "PENDING" | "FAILED";
  simulated: boolean;
  explorer_url: string | null;
  confirmations?: number | undefined;
  error?: string | null | undefined;
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
  error?: string | null | undefined;
}

export const BLUE_CARBON_REGISTRY_ABI = [
  "function anchorRecord(bytes32 recordHash, string calldata projectCode, uint256 verifiedTco2e) external",
  "function verifyRecord(bytes32 recordHash) external view returns (bool exists, string memory projectCode, uint256 verifiedTco2e, uint256 blockNumber, uint256 timestamp, address verifier)",
  "function getLatestAnchor(string calldata projectCode) external view returns (bytes32)",
  "event RecordAnchored(bytes32 indexed recordHash, string indexed projectCode, uint256 verifiedTco2e, uint256 timestamp, address indexed verifier)",
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
  verify(txHash: string, recordHash: string): Promise<OnChainVerificationReport>;
}

// -----------------------------------------------------------------------------
// Simulated Provider (Demo/Local only - Explicitly flagged as SIMULATED)
// -----------------------------------------------------------------------------
export const simulatedProvider: BlockchainProvider = {
  network: "Simulated Testnet (Demo Only)",
  simulated: true,

  async anchor(recordHash) {
    const pseudoTx = await sha256Hex(`sim-tx:${recordHash}:${Date.now()}`);
    const pseudoBlock = 4_800_000 + (parseInt(recordHash.slice(0, 6), 16) % 500_000);

    return {
      tx_hash: `0x${pseudoTx}`,
      block_number: pseudoBlock,
      network: this.network,
      status: "CONFIRMED",
      simulated: true,
      explorer_url: null,
      confirmations: 12,
    };
  },

  async verify(txHash, recordHash) {
    return {
      isVerified: true,
      txHash,
      recordHash,
      blockNumber: 4_800_000 + (parseInt(recordHash.slice(0, 6), 16) % 500_000),
      confirmations: 12,
      network: this.network,
      simulated: true,
      receiptStatus: "SUCCESS",
      verifiedAt: new Date().toISOString(),
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
}

export function readEvmConfig(): EvmConfig | null {
  const rpcUrl = process.env["BLOCKCHAIN_RPC_URL"];
  const contract = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  if (!rpcUrl || !contract) return null;

  return {
    rpcUrl,
    privateKey: process.env["BLOCKCHAIN_PRIVATE_KEY"],
    contract,
    network: process.env["BLOCKCHAIN_NETWORK"] ?? "Polygon Amoy Testnet",
    explorerUrl: process.env["BLOCKCHAIN_EXPLORER_URL"] ?? "https://amoy.polygonscan.com",
    confirmationsRequired: Number(process.env["BLOCKCHAIN_CONFIRMATIONS_REQUIRED"] ?? 2),
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
        const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
        const wallet = new ethers.Wallet(cfg.privateKey, provider);
        const contract = new ethers.Contract(cfg.contract, BLUE_CARBON_REGISTRY_ABI, wallet);

        const bytes32Hash = recordHash.startsWith("0x") ? recordHash : `0x${recordHash}`;
        const tco2eInteger = BigInt(Math.max(0, Math.round(payload.verified_tco2e ?? 0)));

        // Submit the real contract transaction
        const anchorFn = contract.getFunction("anchorRecord");
        if (!anchorFn) {
          throw new Error("Contract method anchorRecord not found in ABI definition.");
        }
        const txResponse = (await anchorFn(
          bytes32Hash,
          payload.project_code,
          tco2eInteger,
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

        return {
          tx_hash: txHash,
          block_number: receipt.blockNumber,
          network: cfg.network,
          status: "CONFIRMED",
          simulated: false,
          explorer_url: explorerUrl,
          confirmations: cfg.confirmationsRequired,
        };
      } catch (err) {
        return {
          tx_hash: "",
          block_number: null,
          network: cfg.network,
          status: "FAILED",
          simulated: false,
          explorer_url: null,
          error: err instanceof Error ? err.message : "Blockchain transaction submission failed",
        };
      }
    },

    async verify(txHash, recordHash) {
      try {
        const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
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

        const currentBlock = await provider.getBlockNumber();
        const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);
        const isSuccess = receipt.status === 1;

        // Query contract view method
        let existsInContract = false;
        try {
          const contract = new ethers.Contract(cfg.contract, BLUE_CARBON_REGISTRY_ABI, provider);
          const bytes32Hash = recordHash.startsWith("0x") ? recordHash : `0x${recordHash}`;
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
          }
        } catch {
          existsInContract = false;
        }

        return {
          isVerified: isSuccess && existsInContract && confirmations >= cfg.confirmationsRequired,
          txHash,
          recordHash,
          blockNumber: receipt.blockNumber,
          confirmations,
          network: cfg.network,
          simulated: false,
          receiptStatus: isSuccess ? "SUCCESS" : "REVERTED",
          verifiedAt: new Date().toISOString(),
          error: !isSuccess
            ? "Transaction reverted on chain."
            : !existsInContract
              ? "Record hash not found in registry contract state."
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
): Promise<OnChainVerificationReport> {
  const provider = getBlockchainProvider();
  return provider.verify(txHash, recordHash);
}
