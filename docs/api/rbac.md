# RBAC API

The RBAC (Role-Based Access Control) API provides endpoints for managing roles, permissions, and user role assignments with full tenant isolation.

## Overview

Vorion's RBAC system provides:
- Hierarchical role management with inheritance
- Fine-grained permission controls
- Tenant-isolated access control
- System roles with predefined permissions
- Permission caching for performance

**Security Note:** All RBAC operations are scoped to the authenticated user's tenant. The tenant ID is extracted from the JWT token and cannot be overridden.

---

## Roles Endpoints

### GET /api/v1/rbac/roles

List all roles for the current tenant.

**Request:**
```http
GET /api/v1/rbac/roles?limit=50&offset=0&includeInactive=false
Authorization: Bearer <access_token>
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 50 | Maximum results (1-100) |
| `offset` | number | 0 | Pagination offset |
| `includeInactive` | boolean | false | Include inactive roles |

**Response (200 OK):**
```json
{
  "roles": [
    {
      "id": "role_uuid_1",
      "name": "analyst",
      "tenantId": "tenant_uuid",
      "parentRoleId": null,
      "isSystem": false,
      "isActive": true,
      "metadata": {},
      "createdAt": "2026-01-15T10:00:00Z",
      "updatedAt": "2026-02-01T14:30:00Z"
    },
    {
      "id": "role_uuid_2",
      "name": "senior_analyst",
      "tenantId": "tenant_uuid",
      "parentRoleId": "role_uuid_1",
      "isSystem": false,
      "isActive": true,
      "metadata": {
        "department": "finance"
      },
      "createdAt": "2026-01-20T09:00:00Z",
      "updatedAt": "2026-01-20T09:00:00Z"
    }
  ],
  "total": 15,
  "limit": 50,
  "offset": 0
}
```

**Required Permission:** `read:roles`

---

### GET /api/v1/rbac/roles/:id

Get a specific role by ID with its permissions.

**Request:**
```http
GET /api/v1/rbac/roles/role_uuid
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "role": {
    "id": "role_uuid",
    "name": "analyst",
    "tenantId": "tenant_uuid",
    "parentRoleId": null,
    "isSystem": false,
    "isActive": true,
    "metadata": {},
    "createdAt": "2026-01-15T10:00:00Z",
    "updatedAt": "2026-02-01T14:30:00Z"
  },
  "permissions": [
    {
      "action": "read",
      "resource": "intents",
      "conditions": []
    },
    {
      "action": "read",
      "resource": "agents",
      "conditions": []
    }
  ]
}
```

**Not Found (404):**
```json
{
  "error": "Role not found"
}
```

**Required Permission:** `read:roles`

---

### POST /api/v1/rbac/roles

Create a new role.

**Request:**
```http
POST /api/v1/rbac/roles
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "analyst",
  "parentRoleId": "parent_role_uuid",
  "metadata": {
    "department": "finance",
    "level": 2
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Role name (alphanumeric, underscores, colons) |
| `parentRoleId` | string (UUID) | No | Parent role for inheritance |
| `metadata` | object | No | Custom metadata |

**Name Validation:**
- Must start with a letter
- Can contain: letters, numbers, underscores, colons
- Maximum 100 characters
- Pattern: `^[a-z][a-z0-9_:]*$`

**Response (201 Created):**
```json
{
  "role": {
    "id": "new_role_uuid",
    "name": "analyst",
    "tenantId": "tenant_uuid",
    "parentRoleId": "parent_role_uuid",
    "isSystem": false,
    "isActive": true,
    "metadata": {
      "department": "finance",
      "level": 2
    },
    "createdAt": "2026-02-04T12:00:00Z",
    "updatedAt": "2026-02-04T12:00:00Z"
  }
}
```

**System Role Conflict (400):**
```json
{
  "error": "Cannot create role with system role name",
  "systemRoles": ["admin", "tenant:admin", "user", "agent:operator", "auditor", "service_account"]
}
```

**Name Conflict (409):**
```json
{
  "error": "Role name already exists"
}
```

**Required Permission:** `create:roles`

---

### PATCH /api/v1/rbac/roles/:id

Update a role.

**Request:**
```http
PATCH /api/v1/rbac/roles/role_uuid
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "name": "senior_analyst",
  "parentRoleId": "new_parent_uuid",
  "isActive": true,
  "metadata": {
    "department": "finance",
    "level": 3
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | New role name |
| `parentRoleId` | string/null | New parent role (null to remove) |
| `isActive` | boolean | Active status |
| `metadata` | object | Custom metadata |

**Response (200 OK):**
```json
{
  "role": {
    "id": "role_uuid",
    "name": "senior_analyst",
    "parentRoleId": "new_parent_uuid",
    "isActive": true,
    "metadata": {
      "department": "finance",
      "level": 3
    },
    "updatedAt": "2026-02-04T12:15:00Z"
  }
}
```

**System Role (403):**
```json
{
  "error": "Cannot modify system roles"
}
```

**Required Permission:** `update:roles`

---

### DELETE /api/v1/rbac/roles/:id

Delete a role.

**Request:**
```http
DELETE /api/v1/rbac/roles/role_uuid
Authorization: Bearer <access_token>
```

**Response:** `204 No Content`

**System Role (403):**
```json
{
  "error": "Cannot delete system roles"
}
```

**Required Permission:** `delete:roles`

---

## Permissions Endpoints

### POST /api/v1/rbac/roles/:id/permissions

Add a permission to a role.

**Request:**
```http
POST /api/v1/rbac/roles/role_uuid/permissions
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "action": "read",
  "resource": "intents",
  "conditions": [
    {
      "type": "tier_minimum",
      "value": 2
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | Yes | Permission action |
| `resource` | enum | Yes | Target resource |
| `conditions` | array | No | Permission conditions |

**Available Actions:**
- `create`, `read`, `update`, `delete`
- `execute`, `approve`, `reject`, `escalate`, `cancel`
- `manage`, `assign`, `revoke`
- `audit`, `export`
- `*` (all actions)

**Available Resources:**
- `intents`, `policies`, `escalations`, `agents`
- `trust_scores`, `trust_signals`
- `roles`, `permissions`, `users`, `service_accounts`
- `audit_logs`, `webhooks`, `tenants`, `settings`
- `*` (all resources)

**Response (201 Created):**
```json
{
  "permission": {
    "id": "permission_uuid",
    "roleId": "role_uuid",
    "action": "read",
    "resource": "intents",
    "conditions": [
      {
        "type": "tier_minimum",
        "value": 2
      }
    ],
    "createdAt": "2026-02-04T12:00:00Z"
  }
}
```

**System Role (403):**
```json
{
  "error": "Cannot modify system role permissions"
}
```

**Required Permission:** `manage:permissions`

---

### DELETE /api/v1/rbac/roles/:id/permissions

Remove a permission from a role.

**Request:**
```http
DELETE /api/v1/rbac/roles/role_uuid/permissions
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "action": "read",
  "resource": "intents"
}
```

**Response:** `204 No Content`

**System Role (403):**
```json
{
  "error": "Cannot modify system role permissions"
}
```

**Required Permission:** `manage:permissions`

---

## User Role Assignments

### GET /api/v1/rbac/users/:userId/roles

Get roles assigned to a user.

**Request:**
```http
GET /api/v1/rbac/users/user_uuid/roles
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "userId": "user_uuid",
  "roles": [
    {
      "id": "assignment_uuid",
      "roleId": "role_uuid",
      "roleName": "analyst",
      "grantedBy": "admin_user_uuid",
      "grantedAt": "2026-01-15T10:00:00Z",
      "expiresAt": null,
      "metadata": {}
    }
  ],
  "roleNames": ["analyst", "user"]
}
```

**Required Permission:** `read:users`

---

### POST /api/v1/rbac/users/:userId/roles

Assign a role to a user.

**Request:**
```http
POST /api/v1/rbac/users/user_uuid/roles
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "roleId": "role_uuid",
  "expiresAt": "2026-12-31T23:59:59Z",
  "metadata": {
    "reason": "Project assignment",
    "approvedBy": "manager_uuid"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roleId` | string (UUID) | Yes | Role to assign |
| `expiresAt` | string (ISO 8601) | No | Expiration date |
| `metadata` | object | No | Assignment metadata |

**Response (201 Created):**
```json
{
  "assignment": {
    "id": "assignment_uuid",
    "userId": "user_uuid",
    "roleId": "role_uuid",
    "tenantId": "tenant_uuid",
    "grantedBy": "current_user_uuid",
    "grantedAt": "2026-02-04T12:00:00Z",
    "expiresAt": "2026-12-31T23:59:59Z",
    "metadata": {
      "reason": "Project assignment",
      "approvedBy": "manager_uuid"
    }
  }
}
```

**Role Not Found (404):**
```json
{
  "error": "Role not found"
}
```

**Required Permission:** `assign:roles`

---

### DELETE /api/v1/rbac/users/:userId/roles/:roleId

Revoke a role from a user.

**Request:**
```http
DELETE /api/v1/rbac/users/user_uuid/roles/role_uuid
Authorization: Bearer <access_token>
```

**Response:** `204 No Content`

**Not Found (404):**
```json
{
  "error": "Role assignment not found"
}
```

**Required Permission:** `revoke:roles`

---

## Permission Checking

### GET /api/v1/rbac/me/permissions

Get current user's effective permissions.

**Request:**
```http
GET /api/v1/rbac/me/permissions
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "userId": "current_user_uuid",
  "roles": ["admin", "analyst"],
  "permissions": [
    { "action": "read", "resource": "intents" },
    { "action": "create", "resource": "intents" },
    { "action": "read", "resource": "agents" },
    { "action": "*", "resource": "audit_logs" }
  ]
}
```

---

### POST /api/v1/rbac/check

Check if current user has a specific permission.

**Request:**
```http
POST /api/v1/rbac/check
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:**
```json
{
  "action": "create",
  "resource": "intents",
  "resourceId": "specific_resource_uuid"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | Action to check |
| `resource` | string | Yes | Resource type |
| `resourceId` | string | No | Specific resource ID |

**Response (200 OK):**
```json
{
  "allowed": true,
  "reason": "Permission granted via role: admin",
  "effectiveRoles": ["admin", "user"],
  "evaluationTimeMs": 2.3
}
```

**Denied:**
```json
{
  "allowed": false,
  "reason": "No permission found for action 'delete' on resource 'tenants'",
  "effectiveRoles": ["analyst", "user"],
  "evaluationTimeMs": 1.8
}
```

---

## System Roles

### GET /api/v1/rbac/system-roles

Get system roles and their predefined permissions.

**Request:**
```http
GET /api/v1/rbac/system-roles
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "systemRoles": [
    {
      "name": "admin",
      "permissions": [
        "*:*"
      ],
      "isSystem": true
    },
    {
      "name": "tenant:admin",
      "permissions": [
        "manage:users",
        "manage:roles",
        "manage:permissions",
        "read:audit_logs",
        "manage:settings"
      ],
      "isSystem": true
    },
    {
      "name": "user",
      "permissions": [
        "read:intents",
        "create:intents",
        "read:agents"
      ],
      "isSystem": true
    },
    {
      "name": "agent:operator",
      "permissions": [
        "manage:agents",
        "read:intents",
        "read:trust_scores",
        "read:trust_signals"
      ],
      "isSystem": true
    },
    {
      "name": "auditor",
      "permissions": [
        "read:*",
        "export:audit_logs"
      ],
      "isSystem": true
    },
    {
      "name": "service_account",
      "permissions": [
        "create:intents",
        "read:intents",
        "read:agents"
      ],
      "isSystem": true
    }
  ]
}
```

---

## Permission Matrix

| Role | Intents | Agents | Trust | Roles | Users | Audit |
|------|---------|--------|-------|-------|-------|-------|
| admin | Full | Full | Full | Full | Full | Full |
| tenant:admin | Full | Full | Full | Full | Full | Read |
| user | R/C | Read | Read | - | - | - |
| agent:operator | Read | Full | Read | - | - | - |
| auditor | Read | Read | Read | Read | Read | Read/Export |
| service_account | R/C | Read | - | - | - | - |

**Legend:** R = Read, C = Create, Full = All operations

---

## Audit Events

All RBAC operations are logged:

| Event | Description |
|-------|-------------|
| `rbac.role.create` | Role created |
| `rbac.role.update` | Role updated |
| `rbac.role.delete` | Role deleted |
| `rbac.permission.grant` | Permission added to role |
| `rbac.permission.revoke` | Permission removed from role |
| `rbac.role.assign` | Role assigned to user |
| `rbac.role.revoke` | Role revoked from user |

---

## Rate Limits

| Operation | Limit | Window |
|-----------|-------|--------|
| Read | 100 requests | 60 seconds |
| Write | 30 requests | 60 seconds |
| Admin | 10 requests | 60 seconds |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `ROLE_NOT_FOUND` | 404 | Role does not exist |
| `ROLE_EXISTS` | 409 | Role name already exists |
| `SYSTEM_ROLE` | 403 | Cannot modify system role |
| `INVALID_ROLE_NAME` | 400 | Role name validation failed |
| `ASSIGNMENT_NOT_FOUND` | 404 | Role assignment not found |
| `PERMISSION_DENIED` | 403 | Insufficient permissions |
