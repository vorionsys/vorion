'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  text: string;
  status: 'pending' | 'completed';
  solutionLink?: string;
  createdAt?: { seconds: number };
  completedAt?: { seconds: number };
}

export default function VorionDevLog() {
  const [tasks, setTasks] = useState<Task[]>(() => [
    { id: '1', text: 'Integrate shared-constants across all packages', status: 'completed', solutionLink: 'github.com/vorionsys/vorion/commit/5b03b63', createdAt: { seconds: Date.now() / 1000 } },
    { id: '2', text: 'Update GitHub READMEs with ecosystem info', status: 'pending', createdAt: { seconds: Date.now() / 1000 } },
    { id: '3', text: 'Deploy Cognigate API to production', status: 'pending', createdAt: { seconds: Date.now() / 1000 } },
    { id: '4', text: 'Implement @vorion/security package', status: 'pending', createdAt: { seconds: Date.now() / 1000 } },
  ]);
  const [newTaskInput, setNewTaskInput] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [solutionLink, setSolutionLink] = useState('');
  const [isLoading] = useState(false);

  // TODO: Replace with actual Firebase initialization
  // For now using local state - integrate with your Firebase config

  const handleAddTask = () => {
    if (!newTaskInput.trim()) return;

    const newTask: Task = {
      id: Date.now().toString(),
      text: newTaskInput.trim(),
      status: 'pending',
      createdAt: { seconds: Date.now() / 1000 },
    };

    setTasks(prev => [newTask, ...prev]);
    setNewTaskInput('');
  };

  const openCompletionModal = (taskId: string) => {
    setCompletingTaskId(taskId);
    setSolutionLink('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCompletingTaskId(null);
    setSolutionLink('');
  };

  const submitCompletion = () => {
    if (!completingTaskId) return;

    setTasks(prev => prev.map(task =>
      task.id === completingTaskId
        ? { ...task, status: 'completed' as const, solutionLink: solutionLink || 'N/A', completedAt: { seconds: Date.now() / 1000 } }
        : task
    ));

    closeModal();
  };

  const formatUrl = (str: string) => {
    if (!str) return '#';
    return (str.startsWith('http') || str.startsWith('/') || str.startsWith('./')) ? str : 'https://' + str;
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  return (
    <div className="min-h-screen bg-[#050505] text-[#E5E5E5] font-sans overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed w-full z-50 border-b border-[#333333] bg-[#050505]/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#F25F4C] rounded-sm flex items-center justify-center">
                <svg className="w-4 h-4 text-[#050505]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <span className="font-bold text-xl tracking-tight text-white">VORION</span>
            </div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-8">
                <a href="#core" className="hover:text-[#F25F4C] transition px-3 py-2 text-sm font-medium">The Axiom</a>
                <a href="#architecture" className="hover:text-[#F25F4C] transition px-3 py-2 text-sm font-medium">Proof Layers</a>
                <a href="#gtm" className="hover:text-[#F25F4C] transition px-3 py-2 text-sm font-medium">GTM</a>
                <a href="#tasks" className="text-[#F25F4C] hover:text-white transition px-3 py-2 text-sm font-bold border border-[#F25F4C]/30 bg-[#F25F4C]/5">
                  <span className="mr-2">{'>'}_</span>DevLog
                </a>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 bg-[#050505]">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'linear-gradient(to right, #1a1a1a 1px, transparent 1px), linear-gradient(to bottom, #1a1a1a 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent 100%)'
        }} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="border-l-2 border-[#F25F4C] pl-6 mb-8">
            <p className="text-[#F25F4C] font-mono text-sm tracking-widest uppercase">Infrastructure Layer</p>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mt-2">
              Enforce the <br />
              <span className="bg-gradient-to-r from-[#F25F4C] to-[#FF8906] bg-clip-text text-transparent">Basis of Intent.</span>
            </h1>
          </div>

          <p className="mt-6 max-w-2xl text-xl text-[#888888] leading-relaxed">
            Smart contracts verify code. Vorion verifies intent. <br />
            A decentralized proof layer that enforces the &quot;Basis Intent&quot; of every transaction before execution.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <a href="#architecture" className="px-8 py-4 bg-white text-black font-bold hover:bg-[#F25F4C] hover:text-white transition duration-200">
              Read the Specs
            </a>
            <a href="https://github.com/vorionsys/vorion" target="_blank" rel="noopener noreferrer" className="px-8 py-4 border border-[#333333] text-white font-mono hover:border-[#F25F4C] transition duration-200 flex items-center gap-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              vorionsys/vorion
            </a>
          </div>
        </div>
      </section>

      {/* Technical Problem/Solution */}
      <section id="core" className="py-20 border-t border-[#333333] bg-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16">
            {/* Left: The Problem */}
            <div>
              <h2 className="text-3xl font-bold text-white mb-8">The Execution Gap</h2>
              <div className="space-y-8">
                <div className="flex gap-4">
                  <svg className="w-5 h-5 text-[#888888] mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <h3 className="text-lg font-bold text-white">Blind Execution</h3>
                    <p className="text-[#888888] mt-1 text-sm">EVMs execute opcode, not intent. If a user signs a malicious seaport signature, the chain validates the signature, not the outcome.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <svg className="w-5 h-5 text-[#888888] mt-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <h3 className="text-lg font-bold text-white">Missing Proof Layer</h3>
                    <p className="text-[#888888] mt-1 text-sm">There is no infrastructure layer that mathematically proves &quot;This transaction fulfills the user&apos;s Basis Intent&quot; prior to finality.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Vorion Solution */}
            <div className="bg-black border border-[#333333] p-8 relative">
              <div className="absolute top-0 right-0 p-2 bg-[#F25F4C] text-black font-bold text-xs font-mono">
                MODULE: AXIOM
              </div>
              <h2 className="text-2xl font-bold text-white mb-6">The Vorion Axiom</h2>
              <p className="text-[#888888] mb-6">
                A pre-execution enforcement layer. We introduce <strong className="text-white">Basis Proofs</strong>—cryptographic constraints that accompany a transaction.
              </p>

              <div className="font-mono text-sm bg-[#1E1E1E] p-4 border border-[#333333] text-gray-400 overflow-x-auto">
                <span className="text-[#F25F4C]">struct</span> <span className="text-white">BasisIntent</span> {'{'}
                <br />
                &nbsp;&nbsp;bytes32 intentHash;
                <br />
                &nbsp;&nbsp;uint256 maxSlippage;
                <br />
                &nbsp;&nbsp;address[] requiredInteractions;
                <br />
                &nbsp;&nbsp;<span className="text-[#F25F4C]">function</span> <span className="text-white">enforce()</span> external view;
                <br />
                {'}'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Go To Market Strategy */}
      <section id="gtm" className="py-20 bg-[#050505] border-t border-[#333333]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12">
            <h2 className="text-3xl font-bold text-white">GTM: The &quot;Safety Rail&quot; Strategy</h2>
            <p className="text-[#888888] mt-2">We are not selling a token. We are selling the integrity of the transaction stack.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Target 1 */}
            <div className="bg-[#0A0A0A]/80 backdrop-blur border border-[#333333] p-6 transition-all hover:border-[#F25F4C] hover:shadow-[0_0_20px_rgba(242,95,76,0.1)]">
              <div className="text-[#F25F4C] mb-4 text-4xl">
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">1. Wallet Integrations</h3>
              <p className="text-sm text-[#888888] mb-4">Integrate the Vorion SDK directly into wallets (Rabbit, MetaMask Snap) to warn users when transaction execution deviates from intent.</p>
              <span className="text-xs font-mono border border-[#333333] px-2 py-1 text-gray-400">STATUS: OUTREACH</span>
            </div>

            {/* Target 2 */}
            <div className="bg-[#0A0A0A]/80 backdrop-blur border border-[#333333] p-6 transition-all hover:border-[#F25F4C] hover:shadow-[0_0_20px_rgba(242,95,76,0.1)]">
              <div className="text-[#F25F4C] mb-4 text-4xl">
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM14 11a1 1 0 011 1v1h1a1 1 0 110 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 110-2h1v-1a1 1 0 011-1z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">2. Intent Solvers</h3>
              <p className="text-sm text-[#888888] mb-4">Partner with CowSwap, UniswapX, and Across. Vorion provides the &quot;Proof Layer&quot; for their solvers to prove they acted honestly.</p>
              <span className="text-xs font-mono border border-[#333333] px-2 py-1 text-gray-400">STATUS: RESEARCH</span>
            </div>

            {/* Target 3 */}
            <div className="bg-[#0A0A0A]/80 backdrop-blur border border-[#333333] p-6 transition-all hover:border-[#F25F4C] hover:shadow-[0_0_20px_rgba(242,95,76,0.1)]">
              <div className="text-[#F25F4C] mb-4 text-4xl">
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 11-2 0 1 1 0 012 0zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 11-2 0 1 1 0 012 0z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">3. Institutional Custody</h3>
              <p className="text-sm text-[#888888] mb-4">Offer &quot;Enforced Policies&quot; for Fireblocks/Coinbase clients. Math-based rules that cannot be overridden by human error.</p>
              <span className="text-xs font-mono border border-[#333333] px-2 py-1 text-gray-400">STATUS: PLANNED</span>
            </div>
          </div>
        </div>
      </section>

      {/* LIVE TASK MANAGER (TERMINAL STYLE) */}
      <section id="tasks" className="py-20 bg-black border-t border-[#333333]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white font-mono">{'>'}_ Vorion.Log</h2>
              <p className="text-[#888888] text-sm">Live Engineering & Strategy Tasks</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs font-mono text-green-500">SYSTEM ONLINE</span>
            </div>
          </div>

          {/* Input Console */}
          <div className="mb-8 bg-[#1E1E1E] border border-[#333333] p-2 rounded flex gap-2">
            <span className="text-[#F25F4C] font-mono py-2 pl-2">$</span>
            <input
              type="text"
              value={newTaskInput}
              onChange={(e) => setNewTaskInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              placeholder="add_task --priority=high"
              className="flex-1 bg-transparent border-none text-white font-mono focus:ring-0 focus:outline-none placeholder-gray-600"
            />
            <button
              onClick={handleAddTask}
              className="bg-[#F25F4C] text-black font-bold font-mono px-4 text-sm hover:bg-white transition"
            >
              EXECUTE
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-8 font-mono text-sm">
            {/* Pending */}
            <div className="border border-[#333333] bg-[#050505]/50 p-4 min-h-[400px]">
              <h3 className="text-gray-400 border-b border-[#333333] pb-2 mb-4">[ PENDING THREADS ]</h3>
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-[#888888] italic">Fetching remote state...</div>
                ) : pendingTasks.length === 0 ? (
                  <div className="text-[#888888] italic">No pending tasks</div>
                ) : (
                  pendingTasks.map(task => (
                    <div key={task.id} className="flex justify-between items-start group p-2 hover:bg-[#1E1E1E] transition border border-transparent hover:border-[#333333]">
                      <div className="text-[#E5E5E5] break-all">
                        <span className="text-[#F25F4C] mr-2">::</span>{task.text}
                      </div>
                      <button
                        onClick={() => openCompletionModal(task.id)}
                        className="opacity-0 group-hover:opacity-100 text-xs bg-[#333333] px-2 py-1 text-white hover:bg-[#F25F4C] hover:text-black transition flex-shrink-0 ml-2"
                      >
                        RESOLVE
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Completed */}
            <div className="border border-[#333333] bg-[#050505]/50 p-4 min-h-[400px]">
              <h3 className="text-gray-400 border-b border-[#333333] pb-2 mb-4">[ VERIFIED COMPLETIONS ]</h3>
              <div className="space-y-2">
                {completedTasks.length === 0 ? (
                  <div className="text-[#888888] italic">No completed tasks</div>
                ) : (
                  completedTasks.map(task => (
                    <div key={task.id} className="p-2 opacity-60 hover:opacity-100 transition">
                      <div className="text-gray-500 line-through text-xs mb-1">{task.text}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-500 text-[10px]">[VERIFIED]</span>
                        <a
                          href={formatUrl(task.solutionLink || '')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#F25F4C] text-xs hover:underline truncate max-w-[200px]"
                        >
                          {task.solutionLink}
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modal for Proof Submission */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0A0A0A] w-full max-w-lg p-8 border border-[#F25F4C] shadow-2xl">
            <h3 className="text-xl font-bold text-white font-mono mb-4">{'>>'} SUBMIT PROOF</h3>

            <div className="mb-6">
              <label className="block text-[#888888] text-xs font-bold mb-2 font-mono">PROOF_OF_WORK (URL/HASH)</label>
              <input
                type="text"
                value={solutionLink}
                onChange={(e) => setSolutionLink(e.target.value)}
                placeholder="github.com/vorionsys/..."
                className="w-full bg-black border border-[#333333] text-white p-3 font-mono focus:border-[#F25F4C] focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-4">
              <button onClick={closeModal} className="text-[#888888] hover:text-white font-mono text-sm">[ ABORT ]</button>
              <button onClick={submitCompletion} className="bg-[#F25F4C] text-black font-bold font-mono px-6 py-2 hover:bg-white transition">
                [ COMMIT ]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-[#333333] py-10 text-center">
        <p className="text-[#888888] font-mono text-xs">VORION PROTOCOL // ENFORCING BASIS INTENT</p>
        <div className="mt-4 flex justify-center gap-6 text-xs">
          <Link href="/" className="text-[#888888] hover:text-[#F25F4C] transition">Kaizen Home</Link>
          <a href="https://vorion.org" className="text-[#888888] hover:text-[#F25F4C] transition">Vorion</a>
          <a href="https://cognigate.dev" className="text-[#888888] hover:text-[#F25F4C] transition">Cognigate</a>
          <a href="https://github.com/vorionsys/vorion" className="text-[#888888] hover:text-[#F25F4C] transition">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
