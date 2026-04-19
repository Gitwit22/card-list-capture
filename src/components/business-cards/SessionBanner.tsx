import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LocalDraftSession } from '@/lib/sessionStore';

interface SessionBannerProps {
  session: LocalDraftSession;
  onResume: () => void;
  onDiscard: () => void;
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 2) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return '';
  }
}

export function SessionBanner({ session, onResume, onDiscard }: SessionBannerProps) {
  const cardCount = session.batchQueue.length;
  const when = formatRelativeTime(session.updatedAt);

  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <HardDrive className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Unfinished session found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cardCount > 0 ? `${cardCount} card${cardCount !== 1 ? 's' : ''}` : 'Session data'} saved on this device
            {when ? `, ${when}` : ''}.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            This session is stored only on this device. Photos are kept locally until you clear them.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onResume} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Resume Last Session
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={onDiscard}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Discard Session
        </Button>
      </div>
    </div>
  );
}
