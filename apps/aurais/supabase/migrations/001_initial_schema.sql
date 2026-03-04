-- Aurais Initial Schema
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- Aligned with @vorionsys/shared-constants trust tiers (T0-T7, 0-1000 scale)

-- =============================================================================
-- PROFILES (extends auth.users)
-- =============================================================================

CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'core' CHECK (plan IN ('core', 'starter', 'pro', 'team', 'enterprise')),
  organization TEXT,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, plan)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'plan', 'core')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================
-- AGENTS
-- =============================================================================

CREATE TABLE public.agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT DEFAULT '',
  model TEXT DEFAULT 'claude-sonnet-4-20250514',
  trust_tier INTEGER DEFAULT 0 CHECK (trust_tier BETWEEN 0 AND 7),
  trust_score INTEGER DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 1000),
  car_id TEXT UNIQUE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'training', 'active', 'suspended', 'archived')),
  specialization TEXT DEFAULT 'core',
  capabilities JSONB DEFAULT '[]'::jsonb,
  personality_traits JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  executions INTEGER DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agents"
  ON public.agents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create agents"
  ON public.agents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own agents"
  ON public.agents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own agents"
  ON public.agents FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Index for user agent lookups
CREATE INDEX idx_agents_user_id ON public.agents(user_id);
CREATE INDEX idx_agents_status ON public.agents(status);

-- =============================================================================
-- ACTIVITY LOG
-- =============================================================================

CREATE TABLE public.activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activity"
  ON public.activity_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity"
  ON public.activity_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_activity_user_id ON public.activity_log(user_id);
CREATE INDEX idx_activity_created_at ON public.activity_log(created_at DESC);
