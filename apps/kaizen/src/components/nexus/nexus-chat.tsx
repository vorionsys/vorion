'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X, Layers, Brain, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage } from './chat-message';
import { ProcessingIndicator } from './processing-indicator';
import { searchLexicon } from '@/lib/lexicon-data';
import { generateId, sanitizeHtml } from '@/lib/utils';
import { getIntentRoute } from '@/lib/intent-routing';
import type { AudienceType } from '@/lib/intent-routing';
import type { ChatMessage as ChatMessageType, AIModel, ProcessingStatus } from '@/types';

interface NexusChatProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function NexusChat({ isOpen, onToggle }: NexusChatProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([
    {
      id: 'system-1',
      role: 'system',
      content: 'Triad Core Online. I prioritize local knowledge. If data is missing, I will synthesize answers from Gemini, Claude, and Grok perspectives.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState<ProcessingStatus | null>(null);
  const [intentContext, setIntentContext] = useState<string | null>(null);
  const [directRoute, setDirectRoute] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Intent routing: check URL params on mount and pre-seed the chat
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const audience = params.get('audience');
    const intent = params.get('intent');

    if (audience && intent) {
      const route = getIntentRoute(audience, intent);

      // Store system context for the next API call
      setIntentContext(route.systemContext);

      // Store direct route if one exists
      if (route.directRoute) {
        setDirectRoute(route.directRoute);
      }

      // Auto-open the chat panel
      if (!isOpen) {
        onToggle();
      }

      // Add the greeting as the first assistant message
      const greetingMessage: ChatMessageType = {
        id: generateId(),
        role: 'assistant',
        content: route.greeting,
        timestamp: new Date(),
        source: 'local',
      };
      setMessages(prev => [...prev, greetingMessage]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query) return;

    // Add user message
    const userMessage: ChatMessageType = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Check local knowledge first
    setProcessing({
      stage: 'local',
      message: 'Scanning Local Memory...',
      activeNodes: [],
    });

    const localMatch = searchLexicon(query);

    if (localMatch) {
      // Found in local knowledge
      await new Promise(r => setTimeout(r, 500)); // Brief delay for UX
      setProcessing(null);

      const response: ChatMessageType = {
        id: generateId(),
        role: 'assistant',
        content: `
          <div class="font-bold text-white text-lg mb-2">${localMatch.term}</div>
          <p class="text-gray-300">${localMatch.definition}</p>
          <div class="mt-3 flex items-center gap-2">
            <span class="text-xs uppercase text-gray-500">Level:</span>
            <span class="text-xs px-2 py-0.5 rounded badge-${localMatch.level}">${localMatch.level}</span>
          </div>
        `,
        timestamp: new Date(),
        source: 'local',
      };
      setMessages(prev => [...prev, response]);
      return;
    }

    // Not found locally - synthesize from AI models
    setProcessing({
      stage: 'external',
      message: 'Locating External Data...',
      activeNodes: [],
    });
    await new Promise(r => setTimeout(r, 600));

    setProcessing({
      stage: 'synthesis',
      message: 'Engaging Triad Synthesis...',
      activeNodes: ['gemini', 'claude', 'grok'],
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          ...(intentContext ? { systemContext: intentContext } : {}),
        }),
      });

      if (!res.ok) throw new Error('Synthesis failed');

      const data = await res.json();

      const response: ChatMessageType = {
        id: generateId(),
        role: 'assistant',
        content: sanitizeHtml(data.synthesis),
        timestamp: new Date(),
        source: 'synthesis',
        perspectives: data.perspectives,
      };
      setMessages(prev => [...prev, response]);
    } catch (error) {
      const errorMessage: ChatMessageType = {
        id: generateId(),
        role: 'assistant',
        content: '<p class="text-red-400">Error in synthesis matrix. Please retry.</p>',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="fixed bottom-0 right-0 z-50 flex flex-col items-end p-4 pointer-events-none w-full md:w-auto">
      {/* Processing Indicator */}
      {processing && (
        <div className="mb-2 pointer-events-auto">
          <ProcessingIndicator
            visible={true}
            message={processing.message}
            activeNodes={processing.activeNodes}
          />
        </div>
      )}

      {/* Chat Toggle Button (when closed) */}
      {!isOpen && (
        <Button
          onClick={onToggle}
          variant="neon"
          size="sm"
          className="pointer-events-auto rounded-full font-mono"
        >
          <Brain className="w-4 h-4 mr-2" />
          ACTIVATE
        </Button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full md:w-[450px] pointer-events-auto flex flex-col overflow-hidden h-[500px] transition-all animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="bg-gray-800 p-3 flex justify-between items-center border-b border-gray-700">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <span className="font-mono font-bold text-sm text-white">OMNI.AI</span>
            </div>
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-grow p-4 overflow-y-auto space-y-4 bg-gray-900/95">
            {messages.map(message => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Link (from intent routing) */}
          {directRoute && (
            <div className="px-4 py-2 bg-gray-800/60 border-t border-gray-700/50">
              <a
                href={directRoute}
                target={directRoute.startsWith('http') ? '_blank' : undefined}
                rel={directRoute.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Quick link: go directly to your resource</span>
              </a>
            </div>
          )}

          {/* Input */}
          <div className="p-3 bg-gray-800 border-t border-gray-700">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask Nexus..."
                disabled={!!processing}
                className="flex-grow"
              />
              <Button
                type="submit"
                disabled={!!processing || !input.trim()}
                size="md"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
