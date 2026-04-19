/**
 * Environment Configuration for Card Capture App
 * Type-safe environment variable access with validation
 */

interface EnvironmentConfig {
  // API Configuration
  api: {
    baseUrl: string;
    timeoutMs: number;
  };

  // Authentication
  auth: {
    enabled: boolean;
    jwtSecret?: string;
    coreUrl?: string;
  };

  // App Configuration
  app: {
    partition: string;
    environment: 'development' | 'staging' | 'production';
    debugMode: boolean;
  };

  // Core Services Integration
  cores: {
    auth?: {
      url: string;
      apiVersion: string;
    };
    storage?: {
      url: string;
      apiVersion: string;
    };
    audit?: {
      url: string;
      apiVersion: string;
    };
  };

  // Feature Flags
  features: {
    aiClassification: boolean;
    documentOcr: boolean;
    cardStorage: boolean;
    analytics: boolean;
  };

  // Card Capture Configuration
  cardCapture: {
    maxFileSizeMb: number;
    allowedFileTypes: string[];
  };

  // Monitoring
  monitoring: {
    sentryDsn?: string;
  };
}

/**
 * Parse boolean strings safely
 */
function parseBoolean(value: string | undefined, defaultValue: boolean = false): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse number strings safely
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse comma-separated strings into array
 */
function parseArray(value: string | undefined, defaultValue: string[] = []): string[] {
  if (value === undefined) return defaultValue;
  return value.split(',').map(v => v.trim()).filter(Boolean);
}

/**
 * Load and validate environment configuration
 */
export function loadConfig(): EnvironmentConfig {
  const env = import.meta.env;

  const config: EnvironmentConfig = {
    // API Configuration
    api: {
      baseUrl: env.VITE_API_BASE_URL || 'http://localhost:3000',
      timeoutMs: parseNumber(env.VITE_API_TIMEOUT_MS, 30000),
    },

    // Authentication
    auth: {
      enabled: parseBoolean(env.VITE_AUTH_ENABLED, true),
      jwtSecret: env.VITE_JWT_SECRET,
      coreUrl: env.VITE_AUTH_CORE_URL,
    },

    // App Configuration
    app: {
      partition: env.VITE_APP_PARTITION || 'card-capture-app',
      environment: (env.VITE_APP_ENV as any) || 'development',
      debugMode: parseBoolean(env.VITE_DEBUG_MODE, false),
    },

    // Core Services Integration
    cores: {
      auth: env.VITE_AUTH_CORE_URL
        ? {
            url: env.VITE_AUTH_CORE_URL,
            apiVersion: 'v1',
          }
        : undefined,
      storage: env.VITE_STORAGE_CORE_URL
        ? {
            url: env.VITE_STORAGE_CORE_URL,
            apiVersion: 'v1',
          }
        : undefined,
      audit: env.VITE_AUDIT_CORE_URL
        ? {
            url: env.VITE_AUDIT_CORE_URL,
            apiVersion: 'v1',
          }
        : undefined,
    },

    // Feature Flags
    features: {
      aiClassification: parseBoolean(env.VITE_ENABLE_AI_CLASSIFICATION, false),
      documentOcr: parseBoolean(env.VITE_ENABLE_DOCUMENT_OCR, false),
      cardStorage: parseBoolean(env.VITE_ENABLE_CARD_STORAGE, true),
      analytics: parseBoolean(env.VITE_ENABLE_ANALYTICS, false),
    },

    // Card Capture Configuration
    cardCapture: {
      maxFileSizeMb: parseNumber(env.VITE_MAX_FILE_SIZE_MB, 50),
      allowedFileTypes: parseArray(env.VITE_ALLOWED_FILE_TYPES, [
        'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'tiff', 'tif',
        'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx',
      ]),
    },

    // Monitoring
    monitoring: {
      sentryDsn: env.VITE_SENTRY_DSN,
    },
  };

  // Validation
  if (config.app.environment === 'production' && config.app.debugMode) {
    console.warn('⚠️  Debug mode is enabled in production - this should be disabled');
  }

  if (!config.api.baseUrl) {
    throw new Error('VITE_API_BASE_URL environment variable is required');
  }

  if (config.cardCapture.maxFileSizeMb < 1) {
    throw new Error('Max file size must be at least 1 MB');
  }

  if (config.app.debugMode) {
    console.debug('🔧 Card Capture Config:', config);
  }

  return config;
}

/**
 * Get singleton config instance
 */
let configInstance: EnvironmentConfig | null = null;

export function getConfig(): EnvironmentConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Lazy load specific config sections
 */
export const envConfig = {
  get api() {
    return getConfig().api;
  },
  get auth() {
    return getConfig().auth;
  },
  get app() {
    return getConfig().app;
  },
  get cores() {
    return getConfig().cores;
  },
  get features() {
    return getConfig().features;
  },
  get cardCapture() {
    return getConfig().cardCapture;
  },
  get monitoring() {
    return getConfig().monitoring;
  },
};
