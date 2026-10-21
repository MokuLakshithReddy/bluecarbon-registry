/**
 * On-Chain Event Indexing & Analytical Caching Layer
 *
 * Prevents client-side frontends from making expensive direct RPC calls
 * by indexing contract events into a fast, queryable local store.
 *
 * Indexes:
 * - RecordAnchored
 * - CreditBatchMinted
 * - CreditsRetired
 * - RoleGranted / RoleRevoked
 */

export interface IndexedAnchoredRecord {
  recordHash: string;
  projectCode: string;
  verifiedCarbonMilliTco2e: bigint;
  timestamp: number;
  verifier: string;
  txHash: string;
  blockNumber: number;
}

export interface IndexedCreditBatch {
  recordHash: string;
  projectCode: string;
  totalMintedMilli: bigint;
  circulatingMilli: bigint;
  bufferPoolMilli: bigint;
  vintageYear: number;
  minter: string;
  txHash: string;
  blockNumber: number;
}

export interface IndexedRetirement {
  certificateId: string;
  recordHash: string;
  retiree: string;
  beneficiary: string;
  amountMilliTco2e: bigint;
  retirementReason: string;
  timestamp: number;
  txHash: string;
  blockNumber: number;
}

export class BlockchainEventIndexer {
  private readonly anchoredRecords: Map<string, IndexedAnchoredRecord> = new Map();
  private readonly creditBatches: Map<string, IndexedCreditBatch> = new Map();
  private readonly retirements: Map<string, IndexedRetirement> = new Map();

  /**
   * Ingests a RecordAnchored event into the index.
   */
  public indexRecordAnchored(record: IndexedAnchoredRecord): void {
    this.anchoredRecords.set(record.recordHash.toLowerCase(), record);
  }

  /**
   * Ingests a CreditBatchMinted event into the index.
   */
  public indexCreditBatch(batch: IndexedCreditBatch): void {
    this.creditBatches.set(batch.recordHash.toLowerCase(), batch);
  }

  /**
   * Ingests a CreditsRetired event into the index.
   */
  public indexRetirement(retirement: IndexedRetirement): void {
    this.retirements.set(retirement.certificateId.toLowerCase(), retirement);

    // Also deduct from local circulating batch index
    const batch = this.creditBatches.get(retirement.recordHash.toLowerCase());
    if (batch && batch.circulatingMilli >= retirement.amountMilliTco2e) {
      batch.circulatingMilli -= retirement.amountMilliTco2e;
    }
  }

  /**
   * Fast query for an anchored record by hash without touching RPC.
   */
  public getAnchoredRecord(recordHash: string): IndexedAnchoredRecord | undefined {
    return this.anchoredRecords.get(recordHash.toLowerCase());
  }

  /**
   * Fast query for credit batch by record hash.
   */
  public getCreditBatch(recordHash: string): IndexedCreditBatch | undefined {
    return this.creditBatches.get(recordHash.toLowerCase());
  }

  /**
   * Fast query for retirement certificate by ID.
   */
  public getRetirementCertificate(certificateId: string): IndexedRetirement | undefined {
    return this.retirements.get(certificateId.toLowerCase());
  }

  /**
   * Paginated search for retirements by project code or beneficiary.
   */
  public queryRetirements(params: {
    beneficiarySearch?: string;
    limit?: number;
    offset?: number;
  }): { items: IndexedRetirement[]; total: number } {
    let list = Array.from(this.retirements.values());

    if (params.beneficiarySearch) {
      const q = params.beneficiarySearch.toLowerCase();
      list = list.filter((r) => r.beneficiary.toLowerCase().includes(q));
    }

    // Sort descending by timestamp
    list.sort((a, b) => b.timestamp - a.timestamp);

    const offset = params.offset ?? 0;
    const limit = params.limit ?? 20;
    return {
      items: list.slice(offset, offset + limit),
      total: list.length,
    };
  }

  /**
   * Clears internal in-memory index (for testing).
   */
  public clear(): void {
    this.anchoredRecords.clear();
    this.creditBatches.clear();
    this.retirements.clear();
  }
}

export const globalEventIndexer = new BlockchainEventIndexer();
