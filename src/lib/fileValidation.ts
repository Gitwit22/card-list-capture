import { getConfig } from '@/config/env';

export interface FileTypeInfo {
  extension: string;
  mimeTypes: string[];
  label: string;
  category: 'image' | 'document' | 'spreadsheet';
}

const FILE_TYPE_REGISTRY: Record<string, FileTypeInfo> = {
  jpg: {
    extension: 'jpg',
    mimeTypes: ['image/jpeg'],
    label: 'JPEG Image',
    category: 'image',
  },
  jpeg: {
    extension: 'jpeg',
    mimeTypes: ['image/jpeg'],
    label: 'JPEG Image',
    category: 'image',
  },
  png: {
    extension: 'png',
    mimeTypes: ['image/png'],
    label: 'PNG Image',
    category: 'image',
  },
  gif: {
    extension: 'gif',
    mimeTypes: ['image/gif'],
    label: 'GIF Image',
    category: 'image',
  },
  webp: {
    extension: 'webp',
    mimeTypes: ['image/webp'],
    label: 'WebP Image',
    category: 'image',
  },
  heic: {
    extension: 'heic',
    mimeTypes: ['image/heic', 'image/heif'],
    label: 'HEIC Image',
    category: 'image',
  },
  bmp: {
    extension: 'bmp',
    mimeTypes: ['image/bmp'],
    label: 'BMP Image',
    category: 'image',
  },
  tiff: {
    extension: 'tiff',
    mimeTypes: ['image/tiff'],
    label: 'TIFF Image',
    category: 'image',
  },
  tif: {
    extension: 'tif',
    mimeTypes: ['image/tiff'],
    label: 'TIFF Image',
    category: 'image',
  },
  pdf: {
    extension: 'pdf',
    mimeTypes: ['application/pdf'],
    label: 'PDF',
    category: 'document',
  },
  doc: {
    extension: 'doc',
    mimeTypes: ['application/msword'],
    label: 'Word Document',
    category: 'document',
  },
  docx: {
    extension: 'docx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    label: 'Word Document',
    category: 'document',
  },
  xls: {
    extension: 'xls',
    mimeTypes: ['application/vnd.ms-excel'],
    label: 'Excel Spreadsheet',
    category: 'spreadsheet',
  },
  xlsx: {
    extension: 'xlsx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    label: 'Excel Spreadsheet',
    category: 'spreadsheet',
  },
  csv: {
    extension: 'csv',
    mimeTypes: ['text/csv', 'application/csv'],
    label: 'CSV File',
    category: 'spreadsheet',
  },
  txt: {
    extension: 'txt',
    mimeTypes: ['text/plain'],
    label: 'Text File',
    category: 'document',
  },
  rtf: {
    extension: 'rtf',
    mimeTypes: ['application/rtf', 'text/rtf'],
    label: 'Rich Text',
    category: 'document',
  },
  ppt: {
    extension: 'ppt',
    mimeTypes: ['application/vnd.ms-powerpoint'],
    label: 'PowerPoint',
    category: 'document',
  },
  pptx: {
    extension: 'pptx',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    label: 'PowerPoint',
    category: 'document',
  },
};

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function getAllowedTypes(): string[] {
  return getConfig().cardCapture.allowedFileTypes.map((t) => t.toLowerCase());
}

function getMaxSizeMb(): number {
  return getConfig().cardCapture.maxFileSizeMb;
}

export function isFileTypeAllowed(file: File): boolean {
  const allowed = getAllowedTypes();
  const ext = getExtension(file.name);

  // Check by extension
  if (ext && allowed.includes(ext)) return true;

  // Check by MIME type — match against registered MIME types for allowed extensions
  for (const allowedExt of allowed) {
    const info = FILE_TYPE_REGISTRY[allowedExt];
    if (info && info.mimeTypes.some((m) => file.type === m)) return true;
  }

  // Wildcard image support: if 'image' is in allowed list or any image ext is allowed, accept image/* mime
  const hasImageExt = allowed.some((ext) => FILE_TYPE_REGISTRY[ext]?.category === 'image');
  if (hasImageExt && file.type.startsWith('image/')) return true;

  return false;
}

export function isFileSizeAllowed(file: File): boolean {
  return file.size <= getMaxSizeMb() * 1024 * 1024;
}

export function validateFile(file: File): { valid: true } | { valid: false; error: string } {
  if (!isFileTypeAllowed(file)) {
    const allowed = getAllowedTypes();
    return {
      valid: false,
      error: `Unsupported file type. Accepted: ${allowed.map((t) => '.' + t).join(', ')}`,
    };
  }

  if (!isFileSizeAllowed(file)) {
    return {
      valid: false,
      error: `File exceeds ${getMaxSizeMb()} MB limit.`,
    };
  }

  return { valid: true };
}

export function getAcceptString(): string {
  const allowed = getAllowedTypes();
  const mimeTypes = new Set<string>();
  const extensions = new Set<string>();

  for (const ext of allowed) {
    extensions.add(`.${ext}`);
    const info = FILE_TYPE_REGISTRY[ext];
    if (info) {
      info.mimeTypes.forEach((m) => mimeTypes.add(m));
    }
  }

  return [...mimeTypes, ...extensions].join(',');
}

export function getSupportedFormatsLabel(): string {
  const allowed = getAllowedTypes();
  return allowed.map((t) => t.toUpperCase()).join(', ');
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function getFileCategory(file: File): 'image' | 'document' | 'spreadsheet' | 'unknown' {
  const ext = getExtension(file.name);
  const info = FILE_TYPE_REGISTRY[ext];
  if (info) return info.category;
  if (file.type.startsWith('image/')) return 'image';
  return 'unknown';
}
