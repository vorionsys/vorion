-- Trust Records Observability Metadata
-- Migration: 0011_trust_observability_metadata.sql
-- Adds metadata column for observability class and attestation tracking

-- Add metadata JSONB column to trust_records for observability tracking
-- This enables storing:
--   - observabilityClass (0-4): BLACK_BOX, GRAY_BOX, WHITE_BOX, ATTESTED_BOX, VERIFIED_BOX
--   - attestationProvider: Hardware attestation provider (e.g., "Intel SGX", "AWS Nitro")
--   - verificationProof: Link or hash of formal verification proof
--   - sourceCodeUrl: URL to source code repository
--   - lastAuditDate: ISO date string of last security audit
--   - Additional custom metadata as needed

ALTER TABLE trust_records
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Create GIN index for efficient JSONB queries on metadata
CREATE INDEX IF NOT EXISTS trust_records_metadata_gin_idx
ON trust_records USING gin (metadata);

-- Create partial index for quick lookup of entities with specific observability classes
-- This is useful for filtering entities by observability level
CREATE INDEX IF NOT EXISTS trust_records_observability_class_idx
ON trust_records ((metadata->>'observabilityClass'))
WHERE metadata IS NOT NULL AND metadata->>'observabilityClass' IS NOT NULL;

COMMENT ON COLUMN trust_records.metadata IS 'JSONB column for observability metadata including class, attestation, and audit information';
