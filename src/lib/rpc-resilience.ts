/**
 * Resilient Multi-Node RPC Fallback Provider & Wallet State Management
 *
 * Replaces fragile single-point public RPC endpoints with a resilient
 * multi-node provider pool (Alchemy, Infura, QuickNode) with automatic failover,
 * latency health-checking, and granular wallet error classification.
 */

import { ethers } from "ethers";

export interface RpcEndpointConfig {
  name: string;
  url: string;
  priority: number; // 1 = Primary, 2 = Secondary, 3 = Fallback
  expectedChainId: number;
  timeoutMs?: number;
}

export type WalletErrorCode =
  | "USER_REJECTED"
  | "UNRECOGNIZED_CHAIN"
  | "INSUFFICIENT_FUNDS"
  | "GAS_PRICE_SPIKE"
  | "NONCE_TOO_LOW"
  | "RPC_RATE_LIMITED"
  | "RPC_TIMEOUT"
  | "CONTRACT_REVERTED"
  | "UNKNOWN_ERROR";

export interface WalletErrorClassification {
  code: WalletErrorCode;
  userMessage: string;
  isRetryable: boolean;
  technicalDetails?: string;
}

/**
 * Classifies raw wallet and RPC errors into explicit, actionable user states.
 */
export function classifyWalletError(err: unknown): WalletErrorClassification {
  const errMsg = err instanceof Error ? err.message : String(err);
  const anyErr = err as { code?: number | string; info?: { error?: { code?: number } } };

  // 1. User rejection in MetaMask / WalletConnect (EIP-1193 code 4001 or 'ACTION_REJECTED')
  if (
    anyErr?.code === 4001 ||
    anyErr?.code === "ACTION_REJECTED" ||
    errMsg.includes("user rejected") ||
    errMsg.includes("User denied")
  ) {
    return {
      code: "USER_REJECTED",
      userMessage: "Transaction was cancelled in your wallet.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 2. Chain switch needed / unrecognized chain (code 4902)
  if (
    anyErr?.code === 4902 ||
    errMsg.includes("Unrecognized chain") ||
    errMsg.includes("chain switch")
  ) {
    return {
      code: "UNRECOGNIZED_CHAIN",
      userMessage:
        "Your wallet is connected to the wrong network. Please switch to the authorized registry network.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 3. Insufficient gas balance
  if (errMsg.includes("insufficient funds") || anyErr?.code === "INSUFFICIENT_FUNDS") {
    return {
      code: "INSUFFICIENT_FUNDS",
      userMessage: "Insufficient native gas token balance in wallet to pay for transaction fees.",
      isRetryable: false,
      technicalDetails: errMsg,
    };
  }

  // 4. Gas price spike / replacement underpriced
  if (
    errMsg.includes("replacement fee too low") ||
    errMsg.includes("max fee per gas less than block base fee")
  ) {
    return {
      code: "GAS_PRICE_SPIKE",
      userMessage: "Network congestion spike. Please try again with higher priority gas tip.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 5. Nonce collision / transaction underpriced
  if (errMsg.includes("nonce too low") || errMsg.includes("NONCE_EXPIRED")) {
    return {
      code: "NONCE_TOO_LOW",
      userMessage:
        "A previous transaction is still pending. Please wait or reset your account nonce.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 6. RPC rate limiting (HTTP 429)
  if (
    errMsg.includes("429") ||
    errMsg.includes("rate limit") ||
    errMsg.includes("Too Many Requests")
  ) {
    return {
      code: "RPC_RATE_LIMITED",
      userMessage: "RPC node rate limit exceeded. Automatically routing to backup node.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 7. Timeout
  if (errMsg.includes("timeout") || errMsg.includes("TIMEOUT")) {
    return {
      code: "RPC_TIMEOUT",
      userMessage: "Network request timed out waiting for RPC node response.",
      isRetryable: true,
      technicalDetails: errMsg,
    };
  }

  // 8. Reverted
  if (errMsg.includes("revert") || errMsg.includes("CALL_EXCEPTION")) {
    return {
      code: "CONTRACT_REVERTED",
      userMessage:
        "Smart contract execution reverted. Check project verification and role permissions.",
      isRetryable: false,
      technicalDetails: errMsg,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    userMessage: "An unexpected error occurred while communicating with the blockchain.",
    isRetryable: true,
    technicalDetails: errMsg,
  };
}

/**
 * Resilient multi-node RPC provider manager with automatic failover.
 */
export class FallbackRpcProviderManager {
  private readonly endpoints: RpcEndpointConfig[];
  private activeEndpointIndex = 0;

  constructor(endpoints: RpcEndpointConfig[]) {
    if (!endpoints || endpoints.length === 0) {
      throw new Error(
        "FallbackRpcProviderManager requires at least one RPC endpoint configuration.",
      );
    }
    // Sort by priority ascending (1 first)
    this.endpoints = [...endpoints].sort((a, b) => a.priority - b.priority);
  }

  public getActiveEndpoint(): RpcEndpointConfig {
    return this.endpoints[this.activeEndpointIndex]!;
  }

  /**
   * Executes an RPC operation with automatic failover to backup endpoints upon network error or 429 rate limit.
   */
  public async executeWithFailover<T>(
    operation: (provider: ethers.JsonRpcProvider, endpoint: RpcEndpointConfig) => Promise<T>,
  ): Promise<T> {
    let lastError: Error | null = null;
    const startIndex = this.activeEndpointIndex;

    for (let attempts = 0; attempts < this.endpoints.length; attempts++) {
      const currentIndex = (startIndex + attempts) % this.endpoints.length;
      const endpoint = this.endpoints[currentIndex]!;
      const net = new ethers.Network(endpoint.name, endpoint.expectedChainId);
      const provider = new ethers.JsonRpcProvider(endpoint.url, net, { staticNetwork: net });

      try {
        const result = await Promise.race([
          operation(provider, endpoint),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`RPC request timed out after ${endpoint.timeoutMs ?? 5000}ms`)),
              endpoint.timeoutMs ?? 5000,
            ),
          ),
        ]);

        // Success: update active index to this working endpoint
        this.activeEndpointIndex = currentIndex;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Continue loop to try next fallback endpoint
      }
    }

    throw new Error(
      `All ${this.endpoints.length} configured RPC endpoints failed. Last error: ${lastError?.message}`,
    );
  }
}
