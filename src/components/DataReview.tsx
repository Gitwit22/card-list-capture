import { SignupEntry, BusinessCardEntry, DocumentType, ExtractionMeta } from '@/types/scan';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { createEmptySignupEntry, createEmptyBusinessCard } from '@/lib/extraction';
import { useState } from 'react';

interface DataReviewProps {
  docType: DocumentType;
  data: (SignupEntry | BusinessCardEntry)[];
  onChange: (data: (SignupEntry | BusinessCardEntry)[]) => void;
  meta?: ExtractionMeta;
}

export function DataReview({ docType, data, onChange, meta }: DataReviewProps) {
  const [showExtras, setShowExtras] = useState<Record<number, boolean>>({});
  const [showDebug, setShowDebug] = useState(false);

  const updateField = (index: number, field: string, value: string) => {
    const updated = [...data];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const updateExtraField = (index: number, key: string, value: string) => {
    const updated = [...data];
    const entry = { ...updated[index] };
    entry.extraFields = { ...entry.extraFields, [key]: value };
    updated[index] = entry;
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

  const toggleExtras = (index: number) => {
    setShowExtras((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const signupFields = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'organization', label: 'Organization' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'screening', label: 'Screening' },
    { key: 'shareInfo', label: 'Share Info' },
    { key: 'date', label: 'Date' },
    { key: 'comments', label: 'Comments' },
  ];

  const cardFields = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'company', label: 'Company' },
    { key: 'title', label: 'Title' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'website', label: 'Website' },
    { key: 'address', label: 'Address' },
    { key: 'social', label: 'Social' },
  ];

  const fields = docType === 'signup-sheet' ? signupFields : cardFields;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">
          Review Extracted Data ({data.length} {data.length === 1 ? 'entry' : 'entries'})
        </h3>
        <div className="flex items-center gap-2">
          {meta && (
            <button
              onClick={() => setShowDebug((d) => !d)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDebug ? 'Hide' : 'Show'} debug
            </button>
          )}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4 mr-1" /> Add Row
          </Button>
        </div>
      </div>

      {/* Debug / extraction metadata panel */}
      {showDebug && meta && (
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs space-y-1 font-mono">
          <div><span className="text-muted-foreground">structure:</span> {meta.structure}</div>
          <div><span className="text-muted-foreground">confidence:</span> {(meta.confidence * 100).toFixed(0)}%</div>
          <div><span className="text-muted-foreground">detectedHeaders:</span> {meta.detectedHeaders.join(', ') || '(none)'}</div>
          {meta.headerMapping.length > 0 && (
            <div>
              <span className="text-muted-foreground">headerMapping:</span>
              <ul className="ml-3 mt-0.5">
                {meta.headerMapping.map((m, i) => (
                  <li key={i}>
                    {m.original} → {m.normalized ?? <span className="text-yellow-600">unmapped</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {data.map((entry, index) => {
          const extras = entry.extraFields ?? {};
          const hasExtras = Object.keys(extras).length > 0;

          return (
            <div key={entry.id} className="bg-card rounded-lg border border-border p-4 card-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Entry {index + 1}
                </span>
                {data.length > 1 && (
                  <button onClick={() => removeRow(index)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fields.map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.label}</label>
                    <Input
                      value={(entry as Record<string, string>)[f.key] || ''}
                      onChange={e => updateField(index, f.key, e.target.value)}
                      placeholder={f.label}
                      className="h-9 text-sm"
                    />
                  </div>
                ))}
              </div>

              {/* Extra / unmapped fields */}
              {hasExtras && (
                <div className="mt-3">
                  <button
                    onClick={() => toggleExtras(index)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showExtras[index] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {Object.keys(extras).length} extra field{Object.keys(extras).length !== 1 ? 's' : ''}
                  </button>
                  {showExtras[index] && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 pl-2 border-l-2 border-yellow-500/30">
                      {Object.entries(extras).map(([key, value]) => (
                        <div key={key}>
                          <label className="text-xs font-medium text-yellow-600 mb-1 block">{key}</label>
                          <Input
                            value={value}
                            onChange={e => updateExtraField(index, key, e.target.value)}
                            placeholder={key}
                            className="h-9 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
