import { ScanRecord } from '@/types/scan';
import { toast } from 'sonner';

const STORAGE_KEY = 'scan2sheet_history';

export function getScanHistory(): ScanRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).map((r: any) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    }));
  } catch {
    toast.error('Failed to load scan history');
    return [];
  }
}

export function saveScanRecord(record: ScanRecord) {
  const history = getScanHistory();
  history.unshift(record);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      // Drop oldest entries and retry with smaller history
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
        toast.warning('Storage nearly full — older scans were removed.');
      } catch {
        toast.error('Storage is full. Could not save scan.');
      }
    } else {
      toast.error('Failed to save scan record.');
    }
  }
}

export function deleteScanRecord(id: string) {
  const history = getScanHistory().filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
