import { ScanRecord } from '@/types/scan';
import { Clock, FileSpreadsheet, CreditCard, Trash2, Download } from 'lucide-react';
import { exportToExcel } from '@/lib/export';
import { deleteScanRecord } from '@/lib/storage';

interface ScanHistoryProps {
  records: ScanRecord[];
  onRefresh: () => void;
}

export function ScanHistory({ records, onRefresh }: ScanHistoryProps) {
  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No scans yet. Start by scanning a document!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {records.map(record => (
        <div key={record.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border card-shadow hover:card-shadow-hover transition-shadow">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {record.type === 'signup-sheet' ? (
              <FileSpreadsheet className="w-5 h-5 text-primary" />
            ) : (
              <CreditCard className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {record.type === 'signup-sheet' ? 'Sign-Up Sheet' : 'Business Card'}
            </p>
            <p className="text-xs text-muted-foreground">
              {record.data.length} {record.data.length === 1 ? 'entry' : 'entries'} · {record.createdAt.toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => exportToExcel(record.data, record.type)}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Re-download"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => { deleteScanRecord(record.id); onRefresh(); }}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
