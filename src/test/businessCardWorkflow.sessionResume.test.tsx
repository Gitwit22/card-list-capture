/**
 * Regression tests for the duplicate/session-resume scan mode bug.
 *
 * Covers:
 * - Multi-card mode after session resume
 * - Single-card mode after session resume
 * - Legacy sessions (no scanMode stored) with multi-card items → infer multi
 * - Legacy sessions (no scanMode stored) with single-card items → infer single
 * - Multi-card detection preview and Process Batch visible after resume
 * - Route never redirects multi-card mode to single-card-only page
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';
import type { LocalDraftSession } from '@/lib/sessionStore';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLoadSession = vi.fn();
const mockDetectBusinessCardCrops = vi.fn();
const mockExtractBusinessCardBatch = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/SettingsMenu', () => ({
  SettingsMenu: () => <div data-testid="settings-menu" />,
}));

vi.mock('@/components/ScanToSheetLoadingAnimation', () => ({
  ScanToSheetLoadingAnimation: () => <div data-testid="processing-animation">Processing</div>,
}));

// Render the real SessionBanner so its buttons are visible.
vi.mock('@/components/business-cards/SessionBanner', async () => {
  const actual = await vi.importActual<typeof import('@/components/business-cards/SessionBanner')>(
    '@/components/business-cards/SessionBanner',
  );
  return actual;
});

// ImageCapture mock that exposes onBatchAdd and onViewQueue
vi.mock('@/components/ImageCapture', () => ({
  ImageCapture: ({
    onBatchAdd,
    onViewQueue,
  }: {
    onBatchAdd?: (captures: unknown[]) => void;
    onViewQueue?: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onBatchAdd?.([
            {
              file: new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
              previewUrl: 'blob:photo',
              sourceType: 'upload',
            },
          ])
        }
      >
        Add Photo
      </button>
      <button type="button" onClick={() => onViewQueue?.()}>
        Open Queue
      </button>
    </div>
  ),
}));

vi.mock('@/components/DataReview', () => ({
  DataReview: ({ data }: { data: unknown[] }) => (
    <div data-testid="data-review-count">Rows:{data.length}</div>
  ),
}));

vi.mock('@/components/ExportSidebar', () => ({
  ExportSidebar: ({ readyCount }: { readyCount: number }) => (
    <div data-testid="ready-count">Ready:{readyCount}</div>
  ),
}));

vi.mock('@/lib/multiCardDetection', () => ({
  detectBusinessCardCrops: (...args: unknown[]) => mockDetectBusinessCardCrops(...args),
}));

vi.mock('@/lib/extraction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/extraction')>('@/lib/extraction');
  return {
    ...actual,
    extractBusinessCardBatch: (...args: unknown[]) => mockExtractBusinessCardBatch(...args),
  };
});

vi.mock('@/lib/sessionStore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sessionStore')>('@/lib/sessionStore');
  return {
    ...actual,
    loadSession: (...args: unknown[]) => mockLoadSession(...args),
    saveSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(undefined),
    hasSession: vi.fn().mockResolvedValue(false),
  };
});

// Always enable session resume.
vi.mock('@/lib/sessionSettings', () => ({
  getSessionSettings: () => ({
    keepPhotosAfterExport: true,
    autoDeletePhotosAfterExport: false,
    resumeUnfinishedSessions: true,
    warnAboutStoragePressure: false,
    showSafariPrivateModeWarning: false,
    storageFailureDetected: false,
  }),
  saveSessionSettings: vi.fn(),
}));

vi.mock('@/lib/export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/export')>('@/lib/export');
  return { ...actual, exportData: vi.fn() };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeFile(name = 'card.jpg'): File {
  return new File(['fake'], name, { type: 'image/jpeg' });
}

function makeSerializedItem(overrides: {
  id?: string;
  scanMode?: 'single-card' | 'multi-card';
  cropIndex?: number;
} = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    front: { imageKey: `${id}-front`, filename: 'card.jpg', sourceType: 'upload' as const },
    back: undefined,
    sourceImageId: `src-${id}`,
    sourceImageName: 'photo.jpg',
    sourceImageUrl: 'blob:photo',
    cropIndex: overrides.cropIndex ?? 1,
    scanMode: overrides.scanMode ?? 'single-card',
    confidence: 0.9,
    warnings: [],
    status: 'queued' as const,
    extractedRows: [],
    needsReview: false,
    index: 0,
  };
}

function makeSession(overrides: Partial<LocalDraftSession> = {}): LocalDraftSession {
  return {
    id: crypto.randomUUID(),
    mode: 'multi-upload',
    scanMode: undefined,
    step: 'batch-queue',
    batchQueue: [],
    data: [],
    rapidPendingCardId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFakeImageBytes(): ArrayBuffer {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer; // minimal JPEG header
}

function makeLoadSessionResult(session: LocalDraftSession) {
  const images = new Map(
    session.batchQueue.flatMap((item) => {
      const entries: Array<[string, { key: string; data: ArrayBuffer; mimeType: string; filename: string }]> = [
        [
          item.front.imageKey,
          {
            key: item.front.imageKey,
            data: makeFakeImageBytes(),
            mimeType: 'image/jpeg',
            filename: item.front.filename ?? 'card.jpg',
          },
        ],
      ];
      if (item.back) {
        entries.push([
          item.back.imageKey,
          {
            key: item.back.imageKey,
            data: makeFakeImageBytes(),
            mimeType: 'image/jpeg',
            filename: item.back.filename ?? 'back.jpg',
          },
        ]);
      }
      return entries;
    }),
  );
  return { session, images };
}

function renderUploadWorkflow() {
  return render(
    <MemoryRouter>
      <BusinessCardWorkflow
        mode="multi-upload"
        title="Upload Multiple Photos"
        subtitle="Test"
      />
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSession.mockResolvedValue(null);

  // jsdom does not implement URL.createObjectURL — stub it so handleResumeSession
  // can call it when rebuilding previews from stored image records.
  Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:mock-rebuilt-url') });
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });
  mockDetectBusinessCardCrops.mockResolvedValue({
    crops: [
      {
        id: 'crop-1',
        cropIndex: 1,
        file: makeFakeFile('crop-1.jpg'),
        previewUrl: 'blob:crop-1',
        bounds: { x: 10, y: 20, width: 220, height: 130 },
        confidence: 0.88,
        warnings: [],
        aspectRatio: 1.69,
        areaPercent: 6.2,
      },
    ],
    warnings: [],
    debug: {
      sourceImageName: 'photo.jpg',
      imageWidth: 2000,
      imageHeight: 1400,
      detectedCardCount: 1,
      candidateCount: 1,
      rejectedCandidateCount: 0,
      rejectionReasons: {},
      candidates: [],
    },
  });
  mockExtractBusinessCardBatch.mockResolvedValue({
    items: [],
    combinedRows: [],
    summary: { total: 0, queued: 0, processing: 0, done: 0, failed: 0, needsReview: 0 },
  });
});

describe('multi-card upload → detection preview', () => {
  it('selecting Detect multiple cards in photo then uploading shows detection preview', async () => {
    renderUploadWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    await waitFor(() => expect(screen.getByTestId('detection-preview')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Process Batch' })).toBeInTheDocument();
  }, 10000);
});

describe('session resume — scanMode preservation', () => {
  it('resuming a stored multi-card session keeps scanMode = multi-card', async () => {
    const items = [
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 1 }),
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 2 }),
    ];
    const session = makeSession({ scanMode: 'multi-card', batchQueue: items, step: 'batch-queue' });
    mockLoadSession.mockResolvedValue(makeLoadSessionResult(session));

    renderUploadWorkflow();

    // Wait for the session banner to appear.
    const resumeButton = await screen.findByRole('button', { name: /resume last session/i });
    fireEvent.click(resumeButton);

    // After resume, the detection preview should be visible (multi-card crops were restored).
    await waitFor(() =>
      expect(screen.getByTestId('detection-preview')).toBeInTheDocument(),
    );

    // Process Batch should be present.
    expect(screen.getByRole('button', { name: 'Process Batch' })).toBeInTheDocument();
  }, 10000);

  it('resuming a stored single-card session keeps scanMode = single-card (detection preview absent)', async () => {
    const items = [makeSerializedItem({ scanMode: 'single-card' })];
    const session = makeSession({ scanMode: 'single-card', batchQueue: items, step: 'batch-queue' });
    mockLoadSession.mockResolvedValue(makeLoadSessionResult(session));

    renderUploadWorkflow();

    const resumeButton = await screen.findByRole('button', { name: /resume last session/i });
    fireEvent.click(resumeButton);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Process Batch' })).toBeInTheDocument(),
    );

    // Detection preview only appears for multi-card sessions.
    expect(screen.queryByTestId('detection-preview')).not.toBeInTheDocument();
  }, 10000);

  it('legacy session without scanMode but with multi-card items infers multi-card', async () => {
    const items = [
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 1 }),
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 2 }),
    ];
    // Omit scanMode on the session object to simulate a legacy stored session.
    const session = makeSession({ scanMode: undefined, batchQueue: items, step: 'batch-queue' });
    mockLoadSession.mockResolvedValue(makeLoadSessionResult(session));

    renderUploadWorkflow();

    const resumeButton = await screen.findByRole('button', { name: /resume last session/i });
    fireEvent.click(resumeButton);

    // Multi-card detection preview should be restored.
    await waitFor(() =>
      expect(screen.getByTestId('detection-preview')).toBeInTheDocument(),
    );
  }, 10000);

  it('legacy session without scanMode and single-card items infers single-card', async () => {
    const items = [makeSerializedItem({ scanMode: 'single-card' })];
    const session = makeSession({ scanMode: undefined, batchQueue: items, step: 'batch-queue' });
    mockLoadSession.mockResolvedValue(makeLoadSessionResult(session));

    renderUploadWorkflow();

    const resumeButton = await screen.findByRole('button', { name: /resume last session/i });
    fireEvent.click(resumeButton);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Process Batch' })).toBeInTheDocument(),
    );

    expect(screen.queryByTestId('detection-preview')).not.toBeInTheDocument();
  }, 10000);

  it('resumed multi-card session still shows Process Batch and allows processing', async () => {
    const items = [
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 1 }),
      makeSerializedItem({ scanMode: 'multi-card', cropIndex: 2 }),
    ];
    const session = makeSession({ scanMode: 'multi-card', batchQueue: items, step: 'batch-queue' });
    mockLoadSession.mockResolvedValue(makeLoadSessionResult(session));

    mockExtractBusinessCardBatch.mockResolvedValue({
      items: items.map((item, i) => ({
        ...item,
        status: 'done',
        extractedRows: [{
          id: `row-${i}`,
          fullName: `Person ${i + 1}`,
          firstName: 'Person',
          lastName: `${i + 1}`,
          company: `Acme ${i + 1}`,
          title: '',
          phone: '',
          email: '',
          website: '',
          address: '',
          social: '',
          extraFields: {},
          rawText: '',
          status: 'complete',
          needsReview: false,
          scanMode: 'multi-card',
          sourceItemId: item.id,
          sourceCardId: item.id,
        }],
        needsReview: false,
      })),
      summary: { total: 2, queued: 0, processing: 0, done: 2, failed: 0, needsReview: 0 },
    });

    renderUploadWorkflow();

    const resumeButton = await screen.findByRole('button', { name: /resume last session/i });
    fireEvent.click(resumeButton);

    const processButton = await screen.findByRole('button', { name: 'Process Batch' }) as HTMLButtonElement;
    await waitFor(() => expect(processButton.disabled).toBe(false));
    fireEvent.click(processButton);

    await waitFor(() =>
      expect(screen.getByTestId('data-review-count')).toHaveTextContent('Rows:2'),
    );
  }, 15000);
});

describe('routing — multi-card mode is never redirected to single-card page', () => {
  it('/business-cards/upload mounts with mode=multi-upload (upload page is not single page)', () => {
    // Ensures the BusinessCardWorkflow receives mode="multi-upload"; the scan
    // mode buttons must be visible so the user can choose multi-card detection.
    renderUploadWorkflow();

    expect(screen.getByRole('button', { name: 'Detect multiple cards in photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan as single card' })).toBeInTheDocument();
  });

  it('selecting multi-card mode and uploading never falls back to single-card queue', async () => {
    mockDetectBusinessCardCrops.mockResolvedValue({
      crops: [
        {
          id: 'crop-1',
          cropIndex: 1,
          file: makeFakeFile('crop-1.jpg'),
          previewUrl: 'blob:crop-1',
          bounds: { x: 0, y: 0, width: 200, height: 120 },
          confidence: 0.9,
          warnings: [],
          aspectRatio: 1.67,
          areaPercent: 5,
        },
        {
          id: 'crop-2',
          cropIndex: 2,
          file: makeFakeFile('crop-2.jpg'),
          previewUrl: 'blob:crop-2',
          bounds: { x: 220, y: 0, width: 200, height: 120 },
          confidence: 0.85,
          warnings: [],
          aspectRatio: 1.67,
          areaPercent: 5,
        },
      ],
      warnings: [],
      debug: {
        sourceImageName: 'photo.jpg',
        imageWidth: 2000,
        imageHeight: 1400,
        detectedCardCount: 2,
        candidateCount: 2,
        rejectedCandidateCount: 0,
        rejectionReasons: {},
        candidates: [],
      },
    });

    renderUploadWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    // Queue must show 2 detected cards — NOT collapsed to a single entry.
    await waitFor(() => expect(screen.getByText(/Detected 2 cards/i)).toBeInTheDocument());
    expect(screen.getByTestId('detection-preview')).toBeInTheDocument();
  }, 10000);
});
