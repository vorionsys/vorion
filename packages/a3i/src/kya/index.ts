/**
 * KYA ↔ TrustSignalPipeline bridge
 *
 * Provides a factory that wires a KYA instance to a TrustSignalPipeline so
 * every accountability record automatically propagates a CT-ACCT trust signal
 * through the fast+slow pipeline lanes.
 */

import { KYA, type KYAConfig } from '@vorionsys/basis';
import { TrustSignalPipeline } from '../trust/signal-pipeline.js';

/**
 * Create a KYA instance whose accountability chain feeds trust signals into
 * the provided TrustSignalPipeline on every `append()` call.
 *
 * Usage:
 * ```ts
 * const pipeline = createSignalPipeline(dynamics, profiles);
 * const kya = createKYAWithPipeline(kyaConfig, pipeline);
 *
 * // Every accountability record now fires a CT-ACCT signal:
 * await kya.accountability.append(record);
 * ```
 */
export function createKYAWithPipeline(
  config: KYAConfig,
  pipeline: TrustSignalPipeline,
): KYA {
  return new KYA(config, async (agentId, success, factorCode, methodologyKey) => {
    await pipeline.process({ agentId, success, factorCode, methodologyKey });
  });
}
