/**
 * Vorion Security SDK - DSL Module
 * Policy definition language and parser
 */

// Policy DSL
export {
  Policy,
  PolicyBuilder,
  FieldCondition,
  TimeField,
  ConditionExpression,
  CombinedCondition,
  RequirementBuilder,
  user,
  request,
  time,
  resource,
  env,
  mfa,
  approval,
  permission,
  allow,
  deny,
  challenge,
  audit,
  evaluatePolicy,
} from './policy-dsl';

// Parser
export {
  Lexer,
  Parser,
  PolicyValidator,
  PolicyCompiler,
  parsePolicyDSL,
  validatePolicyAST,
  compilePolicyAST,
  parsePolicyString,
  policyToString,
} from './parser';
