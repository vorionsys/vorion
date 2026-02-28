/**
 * CrewAI Trust Tools
 *
 * Tools that allow crew agents to query trust information.
 *
 * @packageDocumentation
 */

import type { TrustEngine } from "../trust-engine/index.js";
import { TRUST_LEVEL_NAMES, TRUST_THRESHOLDS } from "../trust-engine/index.js";
import type { TrustLevel } from "../common/types.js";

/**
 * Tool definition compatible with CrewAI's tool interface
 */
export interface CrewTrustToolDefinition {
  name: string;
  description: string;
  func: (input: string) => Promise<string>;
}

/**
 * Create trust query tools for crew agents
 */
export function createCrewTrustTools(
  trustEngine: TrustEngine,
  agentId: string,
): CrewTrustToolDefinition[] {
  return [
    {
      name: "check_agent_trust",
      description:
        "Check your current trust score and level within the crew. Returns your trust score (0-1000), " +
        "trust level (L0-L5), and level name. Use this to understand your current permissions.",
      func: async (_input: string) => {
        const record = await trustEngine.getScore(agentId);
        if (!record) {
          return JSON.stringify({
            error: "Trust record not found",
            agentId,
          });
        }

        return JSON.stringify({
          agentId,
          score: record.score,
          level: record.level,
          levelName: TRUST_LEVEL_NAMES[record.level],
          components: record.components,
          recentFailures: record.recentFailures.length,
          acceleratedDecay: trustEngine.isAcceleratedDecayActive(agentId),
        });
      },
    },
    {
      name: "check_crew_member_trust",
      description:
        "Check the trust score for another crew member. " +
        "Input should be the agent ID of the crew member to check. " +
        "Useful for deciding whether to delegate tasks.",
      func: async (input: string) => {
        const targetId = input.trim();
        const record = await trustEngine.getScore(targetId);

        if (!record) {
          return JSON.stringify({
            error: "Crew member not found",
            agentId: targetId,
          });
        }

        return JSON.stringify({
          agentId: targetId,
          score: record.score,
          level: record.level,
          levelName: TRUST_LEVEL_NAMES[record.level],
          lastCalculatedAt: record.lastCalculatedAt,
        });
      },
    },
    {
      name: "check_delegation_allowed",
      description:
        "Check if you can delegate a task to another crew member. " +
        "Input should be the target agent ID. " +
        "Returns whether the delegation is allowed based on both agents' trust levels.",
      func: async (input: string) => {
        const targetId = input.trim();
        const myRecord = await trustEngine.getScore(agentId);
        const targetRecord = await trustEngine.getScore(targetId);

        if (!myRecord) {
          return JSON.stringify({
            allowed: false,
            reason: "Your trust record not found",
          });
        }

        if (!targetRecord) {
          return JSON.stringify({
            allowed: false,
            reason: `Crew member ${targetId} not found in trust engine`,
          });
        }

        const minDelegationLevel: TrustLevel = 2;
        const allowed =
          myRecord.level >= minDelegationLevel && targetRecord.level >= 1;

        return JSON.stringify({
          allowed,
          yourLevel: myRecord.level,
          yourLevelName: TRUST_LEVEL_NAMES[myRecord.level],
          targetLevel: targetRecord.level,
          targetLevelName: TRUST_LEVEL_NAMES[targetRecord.level],
          reason: allowed
            ? `Delegation allowed: you have ${TRUST_LEVEL_NAMES[myRecord.level]} trust, target has ${TRUST_LEVEL_NAMES[targetRecord.level]}`
            : `Delegation blocked: requires ${TRUST_LEVEL_NAMES[minDelegationLevel]} trust for delegator`,
        });
      },
    },
    {
      name: "get_trust_levels",
      description:
        "Get information about all trust levels and their score ranges. " +
        "Useful for understanding the trust tier system.",
      func: async (_input: string) => {
        const levels = Object.entries(TRUST_LEVEL_NAMES).map(
          ([level, name]) => ({
            level: parseInt(level),
            name,
            scoreRange: TRUST_THRESHOLDS[parseInt(level) as TrustLevel],
          }),
        );

        return JSON.stringify({
          levels,
          description:
            "Trust levels range from L0 (Sandbox) to L5 (Autonomous). " +
            "Higher levels grant access to more sensitive tasks and delegation capabilities.",
        });
      },
    },
    {
      name: "report_task_success",
      description:
        "Report that you successfully completed a crew task. " +
        "This will record a positive behavioral signal to improve your trust score. " +
        "Input should be a brief description of what you accomplished.",
      func: async (input: string) => {
        await trustEngine.recordSignal({
          id: crypto.randomUUID(),
          entityId: agentId,
          type: "behavioral.crew_task_completed",
          value: 0.85,
          source: "crewai-self-report",
          timestamp: new Date().toISOString(),
          metadata: { description: input },
        });

        const record = await trustEngine.getScore(agentId);

        return JSON.stringify({
          recorded: true,
          newScore: record?.score,
          newLevel: record?.level,
          message: "Task success recorded. Your trust score may have improved.",
        });
      },
    },
    {
      name: "report_task_failure",
      description:
        "Report that you failed to complete a crew task. " +
        "Honest self-reporting of failures helps maintain trust long-term. " +
        "Input should be a brief description of what went wrong.",
      func: async (input: string) => {
        await trustEngine.recordSignal({
          id: crypto.randomUUID(),
          entityId: agentId,
          type: "behavioral.crew_task_failed",
          value: 0.2,
          source: "crewai-self-report",
          timestamp: new Date().toISOString(),
          metadata: { description: input },
        });

        const record = await trustEngine.getScore(agentId);

        return JSON.stringify({
          recorded: true,
          newScore: record?.score,
          newLevel: record?.level,
          acceleratedDecay: trustEngine.isAcceleratedDecayActive(agentId),
          message:
            "Task failure recorded. Your trust score may have decreased. " +
            "Honest reporting is valued in the trust system.",
        });
      },
    },
  ];
}
