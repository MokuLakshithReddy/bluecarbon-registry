/**
 * Blockchain abstraction layer (server only).
 *
 * The registry never writes files or raw datasets on-chain. It builds a
 * canonical verified-project record, hashes it, and anchors ONLY the hash.
 *
 * Providers:
 *  - SimulatedTestnetProvider (default): deterministic demo anchor, clearly
 *    labelled "Blockchain Testnet / Demo Record" in the UI.
 *  - EvmProvider: activated when BLOCKCHAIN_RPC_URL, BLOCKCHAIN_PRIVATE_KEY and
 *    BLOCKCHAIN_CONTRACT_ADDRESS are configured. Implement `anchor()` with an
 *    Ethereum-compatible client (Polygon, Ethereum L2, or an approved chain).
 */

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
  block_number: number;
  network: string;
  status: "CONFIRMED" | "PENDING" | "FAILED";
  simulated: boolean;
}

/** Stable, key-sorted JSON so the same record always hashes identically. */
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

interface BlockchainProvider {
  readonly network: string;
  readonly simulated: boolean;
  anchor(recordHash: string, payload: AnchorPayload): Promise<Omit<AnchorResult, "record_hash">>;
}

const simulatedProvider: BlockchainProvider = {
  network: "Testnet (Simulated)",
  simulated: true,
  async anchor(recordHash) {
    const tx = await sha256Hex(`tx:${recordHash}:${Date.now()}`);
    // Deterministic pseudo block height derived from the hash.
    const block = 4_800_000 + (parseInt(recordHash.slice(0, 6), 16) % 500_000);
    return {
      tx_hash: `0x${tx}`,
      block_number: block,
      network: this.network,
      status: "CONFIRMED",
      simulated: true,
    };
  },
};

function readEvmConfig() {
  const rpcUrl = process.env["BLOCKCHAIN_RPC_URL"];
  const privateKey = process.env["BLOCKCHAIN_PRIVATE_KEY"];
  const contract = process.env["BLOCKCHAIN_CONTRACT_ADDRESS"];
  const network = process.env["BLOCKCHAIN_NETWORK"] ?? "Polygon Amoy Testnet";
  if (!rpcUrl || !privateKey || !contract) return null;
  return { rpcUrl, privateKey, contract, network };
}

/**
 * Returns the configured provider. When Ethereum-compatible credentials are not
 * present, the simulated testnet provider is used and the record is labelled as
 * a demo record everywhere in the UI.
 */
export function getBlockchainProvider(): BlockchainProvider {
  const evm = readEvmConfig();
  if (!evm) return simulatedProvider;
  return {
    network: evm.network,
    simulated: false,
    async anchor(recordHash) {
      // Integration point: send `recordHash` to the registry contract, e.g.
      //   const wallet = new ethers.Wallet(evm.privateKey, new ethers.JsonRpcProvider(evm.rpcUrl));
      //   const c = new ethers.Contract(evm.contract, ABI, wallet);
      //   const tx = await c.anchorRecord("0x" + recordHash); const r = await tx.wait();
      // Until that client is wired, fall back to the simulated anchor so the
      // workflow never breaks mid-demo.
      const fallback = await simulatedProvider.anchor(recordHash, {} as AnchorPayload);
      return { ...fallback, network: `${evm.network} (client not wired)` };
    },
  };
}

export async function anchorVerifiedRecord(payload: AnchorPayload): Promise<AnchorResult> {
  const record_hash = await sha256Hex(canonicalize(payload));
  const provider = getBlockchainProvider();
  const result = await provider.anchor(record_hash, payload);
  return { record_hash, ...result };
}
