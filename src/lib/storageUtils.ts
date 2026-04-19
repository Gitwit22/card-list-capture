/**
 * Storage utilities: browser detection, storage quota monitoring, URL cleanup.
 */

/** Detect Safari private browsing mode (IndexedDB not available). */
export function isSafariPrivateMode(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (!/Safari/.test(navigator.userAgent)) return false;

  try {
    const test = '__safari_private_mode_test__';
    localStorage.setItem(test, '1');
    localStorage.removeItem(test);
    return false; // localStorage works, not private mode
  } catch {
    return true; // localStorage fails, likely private mode
  }
}

/**
 * Rough estimate of session size in bytes.
 * Factors in batch queue metadata, card data, and image previews.
 */
export function estimateSessionSize(params: {
  batchQueueLength: number;
  dataRowsLength: number;
  previewUrlCount: number;
}): number {
  const CARD_METADATA_BYTES = 2000; // per queued card
  const ROW_METADATA_BYTES = 1500; // per extracted row
  const PREVIEW_URL_BYTES = 500; // per ObjectURL string in memory

  return (
    params.batchQueueLength * CARD_METADATA_BYTES +
    params.dataRowsLength * ROW_METADATA_BYTES +
    params.previewUrlCount * PREVIEW_URL_BYTES
  );
}

/**
 * Format byte count as human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if session size warrants a warning (>50MB estimated).
 */
export function shouldWarnAboutStoragePressure(bytes: number): boolean {
  return bytes > 50 * 1024 * 1024;
}

/**
 * Revoke all ObjectURLs in a list and remove duplicates.
 */
export function cleanupObjectUrls(urls: Set<string>): void {
  for (const url of urls) {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors
      }
    }
  }
  urls.clear();
}
