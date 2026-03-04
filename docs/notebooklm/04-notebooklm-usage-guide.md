# Google NotebookLM Usage Guide for Vorion
## How to Get Maximum Value from Your AI Research Notebook

---

## 1. Getting Started

### Upload These Documents
Go to [notebooklm.google.com](https://notebooklm.google.com) and create a new notebook called **"Vorion Platform"**. Upload these source documents in this order:

1. **01-vorion-project-state.md** — The complete project overview (architecture, packages, trust model, current state)
2. **02-vorion-technical-spec.md** — Deep technical specification (types, algorithms, APIs, schemas)
3. **03-vorion-session-transcript.md** — Development history and session transcript (what was built, why, and how)

### Additional Sources to Upload
For even richer context, also upload:

- **SECURITY.md** (from repo root) — Security policy and practices
- **docs/basis-docs/docs/spec/trust-scoring.md** — Full trust scoring specification with recovery mechanics
- **docs/phase6/openapi.yaml** — Complete API specification
- **packages/basis/src/trust-factors.ts** — The canonical source code for trust factors (NotebookLM can read code)
- **Any pitch decks, investor materials, or whitepapers** you have — NotebookLM synthesizes across ALL sources

**Tip:** NotebookLM supports up to 50 sources per notebook. More sources = richer synthesis. Upload anything relevant: meeting notes, design docs, competitor analysis, regulatory documents.

---

## 2. Key Features to Use

### Audio Overview ("Deep Dive" Podcast)
NotebookLM can generate a podcast-style audio conversation between two AI hosts discussing your sources. This is incredibly useful for:

- **Onboarding new team members** — They can listen to a 15-minute overview while commuting
- **Preparing for investor meetings** — Hear how the platform sounds when explained conversationally
- **Finding gaps** — The AI hosts sometimes ask questions that reveal missing documentation
- **Partner briefings** — Share the audio with your partner or collaborators

**How:** Click the "Audio Overview" button. You can customize the focus by adding a prompt like:
- "Focus on the 16-factor trust model and how it differentiates Vorion"
- "Explain this as if briefing a potential enterprise customer"
- "Dive deep into the security architecture and compliance posture"

### Chat with Your Sources
The chat interface lets you ask questions and get answers grounded in your uploaded documents. Best practices:

**Good questions to ask:**
- "What are all the trust factors and which tier unlocks them?"
- "How does the evidence weighting system solve the cold-start problem?"
- "What security tests have been completed and what vulnerabilities were found?"
- "Summarize the difference between the v1 and v2 trust APIs"
- "What compliance standards does Vorion align with?"
- "List all the packages in the monorepo and their purposes"
- "What are the recovery mechanics for trust decay?"
- "How does the proof chain ensure tamper-proof evidence?"

**Power questions (cross-document synthesis):**
- "Based on the technical spec and session transcript, what are the biggest remaining gaps?"
- "If I were explaining Vorion to a regulator, what key points should I hit?"
- "What would a developer need to know to start integrating the SDK?"
- "Compare our trust scoring approach to traditional RBAC — what are the advantages?"

### Notes
Create notes to capture your own thoughts alongside AI-generated insights:
- Pin important findings
- Track questions for your next development session
- Build an FAQ from common questions
- Draft pitch angles based on AI synthesis

### Saved Responses
When NotebookLM generates a particularly good answer, save it. Build a library of:
- Technical explanations at different levels (developer, executive, regulator)
- FAQ responses
- Feature summaries
- Architecture overviews

---

## 3. Recommended Notebook Organization

### Create Multiple Notebooks for Different Purposes

**Notebook 1: "Vorion — Technical Core"**
- Upload: All 3 generated docs + source code files + OpenAPI spec
- Use for: Technical questions, architecture decisions, debugging context

**Notebook 2: "Vorion — Business & Strategy"**
- Upload: Project state doc + any pitch decks, market analysis, investor materials
- Use for: Investor prep, market positioning, competitive analysis

**Notebook 3: "Vorion — Compliance & Security"**
- Upload: SECURITY.md + trust scoring spec + compliance docs (ISO 42001, AI TRiSM mappings)
- Use for: Regulatory prep, compliance gap analysis, security architecture review

**Notebook 4: "Vorion — Session Continuity"**
- Upload: Session transcript + updated progress docs after each major session
- Use for: Maintaining context between Claude Code sessions, briefing new collaborators

---

## 4. Workflow Integration

### Before Each Claude Code Session
1. Open your NotebookLM "Session Continuity" notebook
2. Ask: "What was the last thing completed and what are the next priorities?"
3. Use the answer to prime your Claude Code session with context

### After Each Claude Code Session
1. Generate a session transcript summary (ask Claude Code to generate one)
2. Upload it to NotebookLM
3. Ask NotebookLM: "What changed in this session and what should I prioritize next?"

### For Partner Sync
1. Generate Audio Overview focused on recent changes
2. Share the audio link with your partner
3. They can listen and arrive at the next session fully briefed

### For Investor/Stakeholder Updates
1. Upload the latest project state document
2. Ask NotebookLM: "Generate a 1-page executive summary of current platform capabilities"
3. Use the output as the basis for your update email or slide deck

---

## 5. Pro Tips

### Tip 1: Be Specific in Your Prompts
Instead of "Tell me about trust scoring," ask "Explain how the 16-factor trust model works, including the 5 factor groups and how evidence types are weighted differently for cold-start mitigation."

### Tip 2: Use "Cite Sources" Feature
NotebookLM highlights which source document each piece of information comes from. Use this to verify accuracy and trace claims back to specific code or documentation.

### Tip 3: Generate Study Guides
Ask NotebookLM to create a study guide for specific topics:
- "Create a study guide for a new developer joining the Vorion team"
- "Create a briefing document for a compliance officer reviewing our AI governance approach"

### Tip 4: Cross-Reference Detection
Upload documents that might conflict (e.g., an old spec and the current code) and ask: "Are there any inconsistencies between these sources?" NotebookLM is excellent at finding contradictions.

### Tip 5: Iterative Refinement
Start with broad questions, then drill down:
1. "What are the main components of Vorion?"
2. "Tell me more about the Trust Engine specifically"
3. "How does trust decay work in the Trust Engine?"
4. "What happens when an agent recovers from a trust demotion?"

### Tip 6: Export and Share
- Export chat responses as Google Docs
- Share notebooks with collaborators (they get read access to your sources + chat history)
- Use exported content as drafts for blog posts, documentation, or presentations

### Tip 7: Keep Sources Fresh
After major development sessions, regenerate the project state document and re-upload it. NotebookLM will automatically incorporate the latest state into all future answers.

---

## 6. Limitations to Know

- **50 source limit** per notebook — prioritize quality over quantity
- **No real-time connection** — NotebookLM works with uploaded snapshots, not live data
- **No code execution** — It can read and explain code, but can't run it
- **Source size limits** — Very large files may be truncated; break them into smaller documents if needed
- **No API access** — Everything is through the web interface (no programmatic access yet)
- **Google account required** — NotebookLM is a Google product, requires Google sign-in

---

## 7. Quick Start Checklist

- [ ] Create NotebookLM account at notebooklm.google.com
- [ ] Create "Vorion Platform" notebook
- [ ] Upload `01-vorion-project-state.md`
- [ ] Upload `02-vorion-technical-spec.md`
- [ ] Upload `03-vorion-session-transcript.md`
- [ ] Generate your first Audio Overview
- [ ] Ask your first question: "Give me a complete overview of the Vorion platform"
- [ ] Create a note with your top 3 priorities
- [ ] Share the notebook with your partner
- [ ] Set a reminder to update sources after each major dev session
