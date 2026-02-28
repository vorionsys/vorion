import { describe, it, expect } from "vitest";
import {
  ErrorCategory,
  AUTH_ERRORS,
  VALIDATION_ERRORS,
  RATE_LIMIT_ERRORS,
  NOT_FOUND_ERRORS,
  TRUST_ERRORS,
  SERVER_ERRORS,
  EXTERNAL_ERRORS,
  ERROR_CODES,
  getErrorByCode,
  getErrorsByCategory,
  getRetryableErrors,
  formatErrorMessage,
  createErrorResponse,
} from "./error-codes.js";

describe("ERROR_CODES", () => {
  it("contains all error groups", () => {
    const allKeys = [
      ...Object.keys(AUTH_ERRORS),
      ...Object.keys(VALIDATION_ERRORS),
      ...Object.keys(RATE_LIMIT_ERRORS),
      ...Object.keys(NOT_FOUND_ERRORS),
      ...Object.keys(TRUST_ERRORS),
      ...Object.keys(SERVER_ERRORS),
      ...Object.keys(EXTERNAL_ERRORS),
    ];
    expect(Object.keys(ERROR_CODES)).toHaveLength(allKeys.length);
  });

  it("all error codes are unique", () => {
    const codes = Object.values(ERROR_CODES).map((e) => e.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it("all error codes follow E####  pattern", () => {
    for (const error of Object.values(ERROR_CODES)) {
      expect(error.code).toMatch(/^E\d{4}$/);
    }
  });

  it("all errors have valid HTTP status codes", () => {
    for (const error of Object.values(ERROR_CODES)) {
      expect(error.httpStatus).toBeGreaterThanOrEqual(400);
      expect(error.httpStatus).toBeLessThan(600);
    }
  });

  it("all errors have a valid category", () => {
    const validCategories = Object.values(ErrorCategory);
    for (const error of Object.values(ERROR_CODES)) {
      expect(validCategories).toContain(error.category);
    }
  });

  it("all errors have a message", () => {
    for (const error of Object.values(ERROR_CODES)) {
      expect(error.message).toBeTruthy();
      expect(typeof error.message).toBe("string");
    }
  });

  it("all errors have a retryable boolean", () => {
    for (const error of Object.values(ERROR_CODES)) {
      expect(typeof error.retryable).toBe("boolean");
    }
  });
});

describe("Error groups by category", () => {
  it("AUTH_ERRORS are auth category with 4xx codes", () => {
    for (const error of Object.values(AUTH_ERRORS)) {
      expect(error.category).toBe(ErrorCategory.AUTH);
      expect(error.httpStatus).toBeGreaterThanOrEqual(400);
      expect(error.httpStatus).toBeLessThan(500);
    }
  });

  it("AUTH_ERRORS codes start with E1", () => {
    for (const error of Object.values(AUTH_ERRORS)) {
      expect(error.code).toMatch(/^E1/);
    }
  });

  it("VALIDATION_ERRORS codes start with E2", () => {
    for (const error of Object.values(VALIDATION_ERRORS)) {
      expect(error.code).toMatch(/^E2/);
    }
  });

  it("RATE_LIMIT_ERRORS codes start with E3", () => {
    for (const error of Object.values(RATE_LIMIT_ERRORS)) {
      expect(error.code).toMatch(/^E3/);
    }
  });

  it("NOT_FOUND_ERRORS codes start with E4", () => {
    for (const error of Object.values(NOT_FOUND_ERRORS)) {
      expect(error.code).toMatch(/^E4/);
    }
  });

  it("TRUST_ERRORS codes start with E5", () => {
    for (const error of Object.values(TRUST_ERRORS)) {
      expect(error.code).toMatch(/^E5/);
    }
  });

  it("SERVER_ERRORS codes start with E6", () => {
    for (const error of Object.values(SERVER_ERRORS)) {
      expect(error.code).toMatch(/^E6/);
    }
  });

  it("EXTERNAL_ERRORS codes start with E7", () => {
    for (const error of Object.values(EXTERNAL_ERRORS)) {
      expect(error.code).toMatch(/^E7/);
    }
  });

  it("server/external errors are retryable", () => {
    for (const error of Object.values(SERVER_ERRORS)) {
      expect(error.retryable).toBe(true);
    }
    for (const error of Object.values(EXTERNAL_ERRORS)) {
      expect(error.retryable).toBe(true);
    }
  });

  it("auth errors are not retryable", () => {
    for (const error of Object.values(AUTH_ERRORS)) {
      expect(error.retryable).toBe(false);
    }
  });
});

describe("getErrorByCode", () => {
  it("finds known error codes", () => {
    const result = getErrorByCode("E1001");
    expect(result).toBeDefined();
    expect(result!.code).toBe("E1001");
    expect(result!.category).toBe(ErrorCategory.AUTH);
  });

  it("finds errors from different groups", () => {
    expect(getErrorByCode("E2001")!.category).toBe(ErrorCategory.VALIDATION);
    expect(getErrorByCode("E3001")!.category).toBe(ErrorCategory.RATE_LIMIT);
    expect(getErrorByCode("E4001")!.category).toBe(ErrorCategory.NOT_FOUND);
    expect(getErrorByCode("E5001")!.category).toBe(ErrorCategory.TRUST);
    expect(getErrorByCode("E6001")!.category).toBe(ErrorCategory.SERVER);
    expect(getErrorByCode("E7001")!.category).toBe(ErrorCategory.EXTERNAL);
  });

  it("returns undefined for unknown codes", () => {
    expect(getErrorByCode("E9999")).toBeUndefined();
    expect(getErrorByCode("INVALID")).toBeUndefined();
    expect(getErrorByCode("")).toBeUndefined();
  });
});

describe("getErrorsByCategory", () => {
  it("returns auth errors", () => {
    const errors = getErrorsByCategory(ErrorCategory.AUTH);
    expect(errors.length).toBe(Object.keys(AUTH_ERRORS).length);
    for (const error of errors) {
      expect(error.category).toBe(ErrorCategory.AUTH);
    }
  });

  it("returns validation errors", () => {
    const errors = getErrorsByCategory(ErrorCategory.VALIDATION);
    expect(errors.length).toBe(Object.keys(VALIDATION_ERRORS).length);
  });

  it("returns empty array for unused category", () => {
    const errors = getErrorsByCategory(ErrorCategory.CONFIG);
    expect(errors).toEqual([]);
  });
});

describe("getRetryableErrors", () => {
  it("returns only retryable errors", () => {
    const errors = getRetryableErrors();
    for (const error of errors) {
      expect(error.retryable).toBe(true);
    }
  });

  it("includes server and external errors", () => {
    const errors = getRetryableErrors();
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E6001"); // INTERNAL_ERROR
    expect(codes).toContain("E7001"); // BLOCKCHAIN_ERROR
  });

  it("does not include auth errors", () => {
    const errors = getRetryableErrors();
    const codes = errors.map((e) => e.code);
    expect(codes).not.toContain("E1001");
    expect(codes).not.toContain("E1002");
  });
});

describe("formatErrorMessage", () => {
  it("replaces template parameters", () => {
    const result = formatErrorMessage(
      VALIDATION_ERRORS.MISSING_REQUIRED_FIELD,
      {
        field: "email",
      },
    );
    expect(result).toBe("Required field is missing: email");
  });

  it("replaces multiple parameters", () => {
    const result = formatErrorMessage(TRUST_ERRORS.TRUST_TIER_INSUFFICIENT, {
      currentTier: "T2",
      requiredTier: "T5",
    });
    expect(result).toBe("Trust tier T2 insufficient. Required: T5.");
  });

  it("leaves message unchanged when no params match", () => {
    const result = formatErrorMessage(AUTH_ERRORS.MISSING_API_KEY, {});
    expect(result).toBe(AUTH_ERRORS.MISSING_API_KEY.message);
  });

  it("replaces numeric parameters", () => {
    const result = formatErrorMessage(RATE_LIMIT_ERRORS.RATE_LIMIT_EXCEEDED, {
      retryAfter: 30,
    });
    expect(result).toBe("Rate limit exceeded. Retry after 30 seconds.");
  });
});

describe("createErrorResponse", () => {
  it("creates response without params", () => {
    const response = createErrorResponse(AUTH_ERRORS.MISSING_API_KEY);
    expect(response.status).toBe(401);
    expect(response.error.code).toBe("E1001");
    expect(response.error.message).toBe(AUTH_ERRORS.MISSING_API_KEY.message);
    expect(response.error.category).toBe(ErrorCategory.AUTH);
    expect(response.error.retryable).toBe(false);
    expect(response.error.docsUrl).toBe(
      "https://cognigate.dev/docs/authentication",
    );
  });

  it("creates response with params", () => {
    const response = createErrorResponse(
      VALIDATION_ERRORS.MISSING_REQUIRED_FIELD,
      {
        field: "name",
      },
    );
    expect(response.error.message).toBe("Required field is missing: name");
  });

  it("includes requestId when provided", () => {
    const response = createErrorResponse(
      AUTH_ERRORS.MISSING_API_KEY,
      undefined,
      "req-123",
    );
    expect(response.error.requestId).toBe("req-123");
  });

  it("omits requestId when not provided", () => {
    const response = createErrorResponse(AUTH_ERRORS.MISSING_API_KEY);
    expect(response.error).not.toHaveProperty("requestId");
  });

  it("omits docsUrl when not present on error", () => {
    const response = createErrorResponse(AUTH_ERRORS.INSUFFICIENT_PERMISSIONS);
    expect(response.error).not.toHaveProperty("docsUrl");
  });

  it("includes docsUrl when present on error", () => {
    const response = createErrorResponse(TRUST_ERRORS.TRUST_TIER_INSUFFICIENT);
    expect(response.error.docsUrl).toBe("https://basis.vorion.org/tiers");
  });
});
