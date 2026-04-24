import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BusinessCardWorkflow } from '@/components/business-cards/BusinessCardWorkflow';

const mockDetectBusinessCardCrops = vi.fn();
const mockExtractBusinessCardBatch = vi.fn();
const mockExportData = vi.fn();

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

vi.mock('@/components/business-cards/SessionBanner', () => ({
  SessionBanner: () => null,
}));

vi.mock('@/components/ScanToSheetLoadingAnimation', () => ({
  ScanToSheetLoadingAnimation: () => <div data-testid="processing-animation">Processing</div>,
}));

vi.mock('@/components/ImageCapture', () => ({
  ImageCapture: ({ onBatchAdd, onViewQueue }: { onBatchAdd?: (captures: any[]) => void; onViewQueue?: () => void }) => (
    <div>
      <button
        type="button"
        onClick={() => onBatchAdd?.([
          {
            file: new File(['photo-a'], '1000002308.jpg', { type: 'image/jpeg' }),
            previewUrl: 'blob:photo-a',
            sourceType: 'upload',
          },
        ])}
      >
        Add Photo A
      </button>
      <button
        type="button"
        onClick={() => onBatchAdd?.([
          {
            file: new File(['photo-b'], '1000002309.jpg', { type: 'image/jpeg' }),
            previewUrl: 'blob:photo-b',
            sourceType: 'upload',
          },
        ])}
      >
        Add Photo B
      </button>
      <button type="button" onClick={() => onViewQueue?.()}>
        Open Queue
      </button>
    </div>
  ),
}));

vi.mock('@/components/DataReview', () => ({
  DataReview: ({ data }: { data: Array<{ company?: string }> }) => (
    <div data-testid="data-review-count">Rows:{data.length} Companies:{data.map((row) => row.company || '').join('|')}</div>
  ),
}));

vi.mock('@/components/ExportSidebar', () => ({
  ExportSidebar: ({ readyCount, onExport }: { readyCount: number; onExport: () => void }) => (
    <div>
      <div data-testid="ready-count">Ready:{readyCount}</div>
      <button type="button" onClick={onExport}>Export Now</button>
    </div>
  ),
}));

vi.mock('@/lib/multiCardDetection', () => ({
  detectBusinessCardCrops: (...args: unknown[]) => mockDetectBusinessCardCrops(...args),
}));

vi.mock('@/lib/export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/export')>('@/lib/export');
  return {
    ...actual,
    exportData: (...args: unknown[]) => mockExportData(...args),
  };
});

vi.mock('@/lib/extraction', async () => {
  const actual = await vi.importActual<typeof import('@/lib/extraction')>('@/lib/extraction');
  return {
    ...actual,
    extractBusinessCardBatch: (...args: unknown[]) => mockExtractBusinessCardBatch(...args),
  };
});

function makeDetection(count: number, sourceImageName: string) {
  return {
    crops: Array.from({ length: count }, (_, index) => ({
      id: `${sourceImageName}-crop-${index + 1}`,
      cropIndex: index + 1,
      file: new File([`crop-${index + 1}`], `${sourceImageName}-crop-${index + 1}.jpg`, { type: 'image/jpeg' }),
      previewUrl: `blob:${sourceImageName}-crop-${index + 1}`,
      bounds: { x: 10 + index * 5, y: 20, width: 220, height: 130 },
      confidence: 0.88,
      warnings: [],
      aspectRatio: 1.69,
      areaPercent: 6.2,
    })),
    warnings: [],
    debug: {
      sourceImageName,
      imageWidth: 2000,
      imageHeight: 1400,
      detectedCardCount: count,
      candidateCount: count + 2,
      rejectedCandidateCount: 2,
      rejectionReasons: { too_small: 2 },
      candidates: [],
      overlayUrl: 'data:image/png;base64,debug',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockDetectBusinessCardCrops.mockImplementation(async (file: File) => {
    if (file.name.includes('1000002308')) return makeDetection(6, file.name);
    if (file.name.includes('1000002309')) return makeDetection(6, file.name);
    return makeDetection(2, file.name);
  });

  mockExtractBusinessCardBatch.mockImplementation(async (items: any[], options?: any) => {
    const nextItems = items.map((item, index) => {
      const row = {
        id: `row-${item.id}`,
        fullName: `Person ${index + 1}`,
        firstName: `Person`,
        lastName: `${index + 1}`,
        company: `Company ${item.cropIndex ?? index + 1}`,
        title: '',
        phone: '',
        email: '',
        website: '',
        address: '',
        social: '',
        comment: '',
        extraFields: {},
        rawText: '',
        sourceLabel: item.front?.filename || `Card ${index + 1}`,
        sourceItemId: item.id,
        sourceCardId: item.id,
        sourceImageId: item.sourceImageId,
        sourceImageName: item.sourceImageName,
        cropIndex: item.cropIndex,
        cropImageUrl: item.front?.previewUrl,
        scanMode: item.scanMode,
        confidence: item.confidence ?? 0.8,
        warnings: item.warnings ?? [],
        status: item.needsReview ? 'needs_review' : 'complete',
        needsReview: Boolean(item.needsReview),
      };

      const status = item.needsReview ? 'needs_review' : 'done';
      options?.onItemUpdate?.(item.id, { status, extractedRows: [row], needsReview: Boolean(item.needsReview) });

      return {
        ...item,
        status,
        needsReview: Boolean(item.needsReview),
        extractedRows: [row],
      };
    });

    const summary = {
      total: nextItems.length,
      queued: 0,
      processing: 0,
      done: nextItems.filter((item: any) => item.status === 'done').length,
      failed: 0,
      needsReview: nextItems.filter((item: any) => item.status === 'needs_review').length,
    };

    options?.onProgress?.(summary);

    return {
      items: nextItems,
      combinedRows: nextItems.flatMap((item: any) => item.extractedRows),
      summary,
    };
  });
});

function renderWorkflow() {
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

describe('BusinessCardWorkflow multi-card mode', () => {
  it('one image with 6 cards creates multiple rows, not one merged row', async () => {
    renderWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    await waitFor(() => expect(screen.getByTestId('detection-preview')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Detected 6 cards/i)).toBeInTheDocument());

    const processButton = screen.getByRole('button', { name: 'Process Batch' }) as HTMLButtonElement;
    await waitFor(() => expect(processButton.disabled).toBe(false));
    fireEvent.click(processButton);

    await waitFor(() => expect(screen.getByTestId('data-review-count')).toHaveTextContent('Rows:6'));
    expect(screen.getByText(/Ready to export: 6 rows/i)).toBeInTheDocument();
  }, 15000);

  it('zero detections fallback to one needs-review row', async () => {
    mockDetectBusinessCardCrops.mockResolvedValueOnce({
      crops: [],
      warnings: ['No clear card regions were detected. Falling back to single-card extraction.'],
      debug: {
        sourceImageName: '1000002308.jpg',
        imageWidth: 1800,
        imageHeight: 1200,
        detectedCardCount: 0,
        candidateCount: 0,
        rejectedCandidateCount: 0,
        rejectionReasons: {},
        candidates: [],
      },
    });

    renderWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    const processButton = screen.getByRole('button', { name: 'Process Batch' }) as HTMLButtonElement;
    await waitFor(() => expect(processButton.disabled).toBe(false));
    fireEvent.click(processButton);

    await waitFor(() => expect(screen.getByText(/Ready to export: 1 rows/i)).toBeInTheDocument());
    expect(screen.getByText(/Needs review: 1/i)).toBeInTheDocument();
  }, 15000);

  it('export includes all accumulated rows across multiple uploaded photos', async () => {
    mockDetectBusinessCardCrops
      .mockResolvedValueOnce(makeDetection(2, '1000002308.jpg'))
      .mockResolvedValueOnce(makeDetection(2, '1000002309.jpg'));

    renderWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    await waitFor(() => expect(screen.getByText(/Detected 4 cards/i)).toBeInTheDocument());
    const processButton = screen.getByRole('button', { name: 'Process Batch' }) as HTMLButtonElement;
    await waitFor(() => expect(processButton.disabled).toBe(false));
    fireEvent.click(processButton);

    await waitFor(() => expect(screen.getByText(/Ready to export: 4 rows/i)).toBeInTheDocument());
    expect(screen.getByText(/Total uploaded photos: 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export Now' }));

    await waitFor(() => expect(mockExportData).toHaveBeenCalled());
    const exportRows = mockExportData.mock.calls[0][0] as any[];
    expect(exportRows).toHaveLength(4);
  }, 15000);

  it('removing a crop prevents that crop from being processed', async () => {
    mockDetectBusinessCardCrops.mockResolvedValueOnce(makeDetection(3, '1000002308.jpg'));

    renderWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    const preview = await screen.findByTestId('detection-preview');
    const removeButtons = within(preview).getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[0]);

    const processButton = screen.getByRole('button', { name: 'Process Batch' }) as HTMLButtonElement;
    await waitFor(() => expect(processButton.disabled).toBe(false));
    fireEvent.click(processButton);
    await waitFor(() => expect(mockExtractBusinessCardBatch).toHaveBeenCalled());

    const firstCallItems = mockExtractBusinessCardBatch.mock.calls[0][0] as any[];
    expect(firstCallItems).toHaveLength(2);
  }, 15000);

  it('detection preview appears before OCR in multi-card mode', async () => {
    mockDetectBusinessCardCrops.mockResolvedValueOnce(makeDetection(2, '1000002308.jpg'));

    renderWorkflow();

    fireEvent.click(screen.getByRole('button', { name: 'Detect multiple cards in photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Photo A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Queue' }));

    await waitFor(() => expect(screen.getByTestId('detection-preview')).toBeInTheDocument());
    expect(mockExtractBusinessCardBatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Process Batch' }));
    await waitFor(() => expect(mockExtractBusinessCardBatch).toHaveBeenCalledTimes(1));
  });
});
