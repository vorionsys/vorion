/**
 * Intent Routing Bridge for Kaizen
 *
 * Maps audience+intent pairs from the vorion.org intent router widget
 * to Kaizen resources. When a user arrives at learn.vorion.org with
 * query params like ?audience=dev&intent=integrate-sdk, this module
 * determines what to show them — a pre-seeded chat greeting, relevant
 * lexicon terms, a suggested learning path, or a direct navigation route.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntentRoute {
  /** Pre-seeded greeting message for the NEXUS chat */
  greeting: string;
  /** System context to add to the AI prompt */
  systemContext: string;
  /** Relevant lexicon term slugs to surface */
  suggestedTerms: string[];
  /** Learning path slug to recommend (if any) */
  suggestedPath?: string;
  /** Direct page to navigate to (if more appropriate than chat) */
  directRoute?: string;
}

export type AudienceType =
  | 'dev'
  | 'enterprise'
  | 'researcher'
  | 'investor'
  | 'regulator'
  | 'community'
  | 'partner';

// ---------------------------------------------------------------------------
// Route Definitions
// ---------------------------------------------------------------------------

const INTENT_ROUTES: Record<string, Record<string, IntentRoute>> = {
  // ── Developer ───────────────────────────────────────────────────────────
  dev: {
    'integrate-sdk': {
      greeting:
        "Welcome! I see you're a developer looking to integrate the Vorion SDK. I can walk you through the setup process, explain the trust scoring API, or point you to code examples. What would you like to start with?",
      systemContext:
        'The user is a developer who wants to integrate the Vorion SDK into their project. Prioritise practical setup instructions, code snippets, and API reference material. Keep answers concise and technically precise.',
      suggestedTerms: ['basis-protocol', 'trust-scoring', 'agent-architecture'],
      suggestedPath: 'sdk-integration',
    },
    'explore-api': {
      greeting:
        "Hey there! Ready to explore the Vorion API? I can give you a quick overview of available endpoints, walk through authentication, or dive into specific features like trust scoring and policy enforcement. Where should we start?",
      systemContext:
        'The user is a developer interested in exploring the Vorion API surface. Focus on endpoint documentation, request/response shapes, authentication flows, and rate limits.',
      suggestedTerms: ['api-endpoints', 'trust-scoring', 'policy-enforcement'],
    },
    'trust-scoring': {
      greeting:
        "Great choice — trust scoring is at the heart of the Vorion protocol. I'll take you straight to the deep-dive, but feel free to ask me anything about how scores are calculated, how decay works, or how to integrate scoring into your own agents.",
      systemContext:
        'The user is a developer who wants to understand and demo the trust scoring system. Emphasise the algorithm, scoring tiers, decay mechanics, and practical integration advice.',
      suggestedTerms: ['trust-scoring', 'trust-tiers', 'decay'],
      directRoute: '/lexicon/trust-scoring',
    },
    contribute: {
      greeting:
        "Awesome — we love contributors! Whether you want to fix a bug, propose a feature, or improve the docs, I can help you find the right starting point. I've linked the GitHub repo below. What area interests you most?",
      systemContext:
        'The user is a developer looking to contribute to the Vorion open-source project. Guide them toward contribution guidelines, good first issues, and the repository structure.',
      suggestedTerms: ['open-source', 'basis-protocol'],
      directRoute: 'https://github.com/vorionsys',
    },
  },

  // ── Enterprise ──────────────────────────────────────────────────────────
  enterprise: {
    'schedule-demo': {
      greeting:
        "Welcome! I'd be happy to help you schedule a demo of the Vorion platform. In the meantime, I can answer questions about governance features, compliance capabilities, or deployment options. Would you like to book a time or explore first?",
      systemContext:
        'The user is an enterprise stakeholder interested in scheduling a product demo. Be professional and consultative. Highlight governance, compliance, and scalability features.',
      suggestedTerms: ['governance', 'compliance'],
      directRoute: '/contact?type=demo',
    },
    'security-specs': {
      greeting:
        "Welcome! I understand security review is a priority for your team. I can walk you through our cryptographic auditability framework, zero-trust architecture, and compliance posture. What aspect of security would you like to examine first?",
      systemContext:
        'The user is conducting a security review of the Vorion platform for enterprise adoption. Provide detailed, precise answers about security architecture, encryption, audit trails, and zero-trust principles.',
      suggestedTerms: ['security', 'cryptographic-auditability', 'zero-trust'],
    },
    compliance: {
      greeting:
        "Welcome! Compliance is built into the foundation of the Vorion protocol. I can detail how we map to frameworks like SOC 2, GDPR, and ISO 27001, or explain our governance and policy enforcement layers. What compliance area matters most to your organisation?",
      systemContext:
        'The user is an enterprise compliance officer or similar role evaluating Vorion against regulatory requirements. Provide framework-specific mappings, governance details, and policy enforcement mechanisms.',
      suggestedTerms: ['compliance', 'governance', 'policy-enforcement'],
    },
    pricing: {
      greeting:
        "Welcome! I can give you an overview of our plans and what's included at each tier, from individual agent anchoring through to full enterprise governance suites. What scale of deployment are you considering?",
      systemContext:
        "The user is an enterprise buyer evaluating pricing and plans. Be transparent about capabilities per tier and focus on value for the user's scale.",
      suggestedTerms: ['agent-anchor', 'enterprise'],
    },
  },

  // ── Researcher ──────────────────────────────────────────────────────────
  researcher: {
    whitepaper: {
      greeting:
        "Welcome, researcher! I can point you to our published papers on the Basis Protocol, trust scoring methodology, and AI safety frameworks. I can also summarise key findings or discuss the theoretical underpinnings. What's your area of focus?",
      systemContext:
        'The user is an academic or independent researcher looking for formal research papers and theoretical foundations. Use precise academic language and cite specific mechanisms.',
      suggestedTerms: ['basis-protocol', 'trust-scoring', 'ai-safety'],
    },
    methodology: {
      greeting:
        "Welcome! The trust scoring methodology is one of the most technically interesting parts of the Vorion protocol. I can break down the scoring algorithm, explain decay functions, or compare our approach to related work. What would you like to dig into?",
      systemContext:
        'The user is a researcher interested in the formal methodology behind trust scoring. Provide rigorous, detailed explanations with emphasis on mathematical foundations and design rationale.',
      suggestedTerms: ['trust-scoring', 'decay', 'trust-tiers'],
    },
    'ai-safety': {
      greeting:
        "Welcome! AI safety is core to why Vorion exists. I can discuss our alignment approach, human-in-the-loop design patterns, and how trust scoring acts as a safety mechanism for autonomous agents. Where would you like to start?",
      systemContext:
        'The user is researching AI safety and alignment. Frame answers in terms of safety guarantees, alignment mechanisms, human oversight, and risk mitigation strategies.',
      suggestedTerms: ['ai-safety', 'alignment', 'human-in-the-loop'],
    },
  },

  // ── Investor ────────────────────────────────────────────────────────────
  investor: {
    roadmap: {
      greeting:
        "Welcome! I'd be happy to walk you through the Vorion product roadmap — from current capabilities through our near-term milestones and long-term vision. Would you like a high-level overview or a deep dive into a specific phase?",
      systemContext:
        'The user is an investor evaluating the product roadmap. Focus on strategic vision, market positioning, technical moat, and milestone-based delivery. Be confident but honest about timelines.',
      suggestedTerms: ['basis-protocol', 'agent-anchor'],
    },
    traction: {
      greeting:
        "Welcome! I can share key traction metrics, adoption milestones, and growth indicators for the Vorion platform. What metrics matter most to your evaluation — usage, integrations, community, or something else?",
      systemContext:
        'The user is an investor evaluating traction and market validation. Provide quantitative metrics where available and contextualize growth within the AI governance market.',
      suggestedTerms: ['basis-protocol', 'agent-anchor'],
    },
    connect: {
      greeting:
        "Welcome! I'll connect you with the Vorion team directly. In the meantime, feel free to ask me anything about the protocol, market opportunity, or technical architecture.",
      systemContext:
        'The user is an investor who wants to connect with the founding team. Be professional and facilitate the connection while remaining available for questions.',
      suggestedTerms: [],
      directRoute: '/contact?type=investor',
    },
  },

  // ── Regulator ───────────────────────────────────────────────────────────
  regulator: {
    governance: {
      greeting:
        "Welcome! I can provide a comprehensive overview of the Vorion governance framework, including how policy enforcement works, human-in-the-loop oversight mechanisms, and our approach to responsible AI deployment. What governance aspect would you like to explore?",
      systemContext:
        'The user is a regulator or policy-maker evaluating AI governance frameworks. Provide thorough, precise explanations of governance mechanisms, accountability structures, and oversight capabilities. Use formal language.',
      suggestedTerms: ['governance', 'compliance', 'policy-enforcement', 'human-in-the-loop'],
    },
    'compliance-mapping': {
      greeting:
        "Welcome! I can detail how the Vorion protocol maps to major regulatory frameworks and compliance standards — including GDPR, the EU AI Act, NIST AI RMF, and others. Which standards are most relevant to your review?",
      systemContext:
        'The user is a regulator interested in how Vorion maps to existing compliance frameworks. Provide specific, framework-by-framework mappings and highlight proactive compliance features.',
      suggestedTerms: ['compliance', 'governance'],
    },
    documentation: {
      greeting:
        "Welcome! I can guide you to formal documentation covering the Basis Protocol specification, trust scoring methodology, and system architecture. Would you like technical specifications, process documentation, or both?",
      systemContext:
        'The user is a regulator requesting formal documentation for review. Point them to the most authoritative and detailed resources. Be thorough and precise.',
      suggestedTerms: ['basis-protocol', 'trust-scoring'],
    },
  },

  // ── Community ───────────────────────────────────────────────────────────
  community: {
    discord: {
      greeting:
        "Hey! Welcome to the Vorion community. I'll send you straight to our Discord server where you can connect with other builders, researchers, and enthusiasts. See you there!",
      systemContext:
        'The user wants to join the Vorion community Discord. Facilitate the connection and make them feel welcome.',
      suggestedTerms: [],
      directRoute: 'https://discord.gg/vorion',
    },
    events: {
      greeting:
        "Welcome! We host regular community events including workshops, AMAs, and hackathons. I can share what's coming up or help you find events that match your interests. What kind of events are you looking for?",
      systemContext:
        'The user is interested in community events and meetups. Share information about upcoming events, formats, and how to participate.',
      suggestedTerms: [],
    },
    learn: {
      greeting:
        "Welcome to Kaizen! Whether you're brand new to AI governance or looking to deepen your understanding, you're in the right place. I recommend starting with our beginner learning path — it covers the fundamentals of trust scoring, the Basis Protocol, and how it all fits together. Ready to dive in?",
      systemContext:
        'The user is a community member who wants to learn about AI governance. Start with foundational concepts and guide them through the beginner learning path. Be encouraging and accessible.',
      suggestedTerms: ['ai-governance', 'trust-scoring', 'basis-protocol'],
      suggestedPath: 'beginner-fundamentals',
    },
  },

  // ── Partner ─────────────────────────────────────────────────────────────
  partner: {
    integration: {
      greeting:
        "Welcome, partner! I can help you get started with a technical integration — from API access and SDK setup to architecture patterns for connecting your platform with the Vorion protocol. What does your integration look like?",
      systemContext:
        'The user is a technology partner looking to integrate with the Vorion platform. Provide detailed technical guidance, architecture recommendations, and API/SDK documentation.',
      suggestedTerms: ['api-endpoints', 'sdk', 'agent-architecture'],
    },
    collaboration: {
      greeting:
        "Welcome! We're always excited to explore collaboration opportunities. I can outline current partnership models, co-development possibilities, or connect you directly with our partnerships team. What kind of collaboration are you envisioning?",
      systemContext:
        'The user is exploring collaboration or co-development opportunities with Vorion. Be open, professional, and help them understand partnership possibilities.',
      suggestedTerms: [],
    },
    'partner-program': {
      greeting:
        "Welcome! The Vorion Partner Program offers tiered benefits including early API access, co-marketing, technical support, and revenue sharing. I can walk you through the tiers and requirements, or connect you with our partnerships team. What would you like to know?",
      systemContext:
        'The user wants details about the formal partner program. Provide structured information about tiers, benefits, requirements, and how to apply.',
      suggestedTerms: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const FALLBACK_ROUTE: IntentRoute = {
  greeting:
    "Welcome to Kaizen — Vorion's learning and knowledge platform! I'm here to help you explore AI governance, understand the Basis Protocol, or find exactly what you're looking for. What brings you here today?",
  systemContext:
    'The user arrived without a specific intent or with an unrecognised audience/intent combination. Be welcoming and help them discover what Kaizen offers.',
  suggestedTerms: ['basis-protocol', 'trust-scoring', 'governance'],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an audience + intent pair to a route configuration.
 *
 * Returns a matching `IntentRoute` if found, otherwise returns a generic
 * welcome fallback so callers always receive a valid route object.
 */
export function getIntentRoute(audience: string, intent: string): IntentRoute {
  const audienceRoutes = INTENT_ROUTES[audience];
  if (!audienceRoutes) return FALLBACK_ROUTE;

  return audienceRoutes[intent] ?? FALLBACK_ROUTE;
}

/**
 * Return a human-readable label for a given audience type.
 */
export function getAudienceLabel(audience: AudienceType): string {
  const labels: Record<AudienceType, string> = {
    dev: 'Developer',
    enterprise: 'Enterprise',
    researcher: 'Researcher',
    investor: 'Investor',
    regulator: 'Regulator',
    community: 'Community Member',
    partner: 'Partner',
  };

  return labels[audience] ?? 'Visitor';
}
