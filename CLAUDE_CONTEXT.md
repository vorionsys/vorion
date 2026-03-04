# Vorion Project Context

## Overview
Vorion is an enterprise AI governance platform focused on policy enforcement, trust scoring, and cryptographic auditability.

## Repository
- Monorepo root: `/Users/alexblanc/dev/vorion`
- Primary runtime: Node.js/TypeScript
- Key packages live under `src/` and `apps/`

## Security Modules (Current)
- RBAC: `src/rbac/`, `src/security/rbac/`
- MFA: `src/security/mfa/`
- CSRF protection: `src/security/csrf.ts`
- Session management: `src/security/session-*.ts`
- WebAuthn: `src/security/webauthn/`

## Notes
- Deployment configs: `docker-compose.personal.yml`, `docker-compose.business.yml`, `docker-compose.enterprise.yml`
