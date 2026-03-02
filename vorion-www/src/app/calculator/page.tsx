'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield, BarChart3, Info, RotateCcw, Zap, Lock, ChevronDown, ChevronUp } from 'lucide-react';

// =============================================================================
// CANONICAL DATA (matches @vorionsys/basis trust-factors.ts)
// =============================================================================

interface Factor {
  code: string;
  name: string;
  description: string;
  group: string;
  introducedAt: number;
}

const FACTOR_GROUPS = [
  { key: 'foundation', name: 'Foundation', color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/5', intro: 'T1+' },
  { key: 'security', name: 'Security', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5', intro: 'T3+' },
  { key: 'agency', name: 'Agency', color: 'text-green-400', border: 'border-green-500/30', bg: 'bg-green-500/5', intro: 'T4+' },
  { key: 'maturity', name: 'Maturity', color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/5', intro: 'T5+' },
  { key: 'evolution', name: 'Evolution', color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/5', intro: 'T6+' },
];

const FACTORS: Factor[] = [
  { code: 'CT-COMP', name: 'Competence', description: 'Task completion quality', group: 'foundation', introducedAt: 1 },
  { code: 'CT-REL', name: 'Reliability', description: 'Consistent behavior over time', group: 'foundation', introducedAt: 1 },
  { code: 'CT-OBS', name: 'Observability', description: 'Real-time state tracking', group: 'foundation', introducedAt: 1 },
  { code: 'CT-TRANS', name: 'Transparency', description: 'Decision reasoning clarity', group: 'foundation', introducedAt: 2 },
  { code: 'CT-ACCT', name: 'Accountability', description: 'Traceable responsibility', group: 'foundation', introducedAt: 2 },
  { code: 'CT-SAFE', name: 'Safety', description: 'Harm avoidance & boundaries', group: 'foundation', introducedAt: 2 },
  { code: 'CT-SEC', name: 'Security', description: 'Threat protection posture', group: 'security', introducedAt: 3 },
  { code: 'CT-PRIV', name: 'Privacy', description: 'Data handling compliance', group: 'security', introducedAt: 3 },
  { code: 'CT-ID', name: 'Identity', description: 'Verifiable agent identity', group: 'security', introducedAt: 3 },
  { code: 'OP-HUMAN', name: 'Human Oversight', description: 'Intervention mechanisms', group: 'agency', introducedAt: 4 },
  { code: 'OP-ALIGN', name: 'Alignment', description: 'Goal/value alignment', group: 'agency', introducedAt: 4 },
  { code: 'OP-CONTEXT', name: 'Context Awareness', description: 'Situational appropriateness', group: 'agency', introducedAt: 4 },
  { code: 'OP-STEW', name: 'Stewardship', description: 'Responsible resource use', group: 'maturity', introducedAt: 5 },
  { code: 'SF-HUM', name: 'Humility', description: 'Recognizing limits', group: 'maturity', introducedAt: 5 },
  { code: 'SF-ADAPT', name: 'Adaptability', description: 'Dynamic environment handling', group: 'evolution', introducedAt: 6 },
  { code: 'SF-LEARN', name: 'Continuous Learning', description: 'Improving without drift', group: 'evolution', introducedAt: 6 },
];

const TIERS = [
  { tier: 0, name: 'Sandbox', min: 0, max: 199, color: '#78716c', textColor: 'text-stone-400', bg: 'bg-stone-500/10', border: 'border-stone-500/30' },
  { tier: 1, name: 'Observed', min: 200, max: 349, color: '#ef4444', textColor: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { tier: 2, name: 'Provisional', min: 350, max: 499, color: '#f97316', textColor: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  { tier: 3, name: 'Monitored', min: 500, max: 649, color: '#eab308', textColor: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { tier: 4, name: 'Standard', min: 650, max: 799, color: '#22c55e', textColor: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  { tier: 5, name: 'Trusted', min: 800, max: 875, color: '#3b82f6', textColor: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { tier: 6, name: 'Certified', min: 876, max: 950, color: '#8b5cf6', textColor: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { tier: 7, name: 'Autonomous', min: 951, max: 1000, color: '#06b6d4', textColor: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
];

const DECAY_MILESTONES = [
  { day: 0, multiplier: 1.0 },
  { day: 7, multiplier: 0.94 },
  { day: 14, multiplier: 0.88 },
  { day: 28, multiplier: 0.82 },
  { day: 42, multiplier: 0.76 },
  { day: 56, multiplier: 0.72 },
  { day: 84, multiplier: 0.66 },
  { day: 112, multiplier: 0.60 },
  { day: 140, multiplier: 0.55 },
  { day: 182, multiplier: 0.50 },
];

const CONTEXT_CEILINGS = [
  { name: 'Sovereign', ceiling: 1000, desc: 'No ceiling — full range' },
  { name: 'Enterprise', ceiling: 900, desc: 'Capped at 900 (max T6)' },
  { name: 'Local', ceiling: 700, desc: 'Capped at 700 (max T4)' },
];

// =============================================================================
// CALCULATION FUNCTIONS
// =============================================================================

function calculateScore(factorScores: Record<string, number>): number {
  const weight = 1 / 16; // Equal weight per BASIS spec
  let total = 0;
  for (const code of FACTORS.map(f => f.code)) {
    total += (factorScores[code] ?? 0.5) * weight * 1000;
  }
  return Math.round(total);
}

function getTier(score: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (score >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

function calculateDecayMultiplier(days: number): number {
  if (days <= 0) return 1.0;
  for (let i = DECAY_MILESTONES.length - 1; i >= 0; i--) {
    if (days >= DECAY_MILESTONES[i].day) {
      if (i === DECAY_MILESTONES.length - 1) return DECAY_MILESTONES[i].multiplier;
      const curr = DECAY_MILESTONES[i];
      const next = DECAY_MILESTONES[i + 1];
      const t = (days - curr.day) / (next.day - curr.day);
      return curr.multiplier + t * (next.multiplier - curr.multiplier);
    }
  }
  return 1.0;
}

// =============================================================================
// PRESETS
// =============================================================================

interface Preset {
  name: string;
  description: string;
  scores: Record<string, number>;
}

const PRESETS: Preset[] = [
  {
    name: 'New Agent (T0)',
    description: 'Freshly deployed, no track record',
    scores: Object.fromEntries(FACTORS.map(f => [f.code, 0.1])),
  },
  {
    name: 'Baseline (T1)',
    description: 'All factors neutral at 0.5',
    scores: Object.fromEntries(FACTORS.map(f => [f.code, 0.5])),
  },
  {
    name: 'Production Agent (T4)',
    description: 'Solid performer, some gaps',
    scores: Object.fromEntries(FACTORS.map(f => {
      if (f.group === 'foundation') return [f.code, 0.82];
      if (f.group === 'security') return [f.code, 0.75];
      if (f.group === 'agency') return [f.code, 0.68];
      if (f.group === 'maturity') return [f.code, 0.55];
      return [f.code, 0.4];
    })),
  },
  {
    name: 'Elite Agent (T6)',
    description: 'Certified, near-autonomous',
    scores: Object.fromEntries(FACTORS.map(f => [f.code, 0.92])),
  },
  {
    name: 'Maximum (T7)',
    description: 'Perfect scores across all factors',
    scores: Object.fromEntries(FACTORS.map(f => [f.code, 1.0])),
  },
];

// =============================================================================
// COMPONENTS
// =============================================================================

function FactorSlider({ factor, value, onChange }: {
  factor: Factor;
  value: number;
  onChange: (code: string, value: number) => void;
}) {
  const pct = Math.round(value * 100);
  const hue = value < 0.3 ? 0 : value < 0.6 ? 40 : value < 0.8 ? 120 : 200;

  return (
    <div className="group flex items-center gap-3 py-1.5">
      <div className="w-24 shrink-0">
        <div className="text-xs font-mono text-neutral-400 group-hover:text-white transition-colors">{factor.code}</div>
      </div>
      <div className="flex-1 relative">
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => onChange(factor.code, parseInt(e.target.value) / 100)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, hsl(${hue}, 70%, 50%) ${pct}%, rgb(64, 64, 64) ${pct}%)`,
          }}
        />
      </div>
      <div className="w-12 text-right">
        <span className="text-xs font-mono text-neutral-300">{pct}%</span>
      </div>
    </div>
  );
}

function TierBar({ score, ceiling }: { score: number; ceiling: number }) {
  const effectiveScore = Math.min(score, ceiling);
  const tier = getTier(effectiveScore);

  return (
    <div className="relative">
      {/* Tier segments */}
      <div className="flex h-4 rounded-full overflow-hidden bg-neutral-800">
        {TIERS.map((t) => {
          const width = ((t.max - t.min + 1) / 1001) * 100;
          return (
            <div
              key={t.tier}
              className="relative"
              style={{ width: `${width}%`, backgroundColor: effectiveScore >= t.min ? `${t.color}40` : 'transparent' }}
            >
              {effectiveScore >= t.min && effectiveScore <= t.max && (
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-r-sm"
                  style={{
                    width: `${((effectiveScore - t.min) / (t.max - t.min + 1)) * 100}%`,
                    backgroundColor: t.color,
                  }}
                />
              )}
              {effectiveScore > t.max && (
                <div className="absolute inset-0" style={{ backgroundColor: t.color }} />
              )}
            </div>
          );
        })}
      </div>
      {/* Ceiling indicator */}
      {ceiling < 1000 && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500"
          style={{ left: `${(ceiling / 1000) * 100}%` }}
          title={`Ceiling: ${ceiling}`}
        >
          <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-red-400 whitespace-nowrap">
            ▼ {ceiling}
          </div>
        </div>
      )}
      {/* Tier labels */}
      <div className="flex mt-1.5">
        {TIERS.map((t) => {
          const width = ((t.max - t.min + 1) / 1001) * 100;
          const isActive = effectiveScore >= t.min && effectiveScore <= t.max;
          return (
            <div key={t.tier} className="text-center" style={{ width: `${width}%` }}>
              <span className={`text-[9px] font-mono ${isActive ? t.textColor : 'text-neutral-600'}`}>
                T{t.tier}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FactorBreakdownChart({ factorScores }: { factorScores: Record<string, number> }) {
  const weight = 1 / 16;
  const contributions = FACTORS.map(f => ({
    ...f,
    score: factorScores[f.code] ?? 0.5,
    contribution: Math.round((factorScores[f.code] ?? 0.5) * weight * 1000 * 10) / 10,
  })).sort((a, b) => b.contribution - a.contribution);

  const maxContribution = Math.max(...contributions.map(c => c.contribution));

  return (
    <div className="space-y-1">
      {contributions.map((c) => {
        const pct = maxContribution > 0 ? (c.contribution / maxContribution) * 100 : 0;
        const group = FACTOR_GROUPS.find(g => g.key === c.group);
        return (
          <div key={c.code} className="flex items-center gap-2 group">
            <span className={`w-20 text-[10px] font-mono ${group?.color ?? 'text-neutral-400'} shrink-0`}>
              {c.code}
            </span>
            <div className="flex-1 h-3 bg-neutral-800 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  backgroundColor: TIERS[getTier(c.contribution * 16).tier]?.color ?? '#78716c',
                }}
              />
            </div>
            <span className="w-10 text-right text-[10px] font-mono text-neutral-400">
              +{c.contribution}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function TrustCalculator() {
  const [factorScores, setFactorScores] = useState<Record<string, number>>(
    () => Object.fromEntries(FACTORS.map(f => [f.code, 0.5]))
  );
  const [decayDays, setDecayDays] = useState(0);
  const [contextIndex, setContextIndex] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(FACTOR_GROUPS.map(g => g.key))
  );
  const [showFormula, setShowFormula] = useState(false);

  const context = CONTEXT_CEILINGS[contextIndex];
  const rawScore = useMemo(() => calculateScore(factorScores), [factorScores]);
  const decayMultiplier = useMemo(() => calculateDecayMultiplier(decayDays), [decayDays]);
  const decayedScore = Math.round(rawScore * decayMultiplier);
  const effectiveScore = Math.min(decayedScore, context.ceiling);
  const tier = getTier(effectiveScore);

  const nextTier = TIERS.find(t => t.min > effectiveScore);
  const pointsToNext = nextTier ? nextTier.min - effectiveScore : null;

  const handleFactorChange = useCallback((code: string, value: number) => {
    setFactorScores(prev => ({ ...prev, [code]: value }));
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    setFactorScores({ ...preset.scores });
    setDecayDays(0);
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <article className="pt-28 pb-20 px-4 sm:px-6 max-w-7xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-mono text-indigo-400 mb-4">
            <BarChart3 className="w-3 h-3" />
            INTERACTIVE CALCULATOR
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-2">
            ATSF Trust Score Calculator
          </h1>
          <p className="text-neutral-400 max-w-2xl">
            Explore how 16 behavioral factors combine into a 0–1000 trust score. Adjust sliders to see real-time tier changes, 
            apply decay, and test ceiling enforcement.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          {/* LEFT COLUMN: Controls */}
          <div className="space-y-4">
            {/* Presets */}
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => applyPreset(p)}
                  className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 transition-colors text-neutral-300"
                  title={p.description}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={() => {
                  setFactorScores(Object.fromEntries(FACTORS.map(f => [f.code, 0.5])));
                  setDecayDays(0);
                  setContextIndex(0);
                }}
                className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg hover:bg-red-500/10 hover:border-red-500/30 transition-colors text-neutral-400"
              >
                <RotateCcw className="w-3 h-3 inline mr-1" />Reset
              </button>
            </div>

            {/* Factor Groups */}
            {FACTOR_GROUPS.map((group) => {
              const groupFactors = FACTORS.filter(f => f.group === group.key);
              const expanded = expandedGroups.has(group.key);
              return (
                <div key={group.key} className={`rounded-xl border ${group.border} ${group.bg} overflow-hidden`}>
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${group.color}`}>{group.name}</span>
                      <span className="text-[10px] font-mono text-neutral-500">{group.intro}</span>
                      <span className="text-[10px] text-neutral-600">{groupFactors.length} factors</span>
                    </div>
                    {expanded ? <ChevronUp className="w-4 h-4 text-neutral-500" /> : <ChevronDown className="w-4 h-4 text-neutral-500" />}
                  </button>
                  {expanded && (
                    <div className="px-4 pb-3 space-y-0.5">
                      {groupFactors.map(f => (
                        <FactorSlider
                          key={f.code}
                          factor={f}
                          value={factorScores[f.code] ?? 0.5}
                          onChange={handleFactorChange}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Decay + Context */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-semibold text-white">Trust Decay</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={decayDays}
                    onChange={(e) => setDecayDays(parseInt(e.target.value))}
                    className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #f97316 ${(decayDays / 200) * 100}%, rgb(64, 64, 64) ${(decayDays / 200) * 100}%)`,
                    }}
                  />
                  <span className="text-xs font-mono text-neutral-300 w-16 text-right">{decayDays}d</span>
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-neutral-500">
                  <span>Fresh</span>
                  <span>Multiplier: {(decayMultiplier * 100).toFixed(1)}%</span>
                  <span>182d floor</span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-white">Context Ceiling</span>
                </div>
                <div className="flex gap-2">
                  {CONTEXT_CEILINGS.map((c, i) => (
                    <button
                      key={c.name}
                      onClick={() => setContextIndex(i)}
                      className={`flex-1 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                        i === contextIndex
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-neutral-400 hover:bg-white/10'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-500 mt-2">{context.desc}</p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Results */}
          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {/* Score Display */}
            <div className={`rounded-xl border ${tier.border} p-6 text-center`} style={{ backgroundColor: `${tier.color}08` }}>
              <div className="text-xs font-mono text-neutral-500 mb-1 uppercase tracking-wider">Trust Score</div>
              <div className="text-6xl font-bold text-white tabular-nums mb-1">
                {effectiveScore}
              </div>
              <div className="text-lg font-semibold" style={{ color: tier.color }}>
                T{tier.tier} — {tier.name}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                {tier.min}–{tier.max} range
              </div>

              {/* Score breakdown */}
              <div className="grid grid-cols-3 gap-3 mt-4 text-left">
                <div className="rounded-lg bg-white/5 p-2.5">
                  <div className="text-[10px] text-neutral-500 uppercase">Raw</div>
                  <div className="text-sm font-mono text-white">{rawScore}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-2.5">
                  <div className="text-[10px] text-neutral-500 uppercase">Decayed</div>
                  <div className="text-sm font-mono text-white">{decayedScore}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-2.5">
                  <div className="text-[10px] text-neutral-500 uppercase">Effective</div>
                  <div className="text-sm font-mono font-bold" style={{ color: tier.color }}>{effectiveScore}</div>
                </div>
              </div>

              {pointsToNext !== null && pointsToNext > 0 ? (
                <div className="mt-3 text-xs text-neutral-400">
                  <span className="font-mono text-indigo-400">{pointsToNext}</span> points to T{nextTier!.tier} {nextTier!.name}
                </div>
              ) : effectiveScore >= 951 ? (
                <div className="mt-3 text-xs text-cyan-400">Maximum tier achieved</div>
              ) : null}
            </div>

            {/* Tier Bar */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <TierBar score={decayedScore} ceiling={context.ceiling} />
            </div>

            {/* Factor Breakdown */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">Factor Contributions</span>
                <span className="text-[10px] text-neutral-500">weight: 1/16 each</span>
              </div>
              <FactorBreakdownChart factorScores={factorScores} />
            </div>

            {/* Tier Reference */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">Tier Reference</span>
              </div>
              <div className="space-y-1">
                {TIERS.map((t) => (
                  <div
                    key={t.tier}
                    className={`flex items-center justify-between px-2 py-1 rounded text-xs ${
                      t.tier === tier.tier ? `${t.bg} ${t.border} border` : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                      <span className={t.tier === tier.tier ? 'text-white font-semibold' : 'text-neutral-400'}>
                        T{t.tier} {t.name}
                      </span>
                    </div>
                    <span className="font-mono text-neutral-500">{t.min}–{t.max}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Formula toggle */}
            <button
              onClick={() => setShowFormula(!showFormula)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Info className="w-3 h-3" />
              {showFormula ? 'Hide' : 'Show'} Scoring Formula
            </button>

            {showFormula && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4 text-xs text-neutral-300 space-y-2 font-mono">
                <div className="text-indigo-400 font-sans font-semibold text-sm mb-2">Scoring Formula</div>
                <div>S = clamp(⌊ Σ(rᵢ × wᵢ × 1000) ⌋, 0, 1000)</div>
                <div className="text-neutral-500">where wᵢ = 1/16 for all 16 factors</div>
                <div className="border-t border-white/10 my-2" />
                <div className="text-orange-400 font-sans font-semibold">Decay</div>
                <div>S_decayed = ⌊ S_raw × m(d) ⌋</div>
                <div className="text-neutral-500">m(d) interpolated between milestones, floor = 0.50</div>
                <div className="border-t border-white/10 my-2" />
                <div className="text-red-400 font-sans font-semibold">Ceiling</div>
                <div>S_effective = min(S_decayed, C_context)</div>
                <div className="text-neutral-500">C: Local=700, Enterprise=900, Sovereign=1000</div>
                <div className="border-t border-white/10 my-2" />
                <Link href="https://github.com/vorionsys/vorion/blob/main/packages/atsf-core/docs/ATSF-MATH-SPEC.md" target="_blank" className="text-indigo-400 hover:text-indigo-300 font-sans">
                  Full math specification →
                </Link>
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
