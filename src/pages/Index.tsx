import { useState, useEffect, useCallback } from 'react';
import { FileSpreadsheet, CreditCard, ArrowLeft, Download, Loader2, ScanLine, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageCapture } from '@/components/ImageCapture';
import { DataReview } from '@/components/DataReview';
import { ScanHistory } from '@/components/ScanHistory';
import { DocumentType, SignupEntry, BusinessCardEntry, ScanRecord } from '@/types/scan';
import { extractFromImage } from '@/lib/extraction';
import { exportToExcel } from '@/lib/export';
import { getScanHistory, saveScanRecord } from '@/lib/storage';
import { toast } from 'sonner';

type Step = 'home' | 'capture' | 'processing' | 'review' | 'history';

const Index = () => {
  const [step, setStep] = useState<Step>('home');
  const [docType, setDocType] = useState<DocumentType>('business-card');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [data, setData] = useState<(SignupEntry | BusinessCardEntry)[]>([]);
  const [history, setHistory] = useState<ScanRecord[]>([]);

  useEffect(() => {
    setHistory(getScanHistory());
  }, []);

  const refreshHistory = useCallback(() => {
    setHistory(getScanHistory());
  }, []);

  const selectType = (type: DocumentType) => {
    setDocType(type);
    setStep('capture');
  };

  const handleImageSelected = async (file: File, previewUrl: string) => {
    setImageFile(file);
    setImageUrl(previewUrl);
    setStep('processing');

    try {
      const extracted = await extractFromImage(file, docType);
      setData(extracted);
      setStep('review');
      toast.info('Data extracted — please review and correct any errors before exporting.');
    } catch {
      toast.error('Failed to extract data. Please try again.');
      setStep('capture');
    }
  };

  const handleExport = () => {
    if (data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const record: ScanRecord = {
      id: crypto.randomUUID(),
      type: docType,
      imageUrl,
      data: data as any,
      createdAt: new Date(),
    };
    saveScanRecord(record);
    exportToExcel(data, docType);
    refreshHistory();
    toast.success('Exported to Excel!');
    reset();
  };

  const reset = () => {
    setStep('home');
    setImageFile(null);
    setImageUrl('');
    setData([]);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'home' && (
              <button onClick={reset} className="p-1.5 -ml-1.5 rounded-md hover:bg-secondary transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg scan-gradient flex items-center justify-center">
                <ScanLine className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg text-foreground">Scan2Sheet</span>
            </div>
          </div>
          {step === 'home' && (
            <button
              onClick={() => setStep('history')}
              className="p-2 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors relative"
            >
              <History className="w-5 h-5" />
              {history.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-medium">
                  {history.length}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* HOME */}
        {step === 'home' && (
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-bold text-foreground">Scan to Spreadsheet</h1>
              <p className="text-muted-foreground">
                Capture sign-up sheets or business cards and export clean data to Excel.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                onClick={() => selectType('signup-sheet')}
                className="group p-6 rounded-xl bg-card border border-border card-shadow hover:card-shadow-hover hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/15 transition-colors">
                  <FileSpreadsheet className="w-6 h-6 text-primary" />
                </div>
                <h2 className="font-semibold text-foreground mb-1">Sign-Up Sheet</h2>
                <p className="text-sm text-muted-foreground">
                  Extract names, phones, emails from paper sign-up lists.
                </p>
              </button>

              <button
                onClick={() => selectType('business-card')}
                className="group p-6 rounded-xl bg-card border border-border card-shadow hover:card-shadow-hover hover:border-primary/30 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:bg-accent/15 transition-colors">
                  <CreditCard className="w-6 h-6 text-accent" />
                </div>
                <h2 className="font-semibold text-foreground mb-1">Business Card</h2>
                <p className="text-sm text-muted-foreground">
                  Pull contact details from business or visiting cards.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* CAPTURE */}
        {step === 'capture' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {docType === 'signup-sheet' ? 'Scan Sign-Up Sheet' : 'Scan Business Card'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Take a photo or upload an image of the document.
              </p>
            </div>
            <ImageCapture onImageSelected={handleImageSelected} />
          </div>
        )}

        {/* PROCESSING */}
        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-16 h-16 rounded-full scan-gradient flex items-center justify-center animate-pulse">
              <Loader2 className="w-7 h-7 text-primary-foreground animate-spin" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">Extracting data...</p>
              <p className="text-sm text-muted-foreground mt-1">Analyzing your document</p>
            </div>
          </div>
        )}

        {/* REVIEW */}
        {step === 'review' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Review & Edit</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Correct any errors before exporting to Excel.
              </p>
            </div>

            {imageUrl && (
              <div className="rounded-lg overflow-hidden border border-border">
                <img src={imageUrl} alt="Scanned document" className="w-full max-h-48 object-contain bg-secondary" />
              </div>
            )}

            <DataReview docType={docType} data={data} onChange={setData} />

            <Button onClick={handleExport} className="w-full scan-gradient scan-shadow h-12 text-primary-foreground font-medium">
              <Download className="w-5 h-5 mr-2" />
              Export to Excel
            </Button>
          </div>
        )}

        {/* HISTORY */}
        {step === 'history' && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-foreground">Scan History</h2>
            <ScanHistory records={history} onRefresh={refreshHistory} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
