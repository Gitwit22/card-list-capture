import { SignupEntry, BusinessCardEntry, DocumentType, FieldConfidenceScores } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
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

/** Map a confidence score to a Tailwind border/ring class for field highlighting. */
function fieldConfidenceClass(score: number | undefined, isUserEdited: boolean): string {
  if (isUserEdited) return ''; // user-edited fields get no confidence styling
  if (score === undefined) return '';
  if (score >= 0.80) return ''; // normal — no additional class
  if (score >= 0.60) return 'border-yellow-400 focus-visible:ring-yellow-400';
  return 'border-red-400 focus-visible:ring-red-400';
}

/** Derive a human-readable reason label from a machine review-reason key. */
function humanizeReason(reason: string): string {
  const map: Record<string, string> = {
    no_name_or_company: 'No name or company found',
    no_person_name: 'No person name found',
    low_confidence_name: 'Low-confidence name',
    low_confidence_company: 'Low-confidence company',
    website_contamination_cleaned: 'Website was cleaned (OCR junk removed)',
    phone_contamination_cleaned: 'Phone field had non-phone text',
    title_address_moved: 'Address fragment removed from title',
    company_address_moved: 'Address fragment removed from company',
    multiple_name_candidates: 'Multiple possible person names detected',
    name_not_found: 'No name detected',
    company_not_found: 'No company detected',
    fax_promoted_as_phone: 'Fax number used as primary phone',
  };
  return map[reason] ?? reason.replace(/_/g, ' ');
}

/** Return the confidence value for a given card field key. */
function getFieldConfidence(
  fieldKey: string,
  fc: FieldConfidenceScores | undefined,
): number | undefined {
  if (!fc) return undefined;
  const key = fieldKey as keyof FieldConfidenceScores;
  return fc[key];
}

export function DataReview({ docType, data, onChange, businessCardFilter, onBusinessCardFilterChange, cardPreviewMap }: DataReviewProps) {
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

  // ── Batch summary (business-card only) ───────────────────────────────────
  const batchSummary = (() => {
    if (docType !== 'business-card') return null;
    const cards = data as BusinessCardEntry[];
    const total = cards.length;
    const needsReviewCount = cards.filter((c) => c.needsReview).length;
    const readyCount = total - needsReviewCount;
    const avgConf = total > 0
      ? Math.round((cards.reduce((sum, c) => sum + (c.confidence ?? 0), 0) / total) * 100)
      : 0;
    return { total, needsReviewCount, readyCount, avgConf };
  })();

  // ── Filter counts ────────────────────────────────────────────────────────
  const filterCounts = (() => {
    if (docType !== 'business-card') return null;
    const cards = data as BusinessCardEntry[];
    return {
      all: cards.length,
      needs_review: cards.filter((c) => c.needsReview || c.status === 'needs_review').length,
      complete: cards.filter((c) => !c.needsReview && c.status !== 'failed').length,
      failed: cards.filter((c) => c.status === 'failed').length,
    };
  })();

  // ── Visible entries after filter ─────────────────────────────────────────
  const visibleData = (() => {
    if (docType !== 'business-card' || !businessCardFilter || businessCardFilter === 'all') return data;
    return (data as BusinessCardEntry[]).filter((card) => {
      if (businessCardFilter === 'needs_review') return card.needsReview || card.status === 'needs_review';
      if (businessCardFilter === 'complete') return !card.needsReview && card.status !== 'failed';
      if (businessCardFilter === 'failed') return card.status === 'failed';
      return true;
    });
  })();

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

      {/* ── Batch summary bar ──────────────────────────────────────────── */}
      {batchSummary && batchSummary.total > 1 && (
        <div className="flex flex-wrap gap-3 text-sm rounded-lg border border-border bg-muted/40 px-4 py-2">
          <span className="text-muted-foreground">Total: <strong>{batchSummary.total}</strong></span>
          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Ready: <strong>{batchSummary.readyCount}</strong>
          </span>
          {batchSummary.needsReviewCount > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Needs Review: <strong>{batchSummary.needsReviewCount}</strong>
            </span>
          )}
          <span className="text-muted-foreground">Avg confidence: <strong>{batchSummary.avgConf}%</strong></span>
        </div>
      )}

      {/* ── Filter tabs ────────────────────────────────────────────────── */}
      {docType === 'business-card' && onBusinessCardFilterChange && filterCounts && (
        <div className="flex flex-wrap gap-2">
          {(['all', 'needs_review', 'complete', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => onBusinessCardFilterChange(f)}
              className={[
                'text-xs px-3 py-1 rounded-full border transition-colors',
                businessCardFilter === f
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : f === 'needs_review' ? 'Needs Review' : f === 'complete' ? 'Ready' : 'Failed'}
              {' '}({filterCounts[f]})
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {visibleData.map((entry, visibleIndex) => {
          const realIndex = data.indexOf(entry);
          return (
          <div key={entry.id} className="bg-card rounded-lg border border-border p-4 card-shadow">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Entry {visibleIndex + 1}
                </span>
                {docType === 'business-card' && (() => {
                  const card = entry as BusinessCardEntry;
                  if (card.status === 'failed') {
                    return <Badge variant="destructive" className="text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</Badge>;
                  }
                  if (card.needsReview) {
                    return <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Needs Review</Badge>;
                  }
                  return <Badge variant="outline" className="text-xs text-green-600 border-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Ready</Badge>;
                })()}
                {docType === 'business-card' && (entry as BusinessCardEntry).manualCrop && (
                  <Badge variant="secondary">Manual Crop</Badge>
                )}
                {docType === 'business-card' && (entry as BusinessCardEntry).manualEntry && (
                  <Badge variant="secondary">Manual Entry</Badge>
                )}
              </div>
              {data.length > 1 && (
                <button onClick={() => removeRow(realIndex)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* ── Review reasons ──────────────────────────────────────── */}
            {docType === 'business-card' && (() => {
              const card = entry as BusinessCardEntry;
              const reasons = card.warnings?.filter((w) => w && !w.startsWith('fax_')) ?? [];
              if (reasons.length === 0) return null;
              return (
                <div className="mb-3 flex flex-wrap gap-1">
                  {reasons.map((r) => (
                    <span key={r} className="text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded px-2 py-0.5">
                      {humanizeReason(r)}
                    </span>
                  ))}
                </div>
              );
            })()}

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
              {fields.map(f => {
                const card = docType === 'business-card' ? (entry as BusinessCardEntry) : null;
                const fc = card?.fieldConfidence;
                const isUserEdited = card?.userEdited?.has(f.key as keyof BusinessCardEntry) ?? false;
                const confScore = getFieldConfidence(f.key, fc);
                const inputClass = ['h-9 text-sm', fieldConfidenceClass(confScore, isUserEdited)].filter(Boolean).join(' ');
                return (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                      {f.label}
                      {isUserEdited && (
                        <span className="text-[10px] text-blue-500 font-normal">(edited)</span>
                      )}
                      {!isUserEdited && confScore !== undefined && confScore < 0.60 && (
                        <AlertCircle className="w-3 h-3 text-red-400" aria-label="Low confidence" />
                      )}
                      {!isUserEdited && confScore !== undefined && confScore >= 0.60 && confScore < 0.80 && (
                        <AlertTriangle className="w-3 h-3 text-yellow-400" aria-label="Medium confidence" />
                      )}
                    </label>
                    <Input
                      value={(entry as Record<string, string>)[f.key] || ''}
                      onChange={e => updateField(realIndex, f.key, e.target.value)}
                      placeholder={f.label}
                      className={inputClass}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )})}
      </div>
    </div>
  );
}
