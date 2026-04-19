import { ScanRecord } from '@/types/scan';
import { toast } from 'sonner';

const STORAGE_KEY = 'scan2sheet_history';
const LAST_SAVED_KEY = 'scan2sheet_last_saved';
const SAVE_FAILURE_KEY = 'scan2sheet_save_failed';

type StoredScanRecord = Omit<ScanRecord, 'createdAt'> & { createdAt: string };

export interface StorageStatus {
  lastSavedAt: Date | null;
  saveFailed: boolean;
  failureReason: string | null;
}

export function getScanHistory(): ScanRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredScanRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    }));
  } catch {
    toast.error('Failed to load scan history');
    return [];
  }
}

export function getStorageStatus(): StorageStatus {
  try {
    const lastSavedRaw = localStorage.getItem(LAST_SAVED_KEY);
    const lastSavedAt = lastSavedRaw ? new Date(lastSavedRaw) : null;
    const saveFailed = localStorage.getItem(SAVE_FAILURE_KEY) === 'true';
    const failureReason = saveFailed ? localStorage.getItem(`${SAVE_FAILURE_KEY}_reason`) : null;
    return { lastSavedAt, saveFailed, failureReason };
  } catch {
    return { lastSavedAt: null, saveFailed: true, failureReason: 'Storage check failed' };
  }
}

export function saveScanRecord(record: ScanRecord): boolean {
  const history = getScanHistory();
  history.unshift(record);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
    localStorage.setItem(LAST_SAVED_KEY, new Date().toISOString());
    localStorage.removeItem(SAVE_FAILURE_KEY);
    localStorage.removeItem(`${SAVE_FAILURE_KEY}_reason`);
    return true;
  } catch (err) {
    let reason = 'Unknown error';

    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      // Drop oldest entries and retry with smaller history
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
        localStorage.setItem(LAST_SAVED_KEY, new Date().toISOString());
        localStorage.removeItem(SAVE_FAILURE_KEY);
        toast.warning('Storage nearly full — older scans were removed.');
        return true;
      } catch {
        reason = 'Storage quota exceeded';
        localStorage.setItem(SAVE_FAILURE_KEY, 'true');
        localStorage.setItem(`${SAVE_FAILURE_KEY}_reason`, reason);
        toast.error('Storage is full. Could not save scan.');
        return false;
      }
    } else {
      reason = err instanceof Error ? err.message : 'Save failed';
      localStorage.setItem(SAVE_FAILURE_KEY, 'true');
      localStorage.setItem(`${SAVE_FAILURE_KEY}_reason`, reason);
      toast.error('Failed to save scan record.');
      return false;
    }
  }
}

export function deleteScanRecord(id: string) {
  try {
    const history = getScanHistory().filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    localStorage.setItem(LAST_SAVED_KEY, new Date().toISOString());
  } catch {
    // Silently fail on delete
  }
}

export function clearStorageStatus() {
  try {
    localStorage.removeItem(SAVE_FAILURE_KEY);
    localStorage.removeItem(`${SAVE_FAILURE_KEY}_reason`);
  } catch {
    // Ignore cleanup errors
  }
}
