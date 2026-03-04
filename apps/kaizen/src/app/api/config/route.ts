import { NextResponse } from 'next/server';

export async function GET() {
  // Check AI provider status (server-side env vars)
  const providerStatus = {
    gemini: { available: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY, simulated: false },
    claude: {
      available: !!process.env.ANTHROPIC_API_KEY,
      simulated: !process.env.ANTHROPIC_API_KEY
    },
    grok: {
      available: !!process.env.XAI_API_KEY,
      simulated: !process.env.XAI_API_KEY
    },
  };

  return NextResponse.json({
    supabase: {
      configured: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      urlPresent: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    },
    providers: providerStatus,
  });
}
