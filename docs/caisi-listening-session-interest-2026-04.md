# CAISI Listening Session — Interest Submission
## Barriers to AI Adoption in the Finance Sector

**To:** caisi-events@nist.gov
**Subject:** Barriers to Adoption in [Finance]
**Organization:** Vorion
**Contact:** Alex Blanc and Ryan Cason — contact@vorion.org | https://vorion.org
**Submission Date:** March 2026
**Target Session:** CAISI Virtual Workshop on Barriers to AI Adoption — April 2026

---

## Organization Description

Vorion is an open-source AI agent security platform developer. We build and maintain the BASIS Standard — an open trust scoring and governance specification for AI agent systems — and reference implementations used in enterprise and regulated-industry deployments. Our implementations are directly deployed in financial services contexts, giving us direct operational data on the barriers institutions face when adopting AI agent systems.

---

## Barriers to Adoption in the Finance Sector

Financial institutions represent the largest category of enterprise AI agent adopters, yet adoption remains restrained by three structural barriers that current standards, tooling, and guidance do not address:

**1. Unquantifiable liability exposure**

Financial institutions cannot model the financial risk of an AI agent misbehaving because no industry-standard framework exists for measuring agent trust, behavioral reliability, or blast radius. Without quantifiable trust metrics, risk management teams cannot approve agent deployments — the risk profile is binary (either works correctly or causes material damage), which is unacceptable for institutions with fiduciary obligations. We have measured this directly: every enterprise engagement begins with a risk quantification request that existing AI governance tools cannot satisfy.

**2. Compliance gap in existing audit frameworks**

SOC 2, ISO 27001, and PCI DSS include no controls specific to AI agent behavior. Financial institutions subject to these frameworks cannot demonstrate compliance for agent deployments. Our compliance mapping work has identified 13+ compliance frameworks with zero AI agent-specific control coverage. The result is regulatory paralysis: compliance officers routinely block AI agent rollouts that security teams have signed off, because no audit trail exists for agent-level actions.

**3. No insurance underwriting model for agentic risk**

Cyber insurance policies either explicitly exclude AI agent incidents or lack actuarial models for pricing the risk. Without a standardized trust score or behavioral profile for AI agents, insurers cannot underwrite the exposure. This creates a catch-22: institutions cannot deploy agents without insurance coverage, and insurers cannot price coverage without standardized metrics. We estimate this blocks a meaningful share of financial sector AI agent deployments at the final approval stage.

**What enabled progress:** In cases where financial institutions have successfully adopted AI agent systems, three factors made the difference: (1) graduated trust scoring that provides measurable, auditable trust trajectories; (2) cryptographic proof chains that produce audit records accepted by compliance reviewers; and (3) progressive containment controls that allow risk management to approve "start narrow, earn expansion" deployment patterns rather than requiring full-scope approval upfront.

---

*Vorion provides open-source implementations of all enabling patterns described above. We welcome the opportunity to present this evidence and concrete tooling to CAISI's working group.*

---
*One page — submitted per CAISI interest submission format, February 2026 announcement*
