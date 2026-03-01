'use client';

import Link from 'next/link';
import { Award, ArrowLeft, ArrowRight } from 'lucide-react';
import { Navbar } from '@/components/nexus';

export default function CertificatesPage() {
  return (
    <>
      <Navbar />
      <main className="flex-grow pt-24 pb-12 px-4 max-w-4xl mx-auto w-full">
        <div className="text-center">
          <div className="w-20 h-20 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-6">
            <Award className="w-10 h-10 text-green-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Certificates</h1>
          <p className="text-gray-400 max-w-xl mx-auto mb-8">
            Earn certificates by completing learning paths and quizzes. Your certificates demonstrate
            mastery of AI governance concepts and the Vorion ecosystem.
          </p>

          <div className="glass p-8 rounded-xl border border-gray-700/50 mb-8">
            <h2 className="text-xl font-bold text-white mb-3">How to Earn Certificates</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
              <div>
                <div className="text-cyan-400 font-bold mb-1">1. Learn</div>
                <p className="text-sm text-gray-400">Follow a structured learning path to build your knowledge.</p>
              </div>
              <div>
                <div className="text-purple-400 font-bold mb-1">2. Quiz</div>
                <p className="text-sm text-gray-400">Take the quiz at the end of each path to test your understanding.</p>
              </div>
              <div>
                <div className="text-green-400 font-bold mb-1">3. Earn</div>
                <p className="text-sm text-gray-400">Score 80% or higher to earn your certificate.</p>
              </div>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <Link
              href="/paths"
              className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg font-medium transition"
            >
              Start a Learning Path
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg font-medium transition"
            >
              View Profile
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
