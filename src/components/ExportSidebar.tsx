import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { ExportFormat } from '@/lib/export';

const EXPORT_FORMAT_OPTIONS: Array<{ format: ExportFormat; label: string }> = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'csv', label: 'CSV (.csv)' },
  { format: 'tsv', label: 'TSV (.tsv)' },
  { format: 'json', label: 'JSON (.json)' },
  { format: 'md', label: 'Markdown (.md)' },
];

interface ExportSidebarProps {
  exportFormatSelection: Record<ExportFormat, boolean>;
  onToggleExportFormat: (format: ExportFormat, included: boolean) => void;
  onSelectAllExportFormats: () => void;
  onClearAllExportFormats: () => void;
  availableExportColumns: string[];
  exportColumnSelection: Record<string, boolean>;
  onToggleColumn: (column: string, included: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onReset: () => void;
  onExport: () => void;
  onExportAndClear?: () => void;
  readyCount: number;
  exportDisabled?: boolean;
  showAdvancedColumns?: boolean;
  onToggleAdvancedColumns?: (enabled: boolean) => void;
  auxiliaryActionLabel?: string;
  onAuxiliaryAction?: () => void;
}

export function ExportSidebar({
  exportFormatSelection,
  onToggleExportFormat,
  onSelectAllExportFormats,
  onClearAllExportFormats,
  availableExportColumns,
  exportColumnSelection,
  onToggleColumn,
  onSelectAll,
  onClearAll,
  onReset,
  onExport,
  onExportAndClear,
  readyCount,
  exportDisabled = false,
  showAdvancedColumns = false,
  onToggleAdvancedColumns,
  auxiliaryActionLabel,
  onAuxiliaryAction,
}: ExportSidebarProps) {
  const selectedCount = availableExportColumns.filter((column) => exportColumnSelection[column] !== false).length;
  const selectedFormats = EXPORT_FORMAT_OPTIONS.filter(({ format }) => exportFormatSelection[format] !== false);

  return (
    <aside className="w-full h-fit space-y-4 min-[1200px]:sticky min-[1200px]:top-24 min-[1200px]:w-[340px] min-[1200px]:justify-self-end">
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Export</p>
          <p className="text-sm text-muted-foreground">Ready to export: {readyCount} rows</p>
        </div>

        {auxiliaryActionLabel && onAuxiliaryAction && (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="outline" onClick={onAuxiliaryAction}>
              {auxiliaryActionLabel}
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Export File Types</p>
          <p className="text-xs text-muted-foreground">{selectedFormats.length}/{EXPORT_FORMAT_OPTIONS.length} selected</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onSelectAllExportFormats}>
            Select all
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClearAllExportFormats}>
            Clear all
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {EXPORT_FORMAT_OPTIONS.map(({ format, label }) => (
            <label key={format} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={exportFormatSelection[format] !== false}
                onCheckedChange={(checked) => onToggleExportFormat(format, Boolean(checked))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">Export Columns</p>
          <p className="text-xs text-muted-foreground">{selectedCount}/{availableExportColumns.length} selected</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onSelectAll}>
            Select all
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClearAll}>
            Clear all
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReset}>
            Reset to detected
          </Button>
          {onToggleAdvancedColumns && (
            <Button
              type="button"
              size="sm"
              variant={showAdvancedColumns ? 'default' : 'outline'}
              onClick={() => onToggleAdvancedColumns(!showAdvancedColumns)}
            >
              {showAdvancedColumns ? 'Hide Advanced' : 'Show Advanced'}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto pr-1">
          {availableExportColumns.map((column) => (
            <label key={column} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                checked={exportColumnSelection[column] !== false}
                onCheckedChange={(checked) => onToggleColumn(column, Boolean(checked))}
              />
              <span className="truncate">{column}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Button
          onClick={onExport}
          disabled={exportDisabled}
          className="w-full scan-gradient scan-shadow h-12 text-primary-foreground font-medium"
        >
          <Download className="w-5 h-5 mr-2" />
          Export Selected Files
        </Button>

        {onExportAndClear && (
          <Button onClick={onExportAndClear} disabled={exportDisabled} variant="outline" className="w-full h-11">
            <Download className="w-5 h-5 mr-2" />
            Export Selected Files and Clear Session
          </Button>
        )}
      </div>
    </aside>
  );
}