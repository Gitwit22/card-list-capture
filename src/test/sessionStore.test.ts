/**
 * Tests for sessionStore — IndexedDB-backed local draft session.
 *
 * jsdom ships with a basic indexedDB stub via fake-indexeddb or the
 * environment's built-in shim. We mock the low-level openDB calls so the
 * suite can run without a real browser context.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSessionSettings, saveSessionSettings } from '@/lib/sessionSettings';
import { fileToImageRecord, imageRecordToFile } from '@/lib/sessionStore';

// ─── sessionSettings tests ────────────────────────────────────────────────────

describe('sessionSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when no settings are stored', () => {
    const settings = getSessionSettings();
    expect(settings.keepPhotosAfterExport).toBe(true);
    expect(settings.autoDeletePhotosAfterExport).toBe(false);
    expect(settings.resumeUnfinishedSessions).toBe(true);
  });

  it('persists and retrieves saved settings', () => {
    saveSessionSettings({ keepPhotosAfterExport: false, autoDeletePhotosAfterExport: true });
    const settings = getSessionSettings();
    expect(settings.keepPhotosAfterExport).toBe(false);
    expect(settings.autoDeletePhotosAfterExport).toBe(true);
  });

  it('enforces mutual exclusivity: autoDelete=true forces keepPhotos=false', () => {
    const result = saveSessionSettings({ autoDeletePhotosAfterExport: true });
    expect(result.keepPhotosAfterExport).toBe(false);
    expect(result.autoDeletePhotosAfterExport).toBe(true);
  });

  it('enforces mutual exclusivity: keepPhotos=true forces autoDelete=false', () => {
    // First set both conflicting values to ensure override works.
    saveSessionSettings({ autoDeletePhotosAfterExport: true });
    const result = saveSessionSettings({ keepPhotosAfterExport: true });
    expect(result.keepPhotosAfterExport).toBe(true);
    expect(result.autoDeletePhotosAfterExport).toBe(false);
  });

  it('does not alter resumeUnfinishedSessions when toggling photo settings', () => {
    saveSessionSettings({ resumeUnfinishedSessions: false });
    saveSessionSettings({ autoDeletePhotosAfterExport: true });
    const settings = getSessionSettings();
    expect(settings.resumeUnfinishedSessions).toBe(false);
  });
});

// ─── sessionStore serialization helpers ──────────────────────────────────────

describe('sessionStore helpers', () => {
  it('fileToImageRecord reads file bytes into an ImageRecord', async () => {
    const content = 'fake-image-data';
    const file = new File([content], 'card.jpg', { type: 'image/jpeg' });
    const record = await fileToImageRecord('test-key', file);

    expect(record.key).toBe('test-key');
    expect(record.mimeType).toBe('image/jpeg');
    expect(record.filename).toBe('card.jpg');
    expect(record.data.byteLength).toBe(new TextEncoder().encode(content).byteLength);
  });

  it('imageRecordToFile reconstructs a File from stored bytes', async () => {
    const original = new File(['hello'], 'front.png', { type: 'image/png' });
    const record = await fileToImageRecord('my-key', original);
    const restored = imageRecordToFile(record);

    expect(restored.name).toBe('front.png');
    expect(restored.type).toBe('image/png');

    const originalText = await original.text();
    const restoredText = await restored.text();
    expect(restoredText).toBe(originalText);
  });

  it('round-trips a File through store and back', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const file = new File([bytes], 'back.png', { type: 'image/png' });
    const record = await fileToImageRecord('card-abc-back', file);
    const rebuilt = imageRecordToFile(record);

    const buf = await rebuilt.arrayBuffer();
    expect(new Uint8Array(buf)).toEqual(bytes);
  });
});
