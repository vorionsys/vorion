/**
 * Password Policy Engine for Vorion Platform
 *
 * Provides comprehensive password validation, strength calculation,
 * and policy enforcement with support for multi-tenant configurations.
 *
 * @module security/password-policy
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import zxcvbn from 'zxcvbn';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ component: 'password-policy' });

/**
 * Password policy configuration interface
 */
export interface PasswordPolicy {
  /** Minimum password length (default: 12) */
  minLength: number;
  /** Maximum password length (default: 128) */
  maxLength: number;
  /** Require at least one uppercase letter (default: true) */
  requireUppercase: boolean;
  /** Require at least one lowercase letter (default: true) */
  requireLowercase: boolean;
  /** Require at least one number (default: true) */
  requireNumbers: boolean;
  /** Require at least one special character (default: true) */
  requireSpecialChars: boolean;
  /** Allowed special characters (default: '!@#$%^&*()_+-=[]{}|;:,.<>?') */
  specialChars: string;
  /** Prevent common passwords from being used (default: true) */
  preventCommonPasswords: boolean;
  /** Prevent passwords containing user info like email, username, name (default: true) */
  preventUserInfo: boolean;
  /** Number of previous passwords to check for reuse (default: 12) */
  preventReuse: number;
  /** Maximum password age in days, 0 = never expires (default: 0) */
  maxAge: number;
  /** Minimum password age in days before it can be changed (default: 0) */
  minAge: number;
}

/**
 * Default password policy with strong security settings
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  preventCommonPasswords: true,
  preventUserInfo: true,
  preventReuse: 12,
  maxAge: 0,
  minAge: 0,
};

/**
 * NIST 800-63B compliant password policy
 *
 * Based on NIST Digital Identity Guidelines (SP 800-63B):
 * - Minimum 8 characters
 * - No composition rules (uppercase, numbers, special chars)
 * - Block common/compromised passwords
 * - No periodic password expiration
 * - Allow all printable characters
 *
 * @see https://pages.nist.gov/800-63-3/sp800-63b.html
 */
export const NIST_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialChars: false,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  preventCommonPasswords: true,
  preventUserInfo: true,
  preventReuse: 12,
  maxAge: 0, // No periodic expiration per NIST guidelines
  minAge: 0,
};

/**
 * Result of password validation
 */
export interface PasswordValidationResult {
  /** Whether the password meets all policy requirements */
  valid: boolean;
  /** Password strength score from 0-100 */
  score: number;
  /** List of policy violations that must be fixed */
  errors: string[];
  /** Non-blocking warnings about the password */
  warnings: string[];
  /** Suggestions for improving the password */
  suggestions: string[];
}

/**
 * User information for context-aware validation
 */
export interface UserInfo {
  /** User's email address */
  email?: string;
  /** User's username */
  username?: string;
  /** User's full name or display name */
  name?: string;
}

/**
 * List of 1000+ most common passwords
 * Source: Various password breach databases and security research
 */
const COMMON_PASSWORDS: Set<string> = new Set([
  // Top 100 most common
  '123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111',
  '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein',
  'shadow', 'master', '696969', 'mustang', '666666', 'qwertyuiop', '123321', '1234567890',
  'pussy', 'superman', '654321', '1qaz2wsx', '7777777', 'fuckyou', 'qazwsx', 'jordan',
  '123qwe', '000000', 'nikita', 'hunter', 'zaq1zaq1', 'trustno1', 'rangers', 'buster',
  'thomas', 'robert', 'soccer', 'hockey', 'killer', 'george', 'andrew', 'charlie',
  'harley', 'daniel', 'joshua', 'matthew', 'jordan23', 'maggie', 'iloveyou', 'ashley',
  'michelle', 'nicole', 'jessica', 'pepper', 'hannah', 'amanda', 'summer', 'heather',
  'test123', 'qwert', 'anthony', 'brandon', 'steven', 'michael', 'jennifer', 'richard',
  'austin', 'cowboy', 'thunder', 'silver', 'princess', 'ginger', 'hello', 'welcome',
  'whatever', 'cheese', 'phoenix', 'falcon', 'jacket', 'cookie', 'coffee', 'samantha',
  'internet', 'starwars', 'computer', 'corvette', 'mercedes', 'diamond', 'freedom',
  'benjamin', 'william', 'liverpool', 'chelsea', 'arsenal', 'barcelona', 'raiders',
  'yankees', 'cowboys', 'steelers', 'eagles', 'giants', 'patriots', 'dolphins',

  // 100-200
  'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'qwerty123', 'password1', 'password123',
  'admin', 'administrator', 'login', 'welcome1', 'welcome123', 'changeme', 'letmein1',
  'passw0rd', 'p@ssw0rd', 'p@ssword', 'pass123', 'pass1234', 'pass12345', 'admin123',
  'admin1234', 'root', 'root123', 'toor', 'access', 'access1', 'access123', 'guest',
  'guest123', 'master123', 'abc1234', 'abc12345', 'abcd1234', 'qwerty1', 'qwerty12',
  'qwe123', 'qwe1234', 'qweasd', 'q1w2e3', 'q1w2e3r4', 'a1b2c3', 'a1b2c3d4', '1q2w3e',
  '1q2w3e4r', '1q2w3e4r5t', '1qaz', '2wsx', '3edc', '4rfv', '1qazxsw2', 'zaq12wsx',
  'passpass', 'testtest', 'qwertyu', 'asdfghj', 'zxcvbnm,', 'aaaaaa', 'bbbbbb', '111222',
  '112233', '121212', '123123123', '123321123', '1234321', '12341234', '123454321',
  '12344321', '0987654321', '9876543210', '1111111111', '0000000000', 'aaaaaaaa',
  'baseball1', 'football1', 'basketball', 'hockey1', 'soccer1', 'tennis', 'golf',

  // 200-300
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'spring', 'summer1', 'fall', 'winter', 'monday',
  'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'sunshine',
  'moonlight', 'rainbow', 'butterfly', 'dolphin', 'tiger', 'lion', 'wolf', 'bear',
  'eagle', 'shark', 'snake', 'spider', 'panther', 'jaguar', 'phoenix1', 'dragon1',
  'unicorn', 'pegasus', 'angel', 'demon', 'vampire', 'zombie', 'ghost', 'wizard',
  'warrior', 'knight', 'samurai', 'ninja', 'pirate', 'captain', 'general', 'soldier',
  'marine', 'army', 'navy', 'airforce', 'alpha', 'beta', 'gamma', 'delta', 'omega',
  'epsilon', 'sigma', 'lambda', 'matrix', 'trinity', 'neo', 'morpheus', 'oracle',
  'agent', 'smith', 'hacker', 'cracker', 'security', 'private', 'secret', 'hidden',
  'password2', 'password12', 'password01', 'pass1', 'pass12', 'pass01', 'testing',
  'testing1', 'testing123', 'testpass', 'letmein123', 'login123', 'user', 'user123',

  // 300-400
  'apple', 'banana', 'orange', 'grape', 'lemon', 'cherry', 'strawberry', 'blueberry',
  'raspberry', 'watermelon', 'pineapple', 'coconut', 'mango', 'papaya', 'peach', 'plum',
  'chocolate', 'vanilla', 'caramel', 'cookie1', 'brownie', 'cupcake', 'pancake', 'waffle',
  'pizza', 'burger', 'hotdog', 'taco', 'burrito', 'sandwich', 'salad', 'pasta', 'sushi',
  'ramen', 'noodle', 'rice', 'bread', 'cheese1', 'butter', 'milk', 'cream', 'sugar',
  'honey', 'candy', 'popcorn', 'chips', 'pretzel', 'cracker', 'biscuit', 'donut',
  'coffee1', 'tea', 'juice', 'soda', 'water', 'beer', 'wine', 'vodka', 'whiskey', 'rum',
  'gin', 'tequila', 'brandy', 'champagne', 'cocktail', 'martini', 'mojito', 'margarita',
  'red', 'orange1', 'yellow', 'green', 'blue', 'purple', 'pink', 'black', 'white',
  'gray', 'brown', 'silver1', 'gold', 'bronze', 'platinum', 'copper', 'iron', 'steel',
  'metal', 'rock', 'stone', 'crystal', 'diamond1', 'ruby', 'emerald', 'sapphire', 'pearl',

  // 400-500
  'guitar', 'piano', 'violin', 'drums', 'bass', 'trumpet', 'saxophone', 'flute',
  'clarinet', 'harmonica', 'ukulele', 'banjo', 'music', 'song', 'melody', 'rhythm',
  'harmony', 'concert', 'band', 'orchestra', 'choir', 'singer', 'dancer', 'artist',
  'painter', 'sculptor', 'writer', 'author', 'poet', 'actor', 'actress', 'director',
  'producer', 'camera', 'photo', 'video', 'movie', 'film', 'cinema', 'theater',
  'drama', 'comedy', 'action', 'horror', 'thriller', 'romance', 'fantasy', 'scifi',
  'anime', 'manga', 'cartoon', 'disney', 'pixar', 'marvel', 'dccomics', 'batman',
  'superman1', 'spiderman', 'ironman', 'hulk', 'thor', 'captain', 'america', 'shield',
  'avengers', 'xmen', 'wolverine', 'deadpool', 'joker', 'harley', 'catwoman', 'wonder',
  'aquaman', 'flash', 'greenlantern', 'cyborg', 'robin', 'nightwing', 'batgirl',
  'starfire', 'raven', 'beastboy', 'titans', 'league', 'justice', 'heroes', 'villains',

  // 500-600
  'newyork', 'losangeles', 'chicago', 'houston', 'phoenix1', 'philadelphia', 'sanantonio',
  'sandiego', 'dallas', 'austin1', 'jacksonville', 'sanfrancisco', 'seattle', 'denver',
  'boston', 'nashville', 'portland', 'lasvegas', 'detroit', 'memphis', 'atlanta',
  'miami', 'orlando', 'tampa', 'charlotte', 'raleigh', 'minneapolis', 'cleveland',
  'stlouis', 'pittsburgh', 'cincinnati', 'baltimore', 'milwaukee', 'kansascity',
  'sacramento', 'newark', 'oakland', 'tulsa', 'honolulu', 'london', 'paris', 'tokyo',
  'sydney', 'melbourne', 'toronto', 'vancouver', 'montreal', 'berlin', 'munich',
  'amsterdam', 'brussels', 'madrid', 'barcelona1', 'rome', 'milan', 'venice', 'florence',
  'vienna', 'prague', 'budapest', 'warsaw', 'moscow', 'beijing', 'shanghai', 'hongkong',
  'singapore', 'seoul', 'mumbai', 'delhi', 'bangkok', 'dubai', 'cairo', 'capetown',
  'america1', 'canada', 'mexico', 'brazil', 'argentina', 'england', 'france', 'germany',
  'italy', 'spain', 'portugal', 'netherlands', 'belgium', 'switzerland', 'austria',

  // 600-700
  'january1', 'february1', 'march1', 'april1', 'june1', 'july1', 'august1', 'september1',
  'october1', 'november1', 'december1', '2020', '2021', '2022', '2023', '2024', '2025',
  '2019', '2018', '2017', '2016', '2015', '2014', '2013', '2012', '2011', '2010',
  '2000', '1999', '1998', '1997', '1996', '1995', '1994', '1993', '1992', '1991', '1990',
  '1989', '1988', '1987', '1986', '1985', '1984', '1983', '1982', '1981', '1980',
  'birthday', 'mybday', 'happybday', 'happy123', 'happyday', 'goodday', 'goodnight',
  'goodmorning', 'goodluck', 'goodbye', 'hello123', 'hi123', 'hey123', 'hola', 'bonjour',
  'aloha', 'namaste', 'welcome12', 'welcome01', 'thanks', 'thankyou', 'please', 'sorry',
  'excuse', 'pardon', 'yes', 'no', 'maybe', 'always', 'never', 'forever', 'together',
  'family', 'friends', 'bestfriend', 'boyfriend', 'girlfriend', 'husband', 'wife',
  'mother', 'father', 'brother', 'sister', 'daughter', 'son', 'baby', 'child', 'kid',

  // 700-800
  'loveyou', 'loveme', 'mylove', 'yourlove', 'truelove', 'firstlove', 'love123',
  'iloveu', 'iluvu', 'luvu', 'loveu', 'babe', 'sweetie', 'honey1', 'darling', 'angel1',
  'princess1', 'prince', 'king', 'queen', 'royal', 'crown', 'throne', 'castle', 'palace',
  'kingdom', 'empire', 'dynasty', 'legacy', 'legend', 'myth', 'hero', 'heroine', 'champion',
  'winner', 'victory', 'success', 'achieve', 'dream', 'believe', 'hope', 'faith', 'trust',
  'truth', 'honest', 'loyal', 'brave', 'strong', 'power', 'mighty', 'great', 'awesome',
  'amazing', 'fantastic', 'wonderful', 'beautiful', 'gorgeous', 'pretty', 'handsome',
  'cute', 'adorable', 'lovely', 'perfect', 'special', 'unique', 'rare', 'precious',
  'valuable', 'priceless', 'treasure', 'wealth', 'rich', 'money', 'cash', 'dollar',
  'million', 'billion', 'fortune', 'lucky', 'jackpot', 'winner1', 'champion1', 'master1',
  'expert', 'genius', 'smart', 'clever', 'wise', 'brilliant', 'talent', 'gifted', 'skill',

  // 800-900
  'google', 'facebook', 'twitter', 'instagram', 'youtube', 'tiktok', 'snapchat',
  'whatsapp', 'telegram', 'discord', 'reddit', 'linkedin', 'pinterest', 'tumblr',
  'twitch', 'spotify', 'netflix', 'amazon', 'apple1', 'microsoft', 'windows', 'linux',
  'macos', 'android', 'iphone', 'samsung', 'sony', 'nintendo', 'playstation', 'xbox',
  'gaming', 'gamer', 'player', 'noob', 'pro', 'elite', 'veteran', 'rookie', 'newbie',
  'minecraft', 'fortnite', 'pubg', 'valorant', 'league', 'dota', 'csgo', 'overwatch',
  'roblox', 'pokemon', 'pikachu', 'charizard', 'mario', 'luigi', 'zelda', 'link',
  'sonic', 'pacman', 'tetris', 'snake', 'pong', 'chess', 'poker', 'blackjack', 'dice',
  'cards', 'game123', 'play123', 'player1', 'gamer1', 'gaming1', 'esports', 'streaming',
  'streamer', 'youtuber', 'influencer', 'viral', 'trending', 'popular', 'famous', 'celeb',
  'star', 'idol', 'fan', 'follower', 'subscriber', 'member', 'vip', 'premium', 'elite1',

  // 900-1000+
  'school', 'college', 'university', 'student', 'teacher', 'professor', 'doctor', 'nurse',
  'engineer', 'lawyer', 'accountant', 'manager', 'director1', 'president', 'ceo', 'boss',
  'leader', 'captain1', 'chief', 'head', 'senior', 'junior', 'intern', 'trainee', 'rookie1',
  'work', 'job', 'career', 'business', 'company', 'office', 'meeting', 'project', 'team',
  'group', 'club', 'society', 'community', 'network', 'social', 'public', 'private1',
  'personal', 'professional', 'official', 'formal', 'casual', 'simple', 'easy', 'hard',
  'difficult', 'complex', 'basic', 'advanced', 'beginner', 'intermediate', 'expert1',
  'secure', 'safe', 'protect', 'guard', 'shield1', 'defense', 'attack', 'fight', 'battle',
  'war', 'peace', 'freedom1', 'liberty', 'justice1', 'equality', 'rights', 'power1',
  'control', 'system', 'network1', 'server', 'database', 'cloud', 'backup', 'restore',
  'update', 'upgrade', 'install', 'download', 'upload', 'sync', 'connect', 'disconnect',
  'online', 'offline', 'wireless', 'bluetooth', 'wifi', 'ethernet', 'internet1', 'web',
  'browser', 'chrome', 'firefox', 'safari', 'edge', 'opera', 'website', 'webpage', 'app',
  'mobile', 'desktop', 'laptop', 'tablet', 'phone', 'device', 'gadget', 'tech', 'digital',
  'cyber', 'virtual', 'reality', 'future', 'past', 'present', 'time', 'space', 'world',
  'earth', 'moon', 'sun', 'star1', 'planet', 'galaxy', 'universe', 'cosmos', 'infinity',
  'eternal', 'immortal', 'divine', 'sacred', 'holy', 'blessed', 'grace', 'mercy', 'love1',

  // Additional patterns and keyboard walks
  'qwertyui', 'qwertyuio', 'asdfghjkl;', 'zxcvbnm,.', '!@#$%^&*()', '1234567891',
  'abcdefgh', 'abcdefghi', 'abcdefghij', 'zyxwvutsr', 'jihgfedcba', 'mnbvcxz',
  'poiuytrewq', 'lkjhgfdsa', '/.,mnbvcxz', '\\][poiuytr', '=-0987654',
  'azertyuiop', 'qsdfghjklm', 'wxcvbn', 'azerty', 'azerty123', 'qwertz', 'qwertz123',

  // Common patterns with special chars
  'p@ssword', 'p@ssw0rd1', 'p@$$w0rd', 'pa$$word', 'pa$$w0rd', 'passw0rd1', 'p4ssword',
  'p4ssw0rd', 'p455w0rd', 'passw0rd!', 'password!', 'password@', 'password#', 'password$',
  '!password', '@password', '#password', '$password', 'admin!', 'admin@', 'admin#',
  'root!', 'root@', 'test!', 'test@', 'user!', 'user@', 'guest!', 'guest@',
  '!@#$%^', '!@#$%^&', '!@#$%^&*', '!@#123', '123!@#', 'abc!@#', '!@#abc',

  // More keyboard patterns
  '1qaz!QAZ', '2wsx@WSX', '3edc#EDC', '4rfv$RFV', '5tgb%TGB', '6yhn^YHN',
  '7ujm&UJM', '8ik,*IK<', '9ol.9OL>', '0p;/0P:?', 'qazwsxedc', 'rfvtgbyhn',
  'ujmik,ol.', '1234qwer', 'qwer1234', 'asdf1234', '1234asdf', 'zxcv1234', '1234zxcv',

  // Repeat patterns
  'aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'eeeeee', 'ffffff', 'gggggg', 'hhhhhh',
  'aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd', 'eeeeeee', 'fffffff', 'ggggggg',
  'aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff',
  '11111111', '22222222', '33333333', '44444444', '55555555', '66666666',
  '12121212', '23232323', '34343434', '45454545', '56565656', '67676767',
  'abababab', 'cdcdcdcd', 'efefefef', 'ghghghgh', 'ijijklkl', 'mnmnmnmn',
]);

/**
 * Password Policy Engine
 *
 * Provides comprehensive password validation and policy enforcement
 * with support for multi-tenant configurations.
 */
export class PasswordPolicyEngine {
  private tenantPolicies: Map<string, PasswordPolicy> = new Map();
  private defaultPolicy: PasswordPolicy;

  /**
   * Creates a new PasswordPolicyEngine instance
   * @param defaultPolicy - The default policy to use when no tenant-specific policy exists
   */
  constructor(defaultPolicy: PasswordPolicy = DEFAULT_PASSWORD_POLICY) {
    this.defaultPolicy = { ...defaultPolicy };
    logger.debug('PasswordPolicyEngine initialized with default policy');
  }

  /**
   * Validates a password against the configured policy
   *
   * @param password - The password to validate
   * @param userInfo - Optional user information for context-aware validation
   * @param tenantId - Optional tenant ID for multi-tenant policy lookup
   * @returns Validation result with errors, warnings, and suggestions
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   * const result = engine.validate('MyP@ssw0rd!', {
   *   email: 'user@example.com',
   *   username: 'johndoe'
   * });
   *
   * if (!result.valid) {
   *   console.error('Password validation failed:', result.errors);
   * }
   * ```
   */
  validate(
    password: string,
    userInfo?: UserInfo,
    tenantId?: string
  ): PasswordValidationResult {
    const policy = this.getPolicy(tenantId);
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Length checks
    if (password.length < policy.minLength) {
      errors.push(`Password must be at least ${policy.minLength} characters long`);
    }

    if (password.length > policy.maxLength) {
      errors.push(`Password must not exceed ${policy.maxLength} characters`);
    }

    // Character composition checks
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (policy.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (policy.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (policy.requireSpecialChars) {
      const escapedSpecialChars = policy.specialChars.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );
      const specialCharRegex = new RegExp(`[${escapedSpecialChars}]`);
      if (!specialCharRegex.test(password)) {
        errors.push(
          `Password must contain at least one special character (${policy.specialChars})`
        );
      }
    }

    // Common password check
    if (policy.preventCommonPasswords && this.isCommonPassword(password)) {
      errors.push('Password is too common and easily guessable');
    }

    // User info check
    if (policy.preventUserInfo && userInfo) {
      const userInfoViolations = this.checkUserInfo(password, userInfo);
      errors.push(...userInfoViolations);
    }

    // Calculate strength score
    const score = this.calculateStrength(password);

    // Add warnings and suggestions based on strength
    if (score < 40) {
      warnings.push('Password strength is weak');
    } else if (score < 60) {
      warnings.push('Password strength is moderate');
    }

    // Use zxcvbn for detailed feedback
    const zxcvbnResult = zxcvbn(password);
    if (zxcvbnResult.feedback.warning) {
      warnings.push(zxcvbnResult.feedback.warning);
    }
    suggestions.push(...zxcvbnResult.feedback.suggestions);

    // Additional suggestions
    if (password.length < 16 && !suggestions.includes('Use a longer password')) {
      suggestions.push('Consider using a passphrase of 16 or more characters');
    }

    const hasSequentialChars = this.hasSequentialPattern(password);
    if (hasSequentialChars) {
      warnings.push('Password contains sequential characters');
      suggestions.push('Avoid sequential characters like "abc" or "123"');
    }

    const hasRepeatingChars = this.hasRepeatingPattern(password);
    if (hasRepeatingChars) {
      warnings.push('Password contains repeating characters');
      suggestions.push('Avoid repeating characters like "aaa" or "111"');
    }

    const valid = errors.length === 0;

    logger.debug('Password validation completed', {
      valid,
      score,
      errorCount: errors.length,
      warningCount: warnings.length,
    });

    return {
      valid,
      score,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Calculates password strength score from 0-100
   *
   * Uses the zxcvbn library for realistic password strength estimation,
   * with additional scoring for length and character diversity.
   *
   * @param password - The password to evaluate
   * @returns Strength score from 0 (weakest) to 100 (strongest)
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   * const strength = engine.calculateStrength('MyP@ssw0rd!');
   * console.log(`Password strength: ${strength}/100`);
   * ```
   */
  calculateStrength(password: string): number {
    if (!password || password.length === 0) {
      return 0;
    }

    // Use zxcvbn as the base (0-4 score)
    const zxcvbnResult = zxcvbn(password);
    const baseScore = zxcvbnResult.score * 20; // 0-80

    // Add bonus for length (up to 10 points)
    const lengthBonus = Math.min(10, Math.floor(password.length / 4));

    // Add bonus for character diversity (up to 10 points)
    let diversityBonus = 0;
    if (/[a-z]/.test(password)) diversityBonus += 2;
    if (/[A-Z]/.test(password)) diversityBonus += 2;
    if (/\d/.test(password)) diversityBonus += 2;
    if (/[^a-zA-Z\d]/.test(password)) diversityBonus += 4;

    // Calculate total score, capped at 100
    const totalScore = Math.min(100, baseScore + lengthBonus + diversityBonus);

    // Penalties for weak patterns
    let penalty = 0;

    if (this.isCommonPassword(password)) {
      penalty += 50;
    }

    if (this.hasSequentialPattern(password)) {
      penalty += 10;
    }

    if (this.hasRepeatingPattern(password)) {
      penalty += 10;
    }

    // Apply penalty but ensure minimum of 0
    return Math.max(0, totalScore - penalty);
  }

  /**
   * Checks if a password is in the common passwords list
   *
   * @param password - The password to check
   * @returns True if the password is common, false otherwise
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   * if (engine.isCommonPassword('password123')) {
   *   console.warn('This password is too common!');
   * }
   * ```
   */
  isCommonPassword(password: string): boolean {
    const normalizedPassword = password.toLowerCase();

    // Direct match
    if (COMMON_PASSWORDS.has(normalizedPassword)) {
      return true;
    }

    // Check without numbers at the end
    const withoutTrailingNumbers = normalizedPassword.replace(/\d+$/, '');
    if (COMMON_PASSWORDS.has(withoutTrailingNumbers)) {
      return true;
    }

    // Check without special chars at the end
    const withoutTrailingSpecial = normalizedPassword.replace(/[^a-z0-9]+$/i, '');
    if (COMMON_PASSWORDS.has(withoutTrailingSpecial)) {
      return true;
    }

    // Check with common leet speak substitutions reversed
    const unleetSpeak = normalizedPassword
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/7/g, 't')
      .replace(/@/g, 'a')
      .replace(/\$/g, 's');

    if (COMMON_PASSWORDS.has(unleetSpeak)) {
      return true;
    }

    return false;
  }

  /**
   * Checks if a password has been used previously
   *
   * Compares the password against a list of hashed previous passwords
   * using timing-safe comparison to prevent timing attacks.
   *
   * @param userId - The user's ID (for logging purposes)
   * @param password - The password to check
   * @param hashedHistory - Array of previously hashed passwords
   * @returns Promise resolving to true if password was previously used
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   * const wasUsed = await engine.checkPasswordHistory(
   *   'user-123',
   *   'newPassword',
   *   user.passwordHistory
   * );
   *
   * if (wasUsed) {
   *   throw new Error('Password was recently used');
   * }
   * ```
   */
  async checkPasswordHistory(
    userId: string,
    password: string,
    hashedHistory: string[]
  ): Promise<boolean> {
    const currentHash = this.hashForHistory(password);
    const currentHashBuffer = Buffer.from(currentHash, 'hex');

    for (const historicalHash of hashedHistory) {
      try {
        const historicalBuffer = Buffer.from(historicalHash, 'hex');

        if (currentHashBuffer.length === historicalBuffer.length) {
          if (timingSafeEqual(currentHashBuffer, historicalBuffer)) {
            logger.info('Password reuse detected', { userId });
            return true;
          }
        }
      } catch (error) {
        // Invalid hash format, skip
        logger.warn('Invalid hash in password history', { userId });
        continue;
      }
    }

    return false;
  }

  /**
   * Creates a hash of the password for storage in password history
   *
   * Uses SHA-256 with a static salt for consistent comparison.
   * Note: This is NOT for password storage authentication - use bcrypt/argon2 for that.
   * This is only for checking password reuse in history.
   *
   * @param password - The password to hash
   * @returns Hex-encoded hash string
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   * const hash = engine.hashForHistory('userPassword');
   * // Store hash in user's password history
   * ```
   */
  hashForHistory(password: string): string {
    // Using a static salt for password history comparison
    // This is NOT for authentication - use proper password hashing (bcrypt, argon2) for that
    const historySalt = 'vorion-password-history-v1';
    return createHash('sha256')
      .update(historySalt)
      .update(password)
      .digest('hex');
  }

  /**
   * Gets the password policy for a tenant
   *
   * @param tenantId - Optional tenant ID, returns default policy if not specified
   * @returns The applicable password policy
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   *
   * // Get default policy
   * const defaultPolicy = engine.getPolicy();
   *
   * // Get tenant-specific policy
   * const tenantPolicy = engine.getPolicy('tenant-123');
   * ```
   */
  getPolicy(tenantId?: string): PasswordPolicy {
    if (tenantId && this.tenantPolicies.has(tenantId)) {
      return { ...this.tenantPolicies.get(tenantId)! };
    }
    return { ...this.defaultPolicy };
  }

  /**
   * Sets a custom password policy for a tenant
   *
   * @param tenantId - The tenant ID to configure
   * @param policy - Partial policy to merge with defaults
   *
   * @example
   * ```typescript
   * const engine = getPasswordPolicyEngine();
   *
   * // Set a stricter policy for a specific tenant
   * engine.setPolicy('enterprise-tenant', {
   *   minLength: 16,
   *   preventReuse: 24,
   *   maxAge: 90,
   * });
   * ```
   */
  setPolicy(tenantId: string, policy: Partial<PasswordPolicy>): void {
    const existingPolicy = this.tenantPolicies.get(tenantId) ?? this.defaultPolicy;
    const mergedPolicy: PasswordPolicy = {
      ...existingPolicy,
      ...policy,
    };

    // Validate the policy
    this.validatePolicyConfig(mergedPolicy);

    this.tenantPolicies.set(tenantId, mergedPolicy);
    logger.info('Password policy updated for tenant', { tenantId });
  }

  /**
   * Removes a tenant-specific policy, reverting to defaults
   *
   * @param tenantId - The tenant ID to remove the policy for
   */
  removePolicy(tenantId: string): void {
    this.tenantPolicies.delete(tenantId);
    logger.info('Password policy removed for tenant', { tenantId });
  }

  /**
   * Updates the default password policy
   *
   * @param policy - Partial policy to merge with current defaults
   */
  setDefaultPolicy(policy: Partial<PasswordPolicy>): void {
    const mergedPolicy: PasswordPolicy = {
      ...this.defaultPolicy,
      ...policy,
    };

    this.validatePolicyConfig(mergedPolicy);
    this.defaultPolicy = mergedPolicy;
    logger.info('Default password policy updated');
  }

  /**
   * Validates policy configuration for consistency
   * @param policy - The policy to validate
   * @throws Error if policy configuration is invalid
   */
  private validatePolicyConfig(policy: PasswordPolicy): void {
    if (policy.minLength < 1) {
      throw new Error('Minimum length must be at least 1');
    }

    if (policy.maxLength < policy.minLength) {
      throw new Error('Maximum length must be greater than or equal to minimum length');
    }

    if (policy.preventReuse < 0) {
      throw new Error('Prevent reuse count cannot be negative');
    }

    if (policy.maxAge < 0) {
      throw new Error('Max age cannot be negative');
    }

    if (policy.minAge < 0) {
      throw new Error('Min age cannot be negative');
    }

    if (policy.minAge > policy.maxAge && policy.maxAge > 0) {
      throw new Error('Min age cannot be greater than max age');
    }
  }

  /**
   * Checks if password contains user information
   * @param password - The password to check
   * @param userInfo - User information to check against
   * @returns Array of error messages for violations
   */
  private checkUserInfo(password: string, userInfo: UserInfo): string[] {
    const errors: string[] = [];
    const lowercasePassword = password.toLowerCase();

    if (userInfo.email) {
      const emailParts = userInfo.email.toLowerCase().split('@');
      const localPart = emailParts[0];

      // Check if password contains local part of email
      if (localPart.length >= 3 && lowercasePassword.includes(localPart)) {
        errors.push('Password should not contain your email address');
      }
    }

    if (userInfo.username) {
      const username = userInfo.username.toLowerCase();
      if (username.length >= 3 && lowercasePassword.includes(username)) {
        errors.push('Password should not contain your username');
      }
    }

    if (userInfo.name) {
      const nameParts = userInfo.name.toLowerCase().split(/\s+/);
      for (const part of nameParts) {
        if (part.length >= 3 && lowercasePassword.includes(part)) {
          errors.push('Password should not contain parts of your name');
          break;
        }
      }
    }

    return errors;
  }

  /**
   * Checks for sequential character patterns
   * @param password - The password to check
   * @returns True if sequential pattern found
   */
  private hasSequentialPattern(password: string): boolean {
    const sequences = [
      'abcdefghijklmnopqrstuvwxyz',
      'zyxwvutsrqponmlkjihgfedcba',
      '01234567890',
      '09876543210',
      'qwertyuiop',
      'poiuytrewq',
      'asdfghjkl',
      'lkjhgfdsa',
      'zxcvbnm',
      'mnbvcxz',
    ];

    const lowercasePassword = password.toLowerCase();

    for (const sequence of sequences) {
      for (let i = 0; i <= sequence.length - 4; i++) {
        const substr = sequence.substring(i, i + 4);
        if (lowercasePassword.includes(substr)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks for repeating character patterns
   * @param password - The password to check
   * @returns True if repeating pattern found
   */
  private hasRepeatingPattern(password: string): boolean {
    // Check for 3+ consecutive identical characters
    if (/(.)\1{2,}/.test(password)) {
      return true;
    }

    // Check for repeating 2-character patterns (4+ repetitions)
    if (/(.{2})\1{2,}/.test(password)) {
      return true;
    }

    return false;
  }
}

// Singleton instance
let engineInstance: PasswordPolicyEngine | null = null;

/**
 * Gets the singleton PasswordPolicyEngine instance
 *
 * @param defaultPolicy - Optional custom default policy (only used on first call)
 * @returns The PasswordPolicyEngine singleton instance
 *
 * @example
 * ```typescript
 * import { getPasswordPolicyEngine, NIST_PASSWORD_POLICY } from './password-policy.js';
 *
 * // Get engine with default policy
 * const engine = getPasswordPolicyEngine();
 *
 * // Or initialize with NIST policy (first call only)
 * const nistEngine = getPasswordPolicyEngine(NIST_PASSWORD_POLICY);
 *
 * // Validate a password
 * const result = engine.validate('MySecureP@ssw0rd!', {
 *   email: 'user@example.com',
 *   username: 'johndoe',
 *   name: 'John Doe'
 * });
 *
 * if (result.valid) {
 *   console.log('Password is valid with strength:', result.score);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function getPasswordPolicyEngine(
  defaultPolicy?: PasswordPolicy
): PasswordPolicyEngine {
  if (!engineInstance) {
    engineInstance = new PasswordPolicyEngine(defaultPolicy);
    logger.info('PasswordPolicyEngine singleton created');
  }
  return engineInstance;
}

/**
 * Resets the singleton instance (primarily for testing)
 */
export function resetPasswordPolicyEngine(): void {
  engineInstance = null;
  logger.debug('PasswordPolicyEngine singleton reset');
}

export default PasswordPolicyEngine;
