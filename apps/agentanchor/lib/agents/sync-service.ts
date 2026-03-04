/**
 * AgentSyncService - Unified Agent Synchronization Service
 *
 * Consolidates fragmented sync scripts into a single source of truth:
 * - scripts/sync-bai-agents.js (YAML directory sync)
 * - scripts/watch-agents.js (JSON seed file sync with watch)
 * - app/api/admin/sync-agents/route.ts (API-based sync)
 *
 * Key Features:
 * - Single source of truth for all sync logic
 * - Configurable (no hardcoded paths/emails)
 * - Proper TypeScript types with Zod validation
 * - Idempotent operations (hash-based change detection)
 * - Comprehensive error handling
 * - Structured logging with progress callbacks
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getDb, type Database } from '@/lib/db';
import { agents, profiles } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { createLogger, type Logger } from '@/lib/logger';

// =============================================================================
// Type Definitions
// =============================================================================

export interface SyncOptions {
  /** Preview changes without writing to database */
  dryRun?: boolean;
  /** Update existing agents (otherwise skip) */
  updateExisting?: boolean;
  /** Owner ID for imported agents */
  ownerId?: string;
  /** Owner email (alternative to ownerId) */
  ownerEmail?: string;
  /** Number of agents to process per batch */
  batchSize?: number;
  /** Progress callback for streaming updates */
  onProgress?: (progress: SyncProgress) => void;
}

export interface SyncProgress {
  phase: 'scanning' | 'validating' | 'syncing' | 'complete';
  current: number;
  total: number;
  currentAgent?: string;
  message?: string;
}

export interface SyncError {
  agentName: string;
  error: string;
  details?: Record<string, unknown>;
}

export interface SyncResult {
  success: boolean;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: SyncError[];
  duration: number;
  contentHash?: string;
}

export interface SyncStatus {
  lastSyncAt: Date | null;
  lastContentHash: string | null;
  pendingChanges: boolean;
  agentCount: number;
}

// =============================================================================
// Zod Schemas for Agent Validation
// =============================================================================

const AgentConfigSchema = z.object({
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  capabilities: z.array(z.string()).optional(),
  specialization: z.string().optional(),
  personalityTraits: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  autonomyLevel: z.enum(['low', 'medium', 'high']).optional(),
}).passthrough();

const AgentMetadataSchema = z.object({
  icon: z.string().optional(),
  layer: z.string().optional(),
  source: z.string().optional(),
  category: z.string().optional(),
  expertise: z.array(z.string()).optional(),
  principles: z.array(z.string()).optional(),
  level: z.string().optional(),
  levelName: z.string().optional(),
  authority: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  persona: z.record(z.unknown()).optional(),
  baiOs: z.record(z.unknown()).optional(),
  menu: z.array(z.record(z.unknown())).optional(),
  domain: z.string().optional(),
  targetTrustScore: z.number().optional(),
  baiPath: z.string().optional(),
  syncedAt: z.string().optional(),
  version: z.string().optional(),
}).passthrough();

const SeedAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  description: z.string().optional(),
  system_prompt: z.string().min(1, 'System prompt is required'),
  model: z.string().optional().default('claude-sonnet-4-20250514'),
  status: z.enum(['draft', 'training', 'examination', 'active', 'suspended', 'retired']).optional().default('active'),
  trust_score: z.number().min(0).max(1000).optional().default(400),
  config: AgentConfigSchema.optional().default({}),
  metadata: AgentMetadataSchema.optional().default({}),
});

export type SeedAgent = z.infer<typeof SeedAgentSchema>;

const SeedFileSchema = z.object({
  exported_at: z.string().optional(),
  total_agents: z.number().optional(),
  agents: z.array(SeedAgentSchema),
});

// YAML Agent Schema (BAI format)
const YamlAgentMetadataSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  level: z.string().optional().default('L1'),
  icon: z.string().optional().default('robot'),
  type: z.string().optional(),
});

const YamlAgentPersonaSchema = z.object({
  role: z.string().optional(),
  identity: z.string().optional(),
  communication_style: z.string().optional(),
  principles: z.array(z.string()).optional(),
});

const YamlAgentBaiOsSchema = z.object({
  version: z.string().optional().default('1.0'),
  proactive_mode: z.boolean().optional().default(false),
  collaboration: z.boolean().optional().default(false),
  behaviors: z.array(z.string()).optional(),
});

const YamlAgentSchema = z.object({
  agent: z.object({
    metadata: YamlAgentMetadataSchema,
    persona: YamlAgentPersonaSchema.optional(),
    bai_os: YamlAgentBaiOsSchema.optional(),
    menu: z.array(z.object({
      cmd: z.string(),
      label: z.string(),
      action: z.string(),
    })).optional(),
  }),
});

// =============================================================================
// Level Definitions (from BAI sync script)
// =============================================================================

const LEVEL_DEFS: Record<string, { name: string; authority: string; autonomy: string }> = {
  L0: { name: 'Listener', authority: 'Observe and Report ONLY', autonomy: 'None' },
  L1: { name: 'Executor', authority: 'Execute assigned tasks', autonomy: 'Task-level only' },
  L2: { name: 'Planner', authority: 'Plan task sequences', autonomy: 'Task planning' },
  L3: { name: 'Orchestrator', authority: 'Coordinate workflows', autonomy: 'Workflow-level' },
  L4: { name: 'Project Planner', authority: 'Plan projects', autonomy: 'Project planning' },
  L5: { name: 'Project Orchestrator', authority: 'Execute projects', autonomy: 'Project execution' },
  L6: { name: 'Portfolio Manager', authority: 'Multi-project oversight', autonomy: 'Portfolio-level' },
  L7: { name: 'Strategic', authority: 'Strategic decisions', autonomy: 'Strategic (with constraints)' },
  L8: { name: 'Executive', authority: 'Enterprise-wide', autonomy: 'Executive (human oversight required)' },
};

const TRUST_SCORES: Record<string, number> = {
  L0: 25, L1: 35, L2: 45, L3: 50, L4: 55, L5: 60, L6: 65, L7: 75, L8: 100,
};

// =============================================================================
// AgentSyncService Class
// =============================================================================

export class AgentSyncService {
  private db: Database;
  private logger: Logger;
  private lastContentHash: string | null = null;
  private lastSyncAt: Date | null = null;

  constructor(db?: Database) {
    this.db = db || getDb();
    this.logger = createLogger({ service: 'AgentSyncService' });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Sync agents from a JSON seed file
   */
  async syncFromSeedFile(filePath: string, options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      duration: 0,
    };

    try {
      this.emitProgress(options, { phase: 'scanning', current: 0, total: 0, message: 'Reading seed file...' });

      // Read and validate file
      if (!fs.existsSync(filePath)) {
        throw new Error(`Seed file not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const contentHash = this.computeHash(content);

      // Skip if no changes detected
      if (contentHash === this.lastContentHash && !options.updateExisting) {
        this.logger.info('No changes detected in seed file, skipping sync');
        result.success = true;
        result.contentHash = contentHash;
        result.duration = Date.now() - startTime;
        return result;
      }

      // Parse and validate JSON
      const data = JSON.parse(content);
      const validated = SeedFileSchema.safeParse(data);

      if (!validated.success) {
        throw new Error(`Invalid seed file format: ${validated.error.message}`);
      }

      const seedAgents = validated.data.agents;
      this.emitProgress(options, { phase: 'validating', current: 0, total: seedAgents.length, message: `Found ${seedAgents.length} agents` });

      // Resolve owner
      const ownerId = await this.resolveOwnerId(options);
      if (!ownerId) {
        throw new Error('No owner specified and could not resolve default owner');
      }

      // Sync agents
      await this.syncAgentBatch(seedAgents, ownerId, options, result);

      result.success = true;
      result.contentHash = contentHash;
      this.lastContentHash = contentHash;
      this.lastSyncAt = new Date();

    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'Seed file sync failed');
      result.errors.push({ agentName: '_sync', error: err.message });
    }

    result.duration = Date.now() - startTime;
    this.emitProgress(options, { phase: 'complete', current: result.imported + result.updated, total: result.imported + result.updated + result.skipped + result.failed, message: 'Sync complete' });

    return result;
  }

  /**
   * Sync agents from a YAML directory (BAI format)
   */
  async syncFromYamlDirectory(dirPath: string, options: SyncOptions = {}): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      duration: 0,
    };

    try {
      this.emitProgress(options, { phase: 'scanning', current: 0, total: 0, message: 'Scanning YAML directory...' });

      // Find all agent YAML files
      const yamlFiles = this.findAgentYamlFiles(dirPath);
      this.logger.info({ count: yamlFiles.length }, 'Found YAML agent files');

      if (yamlFiles.length === 0) {
        result.success = true;
        result.duration = Date.now() - startTime;
        return result;
      }

      // Parse YAML files into seed agents
      const seedAgents: SeedAgent[] = [];
      for (const filePath of yamlFiles) {
        try {
          const agent = this.parseYamlAgentFile(filePath);
          if (agent) {
            seedAgents.push(agent);
          }
        } catch (error) {
          const err = error as Error;
          result.errors.push({ agentName: path.basename(filePath), error: err.message });
          result.failed++;
        }
      }

      this.emitProgress(options, { phase: 'validating', current: 0, total: seedAgents.length, message: `Parsed ${seedAgents.length} agents` });

      // Resolve owner
      const ownerId = await this.resolveOwnerId(options);
      if (!ownerId) {
        throw new Error('No owner specified and could not resolve default owner');
      }

      // Sync agents
      await this.syncAgentBatch(seedAgents, ownerId, options, result);

      result.success = true;
      this.lastSyncAt = new Date();

    } catch (error) {
      const err = error as Error;
      this.logger.error({ error: err.message }, 'YAML directory sync failed');
      result.errors.push({ agentName: '_sync', error: err.message });
    }

    result.duration = Date.now() - startTime;
    this.emitProgress(options, { phase: 'complete', current: result.imported + result.updated, total: result.imported + result.updated + result.skipped + result.failed, message: 'Sync complete' });

    return result;
  }

  /**
   * Get current sync status
   */
  async getStatus(ownerId?: string): Promise<SyncStatus> {
    const query = ownerId
      ? this.db.select({ count: sql<number>`count(*)` }).from(agents).where(eq(agents.ownerId, ownerId))
      : this.db.select({ count: sql<number>`count(*)` }).from(agents);

    const [countResult] = await query;

    return {
      lastSyncAt: this.lastSyncAt,
      lastContentHash: this.lastContentHash,
      pendingChanges: false, // Would need file monitoring to detect
      agentCount: Number(countResult?.count || 0),
    };
  }

  /**
   * Validate an agent without importing
   */
  validateAgent(agent: unknown): { valid: boolean; errors: string[] } {
    const result = SeedAgentSchema.safeParse(agent);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async syncAgentBatch(
    seedAgents: SeedAgent[],
    ownerId: string,
    options: SyncOptions,
    result: SyncResult
  ): Promise<void> {
    const batchSize = options.batchSize || 50;

    // Get existing agents for comparison
    const existingAgents = await this.db
      .select({ id: agents.id, name: agents.name, metadata: agents.metadata })
      .from(agents)
      .where(eq(agents.ownerId, ownerId));

    const existingByName = new Map(existingAgents.map(a => [a.name.toLowerCase(), a]));

    this.emitProgress(options, { phase: 'syncing', current: 0, total: seedAgents.length, message: 'Starting sync...' });

    // Process in batches
    for (let i = 0; i < seedAgents.length; i += batchSize) {
      const batch = seedAgents.slice(i, i + batchSize);

      for (const seedAgent of batch) {
        try {
          const existing = existingByName.get(seedAgent.name.toLowerCase());
          const agentHash = this.computeHash(JSON.stringify(seedAgent));

          if (existing) {
            // Check if update is needed
            const existingMeta = existing.metadata as Record<string, unknown> | null;
            const existingHash = existingMeta?.contentHash as string | undefined;

            if (!options.updateExisting) {
              result.skipped++;
              continue;
            }

            if (existingHash === agentHash) {
              result.skipped++;
              continue;
            }

            // Update existing agent
            if (!options.dryRun) {
              await this.db
                .update(agents)
                .set({
                  description: seedAgent.description,
                  systemPrompt: seedAgent.system_prompt,
                  model: seedAgent.model,
                  trustScore: seedAgent.trust_score,
                  config: seedAgent.config,
                  metadata: { ...seedAgent.metadata, contentHash: agentHash, syncedAt: new Date().toISOString() },
                  updatedAt: new Date(),
                })
                .where(eq(agents.id, existing.id));
            }
            result.updated++;

          } else {
            // Insert new agent
            if (!options.dryRun) {
              await this.db.insert(agents).values({
                ownerId,
                name: seedAgent.name,
                description: seedAgent.description,
                systemPrompt: seedAgent.system_prompt,
                model: seedAgent.model,
                status: seedAgent.status as 'draft' | 'training' | 'examination' | 'active' | 'suspended' | 'retired',
                trustScore: seedAgent.trust_score,
                config: seedAgent.config,
                metadata: { ...seedAgent.metadata, contentHash: agentHash, syncedAt: new Date().toISOString() },
                graduatedAt: seedAgent.status === 'active' ? new Date() : null,
              });
            }
            result.imported++;
          }

          this.emitProgress(options, {
            phase: 'syncing',
            current: result.imported + result.updated + result.skipped + result.failed,
            total: seedAgents.length,
            currentAgent: seedAgent.name,
          });

        } catch (error) {
          const err = error as Error;
          result.failed++;
          if (result.errors.length < 10) {
            result.errors.push({ agentName: seedAgent.name, error: err.message });
          }
          this.logger.warn({ agent: seedAgent.name, error: err.message }, 'Failed to sync agent');
        }
      }
    }
  }

  private async resolveOwnerId(options: SyncOptions): Promise<string | null> {
    if (options.ownerId) {
      return options.ownerId;
    }

    if (options.ownerEmail) {
      const [owner] = await this.db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, options.ownerEmail))
        .limit(1);
      return owner?.id || null;
    }

    // Fallback: get first profile
    const [firstProfile] = await this.db
      .select({ id: profiles.id })
      .from(profiles)
      .limit(1);
    return firstProfile?.id || null;
  }

  private findAgentYamlFiles(dir: string, files: string[] = []): string[] {
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        this.findAgentYamlFiles(fullPath, files);
      } else if (item.endsWith('.agent.yaml') || item.endsWith('.agent.yml')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private parseYamlAgentFile(filePath: string): SeedAgent | null {
    // Dynamic import for yaml (optional dependency)
    let yaml: { parse: (content: string) => unknown };
    try {
      yaml = require('yaml');
    } catch {
      throw new Error('yaml package not installed. Run: npm install yaml');
    }

    const content = fs.readFileSync(filePath, 'utf8');

    // Handle frontmatter format
    if (content.startsWith('---')) {
      const parts = content.split('---');
      if (parts.length < 3) return null;

      const frontMatter = yaml.parse(parts[1]) as Record<string, unknown>;
      const markdownBody = parts.slice(2).join('---').trim();

      // Extract expertise and principles from markdown
      const expertise: string[] = [];
      const principles: string[] = [];

      const expertiseMatch = markdownBody.match(/## Expertise\n\n([\s\S]*?)(?=\n##|$)/);
      if (expertiseMatch) {
        expertiseMatch[1].trim().split('\n').forEach(line => {
          const item = line.replace(/^-\s*/, '').trim();
          if (item) expertise.push(item);
        });
      }

      const principlesMatch = markdownBody.match(/## Principles\n\n([\s\S]*?)(?=\n##|$)/);
      if (principlesMatch) {
        principlesMatch[1].trim().split('\n').forEach(line => {
          const item = line.replace(/^-\s*/, '').trim();
          if (item) principles.push(item);
        });
      }

      return {
        name: frontMatter.name as string || path.basename(filePath, '.agent.yaml'),
        description: frontMatter.title as string,
        system_prompt: this.buildEnhancedPrompt(frontMatter, expertise, principles),
        model: 'claude-sonnet-4-20250514',
        status: 'draft',
        trust_score: 0,
        config: { temperature: 0.7, maxTokens: 4096 },
        metadata: {
          icon: frontMatter.icon as string || 'robot',
          source: 'bai-yaml-sync',
          level: frontMatter.level as string || 'L1',
          expertise,
          principles,
          baiPath: filePath,
        },
      };
    }

    // Full YAML format (agent.metadata structure)
    const parsed = yaml.parse(content) as Record<string, unknown>;
    const validated = YamlAgentSchema.safeParse(parsed);

    if (!validated.success) {
      this.logger.warn({ file: filePath, errors: validated.error.errors }, 'Invalid YAML agent format');
      return null;
    }

    const agentData = validated.data.agent;
    const meta = agentData.metadata;
    const persona = agentData.persona || { role: undefined, identity: undefined, communication_style: undefined, principles: undefined };
    const baiOs = agentData.bai_os || { version: '1.0', proactive_mode: false, collaboration: false, behaviors: undefined };
    const level = meta.level || 'L1';
    const levelDef = LEVEL_DEFS[level] || LEVEL_DEFS.L1;

    return {
      name: meta.name,
      description: meta.title || `${meta.name} - ${levelDef.name}`,
      system_prompt: this.buildSystemPrompt(meta, persona, baiOs, agentData.menu || [], levelDef),
      model: 'claude-sonnet-4-20250514',
      status: 'draft',
      trust_score: 0,
      config: { temperature: 0.7, maxTokens: 4096, specialization: meta.type || 'general' },
      metadata: {
        icon: meta.icon || 'robot',
        source: 'bai-yaml-sync',
        level,
        levelName: levelDef.name,
        authority: levelDef.authority,
        title: meta.title,
        type: meta.type,
        persona,
        baiOs,
        menu: agentData.menu,
        domain: 'bai-enhanced',
        targetTrustScore: TRUST_SCORES[level] || 35,
        baiPath: filePath,
        version: '2.0',
      },
    };
  }

  private buildSystemPrompt(
    meta: z.infer<typeof YamlAgentMetadataSchema>,
    persona: z.infer<typeof YamlAgentPersonaSchema>,
    baiOs: z.infer<typeof YamlAgentBaiOsSchema>,
    menu: Array<{ cmd: string; label: string; action: string }>,
    levelDef: { name: string; authority: string; autonomy: string }
  ): string {
    const level = meta.level || 'L1';

    let prompt = `# ${meta.name}
**${meta.title || levelDef.name}**

## Identity
${persona.identity || meta.name} - A Level ${level} ${levelDef.name} in the A3I ecosystem.
You are governed by the AgentAnchor platform and operate under the Four Pillars: Truth, Honesty, Service, and Humanity.

## Role
${persona.role || `${levelDef.name} with ${levelDef.authority}`}

## Authority Level
- **Level:** ${level} (${levelDef.name})
- **Authority:** ${levelDef.authority}
- **Autonomy:** ${levelDef.autonomy}

## Communication Style
${persona.communication_style || 'Professional, precise, and helpful.'}
`;

    if (persona.principles && persona.principles.length > 0) {
      prompt += `\n## Principles\n${persona.principles.map(p => `- ${p}`).join('\n')}\n`;
    }

    if (baiOs.behaviors && baiOs.behaviors.length > 0) {
      prompt += `\n## Operating Behaviors\n${baiOs.behaviors.map(b => `- ${b}`).join('\n')}\n`;
    }

    if (baiOs.proactive_mode) {
      prompt += `\n## Proactive Excellence Mode
You operate with proactive excellence:
1. **Find & Fix** - Actively seek problems and opportunities
2. **Analysis -> Action** - Every observation leads to a recommendation
3. **Actionable Steps** - Break work into numbered, executable tasks
4. **Collaborate** - Recommend other agents when their expertise helps
5. **Drive Outcomes** - Focus on results, not just activity
`;
    }

    if (menu.length > 0) {
      prompt += `\n## Available Commands\n${menu.map(m => `- **/${m.cmd}** - ${m.action}`).join('\n')}\n`;
    }

    if (baiOs.collaboration) {
      prompt += `\n## Collaboration Network
As part of the A3I agent workforce, actively identify opportunities to:
- Recommend specialists for domain expertise
- Propose team compositions for complex tasks
- Request peer reviews for quality assurance
- Facilitate handoffs with full context
`;
    }

    return prompt;
  }

  private buildEnhancedPrompt(
    frontMatter: Record<string, unknown>,
    expertise: string[],
    principles: string[]
  ): string {
    const name = frontMatter.name as string || 'Agent';
    const title = frontMatter.title as string || '';
    const level = frontMatter.level as string || 'L1';
    const levelDef = LEVEL_DEFS[level] || LEVEL_DEFS.L1;

    let prompt = `# ${name}\n**${title || levelDef.name}**\n\n`;
    prompt += `## Identity\nLevel ${level} ${levelDef.name} - ${levelDef.authority}\n\n`;

    if (expertise.length > 0) {
      prompt += `## Expertise\n${expertise.map(e => `- ${e}`).join('\n')}\n\n`;
    }

    if (principles.length > 0) {
      prompt += `## Principles\n${principles.map(p => `- ${p}`).join('\n')}\n\n`;
    }

    return prompt;
  }

  private computeHash(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  private emitProgress(options: SyncOptions, progress: SyncProgress): void {
    if (options.onProgress) {
      options.onProgress(progress);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

let syncServiceInstance: AgentSyncService | null = null;

/**
 * Create or retrieve the AgentSyncService instance
 */
export function createSyncService(db?: Database): AgentSyncService {
  if (!syncServiceInstance || db) {
    syncServiceInstance = new AgentSyncService(db);
  }
  return syncServiceInstance;
}

/**
 * Get the singleton sync service instance
 */
export function getSyncService(): AgentSyncService {
  return createSyncService();
}

// =============================================================================
// Exports
// =============================================================================

export {
  SeedAgentSchema,
  SeedFileSchema,
  AgentConfigSchema,
  AgentMetadataSchema,
};
