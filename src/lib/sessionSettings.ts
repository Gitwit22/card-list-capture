/**
 * Session settings — stored in localStorage (small booleans, not sensitive).
 * These govern privacy and lifecycle behaviour for the business card workflow.
 */

const SETTINGS_KEY = 'card_capture_session_settings';

export interface SessionSettings {
  /** Keep local image data after export (true = default, privacy-safe). */
  keepPhotosAfterExport: boolean;
  /** Automatically delete local photos immediately after export. */
  autoDeletePhotosAfterExport: boolean;
  /** Offer to resume an unfinished session on page reload. */
  resumeUnfinishedSessions: boolean;
  /** Warn user if storage pressure is detected. */
  warnAboutStoragePressure: boolean;
  /** Show Safari private-browsing warning if detected. */
  showSafariPrivateModeWarning: boolean;
  /** Track storage failures silently (no persistent user dismissal). */
  storageFailureDetected: boolean;
}

const defaults: SessionSettings = {
  keepPhotosAfterExport: true,
  autoDeletePhotosAfterExport: false,
  resumeUnfinishedSessions: true,
  warnAboutStoragePressure: true,
  showSafariPrivateModeWarning: true,
  storageFailureDetected: false,
};

export function getSessionSettings(): SessionSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function saveSessionSettings(settings: Partial<SessionSettings>): SessionSettings {
  const current = getSessionSettings();
  const next: SessionSettings = { ...current, ...settings };

  // keepPhotos and autoDelete are mutually exclusive – last write wins.
  if (settings.autoDeletePhotosAfterExport === true) {
    next.keepPhotosAfterExport = false;
  } else if (settings.keepPhotosAfterExport === true) {
    next.autoDeletePhotosAfterExport = false;
  }

  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // localStorage not available
  }

  return next;
}
}
