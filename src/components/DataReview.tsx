import { useState } from 'react';
import { SignupEntry, BusinessCardEntry, DocumentType, ExtractionMeta } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';

type BusinessCardFilter = 'all' | 'needs_review' | 'complete' | 'failed';

interface DataReviewProps {
  docType: DocumentType;
  data: (SignupEntry | BusinessCardEntry)[];
  onChange: (data: (SignupEntry | BusinessCardEntry)[]) => void;
  meta?: ExtractionMeta;
  businessCardFilter?: BusinessCardFilter;
  onBusinessCardFilterChange?: (filter: BusinessCardFilter) => void;
  onReviewProblemRows?: () => void;
  onRetryFailed?: () => void;
  cardPreviewMap?: Record<string, { front?: string; back?: string }>;
}

export function DataReview({
  docType,
  data,
  onChange,
  meta,
  businessCardFilter = 'all',
  onBusinessCardFilterChange,
  onReviewProblemRows,
  onRetryFailed,
  cardPreviewMap,
}: DataReviewProps) {
  const [showExtras, setShowExtras] = useState<Record<string, boolean>>({});
  const [showDebug, setShowDebug] = useState(false);

  const getOriginalIndex = (id: string) => data.findIndex((entry) => entry.id === id);

  const updateField = (entryId: string, field: string, value: string) => {
    const index = getOriginalIndex(entryId);
    if (index < 0) return;
    const updated = [...data];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const updateExtraField = (entryId: string, key: string, value: string) => {
    const index = getOriginalIndex(entryId);
    if (index < 0) return;
    const updated = [...data];
    const entry = { ...updated[index] } as SignupEntry | BusinessCardEntry;
    entry.extraFields = { ...(entry.extraFields ?? {}), [key]: value };
    updated[index] = entry;
    onChange(updated);
  };

  const removeRow = (entryId: string) => {
    onChange(data.filter((entry) => entry.id !== entryId));
  };

  const addRow = () => {
    if (docType === 'signup-sheet') {
      onChange([...data, createEmptySignupEntry()]);
    } else {
      onChange([...data, createEmptyBusinessCard()]);
    }
  };

  const toggleExtras = (entryId: string) => {
    setShowExtras((prev) => ({ ...prev, [entryId]: !prev[entryId] }));
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
    { key: 'fullName', label: 'Full Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'company', label: 'Company' },
    { key: 'title', label: 'Title' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'address', label: 'Address' },
    { key: 'social', label: 'Social' },
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
        <div className="flex items-center gap-2">
          {meta && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDebug ? 'Hide' : 'Show'} debug
            </button>
          )}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4 mr-1" /> Add Row
          </Button>
        </div>
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

      {showDebug && meta && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-1 font-mono">
          <div><span className="text-muted-foreground">structure:</span> {meta.structure}</div>
          <div><span className="text-muted-foreground">confidence:</span> {(meta.confidence * 100).toFixed(0)}%</div>
          <div><span className="text-muted-foreground">detectedHeaders:</span> {meta.detectedHeaders.join(', ') || '(none)'}</div>
          {meta.headerMapping.length > 0 && (
            <div>
              <span className="text-muted-foreground">headerMapping:</span>
              <ul className="ml-3 mt-0.5">
                {meta.headerMapping.map((mapping, i) => (
                  <li key={i}>
                    {mapping.original} ? {mapping.normalized ?? <span className="text-yellow-600">unmapped</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filteredData.map((entry, index) => {
          const extras = (entry as SignupEntry | BusinessCardEntry).extraFields ?? {};
          const hasExtras = Object.keys(extras).length > 0;

          return (
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
                      <Badge variant={(entry as BusinessCardEntry).hasBack ? 'default' : 'secondary'}>
                        {(entry as BusinessCardEntry).hasBack ? 'Front + Back' : 'Front Only'}
                      </Badge>
                      {((entry as BusinessCardEntry).conflictFields?.length ?? 0) > 0 && (
                        <Badge variant="secondary">Conflict</Badge>
                      )}
                    </>
                  )}
                </div>
                {data.length > 1 && (
                  <button onClick={() => removeRow(entry.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {docType === 'business-card' && (entry as BusinessCardEntry).error && (
                <p className="text-xs text-destructive mb-3">{(entry as BusinessCardEntry).error}</p>
              )}

              {docType === 'business-card' && (() => {
                const cardEntry = entry as BusinessCardEntry;
                const sourceCardId = cardEntry.sourceCardId || cardEntry.sourceItemId;
                const previews = sourceCardId ? cardPreviewMap?.[sourceCardId] : undefined;

                if (!previews?.front && !previews?.back && !cardEntry.backText && !cardEntry.conflictFields?.length) {
                  return null;
                }

                return (
                  <div className="mb-3 space-y-2">
                    {(previews?.front || previews?.back) && (
                      <div className="flex flex-wrap gap-2">
                        {previews?.front && (
                          <Button type="button" size="sm" variant="outline" asChild>
                            <a href={previews.front} target="_blank" rel="noreferrer">View Front</a>
                          </Button>
                        )}
                        {previews?.back && (
                          <Button type="button" size="sm" variant="outline" asChild>
                            <a href={previews.back} target="_blank" rel="noreferrer">View Back</a>
                          </Button>
                        )}
                      </div>
                    )}
                    {cardEntry.conflictFields && cardEntry.conflictFields.length > 0 && (
                      <p className="text-xs text-amber-600">
                        Conflict fields: {cardEntry.conflictFields.join(', ')}
                      </p>
                    )}
                    {cardEntry.backText && (
                      <p className="text-xs text-muted-foreground">
                        Back text captured and merged into this row.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{field.label}</label>
                    <Input
                      value={(entry as Record<string, string>)[field.key] || ''}
                      onChange={(e) => updateField(entry.id, field.key, e.target.value)}
                      placeholder={field.label}
                      className="h-9 text-sm"
                    />
                  </div>
                ))}
              </div>

              {hasExtras && (
                <div className="mt-3">
                  <button
                    onClick={() => toggleExtras(entry.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showExtras[entry.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {Object.keys(extras).length} extra field{Object.keys(extras).length !== 1 ? 's' : ''}
                  </button>
                  {showExtras[entry.id] && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 pl-2 border-l-2 border-yellow-500/30">
                      {Object.entries(extras).map(([key, value]) => (
                        <div key={key}>
                          <label className="text-xs font-medium text-yellow-600 mb-1 block">{key}</label>
                          <Input
                            value={value}
                            onChange={(e) => updateExtraField(entry.id, key, e.target.value)}
                            placeholder={key}
                            className="h-9 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}