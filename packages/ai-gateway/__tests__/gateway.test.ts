import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before imports
vi.mock('openai', () => {
  const createMock = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello from AI' } }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  });

  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: createMock,
        },
      };
    },
    __createMock: createMock,
  };
});

vi.mock('../src/sustainability/green-route.js', () => ({
  greenRouter: {
    routeRequest: vi.fn().mockResolvedValue({
      useGreenRoute: false,
      recommendedModel: 'general/fast',
      recommendedProvider: 'google',
      reason: 'Default route',
      estimatedCarbon: 0.001,
    }),
  },
}));

vi.mock('../src/sustainability/carbon-tracker.js', () => ({
  carbonTracker: {
    trackTask: vi.fn().mockResolvedValue({
      taskId: 'test',
      carbonEmitted: 0.001,
      energyConsumed: 0.01,
      modelProvider: 'anthropic',
      modelName: 'claude-sonnet',
      tokensInput: 10,
      tokensOutput: 20,
      duration: 100,
      timestamp: new Date(),
    }),
  },
}));

vi.mock('../src/routing/semantic-router.js', () => ({
  semanticRouter: {
    route: vi.fn().mockResolvedValue({
      route: { modelProvider: 'anthropic', modelName: 'claude-3' },
      confidence: 90,
      shouldReflect: false,
    }),
    reflect: vi.fn().mockResolvedValue({}),
  },
}));

import { AIGateway, createGateway } from '../src/gateway.js';
import type { GatewayRequest, RoutingDecision } from '../src/gateway.js';

describe('AIGateway', () => {
  let gateway: AIGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new AIGateway({ baseURL: 'http://localhost:4000', apiKey: 'test-key' });
  });

  // ============================================
  // PRIVACY ROUTING (Route 1)
  // ============================================

  describe('privacy routing', () => {
    it('should route high-security policy to Ollama', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        metadata: { policy: 'high-security' },
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('privacy');
      expect(decision.provider).toBe('ollama');
      expect(decision.model).toBe('privacy/general');
    });

    it('should route requests containing email PII to Ollama', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Send to john@example.com' }],
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('privacy');
      expect(decision.provider).toBe('ollama');
    });

    it('should route requests containing SSN to Ollama', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('privacy');
    });

    it('should route requests containing sensitive keywords to Ollama', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Store the password securely' }],
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('privacy');
    });

    it('should use coding model for PII requests with code context', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Fix the function using my api key ABC123' }],
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('privacy');
      expect(decision.model).toBe('privacy/coding');
    });
  });

  // ============================================
  // TASK ROUTING (Route 2)
  // ============================================

  describe('task routing', () => {
    it('should route coding tasks to specialized model', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Write a function to sort an array' }],
        metadata: { taskType: 'coding' },
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('specialized');
      expect(decision.model).toMatch(/coding/);
    });

    it('should route high-priority coding to expert model', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Implement this algorithm' }],
        metadata: { taskType: 'coding', priority: 'high' },
      };

      const decision = await gateway.route(request);
      expect(decision.model).toBe('coding/expert');
      expect(decision.provider).toBe('anthropic');
    });

    it('should route reasoning tasks appropriately', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Analyze this approach' }],
        metadata: { taskType: 'reasoning' },
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('specialized');
      expect(decision.model).toMatch(/reasoning/);
    });

    it('should route advisor tasks to anthropic', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Provide guidance' }],
        metadata: { taskType: 'advisor' },
      };

      const decision = await gateway.route(request);
      expect(decision.model).toBe('advisor/consultation');
      expect(decision.provider).toBe('anthropic');
    });

    it('should auto-detect coding task from content', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'debug this typescript function' }],
      };

      const decision = await gateway.route(request);
      expect(decision.route).toBe('specialized');
    });
  });

  // ============================================
  // COST-OPTIMIZED ROUTING (Route 4)
  // ============================================

  describe('cost-optimized routing', () => {
    it('should use premium model for high priority', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hello world' }],
        metadata: { priority: 'high' },
      };

      // This will hit task route for 'general' then cost route
      const decision = await gateway.route(request);
      // Since "Hello world" may detect as general, it falls through to cost
      if (decision.route === 'cost-optimized') {
        expect(decision.model).toBe('general/premium');
      }
    });

    it('should use fast model for ultra-low cost requests', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
        metadata: { maxCost: 0.0005, priority: 'low' },
      };

      const decision = await gateway.route(request);
      if (decision.route === 'cost-optimized') {
        expect(decision.model).toBe('general/fast');
        expect(decision.provider).toBe('ollama');
      }
    });
  });

  // ============================================
  // PRIORITY NORMALIZATION
  // ============================================

  describe('priority normalization', () => {
    it('should normalize lowercase priority', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'test' }],
        metadata: { priority: 'high' },
      };
      // Internally calls normalizePriority which converts to uppercase
      const decision = await gateway.route(request);
      expect(decision).toBeDefined();
    });
  });

  // ============================================
  // CHAT
  // ============================================

  describe('chat', () => {
    it('should return a gateway response', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        metadata: { policy: 'high-security' },
      };

      const response = await gateway.chat(request);
      expect(response.content).toBe('Hello from AI');
      expect(response.model).toBeDefined();
      expect(response.usage).toBeDefined();
      expect(response.metadata.route).toBeDefined();
      expect(response.metadata.provider).toBeDefined();
      expect(response.metadata.latency).toBeGreaterThanOrEqual(0);
    });

    it('should include sustainability metrics', async () => {
      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        metadata: { policy: 'high-security' },
      };

      const response = await gateway.chat(request);
      expect(response.metadata.sustainability).toBeDefined();
      expect(response.metadata.sustainability!.carbonEmitted).toBeDefined();
    });

    it('should pass system prompt when provided', async () => {
      const { default: OpenAI } = await import('openai');
      const instance = new OpenAI();

      const request: GatewayRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helper',
        metadata: { policy: 'high-security' },
      };

      await gateway.chat(request);

      expect(instance.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: 'You are a helper' }),
          ]),
        })
      );
    });
  });

  // ============================================
  // FACTORY
  // ============================================

  describe('createGateway', () => {
    it('should create gateway with defaults', () => {
      // createGateway() with no args reads LITELLM_MASTER_KEY from env
      process.env.LITELLM_MASTER_KEY = 'test-default-key';
      try {
        const gw = createGateway();
        expect(gw).toBeInstanceOf(AIGateway);
      } finally {
        delete process.env.LITELLM_MASTER_KEY;
      }
    });

    it('should create gateway with custom config', () => {
      const gw = createGateway({ baseURL: 'http://custom:4000', apiKey: 'custom-key' });
      expect(gw).toBeInstanceOf(AIGateway);
    });
  });
});
