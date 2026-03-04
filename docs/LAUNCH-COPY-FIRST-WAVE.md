# First Wave Launch Copy — Ready to Post
*Created: February 28, 2026*

---

## X / Twitter — Humble Thread

### Post 1:
We just open-sourced a tiny v0.1 experiment in AI agent governance.

No big claims. No "this changes everything."
Just some primitives we built because we needed them.

Repo: https://github.com/vorionsys/vorion
Runtime demo: https://cognigate.dev

### Post 2:
We know it has every red flag:
- 0 stars
- Brand new org
- Arbitrary trust tiers
- Pre-reasoning that can probably be jailbroken

We are sharing it anyway because the only way to improve is in public.

### Post 3:
What's inside:
- BASIS — a pre-reasoning governance pipeline (INTENT → ENFORCE → PROOF)
- ATSF — simple trust tiers (T0–T7)
- CAR — experimental agent registry
- Cognigate — live FastAPI runtime

All Apache 2.0.

### Post 4:
If you're building agents and have ever thought "there has to be a better way to make these trustworthy," come break our code.

Feedback, issues, PRs — all welcome. Even "this won't work because…"

Built by two former banquet servers who learned to code with AI.
https://vorion.org/about

#OpenSource #AISafety #AgenticAI

---

## Show HN

**Title:** Show HN: Vorion v0.1 — a small open experiment in agent governance (BASIS primitives)

**Body:**

Hey HN,

We are a small team that got tired of bolting governance onto agents after the fact. So we built a tiny set of primitives and are open-sourcing them at v0.1 — fully aware of all the reasons this might not work.

What's inside:
- BASIS: early intent → enforce → proof pipeline (heuristic, not formal verification)
- ATSF: simple T0–T7 trust tiers (arbitrary starting point)
- CAR: experimental agent registry
- Cognigate: FastAPI runtime (live demo)

Everything Apache 2.0. Zero production usage yet.

We are submitting this as input to NIST's AI Agent Security RFI (due March 9) because we believe the community should shape these things together.

Would genuinely love brutal feedback — especially on why this approach is doomed.

https://github.com/vorionsys/vorion
https://cognigate.dev

---

## Reddit Posts

### r/MachineLearning (title: [P] Vorion v0.1 — small open experiment in AI agent governance)

We've been working on a small set of open-source governance primitives for autonomous AI agents. Sharing at v0.1 — early, rough, but genuinely open (Apache 2.0).

**What it is:**
- BASIS: pre-reasoning governance pipeline (intent normalization → policy enforcement → cryptographic proof)
- ATSF: heuristic trust scoring with T0–T7 tiers
- CAR: experimental agent identity registry
- Cognigate: live FastAPI enforcement runtime

**What it's not:**
- Production-hardened (zero external users)
- Formally verified (heuristic-based, jailbreakable)
- "The standard" (it's our starting point, not an authority)

Built by two former banquet servers who learned to code with AI and got frustrated by how hard it is to make agents trustworthy.

Would love feedback from this community — especially on why the approach won't work.

Repo: https://github.com/vorionsys/vorion
Live demo: https://cognigate.dev
Our story: https://vorion.org/about

### r/LocalLLaMA — same text, title: "Vorion v0.1 — open governance primitives for local AI agents (Apache 2.0)"

### r/opensource — same text, title: "Vorion v0.1 — Apache 2.0 governance for autonomous AI agents (our first open-source project)"

### r/LangChain — modified version:

**Title:** Governance layer experiment for LangChain/LangGraph agents (Apache 2.0)

We built a small set of governance primitives that can wrap LangGraph workflows with trust scoring and policy enforcement. Sharing at v0.1.

- Pre-reasoning governance (checks intent before agent acts)
- T0–T7 trust tiers with capability gating
- Cryptographic audit trails

Not production-ready. No formal LangGraph integration yet (that's v0.2). Just sharing early to get feedback.

https://github.com/vorionsys/vorion
Live runtime: https://cognigate.dev

---

## LinkedIn Post (personal accounts — Alex + Ryan)

I've been working on something with my friend [Alex/Ryan] that I'm both proud of and nervous about sharing.

We open-sourced a small v0.1 experiment in AI agent governance — a set of primitives for making autonomous agents trustworthy.

The nervous part: it's early, it's rough, and we have zero external users. We know every reason it might not work.

The proud part: it's genuinely open (Apache 2.0), we're honest about its limitations, and we believe the only way to build trustworthy AI infrastructure is in public.

If you work with AI agents and care about governance, I'd love your honest feedback — even (especially) the critical kind.

https://github.com/vorionsys/vorion
https://cognigate.dev
https://vorion.org/about

#OpenSource #AI #AISafety

---

## Discord Posts (LangChain, CrewAI, AI Safety)

**For #show-your-work or #general channels:**

Hey! We just open-sourced a small experiment in agent governance called Vorion (v0.1, Apache 2.0).

It's a pre-reasoning governance pipeline: INTENT → ENFORCE → PROOF. The idea is to check what an agent wants to do *before* it reasons about how.

Very early. Zero external users. Tier boundaries arbitrary. But we wanted to share early and get feedback from people actually building agents.

Repo: https://github.com/vorionsys/vorion
Live API: https://cognigate.dev
Feedback welcome — even "this won't work because…"

---

## "Submitted to NIST" follow-up post (use March 9)

We submitted our early v0.1 governance primitives as input to NIST's RFI on AI Agent Security (Docket NIST-2025-0035).

Not as a proposal for "the standard" — as a humble community contribution with honest acknowledgment of every limitation.

If the community and institutions like NIST can shape these things together, we all win.

Full submission: [link to public copy]
Repos: https://github.com/vorionsys/vorion

---

## Week 1 Feedback Roundup Template (use March 3–5)

**Title:** What we learned in the first week of open-sourcing Vorion

We shared our v0.1 agent governance experiment [X days] ago. Here's what happened:

- Stars: [X]
- Issues opened: [X]
- Comments/feedback: [X]
- Things people liked: [list]
- Things people criticized: [list]
- Things we're changing based on feedback: [list]

Thank you to everyone who took time to look. We're listening.

---

## Month 1 Retrospective Template (use March 31)

**Title:** Vorion — 1 month of open source. What worked, what didn't.

[Write honest retrospective with real numbers and learnings]
