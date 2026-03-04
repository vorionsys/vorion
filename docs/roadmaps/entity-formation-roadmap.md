# Vorion Entity Formation & Operations Roadmap

> **Version:** 1.0
> **Date:** February 19, 2026
> **Authors:** Ryan Cason, Alex Blanc
> **Status:** Planning

---

## Existing Digital Presence

| Asset | Handle / URL | Notes |
|-------|-------------|-------|
| GitHub (private monorepo) | `voriongit` | All source code |
| GitHub (public org) | `vorionsys` | Public-facing repos, OSC application target |
| npm scope | `@vorion` | Package registry |
| Email | `vorionsys@gmail.com` | Matches npm + GitHub public org |
| Domains | vorion.org, agentanchorai.com, bai-cc.com, cognigate.dev, aurais.net | All active and deployed |
| Websites | basis.vorion.org, carid/logic/trust/verify/feedback/opensource.vorion.org, agentanchorai.com, status.agentanchorai.com, bai-cc.com | All live |

---

## Entity Architecture

```
Vorion LLC (WY)
│   IP holding, standards work, enterprise licensing, SBIR applicant
│
├── Open Source Collective (fiscal sponsor)
│   BASIS standard, CAR specification, AgentAnchor spec
│   Transparent funding for contributors, hosting, events
│
├── Future licensing →
│   Operating entities pay licensing fees for shared technology
│   Arm's length royalty rates (10-15% of gross revenue)
│
└── Year 2+ evaluation →
    Potential 501(c)(3) for standards governance
    Only if community momentum justifies overhead
```

### Why Wyoming

- **No state income tax** — royalty and licensing income is tax-advantaged
- **Strong asset protection** — charging order protection for LLC members; creditors cannot force distributions or seize assets
- **Privacy** — member/manager names are not required on Articles of Organization
- **SBIR eligibility** — for-profit LLC qualifies; 501(c)(3) nonprofits do not
- **Cost** — $100 formation + $60/yr annual report (lowest in the US)
- **Pioneered the LLC** — most developed LLC case law and statutes

### Florida Foreign Entity

Vorion LLC will need to register as a foreign entity in Florida **only if** it:
- Employs Florida residents
- Maintains a physical office in Florida
- Signs contracts directly with Florida customers

If Vorion operates purely as a passive IP holding company, foreign qualification **may not be required**. However, if the same individuals manage both entities from Florida, registering is the safer choice. Cost is modest (~$150 one-time + $139/yr).

---

## Phase 1: Form Vorion LLC in Wyoming

**Timeline:** Week 1-2
**Cost:** $260-$460 (DIY) | $760-$1,760 (with attorney)

| Step | Action | Cost | Time |
|------|--------|------|------|
| 1 | Search name availability at [wyobiz.wyo.gov](https://wyobiz.wyo.gov/Business/FilingSearch.aspx) | Free | Same day |
| 2 | **Reserve name** (locks for 120 days while finalizing operating agreement) | $60 | Same day |
| 3 | Engage registered agent (Northwest Registered Agent or Wyoming Agents) | ~$100/yr | Same day |
| 4 | File Articles of Organization online at wyobiz.wyo.gov | $100 | 1-2 business days |
| 5 | Obtain EIN from IRS ([irs.gov online application](https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online)) | Free | Same day |
| 6 | Draft Operating Agreement (attorney recommended for multi-member) | $500-$1,500 | 3-7 days |
| 7 | Open business bank account (Mercury or Relay for remote setup) | Free | 1-5 days |

### Key Decisions

- **Manager-managed** structure recommended for IP holding entity (cleaner governance)
- Operating agreement must address:
  - IP ownership and assignment procedures
  - Licensing authority (who can authorize IP licenses)
  - Distribution policy
  - Member roles and responsibilities (Ryan + Alex)
  - Decision-making procedures and voting
- **Multi-member LLC** requires annual Form 1065 (Partnership Return) filing with the IRS
- Each member receives Schedule K-1 for personal tax returns

### Banking

Remote-friendly business banks that work well with Wyoming LLCs:
- **Mercury** — popular with startups, good API, no fees
- **Relay** — designed for small business, no fees
- **Novo** — free business checking, integrations

Some traditional banks require in-person visits for WY LLC accounts. Online banks are recommended.

---

## Phase 2: IP Assignment

**Timeline:** Week 2-4
**Cost:** $500-$3,000 (attorney for documents)

### Required Documents

**1. IP Assignment Agreement**
- Transfers all existing Vorion IP from individuals to the WY LLC
- Covers: ATSF framework, BASIS standard, CAR specification, Cognigate, AgentAnchor platform, all software, documentation, trademarks, trade secrets
- Must describe IP in detail
- Must specify consideration (what is exchanged for the IP)
- Should be signed, dated, and ideally notarized
- File any trademark/patent assignments with USPTO ($0-$100 per mark)

**2. IP Management Policy**
- How new IP created by members gets assigned to the LLC
- Procedures for supplemental IP assignments (at least annually)
- Licensing approval process
- IP valuation methodology

### Future Licensing Structure

When Vorion licenses IP to operating entities:
- **Arm's length royalty rate:** 10-15% of gross revenue (industry standard for software IP)
- **Transfer pricing documentation:** written memo explaining rate rationale, created at time rate is set
- **Real payments:** bank-to-bank transfers required (not journal entries)
- **Operating entity must remain profitable** after paying royalties
- **Annual review** and adjustment with documented rationale

---

## Phase 3: Florida Foreign Entity Registration

**Timeline:** Week 2-4 (parallel with Phase 2)
**Cost:** ~$350-$450 first year | ~$240-$340/yr ongoing
**Trigger:** Only if Vorion directly operates in Florida

### When Required

| Activity | Requires FL Registration? |
|----------|--------------------------|
| Employing Florida residents | **Yes** |
| Maintaining physical office in FL | **Yes** |
| Signing contracts with FL customers | **Yes** |
| Owning/leasing FL real property | **Yes** |
| Maintaining bank accounts in FL | No |
| Holding member meetings in FL | No |
| Passive IP licensing (receiving royalties) | No |
| Collecting debts | No |

### Registration Process (If Needed)

| Step | Action | Cost |
|------|--------|------|
| 1 | Obtain WY Certificate of Existence from wyobiz.wyo.gov | $3-$5 |
| 2 | Appoint Florida registered agent | ~$100/yr |
| 3 | File Application for Authorization at [Sunbiz.org](https://dos.fl.gov/sunbiz/) | $125 + $25 agent designation |
| 4 | Processing | 3-5 business days (online) |

### Ongoing FL Compliance

- **Annual Report:** Due May 1 each year, $138.75 filing fee
- **Late penalty:** $400 if filed after May 1 but before September
- **Revocation:** After third Friday in September if delinquent
- Florida has **no personal income tax** and **no corporate income tax on pass-through LLCs**

### Penalties for Not Registering When Required

- Cannot maintain lawsuits in Florida courts (can still be sued)
- Fine of up to $500/year of non-compliance
- Must pay all back annual report fees
- No liability protection during unregistered period

---

## Phase 4: Funding Vehicles

**Timeline:** Month 1-3 (parallel with entity formation)

### Open Source Collective — Immediate

**What:** [Open Source Collective](https://www.oscollective.org/) is a 501(c)(6) fiscal host that holds and manages funds on behalf of open source projects. Projects get a fundraising page, transparent ledger, and the ability to receive and spend money without their own legal entity.

**Apply for:** BASIS standard, CAR specification, AgentAnchor specification

**Requirements:**
- Open source license on the project
- Organizational GitHub repository (`vorionsys` — ready)
- Minimum 2 admins on the Open Collective page
- Applicants must be project maintainers
- Recommended: CONTRIBUTING.md, Code of Conduct, clear governance

**Timeline:** 2-5 business day review, donations can be received same day as approval

**Fee structure:**
- Host fee: 10% of all incoming contributions
- Stripe processing: ~2.9% + $0.30 per credit card transaction
- Effective total: ~12-14% of incoming credit card donations
- Example: $1,000 donation → ~$856 net to project

**Allowed uses:**
- Paying contributors for development, design, documentation
- Infrastructure (hosting, CI/CD, domains, tools)
- Events (conference attendance, meetups) — reimbursement only
- Bounties for specific issues or features
- Legal/compliance expenses

**Note:** OSC is 501(c)(6) — donations are NOT tax-deductible as charitable contributions but may be deductible as business expenses for donors.

### SBIR/STTR — Parallel Track

**Status as of February 2026:** SBIR/STTR congressional authorization expired September 30, 2025. Reauthorization pending via H.R.5100 (SBIR/STTR Reauthorization Act of 2025) and Markey compromise bill. No new solicitations or awards until reauthorization passes.

**Prepare now:**

| Step | Action | Time | Notes |
|------|--------|------|-------|
| 1 | Register on [SAM.gov](https://sam.gov) | 2-4 weeks | Required for any federal grant; start immediately |
| 2 | Register on [SBIR.gov](https://www.sbir.gov) and [Research.gov](https://www.research.gov) | Same day | Account creation |
| 3 | Draft NSF Project Pitch (2 pages) | 1-2 weeks | Be ready to submit when solicitations reopen |
| 4 | Monitor reauthorization status | Ongoing | Track H.R.5100 and Senate companion bills |

**Best fit: NSF AI7 — "Technologies for Trustworthy AI"**
- Covers: AI safety, fairness, transparency, explainability, privacy, security
- Phase I: Up to $305,000 (6-12 months)
- Phase II: Up to $1,250,000 (up to 2 years)
- Success rate: ~15-25% for Phase I

**SBIR vs STTR:**

| | SBIR | STTR |
|--|------|------|
| Research partner required? | No | Yes (university/nonprofit) |
| PI employment | Must be "primarily employed" by LLC | Can remain at research institution |
| Best for | In-house R&D capability | University partnerships |

**Recommendation:** STTR may be better if either founder has a university affiliation, since it avoids the PI employment requirement for the LLC.

**Eligibility confirmed:**
- For-profit LLC: eligible
- <500 employees: met
- 51%+ U.S. citizen ownership: met
- At least one member must formalize employment/compensation during award period

**Common first-timer mistakes to avoid:**
1. Not registering on SAM.gov early enough (2-4 week processing)
2. Weak commercialization plan (top reason for rejection)
3. No measurable outcomes defined
4. Force-fitting project into wrong agency topic
5. Not contacting the NSF program officer before submission
6. Poor budget justification
7. Starting application too late (need 8-10 weeks minimum)

---

## Phase 5: Year 2 Decision — 501(c)(3) Evaluation

### Indicators That Justify a Standalone Nonprofit

Evaluate at the 12-18 month mark. Form a 501(c)(3) **only if** multiple indicators are met:

- [ ] Donation revenue consistently at or above **$50,000/year** through OSC
- [ ] **Corporate sponsors** are requesting tax-deductible donation receipts
- [ ] **5+ active core contributors** with established governance processes
- [ ] **Foundation grants** requiring 501(c)(3) status that you're being turned away from
- [ ] **Institutional adoption** by government or enterprises needing a formal standards body
- [ ] OSC's 10% fee is more expensive than running your own entity

### If NOT Triggered

Continue with Open Source Collective. It's cheaper, zero governance overhead, and scales well up to ~$500K/year.

### If Triggered

**"Brother-Sister" structure:**
- 501(c)(3) nonprofit: owns and maintains open standards (BASIS, CAR)
- Vorion LLC: builds commercial products and services on top of standards
- Same founders can be involved in both
- Must have separate governance (boards, meetings, records, bank accounts)

**Precedents:**
- Mozilla Foundation + Mozilla Corporation
- Apache Software Foundation (incubator model)
- OWASP Foundation (started as project, grew into foundation)

**501(c)(3) vs 501(c)(6):**
- **(c)(3):** Public benefit/charitable/educational mission. Donations are tax-deductible. Matches OWASP/Apache model. Better for standards with public benefit focus.
- **(c)(6):** Trade association/industry advancement. Donations not tax-deductible but business-deductible. Matches Linux Foundation model. Better for industry consortiums.

**Recommendation:** 501(c)(3) — AI agent governance standards have a clear public benefit mission.

**Formation cost:** $3,500-$13,000 (with attorney)
**Timeline:** 3-14 months from filing to IRS determination
**Annual cost:** $100-$500 (state filings, registered agent)

---

## Compliance Calendar

### Wyoming LLC (Annual)

| Obligation | Due Date | Cost | Filed At |
|-----------|----------|------|----------|
| Annual Report | Anniversary month of formation | $60 minimum | wyobiz.wyo.gov |
| Registered Agent fee | Annual renewal | ~$100 | Agent provider |
| Form 1065 (Partnership Return) | March 15 (or extension) | CPA cost | IRS |
| Schedule K-1 to members | With Form 1065 | Included | IRS |

**Late penalties:** $50/month for delinquent annual report. Administrative dissolution after 2+ years.

### Florida Foreign Entity (If Registered)

| Obligation | Due Date | Cost | Filed At |
|-----------|----------|------|----------|
| Annual Report | May 1 | $138.75 | Sunbiz.org |
| Registered Agent fee | Annual renewal | ~$100 | Agent provider |

**Late penalties:** $400 if filed late. Authorization revoked after third Friday in September.

### Ongoing IP Management

| Obligation | Frequency | Notes |
|-----------|-----------|-------|
| Supplemental IP Assignment | As new IP is created (at least annually) | Assign new software, specs, marks to LLC |
| Transfer pricing review | Annual | Review royalty rates, document rationale |
| Intercompany invoicing | Quarterly | Real bank-to-bank payments |
| IP audit | Annual | Inventory all IP assets owned by LLC |

---

## Cost Summary

| Phase | Upfront | Annual Ongoing | Timeline |
|-------|---------|---------------|----------|
| WY LLC formation (incl. name reservation) | $260-$1,760 | $160/yr | 1-2 weeks |
| IP assignment + management | $500-$3,000 | $500-$1,000/yr (CPA review) | 2-4 weeks |
| FL foreign entity (if needed) | $350-$450 | $240-$340/yr | 1-2 weeks |
| Open Source Collective | $0 | 12-14% of donations | 1-2 weeks |
| SBIR Phase I (NSF) | $0 | N/A | 8-12 months to award |
| 501(c)(3) (Year 2, if triggered) | $3,500-$13,000 | $100-$500/yr | 3-14 months |

**Year 1 total (conservative, DIY):** ~$1,100-$2,200 + ongoing
**Year 1 total (recommended, with attorney/CPA):** ~$3,000-$7,000 + ongoing

---

## Anti-Patterns & Pitfalls

These are the most common mistakes for small multi-entity structures. Each is a direct threat to the legal separation and tax benefits of the structure.

| Pitfall | Consequence | Prevention |
|---------|------------|------------|
| No economic substance in WY LLC | IRS disregards entity; loses all benefits | Actively manage IP, maintain records, hold documented meetings |
| New IP never assigned to holding company | IP remains personally owned; LLC doesn't actually hold it | Execute supplemental IP assignments at least annually |
| Missing WY annual report | $50/month penalty; administrative dissolution after 2 years | Calendar the due date; set reminders |
| Missing FL foreign qualification (when required) | $500/yr penalty; can't sue in FL courts; no liability protection | Register if any doubt about operating activities in FL |
| Ignoring corporate formalities | Court or IRS "pierces the veil" — treats entities as one | Operating agreement, separate records, documented decisions |
| Commingled bank accounts | Single entity treatment; destroys asset protection | Separate banking from day 1; formal transfers only |

---

## Immediate Next Steps

| # | Action | Owner | Priority |
|---|--------|-------|----------|
| 1 | Search "Vorion" name availability at wyobiz.wyo.gov | Ryan/Alex | This week |
| 2 | Reserve the name ($60, locks for 120 days) | Ryan/Alex | This week |
| 3 | Select registered agent service | Ryan/Alex | This week |
| 4 | Register on SAM.gov (2-4 week processing) | Ryan/Alex | This week |
| 5 | File Articles of Organization at wyobiz.wyo.gov | Ryan/Alex | After name reservation |
| 6 | Obtain EIN from IRS | Ryan/Alex | Same day as formation |
| 7 | Open business bank account (Mercury/Relay) | Ryan/Alex | After EIN |
| 8 | Engage attorney for operating agreement + IP assignment | Ryan/Alex | Week 2 |
| 9 | Apply to Open Source Collective for BASIS/CAR/AgentAnchor | Ryan/Alex | Week 2 |
| 10 | Determine FL foreign qualification necessity (consult CPA) | Ryan/Alex | Month 2 |

---

*This document is a living reference. Update as decisions are made and phases complete.*
