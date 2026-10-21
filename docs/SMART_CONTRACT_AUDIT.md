# Smart Contract Security Audit & Formal Verification Runbook

## 1. Overview

The **BlueCarbon Registry** smart contract architecture (`contracts/BlueCarbonRegistry.sol`) anchors verified carbon restoration claims, mints institutional credit batches, and enforces irreversible on-chain credit retirements with unique certificate generation.

Before deploying to Ethereum Mainnet or Polygon PoS Mainnet, the contracts must pass static analysis, symbolic execution, and an external third-party security audit.

---

## 2. Static Analysis & Tooling

### A. Slither (Trail of Bits)

Slither is a static analysis framework for Solidity that detects common vulnerabilities, reentrancy vectors, access-control oversights, and gas inefficiencies.

#### Installation

```bash
pip3 install slither-analyzer
```

#### Running Slither

```bash
slither contracts/BlueCarbonRegistry.sol --solc-remaps "" --checklist
```

#### Key Detectors Checked:

- `reentrancy-eth`: Ensures state updates occur before external calls (Checks-Effects-Interactions pattern).
- `unprotected-upgrade`: Confirms RBAC guards on administrative entrypoints.
- `controlled-array-length`: Verifies array and loop bounds.
- `shadowing-state`: Prevents variable name collisions between inheritance trees.

---

### B. Aderyn (Cyfrin)

Aderyn is a Rust-based Solidity static analyzer designed to detect edge cases and logic flaws in modern EVM contracts.

#### Installation

```bash
cargo install aderyn
```

#### Running Aderyn

```bash
aderyn .
```

---

### C. Mythril (ConsenSys)

Mythril uses symbolic execution, SMT solving, and taint analysis to detect security vulnerabilities in EVM bytecode.

#### Installation

```bash
pip3 install mythril
```

#### Running Mythril Analysis

```bash
myth analyze contracts/BlueCarbonRegistry.sol --solc-json <(echo '{"language":"Solidity","settings":{"optimizer":{"enabled":true,"runs":200}}}')
```

---

## 3. Gas Optimization Profile

1. **Custom Errors**: Contract utilizes custom errors (e.g. `revert UnauthorizedVerifier(msg.sender)`) instead of string errors (`revert("Unauthorized")`), saving ~50 gas per revert and reducing deployment bytecode.
2. **Fixed-Point Scaling**: Carbon quantities are stored as `uint256` scaled by `CARBON_SCALE_FACTOR = 1000` (milli-tCO2e = kilograms CO2e), eliminating floating-point errors and saving gas.
3. **Calldata & Memory Optimization**: External view and mutation functions take `calldata` structs (`BatchInput calldata input`) rather than loose parameter stacks, avoiding EVM stack-depth exhaustion and reducing calldata expansion gas.

---

## 4. Pre-Mainnet Multi-Sig & Timelock Setup

1. **Multi-Sig Administration**:
   - Replace the single deployer `owner` address with a Gnosis Safe multi-signature wallet requiring 3-of-5 consensus among certified registry governors and independent auditors.
2. **Two-Step Timelock Delay**:
   - Sensitive administrative operations (oracle updates, verifier authorization, parameter modifications) must be scheduled via `scheduleTimelock(bytes32 actionHash)` and wait for `TIMELOCK_DELAY` (2 days) before calling `executeTimelock(bytes32 actionHash)`.
3. **Emergency Circuit Breaker**:
   - Authorized verifiers can pause new batch minting if anomalous satellite telemetry is detected.
