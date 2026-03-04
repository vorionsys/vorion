/**
 * MCP (Model Context Protocol) - Server management and invocation
 */

import {
  MCPServerConfig,
  MCPServerType,
  MCPPermissions,
  MCPInvocation,
  TrustContext,
} from './types';

// =============================================================================
// MCP Server Templates
// =============================================================================

export const MCP_SERVER_TEMPLATES: Record<MCPServerType, {
  defaultConfig: Record<string, unknown>;
  defaultPermissions: MCPPermissions;
  description: string;
}> = {
  filesystem: {
    defaultConfig: {
      allowedDirectories: [],
      watchForChanges: false,
    },
    defaultPermissions: {
      read: true,
      write: false,
      execute: false,
      allowedPaths: [],
      deniedPaths: ['**/node_modules/**', '**/.git/**', '**/.env*'],
    },
    description: 'Access local filesystem within allowed directories',
  },
  github: {
    defaultConfig: {
      repository: '',
      branch: 'main',
      autoSync: false,
    },
    defaultPermissions: {
      read: true,
      write: false,
      execute: false,
    },
    description: 'Access GitHub repositories for code and issues',
  },
  database: {
    defaultConfig: {
      type: 'postgres',
      connectionString: '',
      maxConnections: 5,
    },
    defaultPermissions: {
      read: true,
      write: false,
      execute: false,
    },
    description: 'Query and manage database connections',
  },
  websearch: {
    defaultConfig: {
      provider: 'bing',
      maxResults: 10,
      safeSearch: true,
    },
    defaultPermissions: {
      read: true,
      write: false,
      execute: true,
      rateLimit: 30, // 30 requests per minute
    },
    description: 'Search the web for information',
  },
  custom: {
    defaultConfig: {},
    defaultPermissions: {
      read: true,
      write: false,
      execute: false,
    },
    description: 'Custom MCP server implementation',
  },
};

// =============================================================================
// MCP Permission Checks
// =============================================================================

export function checkMCPPermission(
  server: MCPServerConfig,
  action: 'read' | 'write' | 'execute',
  path?: string
): { allowed: boolean; reason: string } {
  // Check if server is enabled
  if (!server.enabled) {
    return { allowed: false, reason: 'MCP server is disabled' };
  }

  // Check base permission
  if (!server.permissions[action]) {
    return { allowed: false, reason: `${action} permission not granted` };
  }

  // Check path restrictions for filesystem
  if (path && server.type === 'filesystem') {
    const { allowedPaths, deniedPaths } = server.permissions;

    // Check denied paths first
    if (deniedPaths?.some(pattern => matchPath(path, pattern))) {
      return { allowed: false, reason: `Path ${path} is in denied list` };
    }

    // Check allowed paths (if specified)
    if (allowedPaths && allowedPaths.length > 0) {
      if (!allowedPaths.some(pattern => matchPath(path, pattern))) {
        return { allowed: false, reason: `Path ${path} is not in allowed list` };
      }
    }
  }

  return { allowed: true, reason: 'Permission granted' };
}

function matchPath(path: string, pattern: string): boolean {
  // Simple glob matching (** = any, * = single level)
  const regex = pattern
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${regex}$`).test(path);
}

// =============================================================================
// MCP Trust Requirements
// =============================================================================

const MCP_TRUST_REQUIREMENTS: Record<MCPServerType, number> = {
  filesystem: 600,   // Trusted
  github: 400,       // Established
  database: 600,     // Trusted
  websearch: 200,    // Provisional
  custom: 800,       // Verified
};

export function canUseMCPServer(
  server: MCPServerConfig,
  trust: TrustContext
): { allowed: boolean; reason: string } {
  const required = MCP_TRUST_REQUIREMENTS[server.type];

  if (trust.effectiveScore < required) {
    return {
      allowed: false,
      reason: `${server.type} MCP requires trust score ${required} (current: ${trust.effectiveScore})`,
    };
  }

  return { allowed: true, reason: 'Trust requirement met' };
}

// =============================================================================
// MCP Server Configuration
// =============================================================================

export function createMCPServerConfig(
  id: string,
  name: string,
  type: MCPServerType,
  config: Record<string, unknown> = {},
  permissions: Partial<MCPPermissions> = {}
): MCPServerConfig {
  const template = MCP_SERVER_TEMPLATES[type];

  return {
    id,
    name,
    type,
    config: { ...template.defaultConfig, ...config },
    permissions: { ...template.defaultPermissions, ...permissions },
    enabled: true,
  };
}

export function updateMCPPermissions(
  server: MCPServerConfig,
  updates: Partial<MCPPermissions>
): MCPServerConfig {
  return {
    ...server,
    permissions: {
      ...server.permissions,
      ...updates,
    },
  };
}

// =============================================================================
// MCP Invocation
// =============================================================================

export function createMCPInvocation(
  serverId: string,
  method: string,
  params: Record<string, unknown>
): MCPInvocation {
  return {
    serverId,
    method,
    params,
    duration: 0,
  };
}

export async function executeMCPInvocation(
  server: MCPServerConfig,
  invocation: MCPInvocation,
  trust: TrustContext
): Promise<MCPInvocation> {
  const startTime = Date.now();

  // Check trust requirements
  const trustCheck = canUseMCPServer(server, trust);
  if (!trustCheck.allowed) {
    return {
      ...invocation,
      error: trustCheck.reason,
      duration: Date.now() - startTime,
    };
  }

  // Check permissions based on method
  const action = getActionFromMethod(invocation.method);
  const permCheck = checkMCPPermission(server, action, invocation.params.path as string);
  if (!permCheck.allowed) {
    return {
      ...invocation,
      error: permCheck.reason,
      duration: Date.now() - startTime,
    };
  }

  // Execute based on server type
  try {
    const result = await dispatchMCPRequest(server, invocation);
    return {
      ...invocation,
      result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      ...invocation,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

function getActionFromMethod(method: string): 'read' | 'write' | 'execute' {
  const readMethods = ['get', 'list', 'read', 'search', 'query', 'fetch'];
  const writeMethods = ['create', 'update', 'delete', 'write', 'put', 'post'];

  const lowerMethod = method.toLowerCase();

  if (readMethods.some(m => lowerMethod.includes(m))) return 'read';
  if (writeMethods.some(m => lowerMethod.includes(m))) return 'write';
  return 'execute';
}

async function dispatchMCPRequest(
  server: MCPServerConfig,
  invocation: MCPInvocation
): Promise<unknown> {
  // This is where actual MCP protocol handling would go
  // For now, return a placeholder that indicates the MCP system is ready

  switch (server.type) {
    case 'filesystem':
      return handleFilesystemMCP(server, invocation);
    case 'github':
      return handleGitHubMCP(server, invocation);
    case 'database':
      return handleDatabaseMCP(server, invocation);
    case 'websearch':
      return handleWebSearchMCP(server, invocation);
    default:
      throw new Error(`Unsupported MCP server type: ${server.type}`);
  }
}

// =============================================================================
// MCP Handler Stubs (to be implemented with actual MCP protocol)
// =============================================================================

async function handleFilesystemMCP(
  server: MCPServerConfig,
  invocation: MCPInvocation
): Promise<unknown> {
  const { method, params } = invocation;
  const path = params.path as string | undefined;

  // Path parameter is required for all filesystem operations
  if (!path) {
    return {
      type: 'filesystem',
      action: method,
      status: 'rejected',
      governed: true,
      error: 'Missing required path parameter',
    };
  }

  // Reject path traversal attempts
  if (path.includes('..')) {
    return {
      type: 'filesystem',
      action: method,
      path,
      status: 'rejected',
      governed: true,
      error: 'Path traversal detected — ".." is not allowed',
    };
  }

  // Check path against allowedDirectories if configured
  const allowedDirs = server.config.allowedDirectories as string[] | undefined;
  if (allowedDirs && allowedDirs.length > 0) {
    const inAllowed = allowedDirs.some(dir => path.startsWith(dir));
    if (!inAllowed) {
      return {
        type: 'filesystem',
        action: method,
        path,
        status: 'rejected',
        governed: true,
        error: `Path "${path}" is outside allowed directories`,
      };
    }
  }

  // Determine required permission level from method
  const readMethods = ['readFile', 'readDirectory', 'listFiles'];
  const writeMethods = ['writeFile', 'createFile'];
  const deleteMethods = ['deleteFile'];

  let action: 'read' | 'write' | 'execute';
  if (readMethods.includes(method)) {
    action = 'read';
  } else if (writeMethods.includes(method)) {
    action = 'write';
  } else if (deleteMethods.includes(method)) {
    action = 'write';
  } else {
    action = 'execute';
  }

  // Check permission (includes path allow/deny list checks)
  const permCheck = checkMCPPermission(server, action, path);
  if (!permCheck.allowed) {
    return {
      type: 'filesystem',
      action: method,
      path,
      status: 'rejected',
      governed: true,
      error: permCheck.reason,
    };
  }

  // Delete operations get an additional governance warning
  if (deleteMethods.includes(method)) {
    return {
      type: 'filesystem',
      action: method,
      path,
      status: 'completed',
      governed: true,
      warning: 'Destructive operation — file deletion recorded for audit',
    };
  }

  return {
    type: 'filesystem',
    action: method,
    path,
    status: 'completed',
    governed: true,
  };
}

async function handleGitHubMCP(
  server: MCPServerConfig,
  invocation: MCPInvocation
): Promise<unknown> {
  const { method, params } = invocation;
  const repository = params.repository as string | undefined;

  // Validate repository matches server config if configured
  const configuredRepo = server.config.repository as string | undefined;
  if (configuredRepo && repository && repository !== configuredRepo) {
    return {
      type: 'github',
      action: method,
      repository,
      status: 'rejected',
      governed: true,
      error: `Repository "${repository}" does not match configured repository "${configuredRepo}"`,
    };
  }

  // Determine required permission level from method
  const readMethods = ['getIssues', 'getPullRequests', 'getFile'];
  const writeMethods = ['createIssue', 'createPullRequest', 'commentOnIssue'];
  const executeMethods = ['mergePullRequest', 'deleteFile'];

  let action: 'read' | 'write' | 'execute';
  if (readMethods.includes(method)) {
    action = 'read';
  } else if (writeMethods.includes(method)) {
    action = 'write';
  } else if (executeMethods.includes(method)) {
    action = 'execute';
  } else {
    action = 'read'; // Default to read for unknown methods (safest fallback)
  }

  // Check permission
  const permCheck = checkMCPPermission(server, action);
  if (!permCheck.allowed) {
    return {
      type: 'github',
      action: method,
      repository: repository || configuredRepo || 'unknown',
      status: 'rejected',
      governed: true,
      error: permCheck.reason,
    };
  }

  return {
    type: 'github',
    action: method,
    repository: repository || configuredRepo || 'unknown',
    status: 'completed',
    governed: true,
  };
}

async function handleDatabaseMCP(
  server: MCPServerConfig,
  invocation: MCPInvocation
): Promise<unknown> {
  const { method, params } = invocation;
  const query = params.query as string | undefined;
  const table = params.table as string | undefined;

  // Detect query type from query string or method name
  const source = (query || method || '').toUpperCase();

  // DDL operations are NEVER allowed — hard governance rejection
  const ddlPatterns = ['DROP', 'ALTER', 'TRUNCATE'];
  const hasDDL = ddlPatterns.some(pat => source.includes(pat));
  if (hasDDL) {
    return {
      type: 'database',
      action: method,
      queryType: 'DDL',
      status: 'rejected',
      governed: true,
      error: 'DDL operations (DROP, ALTER, TRUNCATE) are prohibited by governance policy',
    };
  }

  // Determine query type and required permission
  let queryType: string;
  let action: 'read' | 'write' | 'execute';

  if (source.includes('SELECT') || source.includes('GET') || source.includes('LIST') || source.includes('READ') || source.includes('QUERY')) {
    queryType = 'SELECT';
    action = 'read';
  } else if (source.includes('INSERT') || source.includes('CREATE') || source.includes('WRITE')) {
    queryType = 'INSERT';
    action = 'write';
  } else if (source.includes('UPDATE') || source.includes('PUT')) {
    queryType = 'UPDATE';
    action = 'write';
  } else if (source.includes('DELETE') || source.includes('REMOVE')) {
    queryType = 'DELETE';
    action = 'execute';
  } else {
    queryType = 'UNKNOWN';
    action = 'execute';
  }

  // Check permission
  const permCheck = checkMCPPermission(server, action);
  if (!permCheck.allowed) {
    return {
      type: 'database',
      action: method,
      queryType,
      status: 'rejected',
      governed: true,
      error: permCheck.reason,
    };
  }

  const result: Record<string, unknown> = {
    type: 'database',
    action: method,
    queryType,
    status: 'completed',
    governed: true,
  };

  if (table) {
    result.table = table;
  }

  // Note maxConnections if configured
  const maxConnections = server.config.maxConnections as number | undefined;
  if (maxConnections !== undefined) {
    result.maxConnections = maxConnections;
  }

  return result;
}

async function handleWebSearchMCP(
  server: MCPServerConfig,
  invocation: MCPInvocation
): Promise<unknown> {
  const { method, params } = invocation;
  const query = params.query as string | undefined;

  if (!query) {
    return {
      type: 'websearch',
      action: 'search',
      status: 'rejected',
      governed: true,
      error: 'Missing required query parameter',
    };
  }

  // Check read permission (search is a read operation)
  const permCheck = checkMCPPermission(server, 'read');
  if (!permCheck.allowed) {
    return {
      type: 'websearch',
      action: 'search',
      query,
      status: 'rejected',
      governed: true,
      error: permCheck.reason,
    };
  }

  // Rate limit check — note the configured limit in the result
  const rateLimit = server.permissions.rateLimit;

  // Safe search blocklist check
  const safeSearch = server.config.safeSearch as boolean | undefined;
  if (safeSearch) {
    const blocklist = ['exploit', 'malware', 'hack', 'crack', 'keygen', 'warez', 'phishing'];
    const lowerQuery = query.toLowerCase();
    const blocked = blocklist.some(term => lowerQuery.includes(term));
    if (blocked) {
      return {
        type: 'websearch',
        action: 'search',
        query,
        status: 'rejected',
        governed: true,
        error: 'Query blocked by safe search policy',
      };
    }
  }

  // Determine maxResults — use param if provided, otherwise server config default
  const configMaxResults = server.config.maxResults as number | undefined;
  const requestedResults = params.maxResults as number | undefined;
  const maxResults = requestedResults
    ? Math.min(requestedResults, configMaxResults || Infinity)
    : configMaxResults || 10;

  return {
    type: 'websearch',
    action: 'search',
    query,
    maxResults,
    provider: server.config.provider || 'unknown',
    status: 'completed',
    governed: true,
    ...(rateLimit !== undefined ? { rateLimit } : {}),
  };
}

// =============================================================================
// MCP Context Builder
// =============================================================================

export function buildMCPContextPrompt(servers: MCPServerConfig[], trust: TrustContext): string {
  const enabledServers = servers.filter(s => s.enabled);

  if (enabledServers.length === 0) return '';

  const sections: string[] = ['## Connected MCP Servers\n'];

  for (const server of enabledServers) {
    const trustCheck = canUseMCPServer(server, trust);
    const status = trustCheck.allowed ? 'Available' : `Locked (${trustCheck.reason})`;

    sections.push(`### ${server.name} (${server.type})`);
    sections.push(`Status: ${status}`);
    sections.push(`Permissions: ${formatPermissions(server.permissions)}`);
    sections.push('');
  }

  return sections.join('\n');
}

function formatPermissions(perms: MCPPermissions): string {
  const parts: string[] = [];
  if (perms.read) parts.push('read');
  if (perms.write) parts.push('write');
  if (perms.execute) parts.push('execute');
  return parts.join(', ') || 'none';
}
