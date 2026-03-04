# Aurais — Supabase Integration Guide

Complete step-by-step instructions to connect Aurais to Supabase for authentication and database.

---

## Prerequisites

- Aurais deployed on Vercel (aurais.net)
- Access to [Supabase Dashboard](https://supabase.com/dashboard)
- Access to [Vercel Dashboard](https://vercel.com/vorionsys/aurais)

---

## Step 1: Create Supabase Project

1. Go to **https://supabase.com/dashboard/projects**
2. Click **"New Project"**
3. Settings:
   - **Organization**: Vorion Systems (or your org)
   - **Name**: `aurais`
   - **Database Password**: Generate a strong password — save it securely
   - **Region**: `East US (Virginia)` (closest to Vercel's default)
   - **Plan**: Free tier is fine for now
4. Click **"Create new project"**
5. Wait ~2 minutes for provisioning
6. Note your **Project URL** and **anon key** from **Settings → API**:
   - `Project URL` → e.g., `https://abcdefghijk.supabase.co`
   - `anon public` key → starts with `eyJ...`

---

## Step 2: Add Environment Variables to Vercel

1. Go to **https://vercel.com/vorionsys/aurais/settings/environment-variables**
2. Add these variables (all environments: Production, Preview, Development):

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project-ref.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...your-anon-key` |
| `NEXT_PUBLIC_URL` | `https://aurais.net` |

3. Click **"Save"** for each

---

## Step 3: Install `@supabase/ssr`

The integration code uses `@supabase/ssr` for cookie-based auth in Next.js App Router. Run:

```bash
cd apps/aurais
npm install @supabase/ssr
```

> Note: `@supabase/supabase-js` is already installed.

---

## Step 4: Configure Supabase Auth Settings

In the Supabase Dashboard for your new project:

### 4a. Site URL
1. Go to **Authentication → URL Configuration**
2. Set **Site URL**: `https://aurais.net`

### 4b. Redirect URLs
Add these redirect URLs:
```
https://aurais.net/auth/callback
https://www.aurais.net/auth/callback
http://localhost:3000/auth/callback
```

### 4c. Email Templates (Optional)
1. Go to **Authentication → Email Templates**
2. Customize the **Confirm signup** template with Aurais branding
3. Customize the **Reset password** template

---

## Step 5: Enable OAuth Providers (Optional)

### GitHub OAuth
1. Go to **Authentication → Providers → GitHub**
2. Toggle **Enable**
3. Go to [GitHub OAuth Apps](https://github.com/settings/developers) → **New OAuth App**:
   - **Application name**: `Aurais`
   - **Homepage URL**: `https://aurais.net`
   - **Authorization callback URL**: `https://your-project-ref.supabase.co/auth/v1/callback`
4. Copy **Client ID** and **Client Secret** into Supabase

### Google OAuth
1. Go to **Authentication → Providers → Google**
2. Toggle **Enable**
3. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create OAuth Client**:
   - **Type**: Web application
   - **Authorized redirect URIs**: `https://your-project-ref.supabase.co/auth/v1/callback`
4. Copy **Client ID** and **Client Secret** into Supabase

---

## Step 6: Create Database Tables

In Supabase **SQL Editor**, run:

```sql
-- User profiles (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  plan TEXT DEFAULT 'core' CHECK (plan IN ('core', 'pro', 'enterprise')),
  organization TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, plan)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'plan', 'core')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Agent registrations
CREATE TABLE public.agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  trust_tier INTEGER DEFAULT 0 CHECK (trust_tier BETWEEN 0 AND 7),
  trust_score INTEGER DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 1000),
  car_id TEXT UNIQUE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  capabilities JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
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
```

---

## Step 7: Redeploy

After adding env vars and installing `@supabase/ssr`:

```bash
git add .
git commit -m "feat: integrate Supabase auth for Aurais"
git push
```

Vercel will auto-deploy. If env vars were added after the last deploy, trigger a redeploy:
1. Go to **Vercel Dashboard → Aurais → Deployments**
2. Click the `...` menu on the latest deployment
3. Click **"Redeploy"**

---

## What Was Already Implemented (Code Changes)

These files were created/updated as part of this integration:

### New Files
| File | Purpose |
|------|---------|
| `src/lib/supabase/client.ts` | Browser-side Supabase client |
| `src/lib/supabase/server.ts` | Server-side Supabase client (Route Handlers, Server Components) |
| `src/lib/supabase/middleware.ts` | Session refresh + route protection logic |
| `src/middleware.ts` | Next.js middleware entry point |
| `src/app/auth/callback/route.ts` | OAuth callback handler (code → session exchange) |
| `.env.example` | Template for environment variables |

### Updated Files
| File | Changes |
|------|---------|
| `src/app/api/auth/login/route.ts` | Replaced stub with `supabase.auth.signInWithPassword()` |
| `src/app/api/auth/signup/route.ts` | Replaced stub with `supabase.auth.signUp()` |
| `src/app/login/page.tsx` | OAuth buttons now use `supabase.auth.signInWithOAuth()` |
| `src/app/signup/page.tsx` | OAuth buttons now use `supabase.auth.signInWithOAuth()` |

---

## Architecture

```
Browser                    Supabase                    Vercel
  │                           │                           │
  ├──── Email/Pass Login ─────┤                           │
  │     signInWithPassword()  │                           │
  │                           │                           │
  ├──── OAuth (GitHub/Google) ┤                           │
  │     signInWithOAuth()     │──── Provider redirect ────┤
  │                           │                           │
  │     /auth/callback ───────┤   exchangeCodeForSession  │
  │                           │                           │
  ├──── Every Request ────────┤──── middleware.ts ─────────┤
  │     Session refresh       │   (cookie refresh)        │
  │                           │                           │
  ├──── Dashboard ────────────┤──── Protected by          │
  │     (auth required)       │   middleware redirect     │
```

---

## Verification Checklist

After completing all steps:

- [ ] Visit `https://aurais.net/signup` — create a test account
- [ ] Check email for verification link
- [ ] Click verification → should redirect to `/dashboard`
- [ ] Visit `https://aurais.net/login` — sign in with test account
- [ ] Try GitHub OAuth button (if configured)
- [ ] Try Google OAuth button (if configured)
- [ ] Visit `/dashboard` while logged out → should redirect to `/login`
- [ ] Check Supabase Dashboard → **Authentication → Users** — user should appear
- [ ] Check Supabase → **Table Editor → profiles** — profile should auto-create

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Missing Supabase URL" error | Verify env vars are set in Vercel and redeploy |
| OAuth redirect fails | Check Redirect URLs in Supabase Auth settings match exactly |
| "Invalid API key" | Ensure you're using the `anon` key, not the `service_role` key |
| Cookie not setting | `@supabase/ssr` must be installed (not just `@supabase/supabase-js`) |
| User created but no profile | Check the `handle_new_user` trigger was created in SQL |
| 500 on `/auth/callback` | Ensure the callback route file exists at `src/app/auth/callback/route.ts` |
