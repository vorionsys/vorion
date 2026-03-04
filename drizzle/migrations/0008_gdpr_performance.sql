-- Migration: 0008_gdpr_performance
-- Description: Add performance indexes for GDPR compliance operations
-- Created: 2026-01-25
--
-- These indexes optimize the performance of GDPR-related queries:
-- - exportUserData() - Article 15 Right of Access
-- - eraseUserData() - Article 17 Right to Erasure
-- - Audit trail queries for compliance reporting

-- =============================================================================
-- 1. INTENTS TABLE - GDPR EXPORT INDEX
-- =============================================================================

-- Index for GDPR exportUserData() and eraseUserData() queries
-- Optimizes: SELECT * FROM intents WHERE entity_id = ?
-- Note: Uses CONCURRENTLY to avoid locking the table during index creation
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intents_entity_id_idx"
ON "intents" ("entity_id");

-- =============================================================================
-- 2. AUDIT RECORDS - USER ACTIVITY INDEX
-- =============================================================================

-- Index for audit queries by user and timestamp
-- Optimizes: SELECT * FROM audit_records WHERE actor_id = ? ORDER BY event_time
-- Used for GDPR Article 15 access reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_records_user_timestamp_idx"
ON "audit_records" ("actor_id", "event_time");

-- =============================================================================
-- 3. INTENT EVENTS - CHRONOLOGICAL INDEX
-- =============================================================================

-- Index for intent event queries by intent and creation time
-- Optimizes: SELECT * FROM intent_events WHERE intent_id = ? ORDER BY created_at
-- Note: intent_events uses occurred_at for timestamps, adding created_at alias index
CREATE INDEX CONCURRENTLY IF NOT EXISTS "intent_events_intent_created_idx"
ON "intent_events" ("intent_id", "occurred_at");

-- =============================================================================
-- 4. COMMENTS
-- =============================================================================

COMMENT ON INDEX "intents_entity_id_idx" IS 'Optimizes GDPR export/erasure queries by entity';
COMMENT ON INDEX "audit_records_user_timestamp_idx" IS 'Optimizes GDPR audit trail queries by user';
COMMENT ON INDEX "intent_events_intent_created_idx" IS 'Optimizes chronological event queries for intent history';
