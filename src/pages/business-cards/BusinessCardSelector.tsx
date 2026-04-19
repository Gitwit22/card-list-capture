import { Camera, Images, ListChecks } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SettingsMenu } from '@/components/SettingsMenu';

const options = [
  {
    title: 'Scan One Card',
    description: 'Capture a front image, optionally capture the back, then review and export.',
    icon: Camera,
    path: '/business-cards/single',
  },
  {
    title: 'Scan a Stack Fast',
    description: 'Capture front and optional back in sequence for each card in a rapid flow.',
    icon: ListChecks,
    path: '/business-cards/batch',
  },
  {
    title: 'Upload Multiple Photos',
    description: 'Upload multiple images, pair front/back in queue, then process as card records.',
    icon: Images,
    path: '/business-cards/upload',
  },
];

export default function BusinessCardSelector() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/')}>
              Home
            </Button>
            <div className="flex items-center gap-2">
              <img src="/Scan%20logo.webp" alt="Scan2Sheet logo" className="w-8 h-8 rounded-lg object-cover" />
              <span className="font-bold text-lg text-foreground">Business Card Modes</span>
            </div>
          </div>
          <SettingsMenu />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Choose A Business Card Workflow</h1>
          <p className="text-muted-foreground mt-2">
            Select the mode that matches how you want to capture cards right now.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.path}
                type="button"
                onClick={() => navigate(option.path)}
                className="group p-6 rounded-xl bg-card border border-border card-shadow hover:card-shadow-hover hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h2 className="font-semibold text-foreground mb-1">{option.title}</h2>
                <p className="text-sm text-muted-foreground">{option.description}</p>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
