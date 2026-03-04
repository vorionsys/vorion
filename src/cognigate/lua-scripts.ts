/**
 * Cognigate Lua Scripts - Atomic Redis Operations
 *
 * Lua scripts for atomic resource tracking operations in Redis.
 * These ensure consistency under concurrent access across multiple instances.
 *
 * @packageDocumentation
 * @module @vorion/cognigate/lua-scripts
 */

/**
 * Atomic increment with limit check.
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - Field name to increment (e.g., 'networkRequests', 'fileSystemOps')
 * ARGV[2] - Increment amount
 * ARGV[3] - Maximum allowed value (limit)
 *
 * Returns: [allowed (0 or 1), newValue]
 */
export const INCREMENT_AND_CHECK_LUA = `
local key = KEYS[1]
local field = ARGV[1]
local increment = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Get current value or default to 0
local current = tonumber(redis.call('HGET', key, field) or '0')
local newValue = current + increment

-- Check if within limit
if newValue <= limit then
  redis.call('HSET', key, field, tostring(newValue))
  return {1, newValue}
else
  return {0, current}
end
`;

/**
 * Update peak memory (only if higher than current peak).
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - New memory value in MB
 *
 * Returns: Current peak memory value
 */
export const UPDATE_MEMORY_PEAK_LUA = `
local key = KEYS[1]
local newMemory = tonumber(ARGV[1])

-- Get current peak or default to 0
local currentPeak = tonumber(redis.call('HGET', key, 'memoryPeakMb') or '0')

-- Update only if new value is higher
if newMemory > currentPeak then
  redis.call('HSET', key, 'memoryPeakMb', tostring(newMemory))
  return newMemory
else
  return currentPeak
end
`;

/**
 * Get all resource metrics atomically.
 *
 * KEYS[1] - The hash key for execution state
 *
 * Returns: [memoryPeakMb, cpuTimeMs, networkRequests, fileSystemOps, startTime]
 */
export const GET_RESOURCE_SNAPSHOT_LUA = `
local key = KEYS[1]

local memoryPeakMb = tonumber(redis.call('HGET', key, 'memoryPeakMb') or '0')
local cpuTimeMs = tonumber(redis.call('HGET', key, 'cpuTimeMs') or '0')
local networkRequests = tonumber(redis.call('HGET', key, 'networkRequests') or '0')
local fileSystemOps = tonumber(redis.call('HGET', key, 'fileSystemOps') or '0')
local startTime = tonumber(redis.call('HGET', key, 'startTime') or '0')

return {memoryPeakMb, cpuTimeMs, networkRequests, fileSystemOps, startTime}
`;

/**
 * Check all resource limits atomically and return violation if any.
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - Memory limit in MB
 * ARGV[2] - CPU time limit in milliseconds (calculated from percent and elapsed time)
 * ARGV[3] - Network requests limit
 * ARGV[4] - File system operations limit
 * ARGV[5] - Current timestamp for wall time calculation
 * ARGV[6] - Timeout in milliseconds
 *
 * Returns: [shouldTerminate (0 or 1), violationType, currentValue, limit]
 * violationType: 0=none, 1=memory, 2=cpu, 3=timeout, 4=network, 5=filesystem
 */
export const CHECK_LIMITS_LUA = `
local key = KEYS[1]
local memoryLimit = tonumber(ARGV[1])
local cpuTimeLimit = tonumber(ARGV[2])
local networkLimit = tonumber(ARGV[3])
local fsLimit = tonumber(ARGV[4])
local currentTime = tonumber(ARGV[5])
local timeoutMs = tonumber(ARGV[6])

-- Get all current values
local memoryPeakMb = tonumber(redis.call('HGET', key, 'memoryPeakMb') or '0')
local cpuTimeMs = tonumber(redis.call('HGET', key, 'cpuTimeMs') or '0')
local networkRequests = tonumber(redis.call('HGET', key, 'networkRequests') or '0')
local fileSystemOps = tonumber(redis.call('HGET', key, 'fileSystemOps') or '0')
local startTime = tonumber(redis.call('HGET', key, 'startTime') or '0')

-- Calculate wall time
local wallTimeMs = 0
if startTime > 0 then
  wallTimeMs = currentTime - startTime
end

-- Check memory limit
if memoryLimit > 0 and memoryPeakMb > memoryLimit then
  return {1, 1, memoryPeakMb, memoryLimit}
end

-- Check CPU time limit
if cpuTimeLimit > 0 and cpuTimeMs > cpuTimeLimit then
  return {1, 2, cpuTimeMs, cpuTimeLimit}
end

-- Check timeout
if timeoutMs > 0 and wallTimeMs > timeoutMs then
  return {1, 3, wallTimeMs, timeoutMs}
end

-- Check network requests limit
if networkLimit > 0 and networkRequests > networkLimit then
  return {1, 4, networkRequests, networkLimit}
end

-- Check file system operations limit
if fsLimit > 0 and fileSystemOps > fsLimit then
  return {1, 5, fileSystemOps, fsLimit}
end

-- No violations
return {0, 0, 0, 0}
`;

/**
 * Initialize execution state atomically.
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - Start time timestamp
 * ARGV[2] - TTL in seconds
 * ARGV[3] - Memory limit in MB
 * ARGV[4] - CPU percent limit
 * ARGV[5] - Timeout in milliseconds
 * ARGV[6] - Network requests limit (or -1 for unlimited)
 * ARGV[7] - File system ops limit (or -1 for unlimited)
 *
 * Returns: 1 on success
 */
export const INIT_EXECUTION_LUA = `
local key = KEYS[1]
local startTime = ARGV[1]
local ttl = tonumber(ARGV[2])
local memoryLimit = ARGV[3]
local cpuLimit = ARGV[4]
local timeoutMs = ARGV[5]
local networkLimit = ARGV[6]
local fsLimit = ARGV[7]

-- Set all initial values
redis.call('HMSET', key,
  'startTime', startTime,
  'memoryPeakMb', '0',
  'cpuTimeMs', '0',
  'networkRequests', '0',
  'fileSystemOps', '0',
  'memoryLimit', memoryLimit,
  'cpuLimit', cpuLimit,
  'timeoutMs', timeoutMs,
  'networkLimit', networkLimit,
  'fsLimit', fsLimit,
  'terminated', '0'
)

-- Set expiry
redis.call('EXPIRE', key, ttl)

return 1
`;

/**
 * Increment CPU time atomically.
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - Delta CPU time in milliseconds
 *
 * Returns: New total CPU time
 */
export const INCREMENT_CPU_TIME_LUA = `
local key = KEYS[1]
local delta = tonumber(ARGV[1])

local current = tonumber(redis.call('HGET', key, 'cpuTimeMs') or '0')
local newValue = current + delta
redis.call('HSET', key, 'cpuTimeMs', tostring(newValue))

return newValue
`;

/**
 * Mark execution as terminated.
 *
 * KEYS[1] - The hash key for execution state
 * ARGV[1] - Termination reason
 * ARGV[2] - Violation type
 *
 * Returns: 1 if marked, 0 if already terminated
 */
export const MARK_TERMINATED_LUA = `
local key = KEYS[1]
local reason = ARGV[1]
local violation = ARGV[2]

local terminated = redis.call('HGET', key, 'terminated')
if terminated == '1' then
  return 0
end

redis.call('HMSET', key,
  'terminated', '1',
  'terminationReason', reason,
  'terminationViolation', violation,
  'terminatedAt', tostring(redis.call('TIME')[1] * 1000)
)

return 1
`;

/**
 * Cleanup and get final metrics.
 *
 * KEYS[1] - The hash key for execution state
 *
 * Returns: [memoryPeakMb, cpuTimeMs, wallTimeMs, networkRequests, fileSystemOps]
 * (also deletes the key)
 */
export const CLEANUP_EXECUTION_LUA = `
local key = KEYS[1]

-- Get all values before deletion
local memoryPeakMb = tonumber(redis.call('HGET', key, 'memoryPeakMb') or '0')
local cpuTimeMs = tonumber(redis.call('HGET', key, 'cpuTimeMs') or '0')
local networkRequests = tonumber(redis.call('HGET', key, 'networkRequests') or '0')
local fileSystemOps = tonumber(redis.call('HGET', key, 'fileSystemOps') or '0')
local startTime = tonumber(redis.call('HGET', key, 'startTime') or '0')

-- Calculate wall time
local currentTime = redis.call('TIME')
local currentMs = tonumber(currentTime[1]) * 1000 + math.floor(tonumber(currentTime[2]) / 1000)
local wallTimeMs = 0
if startTime > 0 then
  wallTimeMs = currentMs - startTime
end

-- Delete the key
redis.call('DEL', key)

return {memoryPeakMb, cpuTimeMs, wallTimeMs, networkRequests, fileSystemOps}
`;
