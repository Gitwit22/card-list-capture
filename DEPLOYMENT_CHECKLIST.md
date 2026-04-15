# ✅ Card Capture - Cloudflare Deployment Checklist

## 📦 Files Created

### Configuration Files
- ✅ `.env.example` - Template for environment variables
- ✅ `wrangler.toml` - Cloudflare Pages configuration

### Source Code
- ✅ `src/config/env.ts` - Environment configuration management
- ✅ `src/lib/api-client.ts` - API client for all cores and backend
- ✅ `src/hooks/useCores.ts` - React hooks for using cores in components

### Documentation
- ✅ `CLOUDFLARE_DEPLOYMENT.md` - Complete deployment guide
- ✅ `CORES_INTEGRATION_GUIDE.md` - Quick integration examples
- ✅ `DEPLOYMENT_CHECKLIST.md` - This file

---

## 🚀 Deployment Steps

### Phase 1: Local Setup (15 min)
- [ ] Run `npm install` to install dependencies
- [ ] Copy `.env.example` to `.env`
- [ ] Fill in environment variables
- [ ] Test locally with `npm run dev`
- [ ] Verify all imports work

### Phase 2: Cloudflare Setup (20 min)
- [ ] Install Wrangler CLI: `npm install -g wrangler`
- [ ] Run `wrangler login` to authenticate
- [ ] Create new Cloudflare Pages project
- [ ] Connect your Git repository
- [ ] Set up KV namespaces (optional but recommended)

### Phase 3: Environment Variables (10 min)
Set in Cloudflare Dashboard for each environment:

**Production:**
```
VITE_API_BASE_URL=https://api.nxtlvl.app
VITE_AUTH_CORE_URL=https://auth-core.nxtlvl.app
VITE_STORAGE_CORE_URL=https://storage-core.nxtlvl.app
VITE_AUDIT_CORE_URL=https://audit-core.nxtlvl.app
VITE_APP_ENV=production
VITE_APP_PARTITION=card-capture-prod
```

**Staging:**
```
VITE_API_BASE_URL=https://staging-api.nxtlvl.app
VITE_APP_ENV=staging
```

### Phase 4: Testing (15 min)
- [ ] Build locally: `npm run build`
- [ ] Test upload functionality
- [ ] Verify auth token flows
- [ ] Check API responses
- [ ] Test error handling

### Phase 5: Deployment (5 min)
- [ ] Commit changes: `git add . && git commit -m "setup: configure Cloudflare deployment"`
- [ ] Push to main: `git push origin main`
- [ ] Monitor Cloudflare dashboard for deployment
- [ ] Verify deployment URL works

### Phase 6: Post-Deployment (10 min)
- [ ] Test production environment
- [ ] Check browser console for errors
- [ ] Verify authentication works
- [ ] Test file uploads
- [ ] Monitor Cloudflare Analytics

---

## 🔗 Required Core Services

### 1. Auth Core
**Purpose:** Token validation, user info, session management

**Required Endpoints:**
- `POST /api/v1/auth/validate` - Validate JWT
- `POST /api/v1/auth/refresh` - Refresh token
- `GET /api/v1/auth/user` - Get user info

**Environment Variable:**
```
VITE_AUTH_CORE_URL=https://auth-core.your-domain.com
```

### 2. Storage Core
**Purpose:** File storage, retrieval, metadata management

**Required Endpoints:**
- `POST /api/v1/storage/upload` - Upload files
- `GET /api/v1/storage/{fileId}` - Get file
- `DELETE /api/v1/storage/{fileId}` - Delete file

**Environment Variable:**
```
VITE_STORAGE_CORE_URL=https://storage-core.your-domain.com
```

### 3. Audit Core
**Purpose:** Compliance logging, audit trails

**Required Endpoints:**
- `POST /api/v1/audit/log` - Log events
- `GET /api/v1/audit/resource/{resourceId}` - View audit log

**Environment Variable:**
```
VITE_AUDIT_CORE_URL=https://audit-core.your-domain.com
```

### 4. Backend API (Card Capture)
**Purpose:** Card processing, classification, storage

**Required Endpoints:**
- `POST /api/cards/upload` - Upload card
- `GET /api/cards/{cardId}` - Get card details
- `GET /api/cards` - List cards
- `POST /api/cards/{cardId}/process` - Process card
- `DELETE /api/cards/{cardId}` - Delete card

**Environment Variable:**
```
VITE_API_BASE_URL=https://api.your-domain.com
```

---

## 💻 Using Cores in Your Components

### Method 1: Individual Hooks (Simple)
```tsx
import { useCardCapture } from '@/hooks/useCores';

function MyComponent() {
  const { uploadCard } = useCardCapture();
  // Use uploadCard...
}
```

### Method 2: Combined Hook (Recommended)
```tsx
import { useCores } from '@/hooks/useCores';

function MyComponent() {
  const { cardCapture, auth, storage, audit, config } = useCores();
  // Use all cores with one import
}
```

### Method 3: Direct Client Access
```tsx
import { getCardCaptureClient } from '@/lib/api-client';

const client = getCardCaptureClient();
const result = await client.uploadCard(file, metadata, token);
```

---

## 🔐 Security Considerations

1. **Token Management**
   - Store JWT tokens securely (httpOnly cookies preferred)
   - Implement token refresh logic
   - Handle token expiration gracefully

2. **API Keys**
   - Never commit `.env` files
   - Use Cloudflare environment variables
   - Rotate keys regularly

3. **CORS Configuration**
   - Add Cloudflare domain to backend CORS whitelist
   - Validate origins server-side

4. **File Upload Security**
   - Validate file types server-side (not just client)
   - Set file size limits
   - Scan files for malware (optional)

---

## 📊 Monitoring & Debugging

### Enable Debug Mode
```env
VITE_DEBUG_MODE=true
```

This will:
- Log configuration to console
- Show detailed error messages
- Display API request/response details

### View Logs in Cloudflare
- Dashboard → Pages → card-list-capture → Deployments
- Real-time logs show deployment and runtime status

### Check Browser Console
```javascript
// Check config
console.log(import.meta.env)

// Test API client
import { getCardCaptureClient } from '@/lib/api-client'
const client = getCardCaptureClient()
console.log(client)
```

---

## ⚠️ Common Issues & Solutions

### Issue: 404 API Errors
**Solution:** 
- Verify `VITE_API_BASE_URL` is correct
- Check core service URLs are accessible
- Ensure backends are running

### Issue: CORS Errors
**Solution:**
- Add Cloudflare domain to backend CORS
- Check `Access-Control-Allow-Origin` header
- Verify `Access-Control-Allow-Credentials` is set

### Issue: Authentication Failures
**Solution:**
- Verify JWT tokens are valid
- Check `VITE_AUTH_CORE_URL` is correct
- Ensure Auth Core is running

### Issue: Build Failures
**Solution:**
- Run `npm install` to update dependencies
- Check TypeScript errors: `npm run build`
- Verify all imports are correct

---

## 🎯 Next Steps After Deployment

1. **Set Up Monitoring**
   - Configure Sentry for error tracking
   - Enable Cloudflare Analytics
   - Set up alerts for failures

2. **Implement Features**
   - Add card classification UI
   - Build audit trail viewer
   - Create admin dashboard

3. **Performance Optimization**
   - Enable KV caching
   - Optimize image handling
   - Add request deduplication

4. **Team Documentation**
   - Train team on new endpoints
   - Document API usage patterns
   - Create runbooks for operations

---

## 📞 Support & Resources

### Documentation
- Cloudflare Pages: https://developers.cloudflare.com/pages/
- Wrangler CLI: https://developers.cloudflare.com/workers/wrangler/
- KV Store: https://developers.cloudflare.com/workers/runtime-apis/kv/

### Files to Review
- `CLOUDFLARE_DEPLOYMENT.md` - Detailed deployment guide
- `CORES_INTEGRATION_GUIDE.md` - Code examples
- `src/config/env.ts` - Configuration details
- `src/lib/api-client.ts` - API client source code

### Environment Variables Reference
| Variable | Type | Default | Notes |
|----------|------|---------|-------|
| `VITE_API_BASE_URL` | string | - | **Required** |
| `VITE_AUTH_CORE_URL` | string | - | Optional but recommended |
| `VITE_STORAGE_CORE_URL` | string | - | Optional |
| `VITE_AUDIT_CORE_URL` | string | - | Optional |
| `VITE_APP_PARTITION` | string | `card-capture-app` | Multi-tenant ID |
| `VITE_APP_ENV` | string | `development` | `production` \| `staging` \| `development` |
| `VITE_AUTH_ENABLED` | boolean | `true` | Enable/disable auth |
| `VITE_DEBUG_MODE` | boolean | `false` | Debug logging |

---

## ✨ Summary

Your card capture app is now fully prepared for Cloudflare deployment with:

✅ **Configuration Management** - Type-safe environment variables  
✅ **API Clients** - For Auth, Storage, Audit cores and backend API  
✅ **React Integration** - Hooks for easy component usage  
✅ **Cloudflare Setup** - wrangler.toml with multi-environment support  
✅ **Documentation** - Deployment and integration guides  
✅ **Code Examples** - Ready-to-use component patterns  

**Ready to deploy!** Follow the deployment steps above to go live. 🚀
