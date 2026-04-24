import { SignupEntry, BusinessCardEntry, DocumentType } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus } from 'lucide-react';
import { createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';

interface DataReviewProps {
  docType: DocumentType;
  data: (SignupEntry | BusinessCardEntry)[];
  onChange: (data: (SignupEntry | BusinessCardEntry)[]) => void;
  businessCardFilter?: 'all' | 'needs_review' | 'complete' | 'failed';
  onBusinessCardFilterChange?: (filter: 'all' | 'needs_review' | 'complete' | 'failed') => void;
  onReviewProblemRows?: () => void;
  onRetryFailed?: () => void;
  cardPreviewMap?: Record<string, { front?: string; back?: string; original?: string; sourceImageName?: string }>;
}

export function DataReview({ docType, data, onChange, cardPreviewMap }: DataReviewProps) {
  const updateField = (index: number, field: string, value: string) => {
    const updated = [...data];
    const base = { ...updated[index], [field]: value } as SignupEntry | BusinessCardEntry;
    if (docType === 'business-card') {
      const card = base as BusinessCardEntry;
      const edited = new Set(card.userEdited ?? []);
      edited.add(field as keyof BusinessCardEntry);
      card.userEdited = edited;
      updated[index] = card;
    } else {
      updated[index] = base;
    }
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
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">
          Review Extracted Data ({data.length} {data.length === 1 ? 'entry' : 'entries'})
        </h3>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="w-4 h-4 mr-1" /> Add Row
        </Button>
      </div>

      <div className="space-y-3">
        {data.map((entry, index) => (
          <div key={entry.id} className="bg-card rounded-lg border border-border p-4 card-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Entry {index + 1}
                </span>
                {docType === 'business-card' && (entry as BusinessCardEntry).manualCrop && (
                  <Badge variant="secondary">Manual Crop</Badge>
                )}
                {docType === 'business-card' && (entry as BusinessCardEntry).manualEntry && (
                  <Badge variant="secondary">Manual Entry</Badge>
                )}
              </div>
              {data.length > 1 && (
                <button onClick={() => removeRow(index)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {docType === 'business-card' && (() => {
              const card = entry as BusinessCardEntry;
              const previewKey = card.sourceCardId || card.sourceItemId || card.sourceImageId || card.id;
              const previews = cardPreviewMap?.[previewKey] ?? {
                front: card.cropImageUrl || card.frontPreviewUrl,
                back: card.backPreviewUrl,
                original: card.sourceImageUrl,
                sourceImageName: card.sourceImageName,
              };

              if (!previews.front && !previews.original && !previews.back) return null;

              return (
                <div className="mb-3 flex flex-wrap gap-2">
                  {previews.front && (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href={previews.front} target="_blank" rel="noreferrer">View Crop</a>
                    </Button>
                  )}
                  {previews.original && (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href={previews.original} target="_blank" rel="noreferrer">View Original Photo</a>
                    </Button>
                  )}
                  {previews.back && (
                    <Button type="button" size="sm" variant="outline" asChild>
                      <a href={previews.back} target="_blank" rel="noreferrer">View Back</a>
                    </Button>
                  )}
                </div>
              );
            })()}
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
