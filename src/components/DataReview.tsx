import { SignupEntry, BusinessCardEntry, DocumentType } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';
import { createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';

type BusinessCardFilter = 'all' | 'needs_review' | 'complete' | 'failed';

interface DataReviewProps {
  docType: DocumentType;
  data: (SignupEntry | BusinessCardEntry)[];
  onChange: (data: (SignupEntry | BusinessCardEntry)[]) => void;
  businessCardFilter?: BusinessCardFilter;
  onBusinessCardFilterChange?: (filter: BusinessCardFilter) => void;
  onReviewProblemRows?: () => void;
  onRetryFailed?: () => void;
}

export function DataReview({
  docType,
  data,
  onChange,
  businessCardFilter = 'all',
  onBusinessCardFilterChange,
  onReviewProblemRows,
  onRetryFailed,
}: DataReviewProps) {
  const updateField = (index: number, field: string, value: string) => {
    const updated = [...data];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeRow = (index: number) => {
    onChange(data.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (docType === 'signup-sheet') {
      onChange([...data, createEmptySignupEntry()]);
    } else {
      onChange([...data, createEmptyBusinessCard()]);
    }
  };

  const signupFields = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'organization', label: 'Organization' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'screening', label: 'Screening' },
    { key: 'shareInfo', label: 'Share Info' },
    { key: 'date', label: 'Date' },
    { key: 'comments', label: 'Comments' },
  ];

  const cardFields = [
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'company', label: 'Company' },
    { key: 'title', label: 'Title' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'address', label: 'Address' },
  ];

  const fields = docType === 'signup-sheet' ? signupFields : cardFields;

  const filteredData = docType === 'business-card'
    ? (data as BusinessCardEntry[]).filter((entry) => {
      if (businessCardFilter === 'all') return true;
      if (businessCardFilter === 'failed') return entry.status === 'failed';
      if (businessCardFilter === 'needs_review') return entry.status === 'needs_review' || entry.needsReview;
      if (businessCardFilter === 'complete') return entry.status === 'complete' && !entry.needsReview;
      return true;
    })
    : data;

  const filterButtons: Array<{ value: BusinessCardFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'needs_review', label: 'Needs Review' },
    { value: 'complete', label: 'Complete' },
    { value: 'failed', label: 'Failed' },
  ];

  const getBadgeVariant = (entry: BusinessCardEntry): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (entry.status === 'failed') return 'destructive';
    if (entry.status === 'needs_review' || entry.needsReview) return 'secondary';
    if (entry.status === 'complete') return 'default';
    return 'outline';
  };

  const getStatusLabel = (entry: BusinessCardEntry) => {
    if (entry.status === 'failed') return 'Failed';
    if (entry.status === 'needs_review' || entry.needsReview) return 'Needs Review';
    return 'Complete';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">
          Review Extracted Data ({filteredData.length} {filteredData.length === 1 ? 'entry' : 'entries'})
        </h3>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="w-4 h-4 mr-1" /> Add Row
        </Button>
      </div>

      {docType === 'business-card' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {filterButtons.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={businessCardFilter === filter.value ? 'default' : 'outline'}
                onClick={() => onBusinessCardFilterChange?.(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onReviewProblemRows}>
              Review Problem Rows
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onRetryFailed}>
              Retry Failed
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filteredData.map((entry, index) => (
          <div key={entry.id} className="bg-card rounded-lg border border-border p-4 card-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Entry {index + 1}
                </span>
                {docType === 'business-card' && (
                  <>
                    <Badge variant={getBadgeVariant(entry as BusinessCardEntry)}>
                      {getStatusLabel(entry as BusinessCardEntry)}
                    </Badge>
                    {(entry as BusinessCardEntry).sourceLabel && (
                      <Badge variant="outline">{(entry as BusinessCardEntry).sourceLabel}</Badge>
                    )}
                  </>
                )}
              </div>
              {data.length > 1 && (
                <button
                  onClick={() => {
                    const originalIndex = data.findIndex((item) => item.id === entry.id);
                    if (originalIndex >= 0) removeRow(originalIndex);
                  }}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {docType === 'business-card' && (entry as BusinessCardEntry).error && (
              <p className="text-xs text-destructive mb-3">{(entry as BusinessCardEntry).error}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fields.map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.label}</label>
                  <Input
                    value={(entry as Record<string, string>)[f.key] || ''}
                    onChange={e => updateField(index, f.key, e.target.value)}
                    placeholder={f.label}
                    className="h-9 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
