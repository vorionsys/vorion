/**
 * Vorion Security SDK - DSL Parser
 * Parse policy DSL to AST and compile to policy engine format
 */

import {
  PolicyAST,
  ConditionAST,
  RequirementAST,
  ActionAST,
  ExpressionAST,
  PolicyDefinition,
  PolicyCondition,
  PolicyRequirement,
  PolicyAction,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '../types';

// ============================================================================
// Token Types
// ============================================================================

type TokenType =
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'KEYWORD'
  | 'OPERATOR'
  | 'PUNCTUATION'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS = new Set([
  'policy',
  'when',
  'and',
  'or',
  'not',
  'require',
  'then',
  'otherwise',
  'allow',
  'deny',
  'challenge',
  'audit',
  'true',
  'false',
  'null',
  'mfa',
  'approval',
  'permission',
  'description',
  'version',
  'priority',
  'tags',
  'enabled',
]);

const OPERATORS = new Set([
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  '&&',
  '||',
  '!',
  '.',
  ':',
  '->',
  '=>',
]);

// ============================================================================
// Lexer
// ============================================================================

export class Lexer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      this.skipComments();

      if (this.pos >= this.input.length) break;

      const char = this.input[this.pos];

      if (this.isLetter(char) || char === '_') {
        this.readIdentifier();
      } else if (this.isDigit(char)) {
        this.readNumber();
      } else if (char === '"' || char === "'") {
        this.readString(char);
      } else if (this.isOperatorStart(char)) {
        this.readOperator();
      } else if (this.isPunctuation(char)) {
        this.tokens.push({
          type: 'PUNCTUATION',
          value: char,
          line: this.line,
          column: this.column,
        });
        this.advance();
      } else {
        throw new SyntaxError(
          `Unexpected character '${char}' at line ${this.line}, column ${this.column}`
        );
      }
    }

    this.tokens.push({
      type: 'EOF',
      value: '',
      line: this.line,
      column: this.column,
    });

    return this.tokens;
  }

  private advance(): string {
    const char = this.input[this.pos];
    this.pos++;
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private peek(offset: number = 0): string {
    return this.input[this.pos + offset] || '';
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.advance();
    }
  }

  private skipComments(): void {
    if (this.peek() === '/' && this.peek(1) === '/') {
      while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
        this.advance();
      }
      this.skipWhitespace();
      this.skipComments();
    } else if (this.peek() === '/' && this.peek(1) === '*') {
      this.advance(); // /
      this.advance(); // *
      while (
        this.pos < this.input.length &&
        !(this.peek() === '*' && this.peek(1) === '/')
      ) {
        this.advance();
      }
      if (this.pos < this.input.length) {
        this.advance(); // *
        this.advance(); // /
      }
      this.skipWhitespace();
      this.skipComments();
    }
  }

  private isLetter(char: string): boolean {
    return /[a-zA-Z]/.test(char);
  }

  private isDigit(char: string): boolean {
    return /[0-9]/.test(char);
  }

  private isOperatorStart(char: string): boolean {
    return /[=!<>&|.:\-]/.test(char);
  }

  private isPunctuation(char: string): boolean {
    return /[(){}\[\],;]/.test(char);
  }

  private readIdentifier(): void {
    const startLine = this.line;
    const startColumn = this.column;
    let value = '';

    while (
      this.pos < this.input.length &&
      (/[a-zA-Z0-9_]/.test(this.input[this.pos]) || this.input[this.pos] === '-')
    ) {
      value += this.advance();
    }

    if (KEYWORDS.has(value.toLowerCase())) {
      if (value === 'true' || value === 'false') {
        this.tokens.push({
          type: 'BOOLEAN',
          value,
          line: startLine,
          column: startColumn,
        });
      } else {
        this.tokens.push({
          type: 'KEYWORD',
          value: value.toLowerCase(),
          line: startLine,
          column: startColumn,
        });
      }
    } else {
      this.tokens.push({
        type: 'IDENTIFIER',
        value,
        line: startLine,
        column: startColumn,
      });
    }
  }

  private readNumber(): void {
    const startLine = this.line;
    const startColumn = this.column;
    let value = '';

    while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
      value += this.advance();
    }

    this.tokens.push({
      type: 'NUMBER',
      value,
      line: startLine,
      column: startColumn,
    });
  }

  private readString(quote: string): void {
    const startLine = this.line;
    const startColumn = this.column;
    let value = '';

    this.advance(); // Opening quote

    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') {
        this.advance();
        const escaped = this.advance();
        switch (escaped) {
          case 'n':
            value += '\n';
            break;
          case 't':
            value += '\t';
            break;
          case 'r':
            value += '\r';
            break;
          default:
            value += escaped;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.pos >= this.input.length) {
      throw new SyntaxError(
        `Unterminated string at line ${startLine}, column ${startColumn}`
      );
    }

    this.advance(); // Closing quote

    this.tokens.push({
      type: 'STRING',
      value,
      line: startLine,
      column: startColumn,
    });
  }

  private readOperator(): void {
    const startLine = this.line;
    const startColumn = this.column;
    let value = this.advance();

    // Check for two-character operators
    const twoChar = value + this.peek();
    if (OPERATORS.has(twoChar)) {
      value += this.advance();
    }

    this.tokens.push({
      type: 'OPERATOR',
      value,
      line: startLine,
      column: startColumn,
    });
  }
}

// ============================================================================
// Parser
// ============================================================================

export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;

  parse(input: string): PolicyAST {
    const lexer = new Lexer(input);
    this.tokens = lexer.tokenize();
    this.pos = 0;

    return this.parsePolicy();
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private peek(offset: number = 1): Token {
    return (
      this.tokens[this.pos + offset] || { type: 'EOF', value: '', line: 0, column: 0 }
    );
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      throw new SyntaxError(
        `Expected ${type}${value ? ` '${value}'` : ''} but got ${token.type} '${token.value}' at line ${token.line}, column ${token.column}`
      );
    }
    return this.advance();
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.current();
    return token.type === type && (value === undefined || token.value === value);
  }

  private parsePolicy(): PolicyAST {
    const startToken = this.current();

    this.expect('KEYWORD', 'policy');
    const idToken = this.expect('IDENTIFIER');
    const id = idToken.value;

    this.expect('PUNCTUATION', '{');

    let description: string | undefined;
    const conditions: ConditionAST[] = [];
    const requirements: RequirementAST[] = [];
    let thenAction: ActionAST = {
      type: 'Action',
      outcome: 'allow',
    };
    let otherwiseAction: ActionAST | undefined;

    while (!this.match('PUNCTUATION', '}') && !this.match('EOF', '')) {
      if (this.match('KEYWORD', 'description')) {
        this.advance();
        this.expect('OPERATOR', ':');
        description = this.expect('STRING').value;
      } else if (this.match('KEYWORD', 'when')) {
        this.advance();
        conditions.push(this.parseCondition());
      } else if (this.match('KEYWORD', 'and')) {
        this.advance();
        const condition = this.parseCondition();
        condition.operator = 'and';
        conditions.push(condition);
      } else if (this.match('KEYWORD', 'or')) {
        this.advance();
        const condition = this.parseCondition();
        condition.operator = 'or';
        conditions.push(condition);
      } else if (this.match('KEYWORD', 'require')) {
        this.advance();
        requirements.push(this.parseRequirement());
      } else if (this.match('KEYWORD', 'then')) {
        this.advance();
        thenAction = this.parseAction();
      } else if (this.match('KEYWORD', 'otherwise')) {
        this.advance();
        otherwiseAction = this.parseAction();
      } else {
        throw new SyntaxError(
          `Unexpected token '${this.current().value}' at line ${this.current().line}`
        );
      }
    }

    this.expect('PUNCTUATION', '}');

    return {
      type: 'Policy',
      id,
      description,
      conditions,
      requirements,
      thenAction,
      otherwiseAction,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: this.current().line, column: this.current().column },
      },
    };
  }

  private parseCondition(): ConditionAST {
    const startToken = this.current();
    const left = this.parseExpression();

    return {
      type: 'Condition',
      operator: 'and',
      left,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: this.current().line, column: this.current().column },
      },
    };
  }

  private parseExpression(): ExpressionAST {
    return this.parseBinaryExpression();
  }

  private parseBinaryExpression(): ExpressionAST {
    let left = this.parseUnaryExpression();

    while (
      this.match('OPERATOR', '==') ||
      this.match('OPERATOR', '!=') ||
      this.match('OPERATOR', '<') ||
      this.match('OPERATOR', '>') ||
      this.match('OPERATOR', '<=') ||
      this.match('OPERATOR', '>=')
    ) {
      const operator = this.advance().value;
      const right = this.parseUnaryExpression();
      left = {
        type: 'BinaryExpression',
        operator,
        left,
        right,
      };
    }

    return left;
  }

  private parseUnaryExpression(): ExpressionAST {
    if (this.match('OPERATOR', '!') || this.match('KEYWORD', 'not')) {
      const operator = this.advance().value;
      const argument = this.parseUnaryExpression();
      return {
        type: 'BinaryExpression',
        operator: operator === 'not' ? '!' : operator,
        left: argument,
        right: { type: 'Literal', value: true },
      };
    }

    return this.parseMemberExpression();
  }

  private parseMemberExpression(): ExpressionAST {
    let object = this.parsePrimaryExpression();

    while (this.match('OPERATOR', '.')) {
      this.advance();
      const property = this.expect('IDENTIFIER');
      object = {
        type: 'MemberExpression',
        object,
        property: { type: 'Identifier', name: property.value },
      };
    }

    // Check for function call
    if (this.match('PUNCTUATION', '(')) {
      this.advance();
      const args: ExpressionAST[] = [];

      while (!this.match('PUNCTUATION', ')')) {
        args.push(this.parseExpression());
        if (this.match('PUNCTUATION', ',')) {
          this.advance();
        }
      }

      this.expect('PUNCTUATION', ')');

      return {
        type: 'CallExpression',
        callee: object,
        arguments: args,
      };
    }

    return object;
  }

  private parsePrimaryExpression(): ExpressionAST {
    const token = this.current();

    if (this.match('IDENTIFIER')) {
      this.advance();
      return { type: 'Identifier', name: token.value };
    }

    if (this.match('STRING')) {
      this.advance();
      return { type: 'Literal', value: token.value };
    }

    if (this.match('NUMBER')) {
      this.advance();
      return { type: 'Literal', value: parseFloat(token.value) };
    }

    if (this.match('BOOLEAN')) {
      this.advance();
      return { type: 'Literal', value: token.value === 'true' };
    }

    if (this.match('KEYWORD', 'null')) {
      this.advance();
      return { type: 'Literal', value: null };
    }

    if (this.match('PUNCTUATION', '(')) {
      this.advance();
      const expr = this.parseExpression();
      this.expect('PUNCTUATION', ')');
      return expr;
    }

    if (this.match('PUNCTUATION', '[')) {
      return this.parseArrayLiteral();
    }

    throw new SyntaxError(
      `Unexpected token '${token.value}' at line ${token.line}, column ${token.column}`
    );
  }

  private parseArrayLiteral(): ExpressionAST {
    this.expect('PUNCTUATION', '[');
    const elements: unknown[] = [];

    while (!this.match('PUNCTUATION', ']')) {
      const expr = this.parseExpression();
      if (expr.type === 'Literal') {
        elements.push(expr.value);
      }
      if (this.match('PUNCTUATION', ',')) {
        this.advance();
      }
    }

    this.expect('PUNCTUATION', ']');

    return { type: 'Literal', value: elements };
  }

  private parseRequirement(): RequirementAST {
    const startToken = this.current();
    const name = this.expect('IDENTIFIER').value;
    const args: unknown[] = [];

    if (this.match('PUNCTUATION', '(')) {
      this.advance();

      while (!this.match('PUNCTUATION', ')')) {
        const expr = this.parseExpression();
        if (expr.type === 'Literal') {
          args.push(expr.value);
        } else if (expr.type === 'Identifier') {
          args.push(expr.name);
        }
        if (this.match('PUNCTUATION', ',')) {
          this.advance();
        }
      }

      this.expect('PUNCTUATION', ')');
    }

    return {
      type: 'Requirement',
      name,
      args,
      loc: {
        start: { line: startToken.line, column: startToken.column },
        end: { line: this.current().line, column: this.current().column },
      },
    };
  }

  private parseAction(): ActionAST {
    const startToken = this.current();

    if (
      this.match('KEYWORD', 'allow') ||
      this.match('KEYWORD', 'deny') ||
      this.match('KEYWORD', 'challenge') ||
      this.match('KEYWORD', 'audit')
    ) {
      const outcome = this.advance().value as ActionAST['outcome'];
      let message: string | undefined;

      if (this.match('PUNCTUATION', '(')) {
        this.advance();
        if (this.match('STRING')) {
          message = this.advance().value;
        }
        this.expect('PUNCTUATION', ')');
      }

      return {
        type: 'Action',
        outcome,
        message,
        loc: {
          start: { line: startToken.line, column: startToken.column },
          end: { line: this.current().line, column: this.current().column },
        },
      };
    }

    throw new SyntaxError(
      `Expected action keyword at line ${startToken.line}, column ${startToken.column}`
    );
  }
}

// ============================================================================
// Validator
// ============================================================================

export class PolicyValidator {
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];

  validate(ast: PolicyAST): ValidationResult {
    this.errors = [];
    this.warnings = [];

    this.validatePolicyId(ast);
    this.validateConditions(ast);
    this.validateRequirements(ast);
    this.validateActions(ast);

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  private validatePolicyId(ast: PolicyAST): void {
    if (!ast.id || ast.id.trim() === '') {
      this.errors.push({
        code: 'INVALID_POLICY_ID',
        message: 'Policy ID is required and cannot be empty',
        severity: 'error',
        location: ast.loc?.start,
      });
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(ast.id)) {
      this.errors.push({
        code: 'INVALID_POLICY_ID_FORMAT',
        message:
          'Policy ID must start with a letter and contain only letters, numbers, underscores, and hyphens',
        severity: 'error',
        location: ast.loc?.start,
      });
    }
  }

  private validateConditions(ast: PolicyAST): void {
    if (ast.conditions.length === 0) {
      this.warnings.push({
        code: 'NO_CONDITIONS',
        message: 'Policy has no conditions and will always match',
        severity: 'warning',
      });
    }

    for (const condition of ast.conditions) {
      this.validateCondition(condition);
    }
  }

  private validateCondition(condition: ConditionAST): void {
    if (!condition.left) {
      this.errors.push({
        code: 'INVALID_CONDITION',
        message: 'Condition is missing left-hand side expression',
        severity: 'error',
        location: condition.loc?.start,
      });
    }
  }

  private validateRequirements(ast: PolicyAST): void {
    const validRequirements = ['mfa', 'approval', 'permission', 'custom'];

    for (const req of ast.requirements) {
      if (!validRequirements.includes(req.name.toLowerCase())) {
        this.warnings.push({
          code: 'UNKNOWN_REQUIREMENT',
          message: `Unknown requirement type: ${req.name}`,
          severity: 'warning',
          location: req.loc?.start,
        });
      }
    }
  }

  private validateActions(ast: PolicyAST): void {
    const validOutcomes = ['allow', 'deny', 'challenge', 'audit'];

    if (!validOutcomes.includes(ast.thenAction.outcome)) {
      this.errors.push({
        code: 'INVALID_ACTION',
        message: `Invalid action outcome: ${ast.thenAction.outcome}`,
        severity: 'error',
        location: ast.thenAction.loc?.start,
      });
    }

    if (ast.otherwiseAction && !validOutcomes.includes(ast.otherwiseAction.outcome)) {
      this.errors.push({
        code: 'INVALID_ACTION',
        message: `Invalid otherwise action outcome: ${ast.otherwiseAction.outcome}`,
        severity: 'error',
        location: ast.otherwiseAction.loc?.start,
      });
    }
  }
}

// ============================================================================
// Compiler
// ============================================================================

export class PolicyCompiler {
  compile(ast: PolicyAST): PolicyDefinition {
    const conditions = this.compileConditions(ast.conditions);
    const requirements = this.compileRequirements(ast.requirements);
    const action = this.compileAction(ast.thenAction);
    const fallbackAction = ast.otherwiseAction
      ? this.compileAction(ast.otherwiseAction)
      : { type: 'deny' as const, message: 'Policy conditions not met' };

    return {
      id: ast.id,
      name: ast.id,
      description: ast.description,
      version: '1.0.0',
      conditions,
      requirements,
      action,
      fallbackAction,
      priority: 100,
      enabled: true,
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private compileConditions(conditions: ConditionAST[]): PolicyCondition[] {
    return conditions.map((condition) => this.compileCondition(condition));
  }

  private compileCondition(condition: ConditionAST): PolicyCondition {
    const expr = condition.left;

    if (expr.type === 'BinaryExpression') {
      return {
        type: this.operatorToConditionType(expr.operator),
        field: this.expressionToField(expr.left),
        value: this.expressionToValue(expr.right),
        operator: condition.operator,
      };
    }

    if (expr.type === 'CallExpression') {
      return this.callExpressionToCondition(expr, condition.operator);
    }

    return {
      type: 'custom',
      field: this.expressionToField(expr),
      value: true,
      operator: condition.operator,
    };
  }

  private operatorToConditionType(
    operator: string
  ): PolicyCondition['type'] {
    switch (operator) {
      case '==':
        return 'equals';
      case '!=':
        return 'notEquals';
      default:
        return 'custom';
    }
  }

  private expressionToField(expr: ExpressionAST): string {
    if (expr.type === 'Identifier') {
      return expr.name;
    }

    if (expr.type === 'MemberExpression') {
      const object = this.expressionToField(expr.object);
      return `${object}.${expr.property.name}`;
    }

    return '';
  }

  private expressionToValue(expr: ExpressionAST): unknown {
    if (expr.type === 'Literal') {
      return expr.value;
    }

    if (expr.type === 'Identifier') {
      return expr.name;
    }

    return null;
  }

  private callExpressionToCondition(
    expr: ExpressionAST & { type: 'CallExpression' },
    operator: 'and' | 'or'
  ): PolicyCondition {
    const callee = expr.callee;
    let methodName = '';
    let objectPath = '';

    if (callee.type === 'MemberExpression') {
      methodName = callee.property.name;
      objectPath = this.expressionToField(callee.object);
    } else if (callee.type === 'Identifier') {
      methodName = callee.name;
    }

    const args = expr.arguments.map((arg) => this.expressionToValue(arg));

    switch (methodName) {
      case 'equals':
        return {
          type: 'equals',
          field: objectPath,
          value: args[0],
          operator,
        };
      case 'notEquals':
        return {
          type: 'notEquals',
          field: objectPath,
          value: args[0],
          operator,
        };
      case 'contains':
        return {
          type: 'contains',
          field: objectPath,
          value: args[0],
          operator,
        };
      case 'inRange':
        return {
          type: 'inRange',
          field: objectPath,
          value: args[0],
          operator,
        };
      case 'between':
        return {
          type: 'between',
          field: objectPath,
          value: { start: args[0], end: args[1] },
          operator,
        };
      case 'matches':
        return {
          type: 'matches',
          field: objectPath,
          value: args[0],
          operator,
        };
      default:
        return {
          type: 'custom',
          field: objectPath,
          value: { method: methodName, args },
          operator,
        };
    }
  }

  private compileRequirements(requirements: RequirementAST[]): PolicyRequirement[] {
    return requirements.map((req) => ({
      type: req.name.toLowerCase() as PolicyRequirement['type'],
      config: this.argsToConfig(req.name, req.args),
    }));
  }

  private argsToConfig(name: string, args: unknown[]): Record<string, unknown> {
    switch (name.toLowerCase()) {
      case 'mfa':
        return { verified: true, method: args[0] };
      case 'approval':
        return {
          approvers: Array.isArray(args[0]) ? args[0] : args,
          minApprovals: typeof args[1] === 'number' ? args[1] : 1,
        };
      case 'permission':
        return { permission: args[0], resource: args[1] };
      default:
        return { args };
    }
  }

  private compileAction(action: ActionAST): PolicyAction {
    return {
      type: action.outcome,
      message: action.message,
    };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a policy DSL string to AST
 */
export function parsePolicyDSL(input: string): PolicyAST {
  const parser = new Parser();
  return parser.parse(input);
}

/**
 * Validate a policy AST
 */
export function validatePolicyAST(ast: PolicyAST): ValidationResult {
  const validator = new PolicyValidator();
  return validator.validate(ast);
}

/**
 * Compile a policy AST to PolicyDefinition
 */
export function compilePolicyAST(ast: PolicyAST): PolicyDefinition {
  const compiler = new PolicyCompiler();
  return compiler.compile(ast);
}

/**
 * Parse, validate, and compile a policy DSL string
 */
export function parsePolicyString(
  input: string
): { policy: PolicyDefinition; validation: ValidationResult } {
  const ast = parsePolicyDSL(input);
  const validation = validatePolicyAST(ast);

  if (!validation.valid) {
    throw new Error(
      `Policy validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
    );
  }

  const policy = compilePolicyAST(ast);

  return { policy, validation };
}

/**
 * Convert a PolicyDefinition to DSL string
 */
export function policyToString(policy: PolicyDefinition): string {
  const lines: string[] = [];

  lines.push(`policy ${policy.id} {`);

  if (policy.description) {
    lines.push(`  description: "${escapeString(policy.description)}"`);
  }

  for (let i = 0; i < policy.conditions.length; i++) {
    const condition = policy.conditions[i];
    const keyword = i === 0 ? 'when' : condition.operator || 'and';
    lines.push(`  ${keyword} ${conditionToString(condition)}`);
  }

  for (const req of policy.requirements) {
    lines.push(`  require ${requirementToString(req)}`);
  }

  lines.push(`  then ${actionToString(policy.action)}`);

  if (policy.fallbackAction) {
    lines.push(`  otherwise ${actionToString(policy.fallbackAction)}`);
  }

  lines.push('}');

  return lines.join('\n');
}

function conditionToString(condition: PolicyCondition): string {
  const { field, type, value } = condition;

  switch (type) {
    case 'equals':
      return `${field} == ${valueToString(value)}`;
    case 'notEquals':
      return `${field} != ${valueToString(value)}`;
    case 'contains':
      return `${field}.contains(${valueToString(value)})`;
    case 'inRange':
      return `${field}.inRange(${valueToString(value)})`;
    case 'between':
      const between = value as { start: string; end: string };
      return `${field}.between(${valueToString(between.start)}, ${valueToString(between.end)})`;
    case 'matches':
      return `${field}.matches(${valueToString(value)})`;
    default:
      return `${field}.${type}(${valueToString(value)})`;
  }
}

function requirementToString(req: PolicyRequirement): string {
  const { type, config } = req;

  switch (type) {
    case 'mfa':
      return config.method ? `mfa(${valueToString(config.method)})` : 'mfa()';
    case 'approval':
      return `approval(${valueToString(config.approvers)}, ${config.minApprovals || 1})`;
    case 'permission':
      return `permission(${valueToString(config.permission)})`;
    default:
      return `${type}(${valueToString(config)})`;
  }
}

function actionToString(action: PolicyAction): string {
  if (action.message) {
    return `${action.type}("${escapeString(action.message)}")`;
  }
  return action.type;
}

function valueToString(value: unknown): string {
  if (typeof value === 'string') {
    return `"${escapeString(value)}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(valueToString).join(', ')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
