import { ScanRecord } from '@/types/scan';

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
    return [];
  }
}

export function saveScanRecord(record: ScanRecord) {
  const history = getScanHistory();
  history.unshift(record);
  // Keep last 50
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
}

export function deleteScanRecord(id: string) {
  const history = getScanHistory().filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
