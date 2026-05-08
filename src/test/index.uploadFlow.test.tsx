import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import Index from '@/pages/Index';

const mockExtractFromImage = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/lib/extraction', () => ({
  extractFromImage: (...args: unknown[]) => mockExtractFromImage(...args),
}));

vi.mock('@/components/ImageCapture', () => ({
  ImageCapture: ({ onImageSelected }: { onImageSelected: (file: File, previewUrl: string) => Promise<void> }) => (
    <button
      data-testid="mock-upload"
      onClick={() => onImageSelected(new File(['img'], 'sheet.jpg', { type: 'image/jpeg' }), 'blob:mock-url')}
    >
      Upload
    </button>
  ),
}));

vi.mock('@/components/DataReview', () => ({
  DataReview: ({ data }: { data: unknown }) => {
    if (!Array.isArray(data)) {
      throw new Error('DataReview expected array data');
    }

    return <div data-testid="data-review">rows: {data.length}</div>;
  },
}));

vi.mock('@/components/ScanHistory', () => ({
  ScanHistory: () => <div>History</div>,
}));

vi.mock('@/lib/storage', () => ({
  getScanHistory: () => [],
  saveScanRecord: vi.fn(),
}));

vi.mock('@/lib/export', () => ({
  exportToExcel: vi.fn(),
}));

describe('Index upload flow', () => {
  beforeEach(() => {
    mockExtractFromImage.mockReset();
  });

  it('uses extracted.entries so review renders without crashing', async () => {
    mockExtractFromImage.mockResolvedValue({
      entries: [
        {
          id: 'row-1',
          fullName: 'Jane Doe',
          organization: '',
          phone: '',
          email: '',
          screening: '',
          shareInfo: '',
          date: '',
          comments: '',
          extraFields: {},
        },
      ],
      meta: {
        structure: 'table',
        detectedHeaders: ['Name'],
        headerMapping: [],
        confidence: 0.92,
      },
    });

    render(<Index />);

    fireEvent.click(screen.getByRole('button', { name: /sign-up sheet/i }));
    fireEvent.click(screen.getByTestId('mock-upload'));

    await waitFor(() => {
      expect(screen.getByTestId('data-review')).toHaveTextContent('rows: 1');
    });
  });
});
