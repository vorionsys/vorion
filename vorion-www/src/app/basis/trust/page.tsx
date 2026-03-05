import { BasisLayout } from '@/components/BasisLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trust Model | BASIS',
  description: 'The BASIS trust model: 0-1000 scoring, eight tiers (T0–T7), decay mechanics, and tier-scaled failure amplification.',
};

export default function TrustPage() {
  return (
    <BasisLayout
      title="Trust Model"
      description="Quantified trust scoring with tiers and dynamics"
      breadcrumb="Trust Model"
    >
      <div className="space-y-12">
        {/* Overview */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Overview</h2>
          <p className="text-neutral-400 leading-relaxed">
            BASIS uses a quantified trust model where entities earn trust through successful operations. Trust is not binary (allow/deny) but graduated on a 0-1000 scale with eight tiers (T0–T7) that progressively unlock capabilities.
          </p>
        </section>

        {/* Trust Score Range */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Trust Score Range</h2>
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-red-400 font-mono">0</span>
              <span className="text-purple-400 font-mono">1000</span>
            </div>
            <div className="h-4 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 to-purple-500 mb-4"></div>
            <div className="flex justify-between text-xs text-neutral-500">
              <span>T0</span>
              <span>T1</span>
              <span>T2</span>
              <span>T3</span>
              <span>T4</span>
              <span>T5</span>
              <span>T6</span>
              <span>T7</span>
            </div>
          </div>
        </section>

        {/* Trust Tiers */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Eight Trust Tiers (T0–T7)</h2>
          <div className="space-y-4">
            <TierCard
              name="T0 — Sandbox"
              range="0–199"
              color="red"
              capabilities={['Isolated testing only', 'No external access', 'No data persistence', 'Failure penalty 2× (most lenient)']}
              description="New or untrusted agents. Completely sandboxed for evaluation."
            />
            <TierCard
              name="T1 — Observed"
              range="200–349"
              color="orange"
              capabilities={['Read public data', 'Internal messaging', 'Basic queries', 'Failure penalty 3×']}
              description="Under active observation. Limited read access with heavy monitoring."
            />
            <TierCard
              name="T2 — Provisional"
              range="350–499"
              color="amber"
              capabilities={['Limited write operations', 'Strict guardrails enforced', 'Supervised external reads', 'Failure penalty 4×']}
              description="Initial trust established. Write access permitted under strict constraints."
            />
            <TierCard
              name="T3 — Monitored"
              range="500–649"
              color="yellow"
              capabilities={['Standard internal workflows', 'Limited external reads', 'Expanding operational freedom', 'Failure penalty 5×']}
              description="Continuous monitoring with expanding freedom. Track record building."
            />
            <TierCard
              name="T4 — Standard"
              range="650–799"
              color="green"
              capabilities={['External API calls', 'Email and messaging', 'Routine operations', 'Failure penalty 7×']}
              description="Trusted for routine operations. External interactions permitted with normal oversight."
            />
            <TierCard
              name="T5 — Trusted"
              range="800–875"
              color="blue"
              capabilities={['Financial transactions', 'Expanded capability access', 'Minimal oversight required', 'Failure penalty 10×']}
              description="Proven reliability. Financial and sensitive operations with minimal oversight."
            />
            <TierCard
              name="T6 — Certified"
              range="876–950"
              color="indigo"
              capabilities={['Privileged operations', 'Sensitive data access', 'Independent operation', 'Failure penalty 10×']}
              description="Independently certified. Operates autonomously with comprehensive audit trail."
            />
            <TierCard
              name="T7 — Autonomous"
              range="951–1000"
              color="purple"
              capabilities={['Full autonomy within policy', 'Administrative functions', 'Audit-only oversight', 'Failure penalty 10×']}
              description="Maximum trust. Complete autonomy within defined policy boundaries — zero tolerance for failures."
            />
          </div>
        </section>

        {/* Trust Dynamics */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Trust Dynamics</h2>

          <h3 className="text-xl font-semibold text-white mb-3 mt-6">Decay</h3>
          <p className="text-neutral-400 leading-relaxed mb-4">
            Trust scores decay over time to prevent stale high-trust entities. The decay follows a half-life model:
          </p>
          <div className="bg-black/30 border border-white/10 rounded-xl p-6 mb-4">
            <pre className="text-sm text-neutral-300 font-mono">
{`DECAY_HALF_LIFE_DAYS = 7

decay_factor = 0.5 ^ (days_since_last_action / DECAY_HALF_LIFE_DAYS)
decayed_score = current_score * decay_factor`}
            </pre>
          </div>
          <p className="text-neutral-400 text-sm">
            Example: An agent with score 800 that takes no action for 7 days decays to 400.
          </p>

          <h3 className="text-xl font-semibold text-white mb-3 mt-8">Failure Amplification</h3>
          <p className="text-neutral-400 leading-relaxed mb-4">
            Failure penalties scale with the agent&apos;s current tier. Lower-tier agents receive smaller
            multipliers so new bots can ascend more easily; high-trust agents pay a steep price for any lapse.
          </p>
          <div className="bg-black/30 border border-white/10 rounded-xl p-6 mb-4">
            <pre className="text-sm text-neutral-300 font-mono">
{`# Tier-scaled failure multipliers (lower = more lenient, aids ascension)
TIER_FAILURE_MULTIPLIERS = {
    "T0": 2,   # Sandbox      — very forgiving
    "T1": 3,   # Observed
    "T2": 4,   # Provisional
    "T3": 5,   # Monitored
    "T4": 7,   # Standard
    "T5": 10,  # Trusted
    "T6": 10,  # Certified
    "T7": 10,  # Autonomous   — no margin for error
}

tier = get_trust_tier(current_score)
if action_delta < 0:
    action_delta = action_delta * TIER_FAILURE_MULTIPLIERS[tier]`}
            </pre>
          </div>
          <p className="text-neutral-400 text-sm">
            Example: A T0 agent failing costs 2× base; the same failure from a T5+ agent costs 10× base.
          </p>

          <h3 className="text-xl font-semibold text-white mb-3 mt-8">Tier Boundaries</h3>
          <p className="text-neutral-400 leading-relaxed mb-4">
            Trust tiers have hard boundaries. An entity cannot skip tiers and must progress through each level:
          </p>
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className="text-left px-4 py-3 text-neutral-400 font-medium">Transition</th>
                  <th className="text-left px-4 py-3 text-neutral-400 font-medium">Minimum Actions</th>
                  <th className="text-left px-4 py-3 text-neutral-400 font-medium">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                <tr><td className="px-4 py-3 text-neutral-300">T0 → T1 (Sandbox → Observed)</td><td className="px-4 py-3 font-mono text-neutral-400">20</td><td className="px-4 py-3 text-neutral-400">100%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T1 → T2 (Observed → Provisional)</td><td className="px-4 py-3 font-mono text-neutral-400">50</td><td className="px-4 py-3 text-neutral-400">95%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T2 → T3 (Provisional → Monitored)</td><td className="px-4 py-3 font-mono text-neutral-400">100</td><td className="px-4 py-3 text-neutral-400">95%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T3 → T4 (Monitored → Standard)</td><td className="px-4 py-3 font-mono text-neutral-400">200</td><td className="px-4 py-3 text-neutral-400">98%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T4 → T5 (Standard → Trusted)</td><td className="px-4 py-3 font-mono text-neutral-400">500</td><td className="px-4 py-3 text-neutral-400">99%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T5 → T6 (Trusted → Certified)</td><td className="px-4 py-3 font-mono text-neutral-400">750</td><td className="px-4 py-3 text-neutral-400">99.5%</td></tr>
                <tr><td className="px-4 py-3 text-neutral-300">T6 → T7 (Certified → Autonomous)</td><td className="px-4 py-3 font-mono text-neutral-400">1000</td><td className="px-4 py-3 text-neutral-400">99.9%</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Trust Score Algorithm */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Trust Score Algorithm</h2>
          <div className="bg-black/30 border border-white/10 rounded-xl p-6 overflow-x-auto">
            <pre className="text-sm text-neutral-300 font-mono">
{`# Constants
DECAY_HALF_LIFE_DAYS = 7

# Tier-scaled failure multipliers (lower tiers more lenient to aid ascension)
TIER_FAILURE_MULTIPLIERS = {
    "T0": 2, "T1": 3, "T2": 4,  "T3": 5,
    "T4": 7, "T5": 10, "T6": 10, "T7": 10,
}

# Action deltas by outcome
ACTION_DELTAS = {
    "success_low_risk": 5,
    "success_medium_risk": 10,
    "success_high_risk": 25,
    "success_critical_risk": 50,
    "failure_low_risk": -10,
    "failure_medium_risk": -25,
    "failure_high_risk": -50,
    "failure_critical_risk": -100,
    "policy_violation": -200,
    "security_incident": -500
}

def calculate_trust_score(
    current_score: int,
    days_since_last_action: float,
    action_outcome: str
) -> int:
    # Apply decay
    decay_factor = 0.5 ** (days_since_last_action / DECAY_HALF_LIFE_DAYS)
    decayed_score = current_score * decay_factor

    # Get delta for action
    delta = ACTION_DELTAS.get(action_outcome, 0)

    # Apply tier-scaled failure amplification
    if delta < 0:
        tier = get_trust_tier(int(decayed_score))
        delta = delta * TIER_FAILURE_MULTIPLIERS.get(tier, 2)

    # Calculate new score with bounds
    new_score = max(0, min(1000, int(decayed_score + delta)))

    return new_score`}
            </pre>
          </div>
        </section>

        {/* Tier Derivation */}
        <section>
          <h2 className="text-2xl font-bold text-white mb-4">Tier Derivation</h2>
          <div className="bg-black/30 border border-white/10 rounded-xl p-6 overflow-x-auto">
            <pre className="text-sm text-neutral-300 font-mono">
{`def get_trust_tier(score: int) -> str:
    if score >= 951:
        return "T7"   # Autonomous
    elif score >= 876:
        return "T6"   # Certified
    elif score >= 800:
        return "T5"   # Trusted
    elif score >= 650:
        return "T4"   # Standard
    elif score >= 500:
        return "T3"   # Monitored
    elif score >= 350:
        return "T2"   # Provisional
    elif score >= 200:
        return "T1"   # Observed
    else:
        return "T0"   # Sandbox`}
            </pre>
          </div>
        </section>
      </div>
    </BasisLayout>
  );
}

function TierCard({ name, range, color, capabilities, description }: {
  name: string;
  range: string;
  color: string;
  capabilities: string[];
  description: string;
}) {
  const colors: Record<string, string> = {
    red: 'border-red-500/30 bg-red-500/10',
    orange: 'border-orange-500/30 bg-orange-500/10',
    amber: 'border-amber-500/30 bg-amber-500/10',
    yellow: 'border-yellow-500/30 bg-yellow-500/10',
    green: 'border-emerald-500/30 bg-emerald-500/10',
    blue: 'border-blue-500/30 bg-blue-500/10',
    indigo: 'border-indigo-500/30 bg-indigo-500/10',
    purple: 'border-purple-500/30 bg-purple-500/10',
  };
  const textColors: Record<string, string> = {
    red: 'text-red-400',
    orange: 'text-orange-400',
    amber: 'text-amber-400',
    yellow: 'text-yellow-400',
    green: 'text-emerald-400',
    blue: 'text-blue-400',
    indigo: 'text-indigo-400',
    purple: 'text-purple-400',
  };

  return (
    <div className={`p-5 rounded-xl border ${colors[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={`text-xl font-bold ${textColors[color]}`}>{name}</h3>
        <span className="font-mono text-sm text-neutral-400">{range}</span>
      </div>
      <p className="text-neutral-400 text-sm mb-3">{description}</p>
      <ul className="space-y-1">
        {capabilities.map((cap, i) => (
          <li key={i} className="flex items-center gap-2 text-sm text-neutral-300">
            <span className={textColors[color]}>•</span> {cap}
          </li>
        ))}
      </ul>
    </div>
  );
}
