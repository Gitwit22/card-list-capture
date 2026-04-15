/**
 * API Client for Card Capture
 * Handles communication with backend API and Core Services
 */

import { envConfig } from '../config/env';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface ApiRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
}

/**
 * Core API Client
 */
class ApiClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number = 3;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = baseUrl || envConfig.api.baseUrl;
    this.timeout = timeout || envConfig.api.timeoutMs;
  }

  /**
   * Make API request with retry logic
   */
  async request<T = unknown>(
    endpoint: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: unknown;
      headers?: Record<string, string>;
      retries?: number;
    }
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      body,
      headers = {},
      retries = this.retries,
    } = options || {};

    const url = `${this.baseUrl}${endpoint}`;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (retries > 0 && response.status >= 500) {
          // Retry on server errors
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.request<T>(endpoint, { method, body, headers, retries: retries - 1 });
        }

        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      return {
        success: true,
        data,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Request timeout after ${this.timeout}ms`,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get API prefix for auth token
   */
  getAuthHeader(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
    };
  }
}

/**
 * Auth Core Client
 */
export class AuthCoreClient extends ApiClient {
  constructor(baseUrl?: string) {
    super(baseUrl || envConfig.cores.auth?.url);
  }

  async validateToken(token: string): Promise<ApiResponse<{ valid: boolean; userId?: string }>> {
    return this.request('/api/v1/auth/validate', {
      method: 'POST',
      headers: this.getAuthHeader(token),
    });
  }

  async refreshToken(refreshToken: string): Promise<ApiResponse<{ accessToken: string; refreshToken: string }>> {
    return this.request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
  }

  async getUser(token: string): Promise<ApiResponse<{ id: string; email: string; name: string }>> {
    return this.request('/api/v1/auth/user', {
      method: 'GET',
      headers: this.getAuthHeader(token),
    });
  }
}

/**
 * Storage Core Client
 */
export class StorageCoreClient extends ApiClient {
  constructor(baseUrl?: string) {
    super(baseUrl || envConfig.cores.storage?.url);
  }

  async uploadFile(
    file: File,
    metadata: Record<string, unknown>,
    token: string
  ): Promise<ApiResponse<{ fileId: string; url: string }>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('metadata', JSON.stringify(metadata));

    const response = await fetch(`${this.baseUrl}/api/v1/storage/upload`, {
      method: 'POST',
      headers: this.getAuthHeader(token),
      body: formData,
    });

    return response.json();
  }

  async getFile(fileId: string, token: string): Promise<ApiResponse<{ url: string; metadata: Record<string, unknown> }>> {
    return this.request(`/api/v1/storage/${fileId}`, {
      method: 'GET',
      headers: this.getAuthHeader(token),
    });
  }

  async deleteFile(fileId: string, token: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.request(`/api/v1/storage/${fileId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader(token),
    });
  }
}

/**
 * Audit Core Client
 */
export class AuditCoreClient extends ApiClient {
  constructor(baseUrl?: string) {
    super(baseUrl || envConfig.cores.audit?.url);
  }

  async logEvent(
    event: {
      action: string;
      resource: string;
      resourceId: string;
      details?: Record<string, unknown>;
    },
    token: string
  ): Promise<ApiResponse<{ eventId: string }>> {
    return this.request('/api/v1/audit/log', {
      method: 'POST',
      body: event,
      headers: this.getAuthHeader(token),
    });
  }

  async getAuditLog(resourceId: string, token: string): Promise<ApiResponse<unknown[]>> {
    return this.request(`/api/v1/audit/resource/${resourceId}`, {
      method: 'GET',
      headers: this.getAuthHeader(token),
    });
  }
}

/**
 * Card Capture Backend Client
 */
export class CardCaptureClient extends ApiClient {
  constructor(baseUrl?: string) {
    super(baseUrl || envConfig.api.baseUrl);
  }

  async uploadCard(
    file: File,
    metadata: Record<string, unknown>,
    token: string
  ): Promise<ApiResponse<{ cardId: string; extractedData: Record<string, unknown> }>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('metadata', JSON.stringify(metadata));
    formData.append('partition', envConfig.app.partition);

    const response = await fetch(`${this.baseUrl}/api/cards/upload`, {
      method: 'POST',
      headers: this.getAuthHeader(token),
      body: formData,
    });

    return response.json();
  }

  async getCard(cardId: string, token: string): Promise<ApiResponse<{ cardId: string; data: Record<string, unknown> }>> {
    return this.request(`/api/cards/${cardId}`, {
      method: 'GET',
      headers: this.getAuthHeader(token),
    });
  }

  async listCards(token: string, filters?: Record<string, unknown>): Promise<ApiResponse<unknown[]>> {
    const query = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        query.set(key, String(value));
      });
    }

    return this.request(`/api/cards?${query.toString()}`, {
      method: 'GET',
      headers: this.getAuthHeader(token),
    });
  }

  async processCard(
    cardId: string,
    processingOptions: Record<string, unknown>,
    token: string
  ): Promise<ApiResponse<{ processed: boolean; result: Record<string, unknown> }>> {
    return this.request(`/api/cards/${cardId}/process`, {
      method: 'POST',
      body: processingOptions,
      headers: this.getAuthHeader(token),
    });
  }

  async deleteCard(cardId: string, token: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return this.request(`/api/cards/${cardId}`, {
      method: 'DELETE',
      headers: this.getAuthHeader(token),
    });
  }
}

/**
 * Singleton instances
 */
let authCoreClient: AuthCoreClient | null = null;
let storageCoreClient: StorageCoreClient | null = null;
let auditCoreClient: AuditCoreClient | null = null;
let cardCaptureClient: CardCaptureClient | null = null;

export function getAuthCoreClient(): AuthCoreClient {
  if (!authCoreClient && envConfig.cores.auth) {
    authCoreClient = new AuthCoreClient();
  }
  return authCoreClient!;
}

export function getStorageCoreClient(): StorageCoreClient {
  if (!storageCoreClient && envConfig.cores.storage) {
    storageCoreClient = new StorageCoreClient();
  }
  return storageCoreClient!;
}

export function getAuditCoreClient(): AuditCoreClient {
  if (!auditCoreClient && envConfig.cores.audit) {
    auditCoreClient = new AuditCoreClient();
  }
  return auditCoreClient!;
}

export function getCardCaptureClient(): CardCaptureClient {
  if (!cardCaptureClient) {
    cardCaptureClient = new CardCaptureClient();
  }
  return cardCaptureClient;
}

/**
 * Export lazy-loaded clients
 */
export const apiClients = {
  get auth() {
    return getAuthCoreClient();
  },
  get storage() {
    return getStorageCoreClient();
  },
  get audit() {
    return getAuditCoreClient();
  },
  get cardCapture() {
    return getCardCaptureClient();
  },
};
