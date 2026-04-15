# Card Capture - Core Integration Quick Start

## Quick Setup (5 minutes)

### 1. Create a `.env` file

```bash
cp .env.example .env
```

### 2. Update with your backend URLs

```env
VITE_API_BASE_URL=https://your-api.example.com
VITE_AUTH_CORE_URL=https://auth-core.example.com
VITE_APP_PARTITION=your-app-id
```

### 3. Start development

```bash
npm install
npm run dev
```

## Usage Examples

### Example 1: Simple Card Upload

```tsx
import { useState } from 'react';
import { useCores } from '@/hooks/useCores';

export function SimpleUpload() {
  const { cardCapture } = useCores();
  const [file, setFile] = useState<File | null>(null);
  const [token] = useState('your-auth-token');

  const handleUpload = async () => {
    if (!file || !token) return;
    
    const result = await cardCapture.uploadCard(file, {
      source: 'web',
      uploadedAt: new Date().toISOString(),
    }, token);

    if (result.success) {
      console.log('✅ Card uploaded:', result.data);
    } else {
      console.error('❌ Upload failed:', result.error);
    }
  };

  return (
    <>
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      <button onClick={handleUpload}>Upload Card</button>
    </>
  );
}
```

### Example 2: Complete Card Workflow with Audit

```tsx
import { useState } from 'react';
import { useCores } from '@/hooks/useCores';

export function CardWorkflow() {
  const { cardCapture, audit, storage, auth } = useCores();
  const [token, setToken] = useState('');
  const [cardId, setCardId] = useState('');

  // Step 1: Validate token with Auth Core
  const validateToken = async () => {
    const result = await auth.validateToken(token);
    if (result.success) {
      console.log('✅ Token is valid');
    }
  };

  // Step 2: Upload card and log audit event
  const uploadCard = async (file: File) => {
    const uploadResult = await cardCapture.uploadCard(file, {
      source: 'mobile',
    }, token);

    if (uploadResult.success && uploadResult.data?.cardId) {
      setCardId(uploadResult.data.cardId);

      // Log the upload event
      await audit.logEvent(
        {
          action: 'card_uploaded',
          resource: 'card',
          resourceId: uploadResult.data.cardId,
          details: {
            fileName: file.name,
            size: file.size,
            format: file.type,
          },
        },
        token
      );

      console.log('✅ Card uploaded and logged');
    }
  };

  // Step 3: Process the card with AI
  const processCard = async () => {
    if (!cardId) return;

    const result = await cardCapture.processCard(cardId, {
      enableAI: true,
      extractMetadata: true,
      validateFormat: true,
    }, token);

    if (result.success) {
      console.log('✅ Card processed:', result.data);

      // Log processing event
      await audit.logEvent(
        {
          action: 'card_processed',
          resource: 'card',
          resourceId: cardId,
          details: result.data,
        },
        token
      );
    }
  };

  // Step 4: Get audit trail
  const viewAuditTrail = async () => {
    if (!cardId) return;

    const result = await audit.getAuditLog(cardId, token);
    if (result.success) {
      console.log('📋 Audit trail:', result.data);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Card Capture Workflow</h2>
      
      <section style={{ marginBottom: '20px' }}>
        <h3>1. Authenticate</h3>
        <input
          type="text"
          placeholder="Enter JWT token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button onClick={validateToken}>Validate Token</button>
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>2. Upload Card</h3>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadCard(file);
          }}
        />
      </section>

      <section style={{ marginBottom: '20px' }}>
        <h3>3. Process Card</h3>
        <button onClick={processCard} disabled={!cardId}>
          {cardId ? `Process Card (${cardId})` : 'Upload a card first'}
        </button>
      </section>

      <section>
        <h3>4. View Audit Trail</h3>
        <button onClick={viewAuditTrail} disabled={!cardId}>
          View Audit Trail
        </button>
      </section>
    </div>
  );
}
```

### Example 3: List and Delete Cards

```tsx
import { useEffect, useState } from 'react';
import { useCores } from '@/hooks/useCores';

export function CardManager() {
  const { cardCapture, audit } = useCores();
  const [cards, setCards] = useState([]);
  const [token] = useState('your-token');

  // Load cards
  useEffect(() => {
    const loadCards = async () => {
      const result = await cardCapture.listCards(token, {
        status: 'processed',
        limit: 20,
      });

      if (result.success) {
        setCards((result.data as any) || []);
      }
    };

    loadCards();
  }, [token]);

  // Delete a card
  const deleteCard = async (cardId: string) => {
    const result = await cardCapture.deleteCard(cardId, token);

    if (result.success) {
      // Log deletion
      await audit.logEvent(
        {
          action: 'card_deleted',
          resource: 'card',
          resourceId: cardId,
        },
        token
      );

      setCards(cards.filter(c => c.id !== cardId));
      console.log('✅ Card deleted');
    }
  };

  return (
    <div>
      <h2>Card Manager</h2>
      <ul>
        {cards.map((card: any) => (
          <li key={card.id}>
            <span>{card.name || card.id}</span>
            <button onClick={() => deleteCard(card.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Example 4: Using Environment Config

```tsx
import { useEnvConfig } from '@/hooks/useCores';

export function DebugPanel() {
  const config = useEnvConfig();

  return (
    <div style={{ border: '1px solid #ccc', padding: '10px', fontSize: '12px' }}>
      <h3>App Configuration</h3>
      <p><strong>Environment:</strong> {config.apiBaseUrl}</p>
      <p><strong>Debug Mode:</strong> {config.debugMode ? '🟢 ON' : '🔴 OFF'}</p>
      <p><strong>AI Classification:</strong> {config.features.aiClassification ? '✅' : '❌'}</p>
      <p><strong>Card Storage:</strong> {config.features.cardStorage ? '✅' : '❌'}</p>
      <p><strong>Max File Size:</strong> {config.cardCapture.maxFileSizeMb}MB</p>
      <p><strong>Allowed Types:</strong> {config.cardCapture.allowedFileTypes.join(', ')}</p>
    </div>
  );
}
```

## File Structure

```
src/
├── config/
│   └── env.ts              # Environment configuration
├── lib/
│   └── api-client.ts       # API client classes for cores
├── hooks/
│   └── useCores.ts         # React hooks for using cores
├── components/
│   └── ...                 # Your components
└── App.tsx                 # Main app
```

## API Response Format

All API calls return this format:

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}
```

## Error Handling

```tsx
const { cardCapture } = useCores();

try {
  const response = await cardCapture.uploadCard(file, metadata, token);
  
  if (!response.success) {
    console.error('API Error:', response.error);
    // Handle error
  } else {
    console.log('Success:', response.data);
    // Use data
  }
} catch (error) {
  console.error('Network Error:', error);
}
```

## Performance Tips

1. **Use lazy loading** - Cores are loaded on-demand
2. **Cache tokens** - Don't call validateToken repeatedly
3. **Batch operations** - Upload multiple cards in parallel
4. **Handle retries** - API client has built-in retry logic
5. **Monitor uploads** - Use `uploadProgress` state from hook

## Connected Cores

| Core | Features | Status |
|------|----------|--------|
| **Auth Core** | Token validation, refresh, user info | ✅ Ready |
| **Storage Core** | File upload/download, metadata | ✅ Ready |
| **Audit Core** | Event logging, audit trails | ✅ Ready |
| **Card Capture API** | Upload, process, list, delete cards | ✅ Ready |

## Next Steps

1. Set up authentication (retrieve JWT token)
2. Implement card upload UI
3. Add processing workflows
4. Set up audit logging
5. Deploy to Cloudflare Pages

## Getting Help

- Check `src/config/env.ts` for configuration details
- Review `src/lib/api-client.ts` for API methods
- Look at `src/hooks/useCores.ts` for React integration
- See `CLOUDFLARE_DEPLOYMENT.md` for deployment help
