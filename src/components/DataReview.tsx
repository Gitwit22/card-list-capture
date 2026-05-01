import { useCallback, useEffect, useRef } from 'react';
import { SignupEntry, BusinessCardEntry, DocumentType, FieldConfidenceScores, BatchCorrectionRule } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Trash2, Plus, AlertTriangle, AlertCircle, CheckCircle2,
  Ban, ShieldAlert, RotateCcw, EyeOff, CheckCheck, ChevronRight,
  Copy, GitMerge,
} from 'lucide-react';
import { createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';
import { humanizeExportReason } from '@/lib/exportValidation';
import type { BatchCorrectionSuggestion } from '@/lib/batchBusinessCardResolver';

interface DataReviewProps {
  docType: DocumentType;
  data: (SignupEntry | BusinessCardEntry)[];
  onChange: (data: (SignupEntry | BusinessCardEntry)[]) => void;
  businessCardFilter?: 'all' | 'needs_review' | 'complete' | 'failed';
  onBusinessCardFilterChange?: (filter: 'all' | 'needs_review' | 'complete' | 'failed') => void;
  onReviewProblemRows?: () => void;
  onRetryFailed?: () => void;
  cardPreviewMap?: Record<string, { front?: string; back?: string; original?: string; sourceImageName?: string }>;
  // Phase 3 props
  focusedCardId?: string | null;
  onAcceptReady?: () => void;
  onReviewNext?: () => void;
  onMarkReady?: (cardId: string) => void;
  onExcludeFromExport?: (cardId: string) => void;
  onRestoreOriginal?: (cardId: string) => void;
  onMergeDuplicate?: (cardId: string, primaryId: string) => void;
  onKeepBoth?: (cardId: string) => void;
  onIgnoreDuplicate?: (cardId: string) => void;
  batchCorrectionSuggestions?: Record<string, BatchCorrectionSuggestion[]>; // cardId → suggestions
  onApplyBatchCorrection?: (rule: BatchCorrectionRule) => void;
  onDismissBatchCorrectionSuggestion?: (cardId: string, ruleId: string) => void;
}

/** Map a confidence score to a Tailwind border/ring class for field highlighting. */
function fieldConfidenceClass(score: number | undefined, isUserEdited: boolean): string {
  if (isUserEdited) return '';
  if (score === undefined) return '';
  if (score >= 0.80) return '';
  if (score >= 0.60) return 'border-yellow-400 focus-visible:ring-yellow-400';
  return 'border-red-400 focus-visible:ring-red-400';
}

/** Derive a human-readable reason label from a machine review-reason key. */
function humanizeReason(reason: string): string {
  const map: Record<string, string> = {
    no_name_or_company: 'No name or company found',
    no_person_name: 'No person name found',
    no_credible_name: 'No credible name detected — verify',
    low_confidence_name: 'Low-confidence name',
    low_confidence_company: 'Low-confidence company',
    website_contamination_cleaned: 'Website was cleaned (OCR junk removed)',
    phone_contamination_cleaned: 'Phone field had non-phone text',
    title_address_moved: 'Address fragment removed from title',
    company_address_moved: 'Address fragment removed from company',
    name_reclassified_as_company: 'Organization name moved from Full Name to Company',
    multiple_name_candidates: 'Multiple possible person names detected',
    conflicting_name_candidates: 'Conflicting name candidates — verify',
    conflicting_company_candidates: 'Conflicting company candidates — verify',
    name_not_found: 'No name detected',
    company_not_found: 'No company detected',
    fax_promoted_as_phone: 'Fax number used as primary phone',
    duplicate_same_email: 'Possible duplicate: same email address',
    duplicate_same_phone: 'Possible duplicate: same phone number',
    duplicate_same_name_company: 'Possible duplicate: same name & company',
    duplicate_same_website_phone: 'Possible duplicate: same website & phone',
  };

  if (reason.startsWith('company_batch_boosted_from:')) {
    const domain = reason.replace('company_batch_boosted_from:', '');
    return `Company auto-filled from batch domain @${domain}`;
  }

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

/** Export status badge. */
function ExportStatusBadge({ card }: { card: BusinessCardEntry }) {
  if (card.excludeFromExport) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted flex items-center gap-1">
        <EyeOff className="w-3 h-3" />Excluded
      </Badge>
    );
  }
  if (card.exportStatus === 'ready_to_export') {
    return (
      <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-400 flex items-center gap-1">
        <CheckCheck className="w-3 h-3" />Export Ready
      </Badge>
    );
  }
  if (card.exportStatus === 'export_warning') {
    return (
      <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3" />Export Warning
      </Badge>
    );
  }
  if (card.exportStatus === 'export_blocked') {
    return (
      <Badge variant="outline" className="text-xs text-red-600 border-red-400 flex items-center gap-1">
        <Ban className="w-3 h-3" />Export Blocked
      </Badge>
    );
  }
  return null;
}

export function DataReview({
  docType,
  data,
  onChange,
  businessCardFilter,
  onBusinessCardFilterChange,
  cardPreviewMap,
  focusedCardId,
  onAcceptReady,
  onReviewNext,
  onMarkReady,
  onExcludeFromExport,
  onRestoreOriginal,
  onMergeDuplicate,
  onKeepBoth,
  onIgnoreDuplicate,
  batchCorrectionSuggestions,
  onApplyBatchCorrection,
  onDismissBatchCorrectionSuggestion,
}: DataReviewProps) {
  const focusedRef = useRef<HTMLDivElement | null>(null);

  // Scroll to focused card when it changes
  useEffect(() => {
    if (focusedCardId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusedCardId]);

  const updateField = useCallback((index: number, field: string, value: string) => {
    const updated = [...data];
    const base = { ...updated[index], [field]: value } as SignupEntry | BusinessCardEntry;
    if (docType === 'business-card') {
      const card = base as BusinessCardEntry;
      // Snapshot original values on first edit
      if (!card.originalOcrValues) {
        const original = updated[index] as BusinessCardEntry;
        card.originalOcrValues = {
          fullName: original.fullName,
          firstName: original.firstName,
          lastName: original.lastName,
          company: original.company,
          title: original.title,
          phone: original.phone,
          email: original.email,
          website: original.website,
          address: original.address,
          tagline: original.tagline,
        };
      }
      const edited = new Set(card.userEdited ?? []);
      edited.add(field as keyof BusinessCardEntry);
      card.userEdited = edited;
      updated[index] = card;
    } else {
      updated[index] = base;
    }
    onChange(updated);
  }, [data, docType, onChange]);

  const removeRow = useCallback((index: number) => {
    onChange(data.filter((_, i) => i !== index));
  }, [data, onChange]);

  const addRow = useCallback(() => {
    if (docType === 'signup-sheet') {
      onChange([...data, createEmptySignupEntry()]);
    } else {
      onChange([...data, createEmptyBusinessCard()]);
    }
  }, [data, docType, onChange]);

  const signupFields = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'date', label: 'Date' },
    { key: 'comments', label: 'Comments' },
  ];

  const cardFields = [
    { key: 'fullName', label: 'Full Name' },
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
    const readyToExport = cards.filter((c) => c.exportStatus === 'ready_to_export').length;
    const exportWarning = cards.filter((c) => c.exportStatus === 'export_warning').length;
    const exportBlocked = cards.filter((c) => c.exportStatus === 'export_blocked').length;
    const excluded = cards.filter((c) => c.excludeFromExport).length;
    const avgConf = total > 0
      ? Math.round((cards.reduce((sum, c) => sum + (c.confidence ?? 0), 0) / total) * 100)
      : 0;
    return { total, needsReviewCount, readyToExport, exportWarning, exportBlocked, excluded, avgConf };
  })();

  // ── Filter counts ────────────────────────────────────────────────────────
  const filterCounts = (() => {
    if (docType !== 'business-card') return null;
    const cards = data as BusinessCardEntry[];
    const failedCount = cards.filter((c) => c.status === 'failed').length;
    const needsReviewCount = cards.filter((c) => c.status !== 'failed' && (c.needsReview || c.status === 'needs_review')).length;
    const completeCount = cards.filter((c) => c.status !== 'failed' && !c.needsReview && c.status !== 'needs_review').length;
    return {
      all: cards.length,
      needs_review: needsReviewCount,
      complete: completeCount,
      failed: failedCount,
    };
  })();

  // ── Visible entries after filter ─────────────────────────────────────────
  const visibleData = (() => {
    if (docType !== 'business-card' || !businessCardFilter || businessCardFilter === 'all') return data;
    return (data as BusinessCardEntry[]).filter((card) => {
      if (businessCardFilter === 'failed') return card.status === 'failed';
      if (businessCardFilter === 'needs_review') return card.status !== 'failed' && (card.needsReview || card.status === 'needs_review');
      if (businessCardFilter === 'complete') return card.status !== 'failed' && !card.needsReview && card.status !== 'needs_review';
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
          {batchSummary.readyToExport > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCheck className="w-3.5 h-3.5" />Export Ready: <strong>{batchSummary.readyToExport}</strong>
            </span>
          )}
          {batchSummary.exportWarning > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5" />Warning: <strong>{batchSummary.exportWarning}</strong>
            </span>
          )}
          {batchSummary.exportBlocked > 0 && (
            <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
              <Ban className="w-3.5 h-3.5" />Blocked: <strong>{batchSummary.exportBlocked}</strong>
            </span>
          )}
          {batchSummary.excluded > 0 && (
            <span className="text-muted-foreground flex items-center gap-1">
              <EyeOff className="w-3.5 h-3.5" />Excluded: <strong>{batchSummary.excluded}</strong>
            </span>
          )}
          {batchSummary.needsReviewCount > 0 && (
            <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />Needs Review: <strong>{batchSummary.needsReviewCount}</strong>
            </span>
          )}
          <span className="text-muted-foreground">Avg confidence: <strong>{batchSummary.avgConf}%</strong></span>
        </div>
      )}

      {/* ── Batch action bar ────────────────────────────────────────────── */}
      {docType === 'business-card' && (onAcceptReady || onReviewNext) && (
        <div className="flex flex-wrap gap-2">
          {onAcceptReady && (
            <Button variant="outline" size="sm" onClick={onAcceptReady} className="text-emerald-700 border-emerald-300 hover:bg-emerald-50">
              <CheckCheck className="w-3.5 h-3.5 mr-1" />Accept Ready Cards
            </Button>
          )}
          {onReviewNext && (
            <Button variant="outline" size="sm" onClick={onReviewNext}>
              <ChevronRight className="w-3.5 h-3.5 mr-1" />Review Next Problem
            </Button>
          )}
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
        {visibleData.map((entry) => {
          const realIndex = data.indexOf(entry);
          const isFocused = focusedCardId === entry.id;
          const card = docType === 'business-card' ? (entry as BusinessCardEntry) : null;
          const suggestions = card ? (batchCorrectionSuggestions?.[card.id] ?? []) : [];
          const isDuplicate = card?.duplicateOf && card.duplicateStatus !== 'ignored';

          return (
            <div
              key={entry.id}
              ref={isFocused ? focusedRef : undefined}
              className={[
                'bg-card rounded-lg border p-4 card-shadow transition-all',
                isFocused ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                card?.excludeFromExport ? 'opacity-60' : '',
              ].join(' ')}
            >
              {/* ── Card header ─────────────────────────────────────────── */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Entry {realIndex + 1}
                  </span>
                  {/* Review status badge */}
                  {card && (() => {
                    if (card.status === 'failed') {
                      return <Badge variant="destructive" className="text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</Badge>;
                    }
                    if (card.needsReview) {
                      return <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Needs Review</Badge>;
                    }
                    return <Badge variant="outline" className="text-xs text-green-600 border-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Ready</Badge>;
                  })()}
                  {/* Export status badge */}
                  {card && <ExportStatusBadge card={card} />}
                  {card?.manualCrop && <Badge variant="secondary">Manual Crop</Badge>}
                  {card?.manualEntry && <Badge variant="secondary">Manual Entry</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  {/* Per-card action buttons */}
                  {card && onMarkReady && !card.excludeFromExport && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2 text-emerald-700 hover:bg-emerald-50"
                      title="Mark as ready to export"
                      onClick={() => onMarkReady(card.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {card && onExcludeFromExport && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                      title={card.excludeFromExport ? 'Include in export' : 'Exclude from export'}
                      onClick={() => onExcludeFromExport(card.id)}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {card && onRestoreOriginal && card.originalOcrValues && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
                      title="Restore original OCR values"
                      onClick={() => onRestoreOriginal(card.id)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {data.length > 1 && (
                    <button onClick={() => removeRow(realIndex)} className="text-muted-foreground hover:text-destructive transition-colors ml-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* ── Duplicate warning banner ─────────────────────────────── */}
              {isDuplicate && card && (
                <div className="mb-3 flex items-center gap-2 flex-wrap rounded-md bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">
                    {card.duplicateStatus === 'confirmed' ? 'Confirmed duplicate' : 'Possible duplicate'}
                    {' '}— matches another card in this batch
                  </span>
                  {onMergeDuplicate && card.duplicateOf && (
                    <button
                      className="underline underline-offset-2 hover:text-orange-900 dark:hover:text-orange-200 flex items-center gap-1"
                      onClick={() => onMergeDuplicate(card.id, card.duplicateOf!)}
                    >
                      <GitMerge className="w-3 h-3" />Merge
                    </button>
                  )}
                  {onKeepBoth && (
                    <button
                      className="underline underline-offset-2 hover:text-orange-900 dark:hover:text-orange-200"
                      onClick={() => onKeepBoth(card.id)}
                    >
                      Keep both
                    </button>
                  )}
                  {onIgnoreDuplicate && (
                    <button
                      className="underline underline-offset-2 hover:text-orange-900 dark:hover:text-orange-200"
                      onClick={() => onIgnoreDuplicate(card.id)}
                    >
                      Ignore
                    </button>
                  )}
                </div>
              )}

              {/* ── Export blocked reasons ───────────────────────────────── */}
              {card?.exportStatus === 'export_blocked' && (card.exportBlockedReasons?.length ?? 0) > 0 && (
                <div className="mb-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1 flex items-center gap-1">
                    <Ban className="w-3 h-3" />Export blocked:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {Array.from(new Set(card.exportBlockedReasons!)).map((r) => (
                      <li key={r} className="text-xs text-red-600 dark:text-red-400">{humanizeExportReason(r)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ── Export warning reasons ───────────────────────────────── */}
              {card?.exportStatus === 'export_warning' && (card.exportWarningReasons?.length ?? 0) > 0 && (
                <div className="mb-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 px-3 py-2">
                  <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1 flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" />Export warnings:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {Array.from(new Set(card.exportWarningReasons!)).slice(0, 3).map((r) => (
                      <li key={r} className="text-xs text-yellow-600 dark:text-yellow-400">{humanizeExportReason(r)}</li>
                    ))}
                    {Array.from(new Set(card.exportWarningReasons!)).length > 3 && (
                      <li className="text-xs text-yellow-500">+{Array.from(new Set(card.exportWarningReasons!)).length - 3} more</li>
                    )}
                  </ul>
                </div>
              )}

              {/* ── Review reasons ──────────────────────────────────────── */}
              {card && (() => {
                const reasons = Array.from(new Set(card.warnings?.filter((w) => w && !w.startsWith('fax_') && !w.startsWith('company_batch_boosted_from:') && !w.startsWith('duplicate_')) ?? []));
                const batchBoosts = Array.from(new Set(card.warnings?.filter((w) => w.startsWith('company_batch_boosted_from:')) ?? []));
                if (reasons.length === 0 && batchBoosts.length === 0) return null;
                return (
                  <div className="mb-3 flex flex-wrap gap-1">
                    {reasons.map((r) => (
                      <span key={r} className="text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800 rounded px-2 py-0.5">
                        {humanizeReason(r)}
                      </span>
                    ))}
                    {batchBoosts.map((r) => (
                      <span key={r} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded px-2 py-0.5">
                        {humanizeReason(r)}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* ── Card preview links ───────────────────────────────────── */}
              {card && (() => {
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

              {/* ── Fields grid ─────────────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map(f => {
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
                        value={(entry as unknown as Record<string, string>)[f.key] || ''}
                        onChange={e => updateField(realIndex, f.key, e.target.value)}
                        placeholder={f.label}
                        className={inputClass}
                      />
                    </div>
                  );
                })}
              </div>

              {/* ── Batch correction suggestions ────────────────────────── */}
              {suggestions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion.rule.id}
                      className="flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs"
                    >
                      <span className="flex-1 text-blue-700 dark:text-blue-400">{suggestion.label}</span>
                      {onApplyBatchCorrection && (
                        <button
                          className="font-medium text-blue-700 dark:text-blue-300 underline underline-offset-2 hover:text-blue-900 dark:hover:text-blue-100"
                          onClick={() => onApplyBatchCorrection(suggestion.rule)}
                        >
                          Apply
                        </button>
                      )}
                      {onDismissBatchCorrectionSuggestion && card && (
                        <button
                          className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
                          onClick={() => onDismissBatchCorrectionSuggestion(card.id, suggestion.rule.id)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
