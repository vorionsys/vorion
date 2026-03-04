'use client';

import { useState } from 'react';
import { Navbar, NeuralLink, NexusChat } from '@/components/nexus';
import { useSubmissions } from '@/lib/supabase-hooks';

export default function NeuralPage() {
  const [chatOpen, setChatOpen] = useState(false);
  const { submitTerm } = useSubmissions();

  const handleSubmit = async (data: { term: string; definition: string; level: string }) => {
    const result = await submitTerm({
      term: data.term,
      definition: data.definition,
      level: data.level as 'novice' | 'intermediate' | 'expert' | 'theoretical',
    });

    if (result) {
      console.log('Submitted to Supabase:', result);
    } else {
      console.warn('Submission failed or Supabase not configured');
    }
  };

  return (
    <>
      <Navbar onActivateChat={() => setChatOpen(true)} />
      <main className="flex-grow pt-24 pb-12 px-4 max-w-7xl mx-auto w-full">
        <NeuralLink onSubmit={handleSubmit} />
      </main>
      <NexusChat isOpen={chatOpen} onToggle={() => setChatOpen(!chatOpen)} />
    </>
  );
}
