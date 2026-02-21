/**
 * HTTP Alert Channel Base
 *
 * Abstract base class for HTTP-based alert channels providing:
 * - Fetch with timeout
 * - Response parsing
 * - HTTP error handling
 * - Headers management
 *
 * @packageDocumentation
 * @module security/alerting/channels/http-base
 */

import { BaseAlertChannel, type BaseChannelConfig } from './base.js';

// =============================================================================
// Types
// =============================================================================

/**
 * HTTP channel configuration extending base config
 */
export interface HttpChannelConfig extends BaseChannelConfig {
  /** Request timeout in ms */
  timeout?: number;
}

/**
 * HTTP request options
 */
export interface HttpRequestOptions {
  /** Request URL */
  url: string;
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (will be JSON stringified if object) */
  body?: unknown;
  /** Request timeout override */
  timeout?: number;
}

/**
 * HTTP response wrapper
 */
export interface HttpResponse<T = unknown> {
  /** HTTP status code */
  status: number;
  /** Response is OK (2xx) */
  ok: boolean;
  /** Response headers */
  headers: Headers;
  /** Parsed response data */
  data: T;
  /** Raw response text */
  text: string;
}

// =============================================================================
// HttpAlertChannel Class
// =============================================================================

/**
 * Abstract base class for HTTP-based alert channels
 *
 * Extends BaseAlertChannel with HTTP-specific functionality:
 * - Fetch with timeout and abort controller
 * - JSON request/response handling
 * - HTTP error extraction
 */
export abstract class HttpAlertChannel extends BaseAlertChannel {
  constructor(config: HttpChannelConfig = {}) {
    super(config);
  }

  /**
   * Make an HTTP request with timeout
   */
  protected async httpRequest<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const {
      url,
      method = 'POST',
      headers = {},
      body,
      timeout = this.timeout,
    } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };

      const requestInit: RequestInit = {
        method,
        headers: requestHeaders,
        signal: controller.signal,
      };

      if (body !== undefined) {
        requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(url, requestInit);
      const text = await response.text();

      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        // Response might not be JSON
        data = text as unknown as T;
      }

      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        data,
        text,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make an HTTP POST request
   */
  protected async httpPost<T = unknown>(
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<HttpResponse<T>> {
    return this.httpRequest<T>({
      url,
      method: 'POST',
      headers,
      body,
    });
  }

  /**
   * Make an HTTP request and throw on non-2xx response
   */
  protected async httpRequestOrThrow<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const response = await this.httpRequest<T>(options);

    if (!response.ok) {
      const errorMessage = this.extractErrorMessage(response);
      throw new Error(errorMessage);
    }

    return response;
  }

  /**
   * Extract error message from HTTP response
   */
  protected extractErrorMessage(response: HttpResponse): string {
    const { status, data, text } = response;

    // Try to extract error message from common response formats
    if (data && typeof data === 'object') {
      const errorObj = data as Record<string, unknown>;
      if (typeof errorObj.error === 'string') {
        return `HTTP ${status}: ${errorObj.error}`;
      }
      if (typeof errorObj.message === 'string') {
        return `HTTP ${status}: ${errorObj.message}`;
      }
      if (typeof errorObj.error_description === 'string') {
        return `HTTP ${status}: ${errorObj.error_description}`;
      }
    }

    // Fallback to status and truncated text
    const truncatedText = text.length > 200 ? text.slice(0, 200) + '...' : text;
    return `HTTP ${status}: ${truncatedText}`;
  }

  /**
   * Build default headers (can be overridden by subclasses)
   */
  protected getDefaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
  }

  /**
   * Merge headers with defaults
   */
  protected mergeHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    return {
      ...this.getDefaultHeaders(),
      ...customHeaders,
    };
  }
}
