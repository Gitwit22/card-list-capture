/**
 * IndexedDB-backed local draft session store for business card workflows.
 *
 * All data stays on-device. No backend upload. No cross-device sync.
 *
 * DB: card-capture-session  (v1)
 *   Object store "session"  – stores session metadata / queue / review data
 *   Object store "images"   – stores raw image bytes keyed by "<cardId>-front|back"
 */

import type { BatchItemStatus, BusinessCardEntry } from '@/types/scan';
import type { BusinessCardCaptureMode } from '@/components/ImageCapture';

// ─── Public types ────────────────────────────────────────────────────────────

export type SessionStep =
  | 'capture'
  | 'batch-queue'
  | 'processing'
  | 'batch-processing'
  | 'review';

export interface SerializedCardSide {
  imageKey: string; // "<cardId>-front" | "<cardId>-back"
  filename?: string;
  sourceType: 'camera' | 'upload';
}

export interface SerializedBatchItem {
  id: string;
  front: SerializedCardSide;
  back?: SerializedCardSide;
  status: BatchItemStatus;
  error?: string;
  extractedRows: BusinessCardEntry[];
  needsReview: boolean;
  index: number;
}

export interface LocalDraftSession {
  id: string;
  mode: BusinessCardCaptureMode;
  step: SessionStep;
  batchQueue: SerializedBatchItem[];
  data: BusinessCardEntry[];
  rapidPendingCardId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageRecord {
  key: string;
  data: ArrayBuffer;
  mimeType: string;
  filename: string;
}

// ─── Private helpers ─────────────────────────────────────────────────────────

const DB_NAME = 'card-capture-session';
const DB_VERSION = 1;
const SESSION_STORE = 'session';
const IMAGES_STORE = 'images';
const SESSION_KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE);
      }
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist session metadata and any new image records.
 * Pass only newly-added image records; already-stored records are kept as-is.
 */
export async function saveSession(
  session: Omit<LocalDraftSession, 'updatedAt'>,
  newImages: ImageRecord[] = [],
): Promise<void> {
  const db = await openDB();
  const full: LocalDraftSession = { ...session, updatedAt: new Date().toISOString() };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SESSION_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(SESSION_STORE).put(full, SESSION_KEY);
    const imgStore = tx.objectStore(IMAGES_STORE);
    for (const img of newImages) {
      imgStore.put(img, img.key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

/** Load the draft session and all stored images. Returns null if none exists. */
export async function loadSession(): Promise<{
  session: LocalDraftSession;
  images: Map<string, ImageRecord>;
} | null> {
  const db = await openDB();

  const result = await new Promise<{
    session: LocalDraftSession;
    images: Map<string, ImageRecord>;
  } | null>((resolve, reject) => {
    const tx = db.transaction([SESSION_STORE, IMAGES_STORE], 'readonly');
    const sessionReq = tx.objectStore(SESSION_STORE).get(SESSION_KEY);
    const imgValsReq = tx.objectStore(IMAGES_STORE).getAll();
    const imgKeysReq = tx.objectStore(IMAGES_STORE).getAllKeys();

    tx.oncomplete = () => {
      const session = sessionReq.result as LocalDraftSession | undefined;
      if (!session) {
        resolve(null);
        return;
      }
      const images = new Map<string, ImageRecord>();
      const vals = imgValsReq.result as ImageRecord[];
      const keys = imgKeysReq.result as string[];
      keys.forEach((k, i) => images.set(k, vals[i]));
      resolve({ session, images });
    };

    tx.onerror = () => reject(tx.error);
  });

  db.close();
  return result;
}

/** Returns true if an unfinished session exists in IndexedDB. */
export async function hasSession(): Promise<boolean> {
  const db = await openDB();
  const found = await new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction([SESSION_STORE], 'readonly');
    const req = tx.objectStore(SESSION_STORE).count();
    req.onsuccess = () => resolve(req.result > 0);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return found;
}

/** Delete all session data including stored images. */
export async function clearSession(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SESSION_STORE, IMAGES_STORE], 'readwrite');
    tx.objectStore(SESSION_STORE).clear();
    tx.objectStore(IMAGES_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ─── Serialization helpers ────────────────────────────────────────────────────

/** Read a File's bytes into an ImageRecord for storage. */
export async function fileToImageRecord(
  key: string,
  file: File,
): Promise<ImageRecord> {
  const data = await file.arrayBuffer();
  return { key, data, mimeType: file.type || 'image/jpeg', filename: file.name };
}

/** Reconstruct a File from a stored ImageRecord. */
export function imageRecordToFile(record: ImageRecord): File {
  return new File([record.data], record.filename, { type: record.mimeType });
}
