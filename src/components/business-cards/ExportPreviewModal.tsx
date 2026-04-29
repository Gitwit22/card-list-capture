/**
 * ExportPreviewModal.tsx
 *
 * Phase 3 export preview dialog.
 * Shows a summary of export readiness before downloading, with:
 *   - Counts: ready / warning / blocked / excluded
 *   - Toggle: export all vs. ready cards only
 *   - List of blocked cards (name + blocked reasons)
 *   - Confirm / Cancel
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { CheckCheck, ShieldAlert, Ban, EyeOff, Download } from 'lucide-react';
import { BusinessCardEntry } from '@/types/scan';
import { getExportSummary, humanizeExportReason } from '@/lib/exportValidation';

interface ExportPreviewModalProps {
  open: boolean;
  cards: BusinessCardEntry[];
  onConfirm: (readyOnly: boolean) => void;
  onCancel: () => void;
}

export function ExportPreviewModal({ open, cards, onConfirm, onCancel }: ExportPreviewModalProps) {
  const [readyOnly, setReadyOnly] = useState(false);
  const summary = getExportSummary(cards);

  const blockedCards = cards.filter(
    (c) => !c.excludeFromExport && c.exportStatus === 'export_blocked',
  );

  const warningCards = cards.filter(
    (c) => !c.excludeFromExport && c.exportStatus === 'export_warning',
  );

  const exportCount = readyOnly
    ? summary.readyToExport + summary.exportWarning
    : summary.readyToExport + summary.exportWarning + summary.exportBlocked;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export Preview
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Summary counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 text-center">
              <CheckCheck className="w-4 h-4 mx-auto mb-1 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{summary.readyToExport}</div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400">Ready</div>
            </div>
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-3 text-center">
              <ShieldAlert className="w-4 h-4 mx-auto mb-1 text-yellow-600 dark:text-yellow-400" />
              <div className="text-xl font-bold text-yellow-700 dark:text-yellow-300">{summary.exportWarning}</div>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">Warning</div>
            </div>
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-3 text-center">
              <Ban className="w-4 h-4 mx-auto mb-1 text-red-600 dark:text-red-400" />
              <div className="text-xl font-bold text-red-700 dark:text-red-300">{summary.exportBlocked}</div>
              <div className="text-xs text-red-600 dark:text-red-400">Blocked</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
              <EyeOff className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xl font-bold text-muted-foreground">{summary.excluded}</div>
              <div className="text-xs text-muted-foreground">Excluded</div>
            </div>
          </div>

          {/* Ready-only toggle */}
          {summary.exportBlocked > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
              <label className="flex items-center gap-2 cursor-pointer select-none flex-1">
                <input
                  type="checkbox"
                  checked={readyOnly}
                  onChange={(e) => setReadyOnly(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">
                  Export ready &amp; warning cards only
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({summary.readyToExport + summary.exportWarning} records — skips {summary.exportBlocked} blocked)
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* Blocked card list */}
          {blockedCards.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-2 flex items-center gap-1">
                <Ban className="w-3.5 h-3.5" />
                Blocked records {readyOnly ? '(will be skipped)' : '(will be included with issues)'}:
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {blockedCards.map((card) => (
                  <div key={card.id} className="text-xs rounded border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-900/10 px-3 py-2">
                    <span className="font-medium text-foreground">
                      {card.fullName || card.company || `Card ${card.cropIndex ?? '—'}`}
                    </span>
                    <div className="text-red-600 dark:text-red-400 mt-0.5">
                      {(card.exportBlockedReasons ?? []).map(humanizeExportReason).join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning card list (abbreviated) */}
          {warningCards.length > 0 && warningCards.length <= 5 && (
            <div>
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                Records with warnings (will be included):
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {warningCards.map((card) => (
                  <div key={card.id} className="text-xs text-yellow-600 dark:text-yellow-400 flex gap-2">
                    <span className="font-medium text-foreground shrink-0">
                      {card.fullName || card.company || `Card ${card.cropIndex ?? '—'}`}
                    </span>
                    <span>{(card.exportWarningReasons ?? []).slice(0, 2).map(humanizeExportReason).join(' · ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {warningCards.length > 5 && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              {warningCards.length} records have warnings — they will be included in the export.
            </p>
          )}
        </div>

        <DialogFooter className="pt-4 border-t border-border">
          <div className="flex items-center justify-between w-full gap-3">
            <span className="text-sm text-muted-foreground">
              Exporting <strong>{exportCount}</strong> record{exportCount !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
              <Button size="sm" onClick={() => onConfirm(readyOnly)} className="gap-1">
                <Download className="w-3.5 h-3.5" />
                Export{readyOnly ? ' Ready' : ' All'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
