import { cn } from '@/lib/utils';

interface ScanToSheetLoadingAnimationProps {
  className?: string;
  title?: string;
  subtitle?: string;
}

export function ScanToSheetLoadingAnimation({
  className,
  title = 'Scanning to Sheet',
  subtitle = 'Reading cards, sheets, and forms...',
}: ScanToSheetLoadingAnimationProps) {
  return (
    <div className={cn('flex items-center justify-center p-4', className)}>
      <div className="flex flex-col items-center gap-6">
        <div className="relative w-[320px] h-[260px]">
          <div className="absolute inset-x-10 top-8 h-32 bg-red-500/10 blur-3xl rounded-full" />

          <div className="absolute left-1/2 -translate-x-1/2 top-20 w-64 h-28 rounded-[2rem] bg-gradient-to-b from-neutral-800 to-neutral-900 border border-neutral-700 shadow-2xl overflow-hidden">
            <div className="absolute inset-x-6 top-5 h-3 rounded-full bg-neutral-700" />
            <div className="absolute inset-x-8 top-10 h-2 rounded-full bg-red-500/70 animate-pulse" />
            <div className="absolute left-1/2 -translate-x-1/2 bottom-4 text-neutral-200 text-sm font-semibold tracking-[0.25em] uppercase">
              STS
            </div>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 top-[92px] w-14 h-14 rounded-full border border-red-400/40 bg-neutral-900/80 backdrop-blur flex items-center justify-center shadow-lg">
            <div className="text-red-400 text-xs font-bold tracking-[0.3em]">LOGO</div>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 top-2 w-36 h-24 rounded-xl bg-white shadow-lg border border-neutral-200 animate-[feedIn_1.8s_ease-in-out_infinite] origin-bottom">
            <div className="px-4 pt-4 space-y-2">
              <div className="h-2 bg-neutral-200 rounded w-3/4" />
              <div className="h-2 bg-neutral-200 rounded w-full" />
              <div className="h-2 bg-neutral-200 rounded w-2/3" />
            </div>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 top-[132px] w-44 h-28 rounded-xl bg-white shadow-2xl border border-neutral-200 origin-top animate-[scanOut_1.8s_ease-in-out_infinite] overflow-hidden">
            <div className="px-4 pt-4 space-y-2">
              <div className="h-2 bg-red-200 rounded w-2/3" />
              <div className="h-2 bg-neutral-200 rounded w-full" />
              <div className="h-2 bg-neutral-200 rounded w-5/6" />
              <div className="h-2 bg-neutral-200 rounded w-3/5" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="h-6 rounded bg-neutral-100" />
                <div className="h-6 rounded bg-neutral-100" />
                <div className="h-6 rounded bg-neutral-100" />
              </div>
            </div>
          </div>

          <div className="absolute right-4 top-[146px] w-16 h-20 rounded-lg bg-white border border-neutral-200 shadow-xl animate-[flyAway_1.8s_ease-in-out_infinite]" />
        </div>

        <div className="text-center space-y-2">
          <div className="text-foreground text-xl font-semibold tracking-wide">{title}</div>
          <div className="text-muted-foreground text-sm">{subtitle}</div>
        </div>

        <style>{`
          @keyframes feedIn {
            0% { transform: translate(-50%, 0px) scaleY(0.7); opacity: 0; }
            15% { transform: translate(-50%, 8px) scaleY(0.9); opacity: 1; }
            35% { transform: translate(-50%, 24px) scaleY(1); opacity: 1; }
            55% { transform: translate(-50%, 42px) scaleY(0.94); opacity: 0.95; }
            100% { transform: translate(-50%, 42px) scaleY(0.94); opacity: 0; }
          }

          @keyframes scanOut {
            0% { transform: translate(-50%, 0px) rotateX(0deg); opacity: 0; }
            25% { transform: translate(-50%, 0px) rotateX(0deg); opacity: 0; }
            40% { transform: translate(-50%, 10px) rotateX(0deg); opacity: 1; }
            60% { transform: translate(-50%, 36px) rotateX(0deg); opacity: 1; }
            78% { transform: translate(-50%, 52px) rotate(-10deg) scale(0.98); opacity: 1; }
            100% { transform: translate(-50%, 72px) rotate(-16deg) scale(0.88); opacity: 0; }
          }

          @keyframes flyAway {
            0%, 62% { transform: translate(0, 0) rotate(0deg) scale(0.5); opacity: 0; }
            70% { transform: translate(-10px, 0px) rotate(-8deg) scale(0.9); opacity: 0.9; }
            85% { transform: translate(12px, -20px) rotate(20deg) scale(0.78); opacity: 0.85; }
            100% { transform: translate(42px, -46px) rotate(40deg) scale(0.5); opacity: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}
