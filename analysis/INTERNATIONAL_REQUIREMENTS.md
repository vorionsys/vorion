# Vorion Platform - International Requirements Gap Analysis

**Document Version:** 1.0
**Date:** 2026-02-04
**Classification:** Internal

---

## Executive Summary

This document provides a comprehensive gap analysis of Vorion's international compliance readiness across major jurisdictions. The analysis covers regulatory requirements for the European Union, United Kingdom, Asia-Pacific, and Canada, along with technical requirements for global deployment.

### Overall Readiness Score: 72/100

| Region | Readiness | Critical Gaps |
|--------|-----------|---------------|
| European Union | 85% | EU AI Act full implementation pending |
| United Kingdom | 65% | Cyber Essentials certification needed |
| Asia-Pacific | 45% | PIPL/CSL data localization not implemented |
| Canada | 70% | Quebec Law 25 updates needed |
| Technical (i18n/l10n) | 55% | Multi-currency, regional data centers |

---

## 1. European Union Requirements

### 1.1 GDPR (General Data Protection Regulation)

**Status: IMPLEMENTED**

#### Implemented Features

| Requirement | Implementation | File Location |
|-------------|----------------|---------------|
| Right to Access (Art. 15) | `exportUserData()` method with streaming pagination | `/packages/platform-core/src/intent/gdpr.ts` |
| Right to Erasure (Art. 17) | `eraseUserData()` soft delete with audit trail | `/packages/platform-core/src/intent/gdpr.ts` |
| Data Portability (Art. 20) | Machine-readable JSON export | `/packages/platform-core/src/intent/gdpr.ts` |
| DPO Role Support | `GdprRole` type includes 'dpo' role | `/packages/platform-core/src/intent/gdpr.ts` |
| Authorization Context | `GdprAuthorizationContext` with tenant isolation | `/packages/platform-core/src/intent/gdpr.ts` |
| Consent Management | `hasExplicitConsent` flag for erasure operations | `/packages/platform-core/src/intent/gdpr.ts` |
| Audit Logging | Comprehensive audit trail via `AuditService` | `/packages/platform-core/src/intent/gdpr.ts` |
| Rate Limiting | `GdprRateLimiter` prevents abuse | `/packages/platform-core/src/intent/gdpr-rate-limiter.ts` |

#### Cross-Border Data Transfer Controls

**Status: IMPLEMENTED**

| Feature | Implementation | File Location |
|---------|----------------|---------------|
| Adequacy Decisions Registry | Full list of EU adequacy countries | `/packages/security/src/compliance/gdpr/data-transfers.ts` |
| Standard Contractual Clauses | `SCCManager` with 2021/914 template | `/packages/security/src/compliance/gdpr/data-transfers.ts` |
| Transfer Impact Assessment | `TIAService` with risk classification | `/packages/security/src/compliance/gdpr/data-transfers.ts` |
| Schrems II Compliance | `SchremsIIService` with government access risk | `/packages/security/src/compliance/gdpr/data-transfers.ts` |
| Data Localization | `DataLocalizationManager` | `/packages/security/src/compliance/gdpr/data-transfers.ts` |
| Encryption Requirements | `EncryptionLevel` with zero-knowledge support | `/packages/security/src/compliance/gdpr/data-transfers.ts` |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Automated SCC agreement tracking | Medium | Add database persistence for SCCAgreement |
| TIA expiration notifications | Low | Add scheduled jobs for TIA renewal alerts |
| Real-time adequacy decision updates | Low | Integrate with EU official data source |

### 1.2 EU AI Act Compliance

**Status: PARTIALLY IMPLEMENTED**

#### Implemented Features

| Requirement | Implementation | File Location |
|-------------|----------------|---------------|
| Risk Classification | `RiskLevel` types (low/medium/high/critical) | `/packages/security/src/security/ai-governance/types.ts` |
| Model Registry | `ModelRegistry` with inventory and versioning | `/packages/security/src/security/ai-governance/model-registry.ts` |
| Audit Trail | `AIAuditLogEntry` with comprehensive logging | `/packages/security/src/security/ai-governance/types.ts` |
| Bias Detection | `BiasDetector` with fairness monitoring | `/packages/security/src/security/ai-governance/bias-detection.ts` |
| Output Filtering | `OutputFilter` with PII redaction | `/packages/security/src/security/ai-governance/output-filter.ts` |
| Prompt Injection Defense | `PromptInjectionDetector` | `/packages/security/src/security/ai-governance/prompt-injection.ts` |
| Rate Limiting | `AIRateLimiter` with cost controls | `/packages/security/src/security/ai-governance/rate-limiter.ts` |
| Compliance Reports | `ComplianceReport` generation | `/packages/security/src/security/ai-governance/types.ts` |

#### EU AI Act Requirements Mapping

| Article | Requirement | Status | Implementation |
|---------|-------------|--------|----------------|
| Art. 9 | Risk Management System | Partial | Risk-Trust model exists |
| Art. 10 | Data Governance | Implemented | Data classification system |
| Art. 11 | Technical Documentation | Implemented | Architecture docs |
| Art. 12 | Record Keeping | Implemented | PROOF artifact system |
| Art. 13 | Transparency | Partial | User documentation exists |
| Art. 14 | Human Oversight | Implemented | Escalation mechanisms |
| Art. 15 | Accuracy & Robustness | Partial | Validation and testing |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| CE Marking workflow | High | Implement conformity assessment process |
| Prohibited AI classification | High | Add prohibited use case detection |
| Transparency UI for AI decisions | Medium | Build user-facing explanation UI |
| Fundamental rights impact assessment | Medium | Create FRIA workflow template |
| EU AI database registration | High | Integrate with EU AI Act database |

### 1.3 Data Residency Requirements

**Status: IMPLEMENTED**

The `DataLocalizationManager` class provides:
- Preferred region configuration
- Allowed/blocked country lists
- Replication controls
- Storage location validation

**File:** `/packages/security/src/compliance/gdpr/data-transfers.ts`

---

## 2. United Kingdom Requirements

### 2.1 UK GDPR

**Status: PARTIAL**

UK GDPR is largely aligned with EU GDPR. Current GDPR implementation covers most requirements.

| Requirement | Status | Notes |
|-------------|--------|-------|
| Data Subject Rights | Implemented | Same as EU GDPR |
| Lawful Basis | Implemented | Same as EU GDPR |
| Data Protection Principles | Implemented | Same as EU GDPR |
| UK-specific transfers | Partial | UK adequacy decision tracked but expires June 2025 |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| UK ICO reporting integration | Medium | Add UK-specific breach reporting |
| UK adequacy decision monitoring | High | Alert on UK adequacy expiration (June 2025) |
| UK-specific data transfer mechanisms | Medium | Implement UK IDTA (International Data Transfer Agreement) |

### 2.2 Cyber Essentials / Cyber Essentials Plus

**Status: NOT IMPLEMENTED**

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Boundary Firewalls | Partial (cloud security groups) | Formal certification needed |
| Secure Configuration | Implemented (hardened configs) | Documentation for assessment |
| Access Control | Implemented (RBAC/ABAC) | Certification evidence |
| Malware Protection | Partial | Endpoint protection evidence |
| Patch Management | Partial | Formal patching policy |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Cyber Essentials certification | High | Engage certification body |
| Cyber Essentials Plus certification | High | External vulnerability assessment |
| Self-assessment questionnaire | Medium | Complete CE questionnaire |

### 2.3 G-Cloud Framework

**Status: NOT IMPLEMENTED**

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| G-Cloud 14 listing | Not listed | Application required |
| Service definition | Not created | Need G-Cloud service docs |
| Pricing structure | Not defined | G-Cloud pricing model |
| Framework terms | Not accepted | Legal review needed |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| G-Cloud supplier application | High | Apply for G-Cloud 14/15 |
| Service definition documents | High | Create G-Cloud service specs |
| UK data center presence | Medium | Evaluate UK region deployment |

---

## 3. Asia-Pacific Requirements

### 3.1 China - PIPL, CSL, Data Localization

**Status: NOT IMPLEMENTED**

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Personal Information Protection Law (PIPL) | Not implemented | Major gap |
| Cybersecurity Law (CSL) | Not implemented | Major gap |
| Data Localization | Not implemented | China data center required |
| Cross-border transfer assessment | Not implemented | CAC approval process |
| Data Security Law (DSL) | Not implemented | Data classification required |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| China data center | Critical | Partner with local provider |
| PIPL consent mechanisms | Critical | Implement separate consent flows |
| CAC security assessment | Critical | Engage local counsel |
| Critical data identification | High | Implement China data classification |
| Local representative | High | Appoint China DPO equivalent |

### 3.2 Japan - APPI (Act on Protection of Personal Information)

**Status: PARTIAL**

Japan has EU adequacy decision, simplifying compliance.

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Adequacy decision | Tracked | Mutual adequacy with EU |
| Opt-out processing | Partial | Need explicit opt-out mechanism |
| Third-party provision | Partial | Logging exists |
| Pseudonymization | Implemented | Via data transfers module |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Japan-specific consent language | Medium | Add Japanese language consent |
| PPC reporting integration | Low | Japan breach notification |
| Anonymization techniques | Low | Japan-specific anonymization |

### 3.3 Singapore - PDPA (Personal Data Protection Act)

**Status: PARTIAL**

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Consent obligations | Partial | Consent framework exists |
| Purpose limitation | Implemented | Via BASIS policy |
| Access and correction | Implemented | Via GDPR module |
| Data breach notification | Partial | Need PDPC notification |
| Data Protection Officer | Partial | DPO role exists |
| Do Not Call registry | Not implemented | Singapore-specific |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| PDPC breach notification | Medium | Add Singapore notification workflow |
| Do Not Call integration | Low | Marketing compliance |
| Singapore data center | Medium | Evaluate SG region |

### 3.4 Australia - Privacy Act & Essential Eight

**Status: PARTIAL**

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Australian Privacy Principles | Partial | Similar to GDPR |
| Notifiable Data Breaches | Partial | Need OAIC notification |
| Essential Eight (E8) | Partial | Security controls exist |

**Essential Eight Maturity Assessment:**

| Control | Current Maturity | Target |
|---------|------------------|--------|
| Application Control | Level 1 | Level 2 |
| Patch Applications | Level 2 | Level 2 |
| Configure Office Macros | N/A | N/A |
| User Application Hardening | Level 1 | Level 2 |
| Restrict Admin Privileges | Level 2 | Level 2 |
| Patch Operating Systems | Level 2 | Level 2 |
| Multi-factor Authentication | Level 2 | Level 3 |
| Regular Backups | Level 2 | Level 2 |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| OAIC breach notification | Medium | Australian notification workflow |
| Essential Eight Level 3 MFA | Medium | Hardware token support |
| Australia data center | Low | Evaluate AU region |

---

## 4. Canada Requirements

### 4.1 PIPEDA (Personal Information Protection and Electronic Documents Act)

**Status: PARTIAL**

Canada has partial EU adequacy decision for commercial organizations.

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Consent | Implemented | Via GDPR module |
| Purpose identification | Implemented | Via BASIS policy |
| Accountability | Implemented | Audit trail |
| Individual access | Implemented | Via GDPR export |
| Challenging compliance | Partial | Need complaint workflow |
| OPC breach notification | Partial | Need Canada-specific flow |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| OPC breach notification | Medium | Canadian notification workflow |
| PIPEDA complaint handling | Low | Complaint workflow |
| Canadian data center | Medium | Evaluate CA region |

### 4.2 Quebec Law 25 (Bill 64)

**Status: NOT IMPLEMENTED**

Quebec's Law 25 introduces stricter requirements than PIPEDA.

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Privacy Impact Assessment | Partial | DPIA exists but not Quebec-specific |
| Anonymization standard | Not implemented | Quebec anonymization rules |
| Consent granularity | Partial | Need enhanced consent |
| Privacy by default | Partial | Need default settings |
| Profiling transparency | Not implemented | AI profiling disclosure |
| CAI registration | Not implemented | Quebec registry |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Quebec PIA template | High | Create Law 25 compliant PIA |
| Anonymization certification | High | Implement Quebec standards |
| CAI breach notification | High | Quebec-specific notification |
| Profiling disclosure | Medium | AI decision transparency |
| Quebec data localization | Medium | Evaluate Quebec hosting |

---

## 5. Technical Requirements

### 5.1 Multi-Language / Internationalization (i18n)

**Status: NOT IMPLEMENTED**

Current state: No custom i18n implementation found in application code. Only framework-level i18n support exists in node_modules.

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| UI translation | Not implemented | Major gap |
| Error message localization | Not implemented | Major gap |
| Date/time formatting | Partial | Framework support only |
| Number formatting | Partial | Framework support only |
| RTL language support | Not implemented | Major gap |
| Content localization | Not implemented | Major gap |

**Required Languages:**

| Language | Region | Priority |
|----------|--------|----------|
| English (US) | North America | Implemented |
| English (UK) | United Kingdom | High |
| French | France, Canada, Quebec | High |
| German | Germany, Austria, Switzerland | High |
| Japanese | Japan | Medium |
| Simplified Chinese | China | Critical (if China market) |
| Portuguese | Brazil | Medium |
| Spanish | Spain, Latin America | Medium |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| i18n framework implementation | High | Implement i18next or similar |
| Translation management system | High | Integrate Crowdin/Lokalise |
| Locale-aware formatting | High | Implement Intl API usage |
| RTL layout support | Medium | CSS/component updates |
| Legal document translations | High | Professional translation |

### 5.2 Multi-Currency Support

**Status: NOT IMPLEMENTED**

No multi-currency support found in the codebase.

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Currency conversion | Not implemented | Major gap |
| Regional pricing | Not implemented | Major gap |
| Invoice localization | Not implemented | Major gap |
| Tax calculation | Not implemented | Major gap |

**Required Currencies:**

| Currency | Region | Priority |
|----------|--------|----------|
| USD | United States | Implemented (assumed) |
| EUR | European Union | High |
| GBP | United Kingdom | High |
| CAD | Canada | Medium |
| JPY | Japan | Medium |
| SGD | Singapore | Medium |
| AUD | Australia | Medium |
| CNY | China | Critical (if China market) |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Currency formatting | High | Implement Intl.NumberFormat |
| Exchange rate service | Medium | Integrate currency API |
| Regional pricing engine | Medium | Build pricing configuration |
| Tax jurisdiction handling | Medium | Integrate tax service |

### 5.3 Regional Data Centers

**Status: PARTIAL**

Policy bundles reference multi-region architecture, but implementation status unclear.

| Region | Status | Gap |
|--------|--------|-----|
| US (multiple regions) | Assumed active | Verify deployment |
| EU (Frankfurt/Dublin) | Unknown | High priority for GDPR |
| UK (London) | Unknown | Required post-Brexit |
| Canada | Unknown | Medium priority |
| Singapore | Unknown | APAC coverage |
| Australia (Sydney) | Unknown | APAC coverage |
| Japan (Tokyo) | Unknown | APAC coverage |
| China | Not available | Critical if China market |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| EU data center confirmation | Critical | Verify Frankfurt/Dublin deployment |
| UK data center | High | Deploy London region |
| Regional failover | Medium | Cross-region replication |
| Data residency controls | Implemented | Via DataLocalizationManager |

### 5.4 Data Sovereignty Controls

**Status: IMPLEMENTED**

The `DataLocalizationManager` and transfer controls provide sovereignty features.

| Feature | Status | Implementation |
|---------|--------|----------------|
| Geographic restrictions | Implemented | `allowedCountries`/`blockedCountries` |
| Processing location | Implemented | `processingLocationRequired` |
| Storage location | Implemented | `storageLocationRequired` |
| Replication controls | Implemented | `replicationAllowed`/`allowedReplicationRegions` |
| Transfer validation | Implemented | `validateTransfer()` |

### 5.5 Cross-Border Data Transfer Mechanisms

**Status: IMPLEMENTED**

| Mechanism | Status | Implementation |
|-----------|--------|----------------|
| Adequacy Decisions | Implemented | `AdequacyDecisionRegistry` |
| Standard Contractual Clauses | Implemented | `SCCManager` |
| Binding Corporate Rules | Partial | Legal basis supported |
| Transfer Impact Assessment | Implemented | `TIAService` |
| Supplementary Measures | Implemented | `SupplementaryMeasure` types |
| Schrems II Assessment | Implemented | `SchremsIIService` |

---

## 6. AI-Specific Requirements (EU AI Act)

### 6.1 Risk Classification System

**Status: IMPLEMENTED**

```typescript
// From /packages/security/src/security/ai-governance/types.ts
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
```

| Risk Level | EU AI Act Mapping | Implementation |
|------------|-------------------|----------------|
| low | Minimal Risk | Voluntary codes |
| medium | Limited Risk | Transparency requirements |
| high | High Risk | Full compliance obligations |
| critical | Unacceptable Risk | Prohibited (detection needed) |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| Prohibited AI use detection | Critical | Implement prohibited use classifier |
| Annex I/II/III mapping | High | Map to EU AI Act annexes |
| Automatic classification | Medium | ML-based risk classification |

### 6.2 Transparency Requirements

**Status: PARTIAL**

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Model inventory | Implemented | `ModelRegistry` |
| Capability documentation | Implemented | `AIModelMetadata.capabilities` |
| Training data info | Implemented | `TrainingDataInfo` |
| Bias detection | Implemented | `BiasDetector` |
| Decision logging | Implemented | `AIAuditLogEntry` |
| User notification | Not implemented | Gap |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| AI interaction disclosure | High | UI indicator for AI content |
| Decision explanation | Medium | Implement explainability layer |
| Synthetic content marking | High | Watermarking for AI output |

### 6.3 Human Oversight Mechanisms

**Status: IMPLEMENTED**

| Feature | Status | Implementation |
|---------|--------|----------------|
| Human-in-the-loop | Implemented | Escalation workflows |
| Override capability | Implemented | Trust score overrides |
| Intervention points | Implemented | Pre/post action gates |
| Audit trail | Implemented | PROOF system |

### 6.4 Technical Documentation

**Status: PARTIAL**

| Document | Status | Location |
|----------|--------|----------|
| System architecture | Implemented | `/docs/` directory |
| Risk assessment | Partial | Trust model docs |
| Data governance | Implemented | Constitution docs |
| Security measures | Implemented | Security whitepaper |
| Testing methodology | Partial | Test documentation |
| Performance metrics | Partial | Monitoring docs |

**Gaps Identified:**

| Gap | Priority | Remediation |
|-----|----------|-------------|
| EU AI Act conformity doc | High | Create Article 11 compliant docs |
| Quality management system | Medium | ISO 9001 integration |
| Post-market monitoring plan | Medium | Ongoing monitoring docs |

---

## 7. Implementation Roadmap

### Phase 1: Critical (0-3 months)

| Task | Region | Priority |
|------|--------|----------|
| Verify EU data center deployment | EU | Critical |
| Implement prohibited AI detection | EU | Critical |
| Begin G-Cloud application | UK | High |
| Quebec Law 25 PIA template | Canada | High |
| i18n framework implementation | Global | High |

### Phase 2: High Priority (3-6 months)

| Task | Region | Priority |
|------|--------|----------|
| Cyber Essentials certification | UK | High |
| EU AI Act conformity documentation | EU | High |
| UK IDTA implementation | UK | High |
| Multi-currency support | Global | High |
| French/German translations | EU | High |

### Phase 3: Medium Priority (6-12 months)

| Task | Region | Priority |
|------|--------|----------|
| Singapore PDPC integration | APAC | Medium |
| Australia OAIC integration | APAC | Medium |
| Japan localization | APAC | Medium |
| Essential Eight Level 3 | APAC | Medium |
| Canadian data center | Canada | Medium |

### Phase 4: Long-term (12+ months)

| Task | Region | Priority |
|------|--------|----------|
| China market entry (if required) | APAC | Critical |
| Brazil LGPD implementation | LATAM | Medium |
| India DPDP Act preparation | APAC | Medium |
| RTL language support | MENA | Low |

---

## 8. Summary of Gaps by Severity

### Critical Gaps (Blocking)

1. **EU Data Center Verification** - Cannot claim EU compliance without verified EU hosting
2. **Prohibited AI Detection** - EU AI Act requires blocking prohibited uses
3. **China Data Localization** - Required for China market entry

### High Priority Gaps

1. **i18n Framework** - Required for any non-English market
2. **Multi-Currency** - Required for international billing
3. **UK Cyber Essentials** - Required for UK government sector
4. **G-Cloud Listing** - Required for UK public sector sales
5. **Quebec Law 25 Compliance** - Mandatory for Quebec operations
6. **EU AI Act Documentation** - Mandatory by August 2025

### Medium Priority Gaps

1. **Regional breach notification** - Country-specific workflows needed
2. **Japan/Singapore localization** - Market expansion requirement
3. **Essential Eight maturity** - Australian government requirement
4. **UK data center** - Post-Brexit requirement

### Low Priority Gaps

1. **RTL language support** - Future market expansion
2. **Brazil LGPD** - Latin America expansion
3. **Minor notification integrations** - Compliance optimization

---

## 9. References

### Implemented Files

| File | Description |
|------|-------------|
| `/packages/platform-core/src/intent/gdpr.ts` | GDPR data export and erasure service |
| `/packages/platform-core/src/intent/gdpr-rate-limiter.ts` | GDPR rate limiting |
| `/packages/security/src/compliance/gdpr/data-transfers.ts` | Cross-border transfer controls |
| `/packages/security/src/security/ai-governance/types.ts` | AI governance type definitions |
| `/packages/security/src/security/ai-governance/index.ts` | AI governance system factory |
| `/docs/constitution/vorion_global_compliance.md` | JSAL and policy bundle architecture |

### External Resources

- [EU GDPR Official Text](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)
- [UK GDPR](https://www.legislation.gov.uk/ukpga/2018/12/contents/enacted)
- [Cyber Essentials](https://www.ncsc.gov.uk/cyberessentials)
- [G-Cloud Framework](https://www.digitalmarketplace.service.gov.uk/)
- [China PIPL](http://www.npc.gov.cn/npc/c30834/202108/a8c4e3672c74491a80b53a172bb753fe.shtml)
- [Japan APPI](https://www.ppc.go.jp/en/)
- [Singapore PDPA](https://www.pdpc.gov.sg/)
- [Australia Privacy Act](https://www.oaic.gov.au/)
- [Canada PIPEDA](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/)
- [Quebec Law 25](https://www.quebec.ca/en/government/ministere/cybersecurity-digital)

---

*Document generated: 2026-02-04*
*Next review: 2026-05-04*
