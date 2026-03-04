# Post-Quantum Cryptography Module

Post-quantum cryptographic primitives for the Vorion security package, implementing NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA).

## Architecture

```
post-quantum/
  kyber.ts       - ML-KEM key encapsulation (FIPS 203)
  dilithium.ts   - ML-DSA digital signatures (FIPS 204)
  hybrid.ts      - Combined classical + PQ modes
  migration.ts   - Key rotation and gradual rollout toolkit
  types.ts       - Type definitions, Zod schemas, parameter constants
  benchmark.ts   - Performance benchmarking
  index.ts       - Barrel exports, convenience factories
```

## Cryptographic Backend

Uses `@noble/post-quantum` (v0.5.4) by Paul Miller -- an audited, pure-JS implementation of FIPS 203/204/205. Falls back to a hash-based reference implementation if the noble module is unavailable.

| Operation | Noble (real PQ) | Reference (simulation) |
|---|---|---|
| ML-KEM keygen | Real lattice keys | Hash-derived keys |
| ML-KEM encapsulate/decapsulate | Shared secrets match | Shared secrets do NOT match |
| ML-DSA sign/verify | Roundtrip verifies | Roundtrip does NOT verify |

To use real PQ operations, `@noble/post-quantum` must be installed (it is a dependency of this package) and `service.initialize()` must be called before key generation, signing, or KEM operations.

## Parameter Sizes (FIPS 203/204)

### ML-KEM (Kyber)

| Parameter Set | Security Level | Public Key | Secret Key | Ciphertext | Shared Secret |
|---|---|---|---|---|---|
| ML-KEM-512 | 1 (AES-128) | 800 B | 1632 B | 768 B | 32 B |
| ML-KEM-768 | 3 (AES-192) | 1184 B | 2400 B | 1088 B | 32 B |
| ML-KEM-1024 | 5 (AES-256) | 1568 B | 3168 B | 1568 B | 32 B |

### ML-DSA (Dilithium)

| Parameter Set | Security Level | Public Key | Secret Key | Signature |
|---|---|---|---|---|
| ML-DSA-44 | 2 | 1312 B | 2560 B | 2420 B |
| ML-DSA-65 | 3 | 1952 B | 4032 B | 3309 B |
| ML-DSA-87 | 5 | 2592 B | 4896 B | 4627 B |

## Integration Points

### Proof Layer (Hybrid Signing)

The proof layer at `packages/security/src/proof/` supports hybrid Ed25519 + Dilithium3 signing:

```typescript
import { ProofService } from '@vorion/security/proof';

const proof = new ProofService();
proof.setSigningAlgorithm('hybrid-ed25519-dilithium3');
await proof.initialize();
// All subsequent proofs are signed with both Ed25519 and ML-DSA-65
```

Combined signature format: `[4B length prefix][Ed25519 sig (64B)][ML-DSA-65 sig (3309B)]`

### FIPS Mode

ML-KEM and ML-DSA are registered as FIPS-approved algorithms in `fips-mode.ts`:

```typescript
import { validateAlgorithm, isFIPSCompliant } from '@vorion/security';

validateAlgorithm('ml-kem-768');  // true
validateAlgorithm('ml-dsa-65');   // true

isFIPSCompliant({
  type: 'sign',
  algorithm: 'ml-dsa-65',
  keyLength: 15616,  // 1952 bytes * 8
});  // true
```

## Usage

```typescript
import {
  KyberService,
  DilithiumService,
  createInitializedKyberService,
  createInitializedDilithiumService,
} from '@vorion/security';

// ML-KEM key exchange
const kyber = await createInitializedKyberService();
const keyPair = await kyber.generateKeyPair('kyber768');
const { ciphertext, sharedSecret: senderSecret } = await kyber.encapsulate(keyPair.publicKey, 'kyber768');
const { sharedSecret: recipientSecret } = await kyber.decapsulate(keyPair.privateKey, ciphertext, 'kyber768');
// senderSecret === recipientSecret

// ML-DSA signatures
const dilithium = await createInitializedDilithiumService();
const sigKeyPair = await dilithium.generateKeyPair('dilithium3');
const { signature } = await dilithium.sign(sigKeyPair.privateKey, message, 'dilithium3');
const { valid } = await dilithium.verify(sigKeyPair.publicKey, message, signature, 'dilithium3');
```

## Test Coverage

147 tests across 8 test files:

- `kyber.test.ts` (25): Service lifecycle, key generation, encapsulate/decapsulate roundtrips for all parameter sets, wrong-key detection
- `dilithium.test.ts` (25): Service lifecycle, key generation, sign/verify roundtrips for all parameter sets, tamper detection
- `hybrid.test.ts` (22): HybridKEM, HybridSign, HybridCryptoProvider roundtrips, isHybridSignature, splitHybridSignature
- `migration.test.ts` (22): KeyRotationManager, GradualRolloutManager, AlgorithmNegotiator, createMigrationToolkit
- `benchmark.test.ts` (8): BenchmarkRunner lifecycle, result structure, export formats
- `types.test.ts` (15): Parameter constants, Zod schemas, default configs
- `index.test.ts` (12): Barrel exports, factory functions
- `fips-pq.test.ts` (18): FIPS algorithm registry, validation functions
