-- MFA (Multi-Factor Authentication) Tables
-- Migration: 0010_mfa_tables.sql
-- Creates tables for TOTP-based MFA with backup codes and challenge tracking

-- MFA method enum
CREATE TYPE mfa_method AS ENUM ('totp', 'backup_codes');
CREATE TYPE mfa_status AS ENUM ('pending', 'active', 'disabled');

-- User MFA settings table
CREATE TABLE user_mfa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  totp_secret TEXT,
  totp_secret_encrypted BOOLEAN DEFAULT true,
  status mfa_status NOT NULL DEFAULT 'pending',
  enabled_at TIMESTAMPTZ,
  enrollment_started_at TIMESTAMPTZ,
  enrollment_expires_at TIMESTAMPTZ,
  grace_period_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_mfa_user_id_idx ON user_mfa(user_id);
CREATE INDEX user_mfa_tenant_id_idx ON user_mfa(tenant_id);
CREATE INDEX user_mfa_status_idx ON user_mfa(status);

-- Backup codes table
CREATE TABLE mfa_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_mfa_id UUID NOT NULL REFERENCES user_mfa(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  used_from_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mfa_backup_codes_user_mfa_id_idx ON mfa_backup_codes(user_mfa_id);

-- MFA challenges table
CREATE TABLE mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  challenge_token TEXT NOT NULL UNIQUE,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mfa_challenges_user_id_idx ON mfa_challenges(user_id);
CREATE INDEX mfa_challenges_token_idx ON mfa_challenges(challenge_token);
