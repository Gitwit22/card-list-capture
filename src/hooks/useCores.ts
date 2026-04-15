/**
 * React Hooks for API Clients
 * Type-safe hooks for using API clients in components
 */

import { useCallback, useRef, useState } from 'react';
import {
  AuthCoreClient,
  StorageCoreClient,
  AuditCoreClient,
  CardCaptureClient,
  ApiResponse,
  getAuthCoreClient,
  getStorageCoreClient,
  getAuditCoreClient,
  getCardCaptureClient,
} from '../lib/api-client';
import { envConfig } from '../config/env';

/**
 * Generic hook for API calls with loading and error state
 */
export function useApiCall<TResponse = unknown>(
  apiFn: (token: string) => Promise<ApiResponse<TResponse>>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TResponse | null>(null);
  const tokenRef = useRef<string | null>(null);

  const execute = useCallback(
    async (token: string) => {
      setLoading(true);
      setError(null);
      tokenRef.current = token;

      try {
        const response = await apiFn(token);
        if (response.success && response.data) {
          setData(response.data);
        } else {
          setError(response.error || 'Unknown error occurred');
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [apiFn]
  );

  return { loading, error, data, execute };
}

/**
 * Hook for Auth Core Client
 */
export function useAuthCore() {
  const [client] = useState(() => getAuthCoreClient());

  const validateToken = useCallback(
    (token: string) =>
      client.validateToken(token),
    [client]
  );

  const refreshToken = useCallback(
    (refreshToken: string) =>
      client.refreshToken(refreshToken),
    [client]
  );

  const getUser = useCallback(
    (token: string) =>
      client.getUser(token),
    [client]
  );

  return { validateToken, refreshToken, getUser };
}

/**
 * Hook for Storage Core Client
 */
export function useStorageCore() {
  const [client] = useState(() => getStorageCoreClient());

  const uploadFile = useCallback(
    (file: File, metadata: Record<string, unknown>, token: string) =>
      client.uploadFile(file, metadata, token),
    [client]
  );

  const getFile = useCallback(
    (fileId: string, token: string) =>
      client.getFile(fileId, token),
    [client]
  );

  const deleteFile = useCallback(
    (fileId: string, token: string) =>
      client.deleteFile(fileId, token),
    [client]
  );

  return { uploadFile, getFile, deleteFile };
}

/**
 * Hook for Audit Core Client
 */
export function useAuditCore() {
  const [client] = useState(() => getAuditCoreClient());

  const logEvent = useCallback(
    (event: {
      action: string;
      resource: string;
      resourceId: string;
      details?: Record<string, unknown>;
    }, token: string) =>
      client.logEvent(event, token),
    [client]
  );

  const getAuditLog = useCallback(
    (resourceId: string, token: string) =>
      client.getAuditLog(resourceId, token),
    [client]
  );

  return { logEvent, getAuditLog };
}

/**
 * Hook for Card Capture Client
 */
export function useCardCapture() {
  const [client] = useState(() => getCardCaptureClient());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadCard = useCallback(
    async (file: File, metadata: Record<string, unknown>, token: string) => {
      setUploading(true);
      setUploadProgress(0);

      try {
        const response = await client.uploadCard(file, metadata, token);
        setUploadProgress(100);
        return response;
      } finally {
        setUploading(false);
      }
    },
    [client]
  );

  const getCard = useCallback(
    (cardId: string, token: string) =>
      client.getCard(cardId, token),
    [client]
  );

  const listCards = useCallback(
    (token: string, filters?: Record<string, unknown>) =>
      client.listCards(token, filters),
    [client]
  );

  const processCard = useCallback(
    (cardId: string, processingOptions: Record<string, unknown>, token: string) =>
      client.processCard(cardId, processingOptions, token),
    [client]
  );

  const deleteCard = useCallback(
    (cardId: string, token: string) =>
      client.deleteCard(cardId, token),
    [client]
  );

  return {
    uploadCard,
    getCard,
    listCards,
    processCard,
    deleteCard,
    uploading,
    uploadProgress,
  };
}

/**
 * Hook for accessing environment config in components
 */
export function useEnvConfig() {
  return {
    isDevelopment: envConfig.app.environment === 'development',
    isProduction: envConfig.app.environment === 'production',
    isStaging: envConfig.app.environment === 'staging',
    debugMode: envConfig.app.debugMode,
    features: envConfig.features,
    cardCapture: envConfig.cardCapture,
    apiBaseUrl: envConfig.api.baseUrl,
  };
}

/**
 * Combined hook for all cores
 */
export function useCores() {
  const auth = useAuthCore();
  const storage = useStorageCore();
  const audit = useAuditCore();
  const cardCapture = useCardCapture();
  const config = useEnvConfig();

  return {
    auth,
    storage,
    audit,
    cardCapture,
    config,
  };
}
