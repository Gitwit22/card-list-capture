# Card Capture - Cloudflare Deployment Guide

## Overview

The Card Capture app is now prepared for deployment on Cloudflare Pages with integration to:
- **Auth Core** - Authentication & token management
- **Storage Core** - File storage and retrieval
- **Audit Core** - Activity logging and compliance
- **Backend API** - Card processing and data management

## Prerequisites

1. **Cloudflare Account** - With Pages enabled
2. **Git Repository** - Connected to Cloudflare (GitHub/GitLab)
3. **Environment Variables** - Set up in Cloudflare dashboard
4. **API Backend** - Running and accessible (nxt-lvl-api)
5. **Core Services** - Auth, Storage, and Audit cores deployed

## Setup Steps

### 1. Install Cloudflare CLI

```bash
npm install -g wrangler
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Set Up Environment Variables

Create `.env` file in the project root:

```bash
# Copy from template
cp .env.example .env
```

Update with your actual values:

```env
# Production
VITE_API_BASE_URL=https://api.nxtlvl.app
VITE_AUTH_CORE_URL=https://auth-core.nxtlvl.app
VITE_STORAGE_CORE_URL=https://storage-core.nxtlvl.app
VITE_AUDIT_CORE_URL=https://audit-core.nxtlvl.app

# App Configuration
VITE_APP_PARTITION=card-capture-prod
VITE_APP_ENV=production

# Feature Flags
VITE_ENABLE_AI_CLASSIFICATION=true
VITE_ENABLE_CARD_STORAGE=true
```

### 4. Configure Cloudflare Dashboard Environment Variables

Go to Cloudflare dashboard → Pages → card-list-capture → Settings → Environment variables

Add for each environment (Production/Preview/Development):

**Production:**
- `VITE_API_BASE_URL`: `https://api.nxtlvl.app`
- `VITE_AUTH_CORE_URL`: `https://auth-core.nxtlvl.app`
- `VITE_APP_ENV`: `production`

**Preview:**
- `VITE_API_BASE_URL`: `https://staging-api.nxtlvl.app`
- `VITE_APP_ENV`: `staging`

**Development:**
- `VITE_API_BASE_URL`: `http://localhost:3000`
- `VITE_DEBUG_MODE`: `true`

### 5. Update Build Configuration

Ensure `package.json` build command is correct:

```json
"scripts": {
  "build": "vite build"
}
```

### 6. Create Cloudflare Pages Connection

1. Go to Cloudflare Dashboard → Pages
2. Click "Create a project"
3. Select "Connect to Git"
4. Choose your GitHub repository (card-list-capture)
5. Configure build:
   - **Framework preset**: Vue (Vite)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`

### 7. Set Up KV Namespace for Caching

```bash
# Create KV namespaces
wrangler kv:namespace create "CARD_CAPTURE_CACHE"
wrangler kv:namespace create "SESSION_STORE"
```

Update `wrangler.toml` with the namespace IDs returned.

### 8. Deploy

**Option A: Automatic (Recommended)**
Push to main branch - Cloudflare will auto-deploy:
```bash
git add .
git commit -m "chore: prepare for Cloudflare deployment"
git push origin main
```

**Option B: Manual**
```bash
npm run build
wrangler publish
```

## Usage in Components

### Import the Cores Hook

```tsx
import { useCores } from '@/hooks/useCores';

export function CardUploadComponent() {
  const { cardCapture, audit, auth } = useCores();
  const [authToken, setAuthToken] = useState<string>('');

  async function handleUpload(file: File) {
    try {
      // Upload card
      const response = await cardCapture.uploadCard(file, {
        source: 'web-capture',
        uploadedAt: new Date().toISOString(),
      }, authToken);

      if (response.success) {
        // Log audit event
        await audit.logEvent(
          {
            action: 'card_uploaded',
            resource: 'card',
            resourceId: response.data?.cardId || '',
            details: { fileName: file.name, size: file.size },
          },
          authToken
        );

        console.log('Card uploaded:', response.data);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    }
  }

  return (
    <div>
      <input type="file" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file);
      }} />
    </div>
  );
}
```

### Using Individual Core Clients

```tsx
import { useAuthCore, useCardCapture } from '@/hooks/useCores';

export function LoginComponent() {
  const auth = useAuthCore();
  
  async function login(token: string) {
    // Validate token with Auth Core
    const response = await auth.validateToken(token);
    
    if (response.success) {
      // Get user info
      const userResponse = await auth.getUser(token);
      console.log('User:', userResponse.data);
    }
  }
}
```

### Access Environment Config

```tsx
import { useEnvConfig } from '@/hooks/useCores';

export function DebugComponent() {
  const config = useEnvConfig();

  if (config.debugMode) {
    return (
      <div>
        <p>API Base: {config.apiBaseUrl}</p>
        <p>Features: {JSON.stringify(config.features)}</p>
      </div>
    );
  }

  return null;
}
```

## Core Service Integration

### Auth Core
**Endpoints:**
- `POST /api/v1/auth/validate` - Validate JWT token
- `POST /api/v1/auth/refresh` - Refresh token
- `GET /api/v1/auth/user` - Get current user

**Usage:**
```tsx
const { auth } = useCores();
const result = await auth.validateToken(token);
```

### Storage Core
**Endpoints:**
- `POST /api/v1/storage/upload` - Upload file
- `GET /api/v1/storage/{fileId}` - Get file metadata
- `DELETE /api/v1/storage/{fileId}` - Delete file

**Usage:**
```tsx
const { storage } = useCores();
const result = await storage.uploadFile(file, metadata, token);
```

### Audit Core
**Endpoints:**
- `POST /api/v1/audit/log` - Log audit event
- `GET /api/v1/audit/resource/{resourceId}` - Get audit log for resource

**Usage:**
```tsx
const { audit } = useCores();
await audit.logEvent({
  action: 'card_processed',
  resource: 'card',
  resourceId: cardId,
}, token);
```

### Card Capture Backend
**Endpoints:**
- `POST /api/cards/upload` - Upload and process card
- `GET /api/cards/{cardId}` - Get card details
- `GET /api/cards` - List cards
- `POST /api/cards/{cardId}/process` - Process card with options
- `DELETE /api/cards/{cardId}` - Delete card

**Usage:**
```tsx
const { cardCapture } = useCores();
const result = await cardCapture.uploadCard(file, metadata, token);
```

## Environment Variables Reference

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `VITE_API_BASE_URL` | Backend API endpoint | Yes | `https://api.nxtlvl.app` |
| `VITE_AUTH_CORE_URL` | Auth Core service endpoint | No | `https://auth-core.nxtlvl.app` |
| `VITE_STORAGE_CORE_URL` | Storage Core service endpoint | No | `https://storage-core.nxtlvl.app` |
| `VITE_AUDIT_CORE_URL` | Audit Core service endpoint | No | `https://audit-core.nxtlvl.app` |
| `VITE_APP_PARTITION` | Multi-tenant partition ID | Yes | `card-capture-prod` |
| `VITE_APP_ENV` | Environment name | Yes | `production` \| `staging` \| `development` |
| `VITE_AUTH_ENABLED` | Enable authentication | Yes | `true` |
| `VITE_ENABLE_AI_CLASSIFICATION` | Enable AI card classification | No | `false` |
| `VITE_ENABLE_CARD_STORAGE` | Enable card storage | No | `true` |
| `VITE_DEBUG_MODE` | Enable debug messages | No | `false` |
| `VITE_MAX_FILE_SIZE_MB` | Max upload size in MB | No | `50` |
| `VITE_ALLOWED_FILE_TYPES` | Comma-separated file types | No | `pdf,jpg,jpeg,png` |

## Deployment Checklist

- [ ] Update `.env.example` with all required variables
- [ ] Set environment variables in Cloudflare dashboard
- [ ] Configure KV namespaces
- [ ] Test locally: `npm run dev`
- [ ] Test build: `npm run build`
- [ ] Update domain in `wrangler.toml`
- [ ] Enable CORS on backend API
- [ ] Test authentication flow
- [ ] Test file upload
- [ ] Verify API connectivity from browser console
- [ ] Monitor Cloudflare dashboard for deployment status
- [ ] Set up monitoring/alerts

## Troubleshooting

### CORS Errors
Add Cloudflare domain to backend CORS whitelist:
```
https://card-capture.pages.dev
https://card-capture.your-domain.com
```

### Authentication Failures
1. Check `VITE_AUTH_CORE_URL` is correct
2. Verify JWT tokens are valid
3. Check browser console for detailed errors

### Upload Failures
1. Verify `VITE_API_BASE_URL` is accessible
2. Check file size limits
3. Ensure auth token is valid

### Performance Issues
1. Enable caching via KV namespaces
2. Check Cloudflare analytics dashboard
3. Monitor backend API response times

## Next Steps

1. **Connect to Backend**: Update nxt-lvl-api to handle card capture endpoints
2. **Implement Storage**: Deploy storage-core with R2 integration
3. **Set Up Auditing**: Configure audit-core to log all card operations
4. **Enable Analytics**: Connect to Cloudflare Analytics Engine
5. **Add Monitoring**: Set up Sentry/Datadog for error tracking

## Support Resources

- Cloudflare Pages Docs: https://developers.cloudflare.com/pages/
- Wrangler CLI: https://developers.cloudflare.com/workers/wrangler/
- KV Store: https://developers.cloudflare.com/workers/runtime-apis/kv/
