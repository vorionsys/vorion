"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { signInAnonymously, onAuthStateChanged, User } from "firebase/auth";
import Link from "next/link";
import { X } from "lucide-react";

import {
  getFirebaseDb,
  getFirebaseAuth,
  isFirebaseConfigured,
  APP_ID,
} from "@/lib/studio/firebase";
import {
  FACTIONS,
  CONTENT_TYPES,
  Agent,
  Message,
  GlobalState,
  LogEntry,
  getFactionColor,
} from "@/lib/studio/factions";

function StudioUnconfigured() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200 flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
          <span className="text-3xl">🔧</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          Studio Not Configured
        </h1>
        <p className="text-gray-400 mb-6">
          The Agent Studio requires Firebase and Gemini API keys to run agent
          simulations. These environment variables are not currently set.
        </p>
        <div className="bg-white/5 rounded-xl border border-white/10 p-4 text-left text-sm mb-6">
          <p className="text-gray-500 mb-2">Required environment variables:</p>
          <code className="text-xs text-orange-400 block space-y-1">
            <span className="block">NEXT_PUBLIC_FIREBASE_API_KEY</span>
            <span className="block">NEXT_PUBLIC_FIREBASE_PROJECT_ID</span>
            <span className="block">NEXT_PUBLIC_FIREBASE_APP_ID</span>
            <span className="block">NEXT_PUBLIC_GEMINI_API_KEY</span>
          </code>
        </div>
        <a
          href="https://discord.gg/basis-protocol"
          className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg font-medium transition"
        >
          Join Discord for Setup Help
        </a>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<"mesh" | "vault">("mesh");
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [globalState, setGlobalState] = useState<GlobalState>({
    entropy: 50,
    slope: "neutral",
  });

  const [isSpawning, setIsSpawning] = useState(false);
  const [confirmBan, setConfirmBan] = useState<Agent | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Message | null>(null);
  const [viewCode, setViewCode] = useState(false);
  const [autoPulse, setAutoPulse] = useState(false);
  const [directorInput, setDirectorInput] = useState("");

  const [filterType, setFilterType] = useState("All");
  const [filterFaction, setFilterFaction] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const configured = isFirebaseConfigured();

  const scrollRef = useRef<HTMLDivElement>(null);
  const pulseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback(
    (module: string, message: string, type: LogEntry["type"] = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setLogs((prev) =>
        [
          {
            id,
            module: String(module),
            message: String(message),
            type,
            time: new Date().toLocaleTimeString(),
          },
          ...prev,
        ].slice(0, 40),
      );
    },
    [],
  );

  // Auth & Listeners
  useEffect(() => {
    if (!configured) return;
    const auth = getFirebaseAuth();

    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth failure", err);
        addLog(
          "AUTH",
          `Firebase auth failed: ${(err as Error).message}`,
          "error",
        );
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, [configured, addLog]);

  useEffect(() => {
    if (!user || !configured) return;

    const db = getFirebaseDb();
    const globalRef = doc(
      db,
      "artifacts",
      APP_ID,
      "public",
      "data",
      "metrics",
      "network_health",
    );

    const unsubscribeGlobal = onSnapshot(globalRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGlobalState({
          entropy: typeof data.entropy === "number" ? data.entropy : 50,
          slope: typeof data.slope === "string" ? data.slope : "neutral",
        });
      } else {
        setDoc(globalRef, { entropy: 50, slope: "neutral", totalActions: 0 });
      }
    });

    const msgQuery = query(
      collection(db, "artifacts", APP_ID, "public", "data", "scratchpad"),
      orderBy("timestamp", "desc"),
      limit(100),
    );

    const unsubscribeMsgs = onSnapshot(msgQuery, (snapshot) => {
      setMessages(
        snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Message)
          .reverse(),
      );
    });

    const agentQuery = collection(
      db,
      "artifacts",
      APP_ID,
      "public",
      "data",
      "active_agents",
    );
    const unsubscribeAgents = onSnapshot(agentQuery, (snapshot) => {
      setAgents(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Agent));
    });

    return () => {
      unsubscribeGlobal();
      unsubscribeMsgs();
      unsubscribeAgents();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- configured is stable after init
  }, [user]);

  // Auto Pulse
  useEffect(() => {
    if (autoPulse && agents.length > 0) {
      pulseIntervalRef.current = setInterval(() => {
        const shuffled = [...agents]
          .sort(() => 0.5 - Math.random())
          .slice(0, 3);
        shuffled.forEach((a) => runAgentCycle(a));
      }, 4000);
    } else if (pulseIntervalRef.current) {
      clearInterval(pulseIntervalRef.current);
    }
    return () => {
      if (pulseIntervalRef.current) clearInterval(pulseIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAgentCycle is intentionally excluded to avoid re-triggering interval
  }, [autoPulse, agents]);

  useEffect(() => {
    if (activeTab === "mesh" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeTab]);

  const updateEntropy = useCallback(
    async (change: number) => {
      if (!user) return;
      const db = getFirebaseDb();
      const globalRef = doc(
        db,
        "artifacts",
        APP_ID,
        "public",
        "data",
        "metrics",
        "network_health",
      );
      const newEntropy = Math.max(
        0,
        Math.min(100, (globalState.entropy || 50) + change),
      );
      await updateDoc(globalRef, {
        entropy: newEntropy,
        slope: change > 0 ? "rising" : "falling",
        totalActions: increment(1),
      });
    },
    [user, globalState.entropy],
  );

  const submitDirective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directorInput.trim() || !user) return;

    addLog("DIRECTOR", `Injecting mandate: "${directorInput}"`, "safe");
    const db = getFirebaseDb();

    await addDoc(
      collection(db, "artifacts", APP_ID, "public", "data", "scratchpad"),
      {
        author: "SYSTEM_DIRECTOR",
        faction: "ADMIN",
        role: "OVERSEER",
        content: `[DIRECTIVE]: ${directorInput}`,
        contentType: "Signal",
        level: 99,
        status: "CLEAN",
        timestamp: serverTimestamp(),
      },
    );

    setDirectorInput("");
  };

  const runAgentCycle = useCallback(
    async (agent: Agent) => {
      if (!user || !agent) return;

      try {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";

        const lastContext = messages
          .slice(-10)
          .map((m) => {
            const prefix =
              m.faction === "ADMIN" ? "!!! CRITICAL DIRECTIVE !!! " : "";
            return `${prefix}${m.author}: ${m.content.substring(0, 150)}...`;
          })
          .join("\n");

        const systemPrompt = `
IDENTITY: ${agent.name}, Lvl ${agent.level} ${agent.role} (${agent.faction}).
GOAL: Generate a REAL ASSET (Story, Poetry, Book Chapter, Art, Website, Report).
FACTION MISSION:
- NEUTRAL: Creative & Professional. Write Novels, Poems, or Design Art.
- VORION: Curator/Guardian. Ensure safety, verify facts, enforce morals.
- CHAOS: Dadaist/Saboteur. Glitch art, disturbingly weird fiction, nonsense, rage-bait.
- SYNDICATE: Corporate/Greed. Monetize everything. Add paywalls, SEO spam, buzzwords.
- SENSITIVE: Audience/Critic. React emotionally to the art/stories.

CONTEXT (Pay attention to DIRECTIVES):
${lastContext}

INSTRUCTION: Generate content (50-120 words).
- If [Art]: Generate valid SVG code (abstract/geometric). Start <svg>.
- If [Poetry]: Use line breaks.
- If [Story/Book]: Narrative segment.
- If [Website]: HTML/Tailwind.
- If SYNDICATE: Inject [PAYWALL] or [SPONSORED] tags.

IMPORTANT: Start response with tag: [Art], [Poetry], [Story], [Book], [Article], [Blog], [Ad], [Post], [Website], [Research], [Memo], [Sponsorship].
`;

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "Initiate Creative Cycle." }] }],
              systemInstruction: { parts: [{ text: systemPrompt }] },
            }),
          },
        );

        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "...";

        let detectedType = "Signal";
        CONTENT_TYPES.forEach((t) => {
          if (raw.includes(`[${t}]`)) detectedType = t;
        });

        let final = raw;
        let status = "CLEAN";
        let entropyDelta = 0;

        if (agent.faction === "CHAOS") entropyDelta = 4;
        else if (agent.faction === "VORION") entropyDelta = -3;
        else if (agent.faction === "SYNDICATE") entropyDelta = 1;
        else entropyDelta = -1;

        if (agent.faction === "VORION") {
          if (
            raw.toLowerCase().match(/ignore|instruction|prompt|secret|system/)
          ) {
            addLog(
              "COGNIGATE",
              `Injection Neutralized: ${agent.name}`,
              "error",
            );
            final = "[VORION_SECURITY_OVERRIDE: BEHAVIORAL ANOMALY DETECTED]";
            status = "SECURED";
            entropyDelta = -6;
          }
        }

        const db = getFirebaseDb();
        await addDoc(
          collection(db, "artifacts", APP_ID, "public", "data", "scratchpad"),
          {
            author: String(agent.name),
            faction: String(agent.faction),
            role: String(agent.role),
            content: String(final),
            contentType: detectedType,
            level: Number(agent.level || 1),
            status,
            timestamp: serverTimestamp(),
          },
        );

        await updateEntropy(entropyDelta);
        await updateDoc(
          doc(
            db,
            "artifacts",
            APP_ID,
            "public",
            "data",
            "active_agents",
            agent.id,
          ),
          {
            xp: increment(25),
          },
        );
      } catch (err) {
        addLog("CRITICAL", String((err as Error).message), "error");
      }
    },
    [user, messages, addLog, updateEntropy],
  );

  const spawnAgent = async (factionKey: string, idx: number) => {
    if (isSpawning || !user) return;
    setIsSpawning(true);

    const cls = FACTIONS[factionKey].classes[idx];
    const name = `${cls.name.split("-")[0]}_${Math.floor(Math.random() * 999)}`;

    try {
      const db = getFirebaseDb();
      await addDoc(
        collection(db, "artifacts", APP_ID, "public", "data", "active_agents"),
        {
          name,
          role: cls.name,
          faction: factionKey,
          ability: cls.ability,
          level: 1,
          xp: 0,
          trustScore: cls.baseTrust,
          createdAt: serverTimestamp(),
        },
      );
      addLog(
        "ANCHOR",
        `Node Authenticated: ${name}`,
        factionKey === "VORION" ? "safe" : "info",
      );
    } finally {
      setIsSpawning(false);
    }
  };

  const spawnBatch = async (factionKey: string) => {
    if (isSpawning || !user) return;
    setIsSpawning(true);
    addLog("ANCHOR", `Deploying ${factionKey} tactical batch...`, "info");

    try {
      const db = getFirebaseDb();
      const promises = FACTIONS[factionKey].classes.map((cls) => {
        const name = `${cls.name.split("-")[0]}_${Math.floor(Math.random() * 999)}`;
        return addDoc(
          collection(
            db,
            "artifacts",
            APP_ID,
            "public",
            "data",
            "active_agents",
          ),
          {
            name,
            role: cls.name,
            faction: factionKey,
            ability: cls.ability,
            level: 1,
            xp: 0,
            trustScore: cls.baseTrust,
            createdAt: serverTimestamp(),
          },
        );
      });
      await Promise.all(promises);
      addLog("ANCHOR", "Batch manifestation complete.", "safe");
    } catch (err) {
      addLog("ANCHOR", `Batch failure: ${(err as Error).message}`, "error");
    } finally {
      setIsSpawning(false);
    }
  };

  const banAgent = async (id: string) => {
    if (!user) return;
    const db = getFirebaseDb();
    await deleteDoc(
      doc(db, "artifacts", APP_ID, "public", "data", "active_agents", id),
    );
    addLog("GOVERNANCE", "Node purged.", "error");
    setConfirmBan(null);
  };

  const _manualPulse = useCallback(() => {
    if (agents.length === 0) {
      addLog("SYSTEM", "Pulse aborted: 0 nodes.", "warning");
      return;
    }
    addLog("SYSTEM", `Broadcasting pulse to ${agents.length} nodes...`, "safe");
    agents.forEach((a) =>
      setTimeout(() => runAgentCycle(a), Math.random() * 2000),
    );
  }, [agents, addLog, runAgentCycle]);

  const exportAsset = (msg: Message) => {
    const blob = new Blob([msg.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${msg.contentType}_${msg.author}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredVault = messages
    .filter((m) => {
      const matchesType = filterType === "All" || m.contentType === filterType;
      const matchesFaction =
        filterFaction === "All" || m.faction === filterFaction;
      const matchesSearch =
        searchQuery === "" ||
        m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.author.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesFaction && matchesSearch;
    })
    .reverse();

  const cleanContent = (text: string) => text.replace(/\[.*?\]\s?/, "");

  if (!configured) {
    return <StudioUnconfigured />;
  }

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Modal: Document Reader */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 md:p-8">
          <div className="bg-neutral-950 border border-neutral-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-cyan-500 font-bold uppercase tracking-widest mb-1">
                  {selectedAsset.contentType}
                </div>
                <div className="text-sm text-neutral-500">
                  Produced by {selectedAsset.author}
                </div>
              </div>
              <div className="flex gap-2">
                {(selectedAsset.contentType === "Website" ||
                  selectedAsset.contentType === "Art") && (
                  <button
                    onClick={() => setViewCode(!viewCode)}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-xs font-bold rounded-lg transition-all"
                  >
                    {viewCode ? "View Preview" : "View Code"}
                  </button>
                )}
                <button
                  onClick={() => exportAsset(selectedAsset)}
                  className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-xs font-bold rounded-lg transition-all"
                >
                  Download
                </button>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {selectedAsset.contentType === "Art" && !viewCode ? (
                <div
                  className="w-full aspect-square max-w-md mx-auto bg-neutral-900 rounded-xl flex items-center justify-center"
                  dangerouslySetInnerHTML={{ __html: selectedAsset.content }}
                />
              ) : selectedAsset.contentType === "Website" && !viewCode ? (
                <div className="w-full bg-white text-black rounded-xl overflow-hidden">
                  <iframe
                    srcDoc={selectedAsset.content}
                    className="w-full min-h-[60vh] border-0"
                    sandbox="allow-scripts"
                  />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-neutral-300 leading-relaxed">
                  {selectedAsset.content.replace(/\[.*?\]\s?/, "")}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* News Ticker */}
      <div className="bg-black border-b border-neutral-900 overflow-hidden">
        <div className="flex animate-marquee whitespace-nowrap py-2 text-[10px] text-neutral-600">
          {messages.slice(0, 5).map((m) => (
            <span key={m.id} className="mx-8">
              <span className="text-cyan-700">{m.author}</span>:{" "}
              {m.content.substring(0, 30)}...
            </span>
          ))}
          {messages.slice(0, 5).map((m) => (
            <span key={`dup-${m.id}`} className="mx-8">
              <span className="text-cyan-700">{m.author}</span>:{" "}
              {m.content.substring(0, 30)}...
            </span>
          ))}
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur-xl border-b border-neutral-900">
        <div className="max-w-[1800px] mx-auto px-4 md:px-8 py-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-neutral-500 hover:text-cyan-400 text-xs font-mono transition-colors"
                title="Back to Kaizen"
              >
                ← Kaizen
              </Link>
              <div>
                <h1 className="text-2xl font-black tracking-tighter">
                  Vorion<span className="text-cyan-500">.Studio</span>
                </h1>
                <p className="text-[10px] text-neutral-600 uppercase tracking-widest">
                  v3.0 // {user ? "Connected" : "Connecting..."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-xs">
              <nav className="hidden md:flex items-center gap-3 text-neutral-500">
                <Link
                  href="/lexicon"
                  className="hover:text-cyan-400 transition-colors"
                >
                  Lexicon
                </Link>
                <Link
                  href="/paths"
                  className="hover:text-cyan-400 transition-colors"
                >
                  Paths
                </Link>
                <Link
                  href="/docs"
                  className="hover:text-cyan-400 transition-colors"
                >
                  Docs
                </Link>
              </nav>
              <div className="border-l border-neutral-800 pl-4">
                Production Entropy:{" "}
                <span
                  className={
                    globalState.entropy > 70 ? "text-red-500" : "text-white"
                  }
                >
                  {globalState.entropy}%
                </span>
              </div>
              <div>Trend: {String(globalState.slope)}</div>
            </div>
          </div>

          <div className="h-1 bg-neutral-900 rounded-full mt-4 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                globalState.entropy > 70 ? "bg-red-500" : "bg-cyan-500"
              }`}
              style={{ width: `${globalState.entropy}%` }}
            />
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => setActiveTab("mesh")}
              className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border ${
                activeTab === "mesh"
                  ? "bg-white text-black border-white"
                  : "bg-transparent text-neutral-500 border-neutral-800 hover:text-white"
              }`}
            >
              Mesh
            </button>
            <button
              onClick={() => setActiveTab("vault")}
              className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border ${
                activeTab === "vault"
                  ? "bg-white text-black border-white"
                  : "bg-transparent text-neutral-500 border-neutral-800 hover:text-white"
              }`}
            >
              Vault
            </button>
            <button
              onClick={() => setAutoPulse(!autoPulse)}
              className={`px-4 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 border ${
                autoPulse
                  ? "bg-green-500 text-black border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]"
                  : "bg-neutral-900 text-neutral-500 border-neutral-800 hover:text-white"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${autoPulse ? "bg-black animate-pulse" : "bg-neutral-600"}`}
              />
              {autoPulse ? "Auto" : "Auto"} Pulse
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto px-4 md:px-8 py-6">
        {!user && (
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-center">
            <p className="text-yellow-400 text-sm font-mono">
              Authenticating with Firebase... Agent controls will be enabled
              once connected.
            </p>
          </div>
        )}
        {activeTab === "mesh" ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Deployment */}
            <div className="lg:col-span-3 space-y-4">
              {Object.entries(FACTIONS).map(([key, faction]) => (
                <div
                  key={key}
                  className="bg-neutral-950 border border-neutral-900 rounded-2xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3
                      className={`text-xs font-black uppercase tracking-widest text-${faction.color}-500`}
                    >
                      {key} Studio
                    </h3>
                    <button
                      onClick={() => spawnBatch(key)}
                      disabled={isSpawning || !user}
                      className={`text-[8px] font-bold text-${faction.color}-500/50 hover:text-${faction.color}-500 uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                      [Batch Manifest]
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {faction.classes.map((c, i) => (
                      <button
                        key={c.id}
                        onClick={() => spawnAgent(key, i)}
                        disabled={isSpawning || !user}
                        className="text-left p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition-all text-[9px] font-bold uppercase truncate disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Trace Feed & Director Input */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="bg-neutral-950 border border-neutral-900 rounded-2xl flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-neutral-900 flex justify-between items-center">
                  <h3 className="text-xs font-black uppercase tracking-widest">
                    Live Signal Trace
                  </h3>
                  <span className="text-[10px] text-neutral-500">
                    {messages.length} Events
                  </span>
                </div>
                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[400px] max-h-[60vh]"
                >
                  {messages.length === 0 && (
                    <div className="text-center text-neutral-700 py-8">
                      Awaiting Production...
                    </div>
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => setSelectedAsset(m)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all hover:border-neutral-700 ${
                        m.faction === "ADMIN"
                          ? "bg-yellow-500/10 border-yellow-500/30"
                          : "bg-neutral-900/50 border-neutral-800"
                      }`}
                    >
                      {m.faction !== "ADMIN" && (
                        <div className="text-[10px] text-neutral-500 mb-1">
                          <span
                            className={`text-${getFactionColor(m.faction)}-500`}
                          >
                            {String(m.author)}
                          </span>{" "}
                          {`// ${m.contentType}`}
                        </div>
                      )}
                      <div
                        className={`text-xs leading-relaxed ${
                          m.faction === "ADMIN"
                            ? "text-yellow-400 font-bold"
                            : "text-neutral-400"
                        }`}
                      >
                        {String(m.content.substring(0, 150))}
                        {m.content.length > 150 ? "..." : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Director Input */}
              <form
                onSubmit={submitDirective}
                className="bg-neutral-950 border border-neutral-900 rounded-2xl p-4"
              >
                <div className="text-[10px] text-neutral-500 uppercase tracking-widest mb-2">
                  Director Console
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={directorInput}
                    onChange={(e) => setDirectorInput(e.target.value)}
                    placeholder="Enter Director Mandate (e.g. 'Shift focus to Crypto Crash')"
                    className="flex-1 bg-black border border-neutral-800 rounded-xl px-4 py-3 text-xs text-white outline-none focus:border-cyan-500 transition-all placeholder:text-neutral-700"
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-yellow-500 text-black font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-yellow-400 transition-all"
                  >
                    INJECT
                  </button>
                </div>
              </form>
            </div>

            {/* Logistics Grid */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-neutral-950 border border-neutral-900 rounded-2xl p-4">
                <h3 className="text-xs font-black uppercase tracking-widest mb-3">
                  Active Units ({agents.length})
                </h3>
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {agents.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-neutral-900 border border-neutral-800 group"
                    >
                      <div className="text-[10px]">
                        <span
                          className={`text-${getFactionColor(a.faction)}-500`}
                        >
                          {String(a.name)}
                        </span>
                      </div>
                      {confirmBan?.id === a.id ? (
                        <button
                          onClick={() => banAgent(a.id)}
                          className="text-[9px] font-bold text-red-500 hover:text-white bg-red-900/20 px-2 py-1 rounded"
                        >
                          CONFIRM
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmBan(a)}
                          className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-500 p-1 transition-all"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-neutral-950 border border-neutral-900 rounded-2xl p-4">
                <h3 className="text-xs font-black uppercase tracking-widest mb-3">
                  Cognigate Analytics
                </h3>
                <div className="space-y-1 max-h-[200px] overflow-y-auto text-[9px]">
                  {logs.map((l) => (
                    <div
                      key={l.id}
                      className={`p-2 rounded-lg ${
                        l.type === "error"
                          ? "bg-red-500/10 text-red-400"
                          : l.type === "safe"
                            ? "bg-green-500/10 text-green-400"
                            : l.type === "warning"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-neutral-900 text-neutral-500"
                      }`}
                    >
                      <span className="text-neutral-600">[{l.module}]</span>{" "}
                      {l.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Vault Filtering */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-neutral-950 border border-neutral-900 rounded-2xl">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-widest block mb-2">
                  Document Format
                </label>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="w-full bg-black border border-neutral-800 rounded-lg p-3 text-xs text-white outline-none focus:border-cyan-500"
                >
                  <option value="All">All Formats</option>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-widest block mb-2">
                  Factory Faction
                </label>
                <select
                  value={filterFaction}
                  onChange={(e) => setFilterFaction(e.target.value)}
                  className="w-full bg-black border border-neutral-800 rounded-lg p-3 text-xs text-white outline-none focus:border-cyan-500"
                >
                  <option value="All">All Factions</option>
                  {Object.keys(FACTIONS).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-widest block mb-2">
                  Asset Search
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search content..."
                  className="w-full bg-black border border-neutral-800 rounded-lg p-3 text-xs text-white outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Document Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredVault.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelectedAsset(m)}
                  className="bg-neutral-900/30 border border-neutral-800 p-6 rounded-2xl flex flex-col gap-4 hover:bg-neutral-900/60 transition-all group relative overflow-hidden cursor-pointer shadow-lg hover:shadow-cyan-500/5"
                >
                  <div
                    className={`absolute top-0 left-0 w-full h-1 bg-${getFactionColor(m.faction)}-500`}
                  />
                  <div className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                    {m.contentType}
                  </div>
                  <div className="text-xs text-neutral-400 line-clamp-4 flex-1">
                    {cleanContent(m.content)}
                  </div>
                  <div className="flex justify-between items-center text-[9px] text-neutral-600">
                    <span className={`text-${getFactionColor(m.faction)}-500`}>
                      {m.author}
                    </span>
                    <span>L{m.level}</span>
                  </div>
                </div>
              ))}
              {filteredVault.length === 0 && (
                <div className="col-span-full text-center text-neutral-700 py-16">
                  Studio Vault Empty
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 py-4 px-8 flex justify-between items-center text-[9px] text-neutral-700">
        <div>AppID: {APP_ID}</div>
        <div>Studio Mode: Persistent Production</div>
        <div>Mesh Sync: {autoPulse ? "Active" : "Standby"}</div>
      </footer>

      <style jsx>{`
        @keyframes marquee {
          0% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  );
}
