/**
 * BASIS Expression Evaluator
 *
 * A secure expression evaluator that supports logical, comparison, and string operations.
 * This implementation avoids eval() and Function() for security.
 *
 * Supported syntax:
 * - Literals: true, false, numbers, strings (single or double quoted)
 * - Variables: entity.trustLevel, intent.context.foo, custom.bar
 * - Comparison: ==, !=, <, >, <=, >=
 * - Logical: AND, OR, NOT (or &&, ||, !)
 * - String operations: contains(), startsWith(), endsWith(), matches()
 * - Arithmetic: +, -, *, /, % (with proper precedence)
 * - Grouping: parentheses for precedence
 *
 * Examples:
 * - "entity.trustLevel >= 3"
 * - "intent.type == 'file_write' AND entity.trustLevel < 3"
 * - "NOT entity.attributes.verified"
 * - "contains(intent.goal, 'delete')"
 * - "(entity.trustScore >= 500 AND intent.priority < 5) OR custom.override"
 */

import { createLogger } from '../common/logger.js';
import type { EvaluationContext } from './types.js';

const logger = createLogger({ component: 'expression-evaluator' });

/**
 * Configuration for expression evaluation limits
 */
export interface ExpressionConfig {
  /** Maximum depth for nested expressions (default: 10) */
  maxDepth?: number;
  /** Maximum expression length in characters (default: 1000) */
  maxLength?: number;
  /** Timeout in milliseconds (default: 100ms) */
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<ExpressionConfig> = {
  maxDepth: 10,
  maxLength: 1000,
  timeoutMs: 100,
};

/**
 * Token types for the lexer
 */
enum TokenType {
  // Literals
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENTIFIER = 'IDENTIFIER',

  // Operators
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Comparison
  EQ = 'EQ', // ==
  NEQ = 'NEQ', // !=
  LT = 'LT', // <
  GT = 'GT', // >
  LTE = 'LTE', // <=
  GTE = 'GTE', // >=

  // Arithmetic
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  MULTIPLY = 'MULTIPLY',
  DIVIDE = 'DIVIDE',
  MODULO = 'MODULO',

  // Grouping
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  COMMA = 'COMMA',
  DOT = 'DOT',

  // Special
  EOF = 'EOF',
}

interface Token {
  type: TokenType;
  value: string | number | boolean;
  position: number;
}

/**
 * Expression evaluation error
 */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public position?: number,
    public expression?: string
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/**
 * Tokenize an expression string
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  const isWhitespace = (ch: string) => /\s/.test(ch);
  const isDigit = (ch: string) => /[0-9]/.test(ch);
  const isAlpha = (ch: string) => /[a-zA-Z_]/.test(ch);
  const isAlphaNumeric = (ch: string) => /[a-zA-Z0-9_]/.test(ch);

  while (pos < expression.length) {
    const ch = expression[pos]!;

    // Skip whitespace
    if (isWhitespace(ch)) {
      pos++;
      continue;
    }

    // Numbers
    if (isDigit(ch) || (ch === '-' && pos + 1 < expression.length && isDigit(expression[pos + 1]!))) {
      const start = pos;
      if (ch === '-') pos++;
      while (pos < expression.length && (isDigit(expression[pos]!) || expression[pos] === '.')) {
        pos++;
      }
      const numStr = expression.slice(start, pos);
      tokens.push({ type: TokenType.NUMBER, value: parseFloat(numStr), position: start });
      continue;
    }

    // Strings (single or double quoted)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = pos;
      pos++; // skip opening quote
      let str = '';
      while (pos < expression.length && expression[pos] !== quote) {
        if (expression[pos] === '\\' && pos + 1 < expression.length) {
          pos++; // skip backslash
          const escaped = expression[pos];
          switch (escaped) {
            case 'n':
              str += '\n';
              break;
            case 't':
              str += '\t';
              break;
            case 'r':
              str += '\r';
              break;
            default:
              str += escaped;
          }
        } else {
          str += expression[pos];
        }
        pos++;
      }
      if (pos >= expression.length) {
        throw new ExpressionError(`Unterminated string starting at position ${start}`, start, expression);
      }
      pos++; // skip closing quote
      tokens.push({ type: TokenType.STRING, value: str, position: start });
      continue;
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      const start = pos;
      while (pos < expression.length && isAlphaNumeric(expression[pos]!)) {
        pos++;
      }
      const word = expression.slice(start, pos);
      const upperWord = word.toUpperCase();

      // Keywords
      if (upperWord === 'TRUE') {
        tokens.push({ type: TokenType.TRUE, value: true, position: start });
      } else if (upperWord === 'FALSE') {
        tokens.push({ type: TokenType.FALSE, value: false, position: start });
      } else if (upperWord === 'AND') {
        tokens.push({ type: TokenType.AND, value: 'AND', position: start });
      } else if (upperWord === 'OR') {
        tokens.push({ type: TokenType.OR, value: 'OR', position: start });
      } else if (upperWord === 'NOT') {
        tokens.push({ type: TokenType.NOT, value: 'NOT', position: start });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: word, position: start });
      }
      continue;
    }

    // Multi-character operators
    if (pos + 1 < expression.length) {
      const twoChar = expression.slice(pos, pos + 2);
      if (twoChar === '==') {
        tokens.push({ type: TokenType.EQ, value: '==', position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === '!=') {
        tokens.push({ type: TokenType.NEQ, value: '!=', position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === '<=') {
        tokens.push({ type: TokenType.LTE, value: '<=', position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === '>=') {
        tokens.push({ type: TokenType.GTE, value: '>=', position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === '&&') {
        tokens.push({ type: TokenType.AND, value: '&&', position: pos });
        pos += 2;
        continue;
      }
      if (twoChar === '||') {
        tokens.push({ type: TokenType.OR, value: '||', position: pos });
        pos += 2;
        continue;
      }
    }

    // Single-character operators
    switch (ch) {
      case '<':
        tokens.push({ type: TokenType.LT, value: '<', position: pos });
        break;
      case '>':
        tokens.push({ type: TokenType.GT, value: '>', position: pos });
        break;
      case '!':
        tokens.push({ type: TokenType.NOT, value: '!', position: pos });
        break;
      case '(':
        tokens.push({ type: TokenType.LPAREN, value: '(', position: pos });
        break;
      case ')':
        tokens.push({ type: TokenType.RPAREN, value: ')', position: pos });
        break;
      case ',':
        tokens.push({ type: TokenType.COMMA, value: ',', position: pos });
        break;
      case '.':
        tokens.push({ type: TokenType.DOT, value: '.', position: pos });
        break;
      case '+':
        tokens.push({ type: TokenType.PLUS, value: '+', position: pos });
        break;
      case '-':
        tokens.push({ type: TokenType.MINUS, value: '-', position: pos });
        break;
      case '*':
        tokens.push({ type: TokenType.MULTIPLY, value: '*', position: pos });
        break;
      case '/':
        tokens.push({ type: TokenType.DIVIDE, value: '/', position: pos });
        break;
      case '%':
        tokens.push({ type: TokenType.MODULO, value: '%', position: pos });
        break;
      default:
        throw new ExpressionError(`Unexpected character '${ch}' at position ${pos}`, pos, expression);
    }
    pos++;
  }

  tokens.push({ type: TokenType.EOF, value: '', position: pos });
  return tokens;
}

/**
 * AST Node types
 */
type ASTNode =
  | { type: 'literal'; value: boolean | number | string }
  | { type: 'identifier'; path: string[] }
  | { type: 'unary'; operator: 'NOT' | '-'; operand: ASTNode }
  | { type: 'binary'; operator: string; left: ASTNode; right: ASTNode }
  | { type: 'call'; name: string; args: ASTNode[] };

/**
 * Parser for expressions
 */
class Parser {
  private tokens: Token[];
  private pos: number = 0;
  private nestingDepth: number = 0;  // Track actual nesting (parens, function calls)
  private maxDepth: number;
  private expression: string;

  constructor(tokens: Token[], expression: string, maxDepth: number) {
    this.tokens = tokens;
    this.expression = expression;
    this.maxDepth = maxDepth;
  }

  private current(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: '', position: 0 };
  }

  private advance(): Token {
    const token = this.current();
    if (token.type !== TokenType.EOF) {
      this.pos++;
    }
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new ExpressionError(
        `Expected ${type} but got ${token.type} at position ${token.position}`,
        token.position,
        this.expression
      );
    }
    return this.advance();
  }

  /**
   * Increment nesting depth and check limits.
   * Called when entering parentheses or function arguments.
   */
  private enterNesting(): void {
    this.nestingDepth++;
    if (this.nestingDepth > this.maxDepth) {
      throw new ExpressionError(
        `Expression exceeds maximum nesting depth of ${this.maxDepth}`,
        this.current().position,
        this.expression
      );
    }
  }

  /**
   * Decrement nesting depth when exiting.
   */
  private exitNesting(): void {
    this.nestingDepth--;
  }

  parse(): ASTNode {
    const result = this.parseOr();
    if (this.current().type !== TokenType.EOF) {
      throw new ExpressionError(
        `Unexpected token ${this.current().type} at position ${this.current().position}`,
        this.current().position,
        this.expression
      );
    }
    return result;
  }

  // Precedence (lowest to highest):
  // 1. OR
  // 2. AND
  // 3. Comparison (==, !=, <, >, <=, >=)
  // 4. Additive (+, -)
  // 5. Multiplicative (*, /, %)
  // 6. Unary (NOT, -)
  // 7. Primary (literals, identifiers, function calls, parenthesized expressions)

  private parseOr(): ASTNode {
    let left = this.parseAnd();

    while (this.current().type === TokenType.OR) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', operator: 'OR', left, right };
    }

    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseComparison();

    while (this.current().type === TokenType.AND) {
      this.advance();
      const right = this.parseComparison();
      left = { type: 'binary', operator: 'AND', left, right };
    }

    return left;
  }

  private parseComparison(): ASTNode {
    let left = this.parseAdditive();

    const comparisonOps = [
      TokenType.EQ,
      TokenType.NEQ,
      TokenType.LT,
      TokenType.GT,
      TokenType.LTE,
      TokenType.GTE,
    ];

    while (comparisonOps.includes(this.current().type)) {
      const op = this.advance();
      const right = this.parseAdditive();
      const opMap: Record<string, string> = {
        [TokenType.EQ]: '==',
        [TokenType.NEQ]: '!=',
        [TokenType.LT]: '<',
        [TokenType.GT]: '>',
        [TokenType.LTE]: '<=',
        [TokenType.GTE]: '>=',
      };
      left = { type: 'binary', operator: opMap[op.type] ?? op.type, left, right };
    }

    return left;
  }

  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();

    while (this.current().type === TokenType.PLUS || this.current().type === TokenType.MINUS) {
      const op = this.advance();
      const right = this.parseMultiplicative();
      left = { type: 'binary', operator: op.type === TokenType.PLUS ? '+' : '-', left, right };
    }

    return left;
  }

  private parseMultiplicative(): ASTNode {
    let left = this.parseUnary();

    while (
      this.current().type === TokenType.MULTIPLY ||
      this.current().type === TokenType.DIVIDE ||
      this.current().type === TokenType.MODULO
    ) {
      const op = this.advance();
      const right = this.parseUnary();
      const opMap: Record<string, string> = {
        [TokenType.MULTIPLY]: '*',
        [TokenType.DIVIDE]: '/',
        [TokenType.MODULO]: '%',
      };
      left = { type: 'binary', operator: opMap[op.type] ?? op.type, left, right };
    }
    return left;
  }

  private parseUnary(): ASTNode {
    if (this.current().type === TokenType.NOT) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', operator: 'NOT', operand };
    } else if (this.current().type === TokenType.MINUS) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'unary', operator: '-', operand };
    } else {
      return this.parsePrimary();
    }
  }

  private parsePrimary(): ASTNode {
    const token = this.current();

    switch (token.type) {
      case TokenType.TRUE:
        this.advance();
        return { type: 'literal', value: true };

      case TokenType.FALSE:
        this.advance();
        return { type: 'literal', value: false };

      case TokenType.NUMBER:
        this.advance();
        return { type: 'literal', value: token.value as number };

      case TokenType.STRING:
        this.advance();
        return { type: 'literal', value: token.value as string };

      case TokenType.IDENTIFIER:
        return this.parseIdentifierOrCall();

      case TokenType.LPAREN:
        // Track nesting for parenthesized expressions
        this.enterNesting();
        this.advance();
        const result = this.parseOr();
        this.expect(TokenType.RPAREN);
        this.exitNesting();
        return result;

      default:
        throw new ExpressionError(
          `Unexpected token ${token.type} at position ${token.position}`,
          token.position,
          this.expression
        );
    }
  }

  private parseIdentifierOrCall(): ASTNode {
    const path: string[] = [];

    // Parse first identifier
    const first = this.expect(TokenType.IDENTIFIER);
    path.push(first.value as string);

    // Parse dotted path
    while (this.current().type === TokenType.DOT) {
      this.advance();
      const next = this.expect(TokenType.IDENTIFIER);
      path.push(next.value as string);
    }

    // Check if it's a function call
    if (this.current().type === TokenType.LPAREN) {
      // It's a function call - the entire path is the function name
      // Track nesting for function arguments
      this.enterNesting();
      const funcName = path.join('.');
      this.advance(); // consume '('

      const args: ASTNode[] = [];
      if (this.current().type !== TokenType.RPAREN) {
        args.push(this.parseOr());
        while (this.current().type === TokenType.COMMA) {
          this.advance();
          args.push(this.parseOr());
        }
      }
      this.expect(TokenType.RPAREN);
      this.exitNesting();
      return { type: 'call', name: funcName, args };
    }

    return { type: 'identifier', path };
  }
}

/**
 * Evaluate an AST node against a context
 */
function evaluateNode(
  node: ASTNode,
  context: EvaluationContext,
  startTime: number,
  timeoutMs: number
): unknown {
  // Check timeout
  if (Date.now() - startTime > timeoutMs) {
    throw new ExpressionError(`Expression evaluation timed out after ${timeoutMs}ms`);
  }

  switch (node.type) {
    case 'literal':
      return node.value;

    case 'identifier':
      return resolveIdentifier(node.path, context);

    case 'unary':
      const operand = evaluateNode(node.operand, context, startTime, timeoutMs);
      if (node.operator === 'NOT') {
        return !toBoolean(operand);
      }
      if (node.operator === '-') {
        return -toNumber(operand);
      }
      throw new ExpressionError(`Unknown unary operator: ${node.operator}`);

    case 'binary':
      return evaluateBinary(node, context, startTime, timeoutMs);

    case 'call':
      return evaluateCall(node, context, startTime, timeoutMs);

    default:
      throw new ExpressionError(`Unknown node type: ${(node as ASTNode).type}`);
  }
}

/**
 * Evaluate a binary operation
 */
function evaluateBinary(
  node: { type: 'binary'; operator: string; left: ASTNode; right: ASTNode },
  context: EvaluationContext,
  startTime: number,
  timeoutMs: number
): unknown {
  // Short-circuit evaluation for logical operators
  if (node.operator === 'AND') {
    const leftVal = evaluateNode(node.left, context, startTime, timeoutMs);
    if (!toBoolean(leftVal)) return false;
    return toBoolean(evaluateNode(node.right, context, startTime, timeoutMs));
  }

  if (node.operator === 'OR') {
    const leftVal = evaluateNode(node.left, context, startTime, timeoutMs);
    if (toBoolean(leftVal)) return true;
    return toBoolean(evaluateNode(node.right, context, startTime, timeoutMs));
  }

  // Evaluate both sides for other operators
  const left = evaluateNode(node.left, context, startTime, timeoutMs);
  const right = evaluateNode(node.right, context, startTime, timeoutMs);

  switch (node.operator) {
    // Comparison operators
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return toNumber(left) < toNumber(right);
    case '>':
      return toNumber(left) > toNumber(right);
    case '<=':
      return toNumber(left) <= toNumber(right);
    case '>=':
      return toNumber(left) >= toNumber(right);

    // Arithmetic operators
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return String(left) + String(right);
      }
      return toNumber(left) + toNumber(right);
    case '-':
      return toNumber(left) - toNumber(right);
    case '*':
      return toNumber(left) * toNumber(right);
    case '/':
      const divisor = toNumber(right);
      if (divisor === 0) {
        throw new ExpressionError('Division by zero');
      }
      return toNumber(left) / divisor;
    case '%':
      const modDivisor = toNumber(right);
      if (modDivisor === 0) {
        throw new ExpressionError('Modulo by zero');
      }
      return toNumber(left) % modDivisor;

    default:
      throw new ExpressionError(`Unknown binary operator: ${node.operator}`);
  }
}

/**
 * Evaluate a function call
 */
function evaluateCall(
  node: { type: 'call'; name: string; args: ASTNode[] },
  context: EvaluationContext,
  startTime: number,
  timeoutMs: number
): unknown {
  const args = node.args.map((arg) => evaluateNode(arg, context, startTime, timeoutMs));
  const funcName = node.name.toLowerCase();

  switch (funcName) {
    case 'contains':
      if (args.length !== 2) {
        throw new ExpressionError(`contains() requires 2 arguments, got ${args.length}`);
      }
      return String(args[0]).includes(String(args[1]));

    case 'startswith':
      if (args.length !== 2) {
        throw new ExpressionError(`startsWith() requires 2 arguments, got ${args.length}`);
      }
      return String(args[0]).startsWith(String(args[1]));

    case 'endswith':
      if (args.length !== 2) {
        throw new ExpressionError(`endsWith() requires 2 arguments, got ${args.length}`);
      }
      return String(args[0]).endsWith(String(args[1]));

    case 'matches':
      if (args.length !== 2) {
        throw new ExpressionError(`matches() requires 2 arguments, got ${args.length}`);
      }
      try {
        const regex = new RegExp(String(args[1]));
        return regex.test(String(args[0]));
      } catch (e) {
        throw new ExpressionError(`Invalid regex pattern: ${args[1]}`);
      }

    case 'length':
      if (args.length !== 1) {
        throw new ExpressionError(`length() requires 1 argument, got ${args.length}`);
      }
      if (Array.isArray(args[0])) {
        return args[0].length;
      }
      return String(args[0]).length;

    case 'lower':
      if (args.length !== 1) {
        throw new ExpressionError(`lower() requires 1 argument, got ${args.length}`);
      }
      return String(args[0]).toLowerCase();

    case 'upper':
      if (args.length !== 1) {
        throw new ExpressionError(`upper() requires 1 argument, got ${args.length}`);
      }
      return String(args[0]).toUpperCase();

    case 'trim':
      if (args.length !== 1) {
        throw new ExpressionError(`trim() requires 1 argument, got ${args.length}`);
      }
      return String(args[0]).trim();

    case 'abs':
      if (args.length !== 1) {
        throw new ExpressionError(`abs() requires 1 argument, got ${args.length}`);
      }
      return Math.abs(toNumber(args[0]));

    case 'min':
      if (args.length < 2) {
        throw new ExpressionError(`min() requires at least 2 arguments`);
      }
      return Math.min(...args.map(toNumber));

    case 'max':
      if (args.length < 2) {
        throw new ExpressionError(`max() requires at least 2 arguments`);
      }
      return Math.max(...args.map(toNumber));

    case 'exists':
      if (args.length !== 1) {
        throw new ExpressionError(`exists() requires 1 argument, got ${args.length}`);
      }
      return args[0] !== undefined && args[0] !== null;

    case 'isempty':
      if (args.length !== 1) {
        throw new ExpressionError(`isEmpty() requires 1 argument, got ${args.length}`);
      }
      const val = args[0];
      if (val === undefined || val === null) return true;
      if (typeof val === 'string') return val.length === 0;
      if (Array.isArray(val)) return val.length === 0;
      if (typeof val === 'object') return Object.keys(val).length === 0;
      return false;

    case 'typeof':
      if (args.length !== 1) {
        throw new ExpressionError(`typeof() requires 1 argument, got ${args.length}`);
      }
      const value = args[0];
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      return typeof value;

    default:
      throw new ExpressionError(`Unknown function: ${node.name}`);
  }
}

/**
 * Resolve an identifier path against the context
 */
function resolveIdentifier(path: string[], context: EvaluationContext): unknown {
  let current: unknown = context;

  for (const part of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Convert a value to boolean
 */
function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/**
 * Convert a value to number
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (isNaN(num)) {
      throw new ExpressionError(`Cannot convert '${value}' to number`);
    }
    return num;
  }
  throw new ExpressionError(`Cannot convert ${typeof value} to number`);
}

/**
 * Evaluate an expression string against a context
 *
 * @param expression - The expression string to evaluate
 * @param context - The evaluation context containing variables
 * @param config - Optional configuration for limits
 * @returns The result of evaluating the expression (coerced to boolean for rule evaluation)
 */
export function evaluateExpression(
  expression: string,
  context: EvaluationContext,
  config: ExpressionConfig = {}
): boolean {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Input validation
  if (!expression || typeof expression !== 'string') {
    throw new ExpressionError('Expression must be a non-empty string');
  }

  if (expression.length > mergedConfig.maxLength) {
    throw new ExpressionError(`Expression exceeds maximum length of ${mergedConfig.maxLength} characters`);
  }

  // Handle simple true/false literals without parsing
  const trimmed = expression.trim();
  if (trimmed.toLowerCase() === 'true') return true;
  if (trimmed.toLowerCase() === 'false') return false;

  try {
    const startTime = Date.now();

    // Tokenize
    const tokens = tokenize(expression);

    // Parse
    const parser = new Parser(tokens, expression, mergedConfig.maxDepth);
    const ast = parser.parse();

    // Evaluate
    const result = evaluateNode(ast, context, startTime, mergedConfig.timeoutMs);

    // Coerce result to boolean
    return toBoolean(result);
  } catch (error) {
    if (error instanceof ExpressionError) {
      logger.warn({ expression, error: error.message }, 'Expression evaluation failed');
      throw error;
    }
    logger.error({ expression, error }, 'Unexpected error during expression evaluation');
    throw new ExpressionError(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate an expression without evaluating it
 *
 * @param expression - The expression to validate
 * @param config - Optional configuration for limits
 * @returns Validation result with any errors
 */
export function validateExpression(
  expression: string,
  config: ExpressionConfig = {}
): { valid: boolean; errors: string[] } {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  if (!expression || typeof expression !== 'string') {
    return { valid: false, errors: ['Expression must be a non-empty string'] };
  }

  if (expression.length > mergedConfig.maxLength) {
    return {
      valid: false,
      errors: [`Expression exceeds maximum length of ${mergedConfig.maxLength} characters`],
    };
  }

  // Simple literals are always valid
  const trimmed = expression.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === 'false') {
    return { valid: true, errors: [] };
  }

  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens, expression, mergedConfig.maxDepth);
    parser.parse();
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { valid: false, errors: [error.message] };
    }
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

/**
 * Get detailed evaluation result (for debugging)
 *
 * @param expression - The expression to evaluate
 * @param context - The evaluation context
 * @param config - Optional configuration
 * @returns Detailed result including the raw value
 */
export function evaluateExpressionDetailed(
  expression: string,
  context: EvaluationContext,
  config: ExpressionConfig = {}
): { success: boolean; value: unknown; booleanResult: boolean; error?: string } {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    if (!expression || typeof expression !== 'string') {
      throw new ExpressionError('Expression must be a non-empty string');
    }

    if (expression.length > mergedConfig.maxLength) {
      throw new ExpressionError(`Expression exceeds maximum length of ${mergedConfig.maxLength} characters`);
    }

    const trimmed = expression.trim();
    if (trimmed.toLowerCase() === 'true') {
      return { success: true, value: true, booleanResult: true };
    }
    if (trimmed.toLowerCase() === 'false') {
      return { success: true, value: false, booleanResult: false };
    }

    const startTime = Date.now();
    const tokens = tokenize(expression);
    const parser = new Parser(tokens, expression, mergedConfig.maxDepth);
    const ast = parser.parse();
    const value = evaluateNode(ast, context, startTime, mergedConfig.timeoutMs);

    return {
      success: true,
      value,
      booleanResult: toBoolean(value),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      value: undefined,
      booleanResult: false,
      error: message,
    };
  }
}
