import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { getSessionSettings, saveSessionSettings, type SessionSettings } from '@/lib/sessionSettings';

export function SettingsMenu() {
  const [settings, setSettings] = useState<SessionSettings>(getSessionSettings);

  const update = (patch: Partial<SessionSettings>) => {
    const next = saveSessionSettings(patch);
    setSettings(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Session settings"
          className="h-8 w-8"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground mb-0.5">Session & Privacy</p>
          <p className="text-xs text-muted-foreground">
            All card data stays on this device only.
          </p>
        </div>

        <div className="space-y-3">
          {/* Resume unfinished sessions */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Label htmlFor="resume-sessions" className="text-sm font-medium">
                Resume unfinished sessions
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Offer to restore your in-progress session on reload.
              </p>
            </div>
            <Switch
              id="resume-sessions"
              checked={settings.resumeUnfinishedSessions}
              onCheckedChange={(checked) => update({ resumeUnfinishedSessions: checked })}
            />
          </div>

          {/* Keep photos after export */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Label htmlFor="keep-photos" className="text-sm font-medium">
                Keep photos after export
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Photos stay in local storage until you clear the session.
              </p>
            </div>
            <Switch
              id="keep-photos"
              checked={settings.keepPhotosAfterExport}
              onCheckedChange={(checked) =>
                update({ keepPhotosAfterExport: checked, autoDeletePhotosAfterExport: !checked })
              }
            />
          </div>

          {/* Auto-delete after export */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <Label htmlFor="auto-delete" className="text-sm font-medium">
                Auto-delete photos after export
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Automatically wipe local session data once you export.
              </p>
            </div>
            <Switch
              id="auto-delete"
              checked={settings.autoDeletePhotosAfterExport}
              onCheckedChange={(checked) =>
                update({ autoDeletePhotosAfterExport: checked, keepPhotosAfterExport: !checked })
              }
            />
          </div>
        </div>

        <div className="pt-1 border-t border-border">
          <p className="text-xs text-muted-foreground leading-snug">
            Photos are kept locally until you clear them.
            Export your spreadsheet before deleting session data.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
