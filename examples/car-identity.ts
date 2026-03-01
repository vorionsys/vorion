/**
 * CAR (Contextual Authority Record) Identity Example
 *
 * Demonstrates the CAR identity system from @vorionsys/contracts:
 *   1. Generate CAR strings from components
 *   2. Parse CAR strings into structured data
 *   3. Validate CAR strings with detailed error reporting
 *   4. Manipulate CAR strings (update, version increment, extensions)
 *   5. Work with capability levels (L0-L7) and domain codes (A-Z)
 *   6. Create agent identities from CAR strings
 *
 * CAR Format:
 *   {registry}.{organization}.{agentClass}:{domains}-L{level}@{version}[#extensions]
 *
 * Example:
 *   a3i.acme-corp.invoice-bot:ABF-L3@1.0.0
 *   ^^^  ^^^^^^^^  ^^^^^^^^^^^  ^^^  ^  ^^^^^
 *    |      |          |         |   |    |
 *    |      |          |         |   |    +-- semantic version
 *    |      |          |         |   +------- capability level (L0-L7)
 *    |      |          |         +----------- domain codes (A-Z)
 *    |      |          +--------------------- agent classification
 *    |      +-------------------------------- organization
 *    +--------------------------------------- certifying registry
 *
 * IMPORTANT: Trust is NOT embedded in the CAR string. Trust is computed
 * at runtime from attestations, behavioral signals, and deployment context.
 *
 * Run:  npx tsx examples/car-identity.ts
 */

import {
  // CAR string functions
  generateCAR,
  parseCAR,
  tryParseCAR,
  safeParseCAR,
  validateCAR,
  isValidCAR,
  updateCAR,
  incrementCARVersion,
  addCARExtensions,
  removeCARExtensions,
  getCARIdentity,

  // Capability levels
  CapabilityLevel,
  getLevelName,
  hasAbility,
  requiresApproval,
  canOperateAutonomously,
  parseLevel,
  CAPABILITY_LEVEL_ABILITIES,

  // Domain codes
  getDomainName,

  // Identity
  createAgentIdentity,
  toAgentIdentitySummary,

  // Types
  type ParsedCAR,
  type CARValidationResult,
  type AgentIdentity,
  type DomainCode,
} from '@vorionsys/contracts/car';

function main(): void {
  generateCARDemo();
  parseCARDemo();
  validateCARDemo();
  manipulateCARDemo();
  capabilityLevelsDemo();
  domainCodesDemo();
  agentIdentityDemo();
}

// ---------------------------------------------------------------------------
// 1. Generate CAR strings
// ---------------------------------------------------------------------------

function generateCARDemo(): void {
  console.log('=== 1. Generating CAR Strings ===\n');

  // Generate a CAR string from individual components.
  const car = generateCAR({
    registry: 'a3i',              // certifying registry
    organization: 'acme-corp',    // operating organization
    agentClass: 'invoice-bot',    // agent classification
    domains: ['A', 'B', 'F'] as DomainCode[], // Administration, Business, Finance
    level: CapabilityLevel.L3_EXECUTE,         // can execute with approval
    version: '1.0.0',
  });

  console.log('Generated CAR:', car);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.0.0

  // With optional extensions (industry/community defined, mutable)
  const carWithExt = generateCAR({
    registry: 'a3i',
    organization: 'acme-corp',
    agentClass: 'invoice-bot',
    domains: ['A', 'B', 'F'] as DomainCode[],
    level: CapabilityLevel.L3_EXECUTE,
    version: '1.0.0',
    extensions: ['gov', 'audit'],
  });

  console.log('With extensions:', carWithExt);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.0.0#gov,audit

  // A security agent with higher autonomy
  const securityCar = generateCAR({
    registry: 'vorion',
    organization: 'sec-team',
    agentClass: 'threat-scanner',
    domains: ['S', 'I', 'G'] as DomainCode[], // Security, Infrastructure, Governance
    level: CapabilityLevel.L5_TRUSTED,
    version: '2.1.0',
  });

  console.log('Security agent:', securityCar);
  // => vorion.sec-team.threat-scanner:GIS-L5@2.1.0
  // Note: domains are sorted alphabetically in the output
}

// ---------------------------------------------------------------------------
// 2. Parse CAR strings
// ---------------------------------------------------------------------------

function parseCARDemo(): void {
  console.log('\n=== 2. Parsing CAR Strings ===\n');

  // Parse a CAR string into its structured components.
  const parsed: ParsedCAR = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');

  console.log('Parsed components:');
  console.log(`  CAR:           ${parsed.car}`);
  console.log(`  Registry:      ${parsed.registry}`);
  console.log(`  Organization:  ${parsed.organization}`);
  console.log(`  Agent class:   ${parsed.agentClass}`);
  console.log(`  Domains:       ${parsed.domains.join(', ')}`);
  console.log(`  Domains mask:  0x${parsed.domainsBitmask.toString(16)}`);
  console.log(`  Level:         L${parsed.level} (${getLevelName(parsed.level)})`);
  console.log(`  Version:       ${parsed.version}`);
  console.log(`  Extensions:    ${parsed.extensions.length > 0 ? parsed.extensions.join(', ') : 'none'}`);

  // Extract the identity portion (registry.organization.agentClass)
  const identity = getCARIdentity(parsed);
  console.log(`  Identity:      ${identity}`);

  // tryParseCAR returns null on invalid input instead of throwing
  const invalid = tryParseCAR('not-a-valid-car');
  console.log(`\ntryParseCAR('not-a-valid-car'):`, invalid);  // null

  // safeParseCAR returns a result object with success/error
  const safeResult = safeParseCAR('a3i.acme-corp.bot:A-L0@1.0.0');
  if (safeResult.success) {
    console.log('safeParseCAR succeeded:', safeResult.data.agentClass);
  }

  const safeFail = safeParseCAR('bad-input');
  if (!safeFail.success) {
    console.log('safeParseCAR failed:', safeFail.error.code, '-', safeFail.error.message);
  }
}

// ---------------------------------------------------------------------------
// 3. Validate CAR strings
// ---------------------------------------------------------------------------

function validateCARDemo(): void {
  console.log('\n=== 3. Validating CAR Strings ===\n');

  // validateCAR returns detailed errors and warnings.
  const result: CARValidationResult = validateCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');
  console.log('Valid CAR:');
  console.log(`  Valid:    ${result.valid}`);
  console.log(`  Errors:  ${result.errors.length}`);
  console.log(`  Warnings: ${result.warnings.length}`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`    [${w.code}] ${w.message}`);
    }
  }

  // Finance domain triggers a warning about runtime trust configuration
  const financeResult = validateCAR('a3i.acme-corp.finance-bot:F-L4@1.0.0');
  console.log('\nFinance domain CAR:');
  console.log(`  Valid:     ${financeResult.valid}`);
  console.log(`  Warnings:  ${financeResult.warnings.length}`);
  for (const w of financeResult.warnings) {
    console.log(`    [${w.code}] ${w.message}`);
  }

  // L7 (Sovereign/Autonomous) triggers a warning
  const l7Result = validateCAR('a3i.acme-corp.admin-bot:A-L7@1.0.0');
  console.log('\nL7 Autonomous CAR:');
  for (const w of l7Result.warnings) {
    console.log(`  [${w.code}] ${w.message}`);
  }

  // Invalid CAR string
  const invalidResult = validateCAR('this-is-not-valid');
  console.log('\nInvalid CAR:');
  console.log(`  Valid:  ${invalidResult.valid}`);
  for (const e of invalidResult.errors) {
    console.log(`  [${e.code}] ${e.message}`);
  }

  // Quick boolean check
  console.log('\nisValidCAR checks:');
  console.log(`  'a3i.acme-corp.bot:A-L3@1.0.0' -> ${isValidCAR('a3i.acme-corp.bot:A-L3@1.0.0')}`);
  console.log(`  'invalid'                       -> ${isValidCAR('invalid')}`);
}

// ---------------------------------------------------------------------------
// 4. Manipulate CAR strings
// ---------------------------------------------------------------------------

function manipulateCARDemo(): void {
  console.log('\n=== 4. Manipulating CAR Strings ===\n');

  const original = 'a3i.acme-corp.invoice-bot:ABF-L3@1.0.0';
  console.log('Original:', original);

  // Update the capability level
  const upgraded = updateCAR(original, {
    level: CapabilityLevel.L5_TRUSTED,
  });
  console.log('Upgraded level:', upgraded);
  // => a3i.acme-corp.invoice-bot:ABF-L5@1.0.0

  // Update the version
  const newVersion = updateCAR(original, {
    version: '2.0.0',
  });
  console.log('New version:', newVersion);

  // Increment version (patch, minor, or major)
  const patched = incrementCARVersion(original, 'patch');
  console.log('Patch bump:', patched);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.0.1

  const minored = incrementCARVersion(original, 'minor');
  console.log('Minor bump:', minored);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.1.0

  const majored = incrementCARVersion(original, 'major');
  console.log('Major bump:', majored);
  // => a3i.acme-corp.invoice-bot:ABF-L3@2.0.0

  // Add extensions
  const withExt = addCARExtensions(original, ['hipaa', 'pci']);
  console.log('Added extensions:', withExt);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.0.0#hipaa,pci

  // Remove extensions
  const withoutPci = removeCARExtensions(withExt, ['pci']);
  console.log('Removed pci:', withoutPci);
  // => a3i.acme-corp.invoice-bot:ABF-L3@1.0.0#hipaa

  // Add new domains
  const moreDomains = updateCAR(original, {
    domains: ['A', 'B', 'D', 'F', 'G'] as DomainCode[],
  });
  console.log('More domains:', moreDomains);
  // => a3i.acme-corp.invoice-bot:ABDFG-L3@1.0.0
}

// ---------------------------------------------------------------------------
// 5. Capability levels (L0-L7)
// ---------------------------------------------------------------------------

function capabilityLevelsDemo(): void {
  console.log('\n=== 5. Capability Levels (L0-L7) ===\n');

  // Each capability level defines what an agent can do.
  const levels = [
    CapabilityLevel.L0_OBSERVE,
    CapabilityLevel.L1_ADVISE,
    CapabilityLevel.L2_DRAFT,
    CapabilityLevel.L3_EXECUTE,
    CapabilityLevel.L4_AUTONOMOUS,
    CapabilityLevel.L5_TRUSTED,
    CapabilityLevel.L6_CERTIFIED,
    CapabilityLevel.L7_AUTONOMOUS,
  ];

  for (const level of levels) {
    const name = getLevelName(level);
    const approval = requiresApproval(level);
    const autonomous = canOperateAutonomously(level);
    console.log(
      `  L${level}: ${name.padEnd(10)} | ` +
      `Approval: ${approval ? 'yes' : 'no '.padEnd(3)} | ` +
      `Autonomous: ${autonomous ? 'yes' : 'no'}`
    );
  }

  // Check specific abilities at a given level
  console.log('\nAbility checks for L3 (Execute):');
  const l3 = CapabilityLevel.L3_EXECUTE;
  console.log(`  Can read?            ${hasAbility(l3, 'read')}`);                    // true
  console.log(`  Can execute?         ${hasAbility(l3, 'execute_with_approval')}`);    // true
  console.log(`  Can execute_any?     ${hasAbility(l3, 'execute_any')}`);              // false (L7 only)
  console.log(`  Can spawn agents?    ${hasAbility(l3, 'spawn_agents')}`);             // false (L6+)

  // List all abilities at L4 (Autonomous)
  const l4Abilities = CAPABILITY_LEVEL_ABILITIES[CapabilityLevel.L4_AUTONOMOUS];
  console.log('\nAll abilities at L4 (Autonomous):');
  console.log(`  ${l4Abilities.join(', ')}`);

  // Parse level from string
  const parsed = parseLevel('L3');
  console.log(`\nparseLevel('L3') = ${parsed} (${getLevelName(parsed)})`);

  const parsed2 = parseLevel('5');
  console.log(`parseLevel('5')  = ${parsed2} (${getLevelName(parsed2)})`);
}

// ---------------------------------------------------------------------------
// 6. Domain codes (A-Z)
// ---------------------------------------------------------------------------

function domainCodesDemo(): void {
  console.log('\n=== 6. Domain Codes ===\n');

  // Each single-character code represents a capability domain.
  const exampleDomains: DomainCode[] = ['A', 'B', 'D', 'F', 'G', 'S'];

  console.log('Domain code reference (selected):');
  for (const code of exampleDomains) {
    console.log(`  ${code}: ${getDomainName(code)}`);
  }

  // When parsed from a CAR, domains also have a bitmask for efficient matching.
  const parsed = parseCAR('a3i.acme-corp.bot:ABFS-L3@1.0.0');
  console.log(`\nDomains from CAR: ${parsed.domains.join(', ')}`);
  console.log(`Bitmask: 0x${parsed.domainsBitmask.toString(16).padStart(8, '0')}`);
}

// ---------------------------------------------------------------------------
// 7. Agent identity from CAR
// ---------------------------------------------------------------------------

function agentIdentityDemo(): void {
  console.log('\n=== 7. Agent Identity from CAR ===\n');

  // Parse the CAR string first
  const parsed = parseCAR('a3i.acme-corp.invoice-bot:ABF-L3@1.0.0');

  // Create a full agent identity from registration options and parsed CAR.
  // The identity combines CAR, DID, capabilities, and attestations.
  const identity: AgentIdentity = createAgentIdentity(
    {
      car: parsed.car,
      did: 'did:vorion:acme-corp:invoice-bot-001',
      serviceEndpoint: 'https://agents.acme-corp.com/invoice-bot',
      metadata: {
        description: 'Invoice processing and compliance agent',
        version: '1.0.0',
        organization: 'Acme Corp',
      },
      attestations: [],  // attestations determine trust at runtime
    },
    parsed, // pre-parsed CAR for efficiency
  );

  console.log('Agent identity:');
  console.log(`  CAR:        ${identity.car}`);
  console.log(`  DID:        ${identity.did}`);
  console.log(`  Domains:    ${identity.capabilities.domains.join(', ')}`);
  console.log(`  Level:      L${identity.capabilities.level} (${getLevelName(identity.capabilities.level)})`);
  console.log(`  Active:     ${identity.active}`);
  console.log(`  Created:    ${identity.created.toISOString()}`);
  console.log(`  Endpoint:   ${identity.serviceEndpoint}`);
  console.log(`  Org:        ${identity.metadata?.organization}`);

  // Create a lightweight summary for listings and search results
  const summary = toAgentIdentitySummary(identity);
  console.log('\nIdentity summary:');
  console.log(`  CAR:     ${summary.car}`);
  console.log(`  DID:     ${summary.did}`);
  console.log(`  Domains: ${summary.domains.join(', ')}`);
  console.log(`  Level:   L${summary.level}`);
  console.log(`  Active:  ${summary.active}`);

  // NOTE: Trust tier is NOT part of the CAR or identity.
  // It is computed at runtime from attestations and behavioral signals.
  // This is a deliberate design decision -- the CAR is an immutable
  // identifier (like a certificate), not a trust indicator.
  console.log('\nNote: Trust tier is computed at runtime, not stored in the CAR.');
  console.log('Same agent can have different trust levels in different deployments.');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main();
