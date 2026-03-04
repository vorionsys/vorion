/**
 * Vorion Security Platform - Canary Deployment CLI
 * Command-line interface for managing canary deployments
 */

import {
  CLIContext,
  CLICommand,
  CLIOption,
  CLIResult,
  CanaryConfig,
  CanaryDeployment,
  CanaryStatus,
} from './types';
import {
  CanaryController,
  createCanaryController,
  createDefaultCanaryConfig,
  DEFAULT_CANARY_STAGES,
} from './controller';

// ============================================================================
// Types
// ============================================================================

export interface CLIOptions {
  /** Configuration file path */
  config?: string;
  /** API endpoint for remote controller */
  apiEndpoint?: string;
  /** Authentication token */
  authToken?: string;
  /** Verbose output */
  verbose?: boolean;
  /** Output format */
  format?: 'text' | 'json' | 'yaml';
}

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  args: string[];
  options: Record<string, string | boolean | number>;
}

// ============================================================================
// CLI Handler Class
// ============================================================================

export class CanaryCLI {
  private readonly controller: CanaryController;
  private readonly commands: Map<string, CLICommand> = new Map();
  private context: CLIContext;

  constructor(controller?: CanaryController) {
    this.controller = controller || createCanaryController();
    this.context = {
      cwd: process.cwd(),
      verbose: false,
      outputFormat: 'text',
    };

    this.registerCommands();
  }

  /**
   * Register all CLI commands
   */
  private registerCommands(): void {
    // Start command
    this.commands.set('start', {
      name: 'start',
      description: 'Start a new canary deployment',
      aliases: ['deploy', 'create'],
      options: [
        { name: 'config', short: 'c', description: 'Configuration file path', type: 'string' },
        { name: 'service', short: 's', description: 'Target service name', type: 'string', required: true },
        { name: 'namespace', short: 'n', description: 'Target namespace', type: 'string', default: 'default' },
        { name: 'version', short: 'v', description: 'Canary version tag', type: 'string' },
        { name: 'baseline', short: 'b', description: 'Baseline version tag', type: 'string' },
        { name: 'stages', description: 'Custom stages (comma-separated percentages)', type: 'string' },
        { name: 'force', short: 'f', description: 'Force start even if deployment exists', type: 'boolean' },
        { name: 'dry-run', description: 'Validate without starting', type: 'boolean' },
      ],
      arguments: [{ name: 'name', description: 'Deployment name', required: true }],
      handler: this.handleStart.bind(this),
    });

    // Status command
    this.commands.set('status', {
      name: 'status',
      description: 'Show deployment status',
      aliases: ['get', 'info'],
      options: [
        { name: 'watch', short: 'w', description: 'Watch for changes', type: 'boolean' },
        { name: 'interval', short: 'i', description: 'Watch interval in seconds', type: 'number', default: 5 },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID or name', required: false }],
      handler: this.handleStatus.bind(this),
    });

    // Promote command
    this.commands.set('promote', {
      name: 'promote',
      description: 'Promote deployment to next stage',
      aliases: ['advance'],
      options: [
        { name: 'skip-validation', description: 'Skip health validation', type: 'boolean' },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handlePromote.bind(this),
    });

    // Rollback command
    this.commands.set('rollback', {
      name: 'rollback',
      description: 'Rollback deployment to baseline',
      aliases: ['revert'],
      options: [
        { name: 'reason', short: 'r', description: 'Rollback reason', type: 'string', required: true },
        { name: 'force', short: 'f', description: 'Force immediate rollback', type: 'boolean' },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handleRollback.bind(this),
    });

    // Pause command
    this.commands.set('pause', {
      name: 'pause',
      description: 'Pause deployment progression',
      aliases: ['hold'],
      options: [],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handlePause.bind(this),
    });

    // Resume command
    this.commands.set('resume', {
      name: 'resume',
      description: 'Resume paused deployment',
      aliases: ['continue'],
      options: [],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handleResume.bind(this),
    });

    // Abort command
    this.commands.set('abort', {
      name: 'abort',
      description: 'Abort deployment completely',
      aliases: ['cancel', 'stop'],
      options: [
        { name: 'reason', short: 'r', description: 'Abort reason', type: 'string', required: true },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handleAbort.bind(this),
    });

    // List command
    this.commands.set('list', {
      name: 'list',
      description: 'List all deployments',
      aliases: ['ls'],
      options: [
        { name: 'status', short: 's', description: 'Filter by status', type: 'string' },
        { name: 'namespace', short: 'n', description: 'Filter by namespace', type: 'string' },
        { name: 'limit', short: 'l', description: 'Limit results', type: 'number', default: 20 },
      ],
      handler: this.handleList.bind(this),
    });

    // History command
    this.commands.set('history', {
      name: 'history',
      description: 'Show deployment history',
      aliases: ['log', 'events'],
      options: [
        { name: 'limit', short: 'l', description: 'Limit results', type: 'number', default: 50 },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handleHistory.bind(this),
    });

    // Metrics command
    this.commands.set('metrics', {
      name: 'metrics',
      description: 'Show deployment metrics',
      options: [
        { name: 'compare', short: 'c', description: 'Compare with baseline', type: 'boolean' },
        { name: 'window', short: 'w', description: 'Time window in minutes', type: 'number', default: 15 },
      ],
      arguments: [{ name: 'deployment', description: 'Deployment ID', required: true }],
      handler: this.handleMetrics.bind(this),
    });
  }

  /**
   * Parse command line arguments
   */
  parseArgs(argv: string[]): ParsedArgs {
    const args: string[] = [];
    const options: Record<string, string | boolean | number> = {};
    let command = '';
    let subcommand: string | undefined;

    let i = 0;
    while (i < argv.length) {
      const arg = argv[i];

      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const nextArg = argv[i + 1];

        if (nextArg && !nextArg.startsWith('-')) {
          options[key] = this.parseValue(nextArg);
          i++;
        } else {
          options[key] = true;
        }
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1);
        const nextArg = argv[i + 1];

        if (nextArg && !nextArg.startsWith('-')) {
          options[key] = this.parseValue(nextArg);
          i++;
        } else {
          options[key] = true;
        }
      } else if (!command) {
        command = arg;
      } else if (!subcommand && this.isSubcommand(command, arg)) {
        subcommand = arg;
      } else {
        args.push(arg);
      }

      i++;
    }

    return { command, subcommand, args, options };
  }

  /**
   * Parse value (convert to appropriate type)
   */
  private parseValue(value: string): string | number | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    const num = Number(value);
    if (!isNaN(num)) return num;
    return value;
  }

  /**
   * Check if argument is a subcommand
   */
  private isSubcommand(command: string, arg: string): boolean {
    // Define subcommands for each command
    const subcommands: Record<string, string[]> = {
      config: ['show', 'validate', 'generate'],
    };
    return subcommands[command]?.includes(arg) || false;
  }

  /**
   * Execute CLI command
   */
  async execute(argv: string[]): Promise<CLIResult> {
    const parsed = this.parseArgs(argv);

    // Handle global options
    if (parsed.options.verbose || parsed.options.v) {
      this.context.verbose = true;
    }
    if (parsed.options.format) {
      this.context.outputFormat = parsed.options.format as 'text' | 'json' | 'yaml';
    }
    if (parsed.options.config) {
      this.context.configPath = parsed.options.config as string;
    }

    // Find command
    let cmd = this.commands.get(parsed.command);
    if (!cmd) {
      // Check aliases
      for (const command of this.commands.values()) {
        if (command.aliases?.includes(parsed.command)) {
          cmd = command;
          break;
        }
      }
    }

    if (!cmd) {
      if (parsed.command === 'help' || parsed.options.help || parsed.options.h) {
        return this.showHelp(parsed.args[0]);
      }
      return {
        success: false,
        message: `Unknown command: ${parsed.command}. Run 'canary help' for usage.`,
        exitCode: 1,
      };
    }

    // Validate required options
    for (const opt of cmd.options) {
      if (opt.required && !(opt.name in parsed.options) && !(opt.short && opt.short in parsed.options)) {
        return {
          success: false,
          message: `Missing required option: --${opt.name}`,
          exitCode: 1,
        };
      }
    }

    // Merge short options to long names
    const mergedOptions = { ...parsed.options };
    for (const opt of cmd.options) {
      if (opt.short && opt.short in mergedOptions) {
        mergedOptions[opt.name] = mergedOptions[opt.short];
        delete mergedOptions[opt.short];
      }
      // Apply defaults
      if (opt.default !== undefined && opt.default !== null && !(opt.name in mergedOptions)) {
        mergedOptions[opt.name] = opt.default as string | number | boolean;
      }
    }

    // Execute handler
    try {
      return await cmd.handler({ ...mergedOptions, _args: parsed.args }, this.context);
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        exitCode: 1,
      };
    }
  }

  /**
   * Show help information
   */
  private showHelp(commandName?: string): CLIResult {
    if (commandName) {
      const cmd = this.commands.get(commandName);
      if (!cmd) {
        return {
          success: false,
          message: `Unknown command: ${commandName}`,
          exitCode: 1,
        };
      }

      const lines = [
        `Usage: canary ${cmd.name} [options] ${cmd.arguments?.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ') || ''}`,
        '',
        cmd.description,
        '',
        'Options:',
      ];

      for (const opt of cmd.options) {
        const shortFlag = opt.short ? `-${opt.short}, ` : '    ';
        const defaultStr = opt.default !== undefined ? ` (default: ${opt.default})` : '';
        const requiredStr = opt.required ? ' [required]' : '';
        lines.push(`  ${shortFlag}--${opt.name.padEnd(20)} ${opt.description}${defaultStr}${requiredStr}`);
      }

      if (cmd.arguments && cmd.arguments.length > 0) {
        lines.push('', 'Arguments:');
        for (const arg of cmd.arguments) {
          const requiredStr = arg.required ? ' [required]' : '';
          lines.push(`  ${arg.name.padEnd(24)} ${arg.description}${requiredStr}`);
        }
      }

      if (cmd.aliases && cmd.aliases.length > 0) {
        lines.push('', `Aliases: ${cmd.aliases.join(', ')}`);
      }

      return {
        success: true,
        message: lines.join('\n'),
        exitCode: 0,
      };
    }

    const lines = [
      'Vorion Canary Deployment CLI',
      '',
      'Usage: canary <command> [options]',
      '',
      'Commands:',
    ];

    for (const cmd of this.commands.values()) {
      lines.push(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
    }

    lines.push(
      '',
      'Global Options:',
      '  -v, --verbose          Enable verbose output',
      '  --format <format>      Output format: text, json, yaml',
      '  --config <path>        Configuration file path',
      '  -h, --help             Show help',
      '',
      'Run "canary help <command>" for more information about a command.'
    );

    return {
      success: true,
      message: lines.join('\n'),
      exitCode: 0,
    };
  }

  // ============================================================================
  // Command Handlers
  // ============================================================================

  /**
   * Handle start command
   */
  private async handleStart(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const name = positionalArgs[0];
    const service = args.service as string;
    const namespace = (args.namespace as string) || 'default';
    const canaryVersion = args.version as string | undefined;
    const baselineVersion = args.baseline as string | undefined;
    const force = args.force as boolean;
    const dryRun = args['dry-run'] as boolean;
    const stagesStr = args.stages as string | undefined;

    // Parse custom stages
    let stages = DEFAULT_CANARY_STAGES;
    if (stagesStr) {
      const percentages = stagesStr.split(',').map(s => parseInt(s.trim(), 10));
      if (percentages.some(isNaN)) {
        return {
          success: false,
          message: 'Invalid stages format. Use comma-separated percentages (e.g., "1,5,25,50,100")',
          exitCode: 1,
        };
      }
      stages = percentages.map((percentage, i) => ({
        percentage,
        duration: 300,
        requiredSuccessRate: 0.98,
        name: `Stage ${i + 1}`,
      }));
    }

    // Create configuration
    const config = createDefaultCanaryConfig(name, service, namespace, {
      stages,
      canaryVersion,
      baselineVersion,
    });

    if (dryRun) {
      return this.formatOutput(context, {
        message: 'Dry run - configuration validated',
        config,
      });
    }

    // Start deployment
    const deployment = await this.controller.start(config, { force });

    return this.formatOutput(context, {
      message: `Canary deployment started: ${deployment.id}`,
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle status command
   */
  private async handleStatus(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];
    const watch = args.watch as boolean;
    const interval = (args.interval as number) || 5;

    if (watch) {
      // Watch mode would be implemented with interval polling
      return {
        success: false,
        message: 'Watch mode not implemented in this example',
        exitCode: 1,
      };
    }

    if (deploymentId) {
      const status = this.controller.getStatus(deploymentId);
      if (!status.deployment) {
        return {
          success: false,
          message: `Deployment not found: ${deploymentId}`,
          exitCode: 1,
        };
      }

      return this.formatOutput(context, {
        deployment: this.formatDeployment(status.deployment),
        trafficSplit: status.trafficSplit,
        health: status.health,
      });
    }

    // List all active deployments
    const deployments = this.controller.listActiveDeployments();
    if (deployments.length === 0) {
      return {
        success: true,
        message: 'No active deployments',
        exitCode: 0,
      };
    }

    return this.formatOutput(context, {
      activeDeployments: deployments.map(d => this.formatDeploymentSummary(d)),
    });
  }

  /**
   * Handle promote command
   */
  private async handlePromote(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];

    const deployment = await this.controller.promote(deploymentId, 'cli-user');

    return this.formatOutput(context, {
      message: `Deployment promoted to stage ${deployment.currentStage} (${deployment.currentPercentage}%)`,
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle rollback command
   */
  private async handleRollback(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];
    const reason = args.reason as string;

    const deployment = await this.controller.rollback(deploymentId, reason, 'cli-user');

    return this.formatOutput(context, {
      message: 'Rollback completed',
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle pause command
   */
  private async handlePause(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];

    const deployment = await this.controller.pause(deploymentId, 'cli-user');

    return this.formatOutput(context, {
      message: 'Deployment paused',
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle resume command
   */
  private async handleResume(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];

    const deployment = await this.controller.resume(deploymentId, 'cli-user');

    return this.formatOutput(context, {
      message: 'Deployment resumed',
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle abort command
   */
  private async handleAbort(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];
    const reason = args.reason as string;

    const deployment = await this.controller.abort(deploymentId, reason, 'cli-user');

    return this.formatOutput(context, {
      message: 'Deployment aborted',
      deployment: this.formatDeployment(deployment),
    });
  }

  /**
   * Handle list command
   */
  private async handleList(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const statusFilter = args.status as string | undefined;
    const namespaceFilter = args.namespace as string | undefined;
    const limit = (args.limit as number) || 20;

    let deployments = this.controller.listActiveDeployments();

    // Apply filters
    if (statusFilter) {
      deployments = deployments.filter(d => d.status === statusFilter);
    }
    if (namespaceFilter) {
      deployments = deployments.filter(d => d.config.namespace === namespaceFilter);
    }

    // Apply limit
    deployments = deployments.slice(0, limit);

    if (deployments.length === 0) {
      return {
        success: true,
        message: 'No deployments found',
        exitCode: 0,
      };
    }

    return this.formatOutput(context, {
      count: deployments.length,
      deployments: deployments.map(d => this.formatDeploymentSummary(d)),
    });
  }

  /**
   * Handle history command
   */
  private async handleHistory(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];
    const limit = (args.limit as number) || 50;

    const deployment = this.controller.getDeployment(deploymentId);
    if (!deployment) {
      return {
        success: false,
        message: `Deployment not found: ${deploymentId}`,
        exitCode: 1,
      };
    }

    const history = deployment.stageHistory.slice(-limit).map(h => ({
      stage: h.stage,
      percentage: h.percentage,
      timestamp: h.timestamp.toISOString(),
      status: h.status,
      reason: h.reason,
    }));

    return this.formatOutput(context, {
      deploymentId,
      history,
    });
  }

  /**
   * Handle metrics command
   */
  private async handleMetrics(args: Record<string, unknown>, context: CLIContext): Promise<CLIResult> {
    const positionalArgs = args._args as string[];
    const deploymentId = positionalArgs[0];
    const compare = args.compare as boolean;
    const window = (args.window as number) || 15;

    const deployment = this.controller.getDeployment(deploymentId);
    if (!deployment) {
      return {
        success: false,
        message: `Deployment not found: ${deploymentId}`,
        exitCode: 1,
      };
    }

    // Get recent metrics
    const windowMs = window * 60 * 1000;
    const now = Date.now();

    const filterRecent = <T extends { timestamp: Date }>(arr: T[]): T[] =>
      arr.filter(m => now - m.timestamp.getTime() < windowMs);

    const recentMetrics = {
      errorRate: filterRecent(deployment.metrics.errorRate),
      latency: {
        p50: filterRecent(deployment.metrics.latency.p50),
        p95: filterRecent(deployment.metrics.latency.p95),
        p99: filterRecent(deployment.metrics.latency.p99),
      },
      requestCount: filterRecent(deployment.metrics.requestCount),
    };

    const calculateAvg = (arr: Array<{ value: number }>) =>
      arr.length > 0 ? arr.reduce((sum, m) => sum + m.value, 0) / arr.length : 0;

    const summary = {
      timeWindow: `${window} minutes`,
      errorRate: {
        average: (calculateAvg(recentMetrics.errorRate) * 100).toFixed(3) + '%',
        samples: recentMetrics.errorRate.length,
      },
      latency: {
        p50: calculateAvg(recentMetrics.latency.p50).toFixed(2) + 'ms',
        p95: calculateAvg(recentMetrics.latency.p95).toFixed(2) + 'ms',
        p99: calculateAvg(recentMetrics.latency.p99).toFixed(2) + 'ms',
      },
      requestRate: calculateAvg(recentMetrics.requestCount).toFixed(0) + ' req/interval',
    };

    return this.formatOutput(context, {
      deploymentId,
      metrics: summary,
    });
  }

  // ============================================================================
  // Output Formatting
  // ============================================================================

  /**
   * Format output based on context
   */
  private formatOutput(context: CLIContext, data: Record<string, unknown>): CLIResult {
    let message: string;

    switch (context.outputFormat) {
      case 'json':
        message = JSON.stringify(data, null, 2);
        break;
      case 'yaml':
        message = this.toYaml(data);
        break;
      default:
        message = this.toText(data);
    }

    return {
      success: true,
      message,
      data,
      exitCode: 0,
    };
  }

  /**
   * Convert data to YAML-like format
   */
  private toYaml(data: unknown, indent: number = 0): string {
    const prefix = '  '.repeat(indent);

    if (data === null || data === undefined) {
      return 'null';
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return '[]';
      return data.map(item => `${prefix}- ${this.toYaml(item, indent + 1).trimStart()}`).join('\n');
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data);
      if (entries.length === 0) return '{}';
      return entries
        .map(([key, value]) => {
          const valueStr = this.toYaml(value, indent + 1);
          if (typeof value === 'object' && value !== null) {
            return `${prefix}${key}:\n${valueStr}`;
          }
          return `${prefix}${key}: ${valueStr}`;
        })
        .join('\n');
    }

    return String(data);
  }

  /**
   * Convert data to human-readable text
   */
  private toText(data: unknown, indent: number = 0): string {
    const prefix = '  '.repeat(indent);

    if (typeof data === 'string') {
      return data;
    }

    if (data === null || data === undefined) {
      return '';
    }

    if (typeof data !== 'object') {
      return String(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => this.toText(item, indent)).join('\n');
    }

    const lines: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        lines.push(`${prefix}${this.formatKey(key)}:`);
        lines.push(this.toText(value, indent + 1));
      } else if (Array.isArray(value)) {
        lines.push(`${prefix}${this.formatKey(key)}:`);
        value.forEach(item => {
          if (typeof item === 'object') {
            lines.push(this.toText(item, indent + 1));
            lines.push('');
          } else {
            lines.push(`${prefix}  - ${item}`);
          }
        });
      } else {
        lines.push(`${prefix}${this.formatKey(key)}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format key for display
   */
  private formatKey(key: string): string {
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Format deployment for output
   */
  private formatDeployment(deployment: CanaryDeployment): Record<string, unknown> {
    return {
      id: deployment.id,
      name: deployment.config.name,
      service: deployment.config.targetService,
      namespace: deployment.config.namespace,
      status: deployment.status,
      stage: `${deployment.currentStage + 1}/${deployment.config.stages.length}`,
      traffic: `${deployment.currentPercentage}%`,
      startTime: deployment.startTime.toISOString(),
      lastUpdated: deployment.lastUpdated.toISOString(),
      canaryVersion: deployment.config.canaryVersion || 'N/A',
      baselineVersion: deployment.config.baselineVersion || 'N/A',
    };
  }

  /**
   * Format deployment summary for list
   */
  private formatDeploymentSummary(deployment: CanaryDeployment): Record<string, unknown> {
    return {
      id: deployment.id,
      name: deployment.config.name,
      service: deployment.config.targetService,
      status: deployment.status,
      traffic: `${deployment.currentPercentage}%`,
      stage: `${deployment.currentStage + 1}/${deployment.config.stages.length}`,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new CLI instance
 */
export function createCanaryCLI(controller?: CanaryController): CanaryCLI {
  return new CanaryCLI(controller);
}

/**
 * Run CLI with arguments
 */
export async function runCLI(argv: string[]): Promise<number> {
  const cli = createCanaryCLI();
  const result = await cli.execute(argv);

  if (result.message) {
    if (result.success) {
      console.log(result.message);
    } else {
      console.error(result.message);
    }
  }

  return result.exitCode;
}

// ============================================================================
// Main Entry Point
// ============================================================================

// If running directly
if (typeof require !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2);
  runCLI(args).then(exitCode => {
    process.exit(exitCode);
  });
}
