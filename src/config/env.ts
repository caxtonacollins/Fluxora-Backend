export interface Config {
  port: number;
  nodeEnv: 'development' | 'staging' | 'production';
  apiVersion: string;
  databaseUrl: string;
  databasePoolSize: number;
  databaseConnectionTimeout: number;
  redisUrl: string;
  redisEnabled: boolean;
  horizonUrl: string;
  horizonNetworkPassphrase: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  metricsEnabled: boolean;
  enableStreamValidation: boolean;
  enableRateLimit: boolean;
  partnerApiToken?: string;
  adminApiToken?: string;
  requirePartnerAuth: boolean;
  requireAdminAuth: boolean;
  indexerEnabled: boolean;
  workerEnabled: boolean;
  indexerStallThresholdMs: number;
  indexerLastSuccessfulSyncAt?: string;
  deploymentChecklistVersion: string;
}

const VALID_NODE_ENVS = new Set(['development', 'staging', 'production']);
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration Error: ${message}`);
    this.name = 'ConfigError';
  }
}

function parseNodeEnv(value: string | undefined): Config['nodeEnv'] {
  if (!value || value === 'test') {
    return 'development';
  }

  if (VALID_NODE_ENVS.has(value)) {
    return value as Config['nodeEnv'];
  }

  throw new ConfigError(`Unsupported NODE_ENV "${value}"`);
}

function parseIntEnv(
  value: string | undefined,
  defaultValue: number,
  min?: number,
  max?: number,
): number {
  if (value === undefined) return defaultValue;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new ConfigError(`Expected integer, got "${value}"`);
  }

  if (min !== undefined && parsed < min) {
    throw new ConfigError(`Value ${parsed} is below minimum ${min}`);
  }

  if (max !== undefined && parsed > max) {
    throw new ConfigError(`Value ${parsed} exceeds maximum ${max}`);
  }

  return parsed;
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Required environment variable missing: ${name}`);
  }

  return value;
}

function normalizeOptionalSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateUrl(
  value: string,
  name: string,
  allowedProtocols?: readonly string[],
): string {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(`Invalid URL for ${name}: ${value}`);
  }

  if (allowedProtocols && !allowedProtocols.includes(parsed.protocol)) {
    throw new ConfigError(`Invalid URL for ${name}: ${value}`);
  }

  return value;
}

function parseLogLevel(value: string | undefined): Config['logLevel'] {
  const normalized = value ?? 'info';

  if (!VALID_LOG_LEVELS.has(normalized)) {
    throw new ConfigError(`Invalid LOG_LEVEL "${normalized}"`);
  }

  return normalized as Config['logLevel'];
}

export function loadConfig(): Config {
  const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
  const parityRequired = nodeEnv !== 'development';
  const isProduction = nodeEnv === 'production';

  const databaseUrl = isProduction
    ? validateUrl(requireEnv('DATABASE_URL'), 'DATABASE_URL', [
        'postgresql:',
        'postgres:',
        'mysql:',
        'mariadb:',
        'sqlite:',
      ])
    : validateUrl(
        process.env.DATABASE_URL ?? 'postgresql://localhost/fluxora',
        'DATABASE_URL',
        ['postgresql:', 'postgres:', 'mysql:', 'mariadb:', 'sqlite:'],
      );

  const redisUrl = validateUrl(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    'REDIS_URL',
    ['redis:', 'rediss:'],
  );

  const horizonUrl = validateUrl(
    process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    'HORIZON_URL',
    ['http:', 'https:'],
  );

  const jwtSecret = isProduction
    ? requireEnv('JWT_SECRET')
    : process.env.JWT_SECRET ?? 'dev-secret-key-change-in-production';

  if (isProduction && jwtSecret.length < 32) {
    throw new ConfigError('JWT_SECRET must be at least 32 characters in production');
  }

  return {
    port: parseIntEnv(process.env.PORT, 3000, 1, 65535),
    nodeEnv,
    apiVersion: process.env.API_VERSION ?? '0.1.0',
    databaseUrl,
    databasePoolSize: parseIntEnv(process.env.DATABASE_POOL_SIZE, 10, 1, 100),
    databaseConnectionTimeout: parseIntEnv(
      process.env.DATABASE_CONNECTION_TIMEOUT,
      5000,
      1000,
      60000,
    ),
    redisUrl,
    redisEnabled: parseBoolEnv(process.env.REDIS_ENABLED, parityRequired),
    horizonUrl,
    horizonNetworkPassphrase:
      process.env.HORIZON_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    enableStreamValidation: parseBoolEnv(process.env.ENABLE_STREAM_VALIDATION, true),
    enableRateLimit: parseBoolEnv(process.env.ENABLE_RATE_LIMIT, !isProduction),
    metricsEnabled: parseBoolEnv(process.env.METRICS_ENABLED, true),
    partnerApiToken: normalizeOptionalSecret(process.env.PARTNER_API_TOKEN),
    adminApiToken: normalizeOptionalSecret(process.env.ADMIN_API_TOKEN),
    requirePartnerAuth: parseBoolEnv(process.env.REQUIRE_PARTNER_AUTH, parityRequired),
    requireAdminAuth: parseBoolEnv(process.env.REQUIRE_ADMIN_AUTH, parityRequired),
    indexerEnabled: parseBoolEnv(process.env.INDEXER_ENABLED, false),
    workerEnabled: parseBoolEnv(process.env.WORKER_ENABLED, false),
    indexerStallThresholdMs: parseIntEnv(
      process.env.INDEXER_STALL_THRESHOLD_MS,
      5 * 60 * 1000,
      1_000,
      86_400_000,
    ),
    indexerLastSuccessfulSyncAt: normalizeOptionalSecret(
      process.env.INDEXER_LAST_SUCCESSFUL_SYNC_AT,
    ),
    deploymentChecklistVersion: process.env.DEPLOYMENT_CHECKLIST_VERSION ?? '2026-03-27',
  };
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    throw new ConfigError('Configuration not initialized. Call initializeConfig() first.');
  }

  return configInstance;
}

export function initializeConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }

  return configInstance;
}

export function resetConfig(): void {
  configInstance = null;
}
