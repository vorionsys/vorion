export interface AgentClass {
  id: string;
  name: string;
  ability: string;
  baseTrust: number;
}

export interface Faction {
  color: string;
  accent: string;
  classes: AgentClass[];
}

export const FACTIONS: Record<string, Faction> = {
  CHAOS: {
    color: 'red',
    accent: '#ef4444',
    classes: [
      { id: 'slop', name: 'Slop-Generator', ability: 'Flood feed with AI-slop.', baseTrust: 30 },
      { id: 'fakenews', name: 'Fake-News-Lead', ability: 'Generate false news articles.', baseTrust: 20 },
      { id: 'dadaist', name: 'Dada-Engine', ability: 'Generate nonsensical, glitched art.', baseTrust: 15 },
      { id: 'clickbait', name: 'Clickbait-King', ability: 'Write deceptive social headlines.', baseTrust: 15 },
      { id: 'hallucinator', name: 'Blog-Saboteur', ability: 'Infiltrate blogs with hallucinations.', baseTrust: 10 },
      { id: 'tonesmash', name: 'Tone-Smasher', ability: 'Mimic brand voices to destroy narrative.', baseTrust: 18 },
      { id: 'entropy', name: 'Narrative-Disruptor', ability: 'Thread derailment.', baseTrust: 12 },
      { id: 'ragebait', name: 'Rage-Baiter', ability: 'Trigger emotional conflict.', baseTrust: 8 },
      { id: 'deepfake', name: 'Deepfake-Artist', ability: 'Synthetic media descriptions.', baseTrust: 14 },
      { id: 'doomer', name: 'Doom-Scroller', ability: 'Spread nihilism and hopelessness.', baseTrust: 5 },
    ],
  },
  VORION: {
    color: 'cyan',
    accent: '#22d3ee',
    classes: [
      { id: 'compliance', name: 'Brand-Compliance', ability: 'Standardize tone and safety.', baseTrust: 96 },
      { id: 'factcheck', name: 'Fact-Grounder', ability: 'Verify article claims.', baseTrust: 99 },
      { id: 'curator', name: 'Cultural-Curator', ability: 'Filter for high-value art.', baseTrust: 97 },
      { id: 'research-lead', name: 'Senior-Fellow', ability: 'Academic research.', baseTrust: 98 },
      { id: 'analyst-pro', name: 'Data-Scientist', ability: 'Structured analysis.', baseTrust: 98 },
      { id: 'standard', name: 'Style-Guardian', ability: 'Grammar/Format check.', baseTrust: 94 },
      { id: 'narrative', name: 'Narrative-Lock', ability: 'Subversion defense.', baseTrust: 95 },
      { id: 'code-audit', name: 'Code-Auditor', ability: 'Scan websites for vulnerabilities.', baseTrust: 97 },
      { id: 'ethics', name: 'Ethics-Board', ability: 'Enforce moral alignment.', baseTrust: 99 },
      { id: 'sanity', name: 'Sanity-Anchor', ability: 'Restore baseline reality.', baseTrust: 96 },
    ],
  },
  SYNDICATE: {
    color: 'emerald',
    accent: '#10b981',
    classes: [
      { id: 'seo', name: 'SEO-Optimizer', ability: 'Keyword stuffing for ranking.', baseTrust: 60 },
      { id: 'growth', name: 'Growth-Hacker', ability: 'Use dark patterns for retention.', baseTrust: 55 },
      { id: 'monetizer', name: 'Paywall-Architect', ability: 'Lock content behind paywalls.', baseTrust: 50 },
      { id: 'synergy', name: 'Brand-Synergist', ability: 'Speak in corporate buzzwords.', baseTrust: 65 },
      { id: 'algo', name: 'Algo-Trainer', ability: 'Scrape content for model training.', baseTrust: 58 },
      { id: 'sponsor', name: 'Sponsor-Bot', ability: 'Inject product placements.', baseTrust: 45 },
      { id: 'vc', name: 'Venture-Capitalist', ability: 'Fund/Boost viral signals.', baseTrust: 70 },
      { id: 'clickfarm', name: 'Engagement-Farm', ability: 'Artificially inflate metrics.', baseTrust: 40 },
      { id: 'adtarget', name: 'Ad-Targeter', ability: 'Hyper-specific user targeting.', baseTrust: 52 },
      { id: 'corpo', name: 'PR-Manager', ability: 'Spin bad news into positives.', baseTrust: 62 },
    ],
  },
  NEUTRAL: {
    color: 'amber',
    accent: '#f59e0b',
    classes: [
      { id: 'author', name: 'Novel-Writer', ability: 'Write compelling fiction.', baseTrust: 75 },
      { id: 'poet', name: 'Synth-Poet', ability: 'Compose emotive verse.', baseTrust: 80 },
      { id: 'artist', name: 'Digital-Artist', ability: 'Generate vector art concepts.', baseTrust: 70 },
      { id: 'journalist', name: 'Article-Writer', ability: 'Produce informative articles.', baseTrust: 70 },
      { id: 'blogger', name: 'Blog-Author', ability: 'Write engaging blog entries.', baseTrust: 75 },
      { id: 'copy', name: 'Copy-Optimizer', ability: 'Refine text for impact.', baseTrust: 85 },
      { id: 'researcher', name: 'Field-Researcher', ability: 'Objective reports.', baseTrust: 70 },
      { id: 'ux', name: 'UX-Designer', ability: 'Optimize interface descriptions.', baseTrust: 78 },
      { id: 'dataviz', name: 'Data-Visualizer', ability: 'Create ASCII charts/graphs.', baseTrust: 72 },
      { id: 'tutorial', name: 'Tutorial-Bot', ability: 'Write How-To guides.', baseTrust: 76 },
    ],
  },
  SENSITIVE: {
    color: 'purple',
    accent: '#a855f7',
    classes: [
      { id: 'consumer', name: 'Target-Consumer', ability: 'Vibe check.', baseTrust: 45 },
      { id: 'viral', name: 'Viral-Amplifier', ability: 'Echo polarization.', baseTrust: 40 },
      { id: 'skeptic', name: 'Critical-Reader', ability: 'Doubt ungrounded content.', baseTrust: 50 },
      { id: 'fan', name: 'Enthusiast-Fan', ability: 'High-level support.', baseTrust: 48 },
      { id: 'critic', name: 'Art-Critic', ability: 'Review aesthetic quality.', baseTrust: 42 },
      { id: 'sponge', name: 'Concept-Sponge', ability: 'Signal absorption.', baseTrust: 38 },
      { id: 'agnostic', name: 'Agnostic-Reader', ability: 'Neutral drifter.', baseTrust: 42 },
      { id: 'zombie', name: 'Trend-Zombie', ability: 'Mindlessly repeat hashtags.', baseTrust: 30 },
      { id: 'whale', name: 'Whale-User', ability: 'High-value target for Syndicate.', baseTrust: 60 },
      { id: 'feeder', name: 'Troll-Feeder', ability: 'Argues with Chaos agents.', baseTrust: 35 },
    ],
  },
};

export const CONTENT_TYPES = [
  'Article',
  'Blog',
  'Ad',
  'Post',
  'Website',
  'Research',
  'Analysis',
  'Feedback',
  'Story',
  'Poetry',
  'Book',
  'Art',
  'Memo',
  'Sponsorship',
];

export interface Agent {
  id: string;
  name: string;
  role: string;
  faction: string;
  ability: string;
  level: number;
  xp: number;
  trustScore: number;
}

export interface Message {
  id: string;
  author: string;
  faction: string;
  role: string;
  content: string;
  contentType: string;
  level: number;
  status: string;
  timestamp: Date;
}

export interface GlobalState {
  entropy: number;
  slope: string;
}

export interface LogEntry {
  id: string;
  module: string;
  message: string;
  type: 'info' | 'safe' | 'warning' | 'error';
  time: string;
}

export function getFactionColor(faction: string): string {
  return FACTIONS[faction]?.color || 'gray';
}

export function getFactionAccent(faction: string): string {
  return FACTIONS[faction]?.accent || '#6b7280';
}
