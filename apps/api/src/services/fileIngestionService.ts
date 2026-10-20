/**
 * SupplySense Multi-Format File Intelligence & Safe Archive Ingestion Service
 * Supports: PDF, DOCX, XLSX/CSV/TSV, PPTX, PNG/JPG/WEBP (OCR metadata), TXT/MD/JSON/YAML/XML, ZIP.
 * Enforces:
 * - File size limits
 * - Zip-slip path traversal rejection (../ or absolute paths)
 * - Decompression bomb protection (max extracted bytes & file count)
 * - Embedded prompt-injection sanitization
 * - Exact provenance locators (Page N, Sheet/Cell, Slide N, Line N)
 */

import path from 'node:path';
import {
  type ParsedFileArtifact,
  type ExtractedFileFact,
  sanitizeAgainstPromptInjection,
} from '../../../packages/shared/src/index.js';

export interface FileUploadInput {
  id?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentText?: string;
  zipEntries?: Array<{ entryPath: string; uncompressedSize: number; contentText?: string }>;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.csv',
  '.tsv',
  '.ods',
  '.pptx',
  '.ppt',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.zip',
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_ZIP_ENTRY_COUNT = 50;

export function ingestAndParseFile(input: FileUploadInput): ParsedFileArtifact {
  const id = input.id || `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ext = path.extname(input.fileName || '').toLowerCase();
  const securityWarnings: string[] = [];

  // 1. Validate filename against path traversal
  if (input.fileName.includes('..') || input.fileName.startsWith('/') || input.fileName.includes('\\')) {
    return {
      id,
      fileName: path.basename(input.fileName),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      formatSupported: false,
      status: 'REJECTED_SECURITY',
      securityWarnings: ['Rejected file due to path traversal characters in filename.'],
      extractedTextPreview: '',
      facts: [],
      bomItems: [],
      parsedAt: new Date().toISOString(),
    };
  }

  // 2. Check file size ceiling
  if (input.sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      formatSupported: true,
      status: 'REJECTED_SECURITY',
      securityWarnings: [
        `File size (${input.sizeBytes} bytes) exceeds maximum allowed limit (${MAX_FILE_SIZE_BYTES} bytes).`,
      ],
      extractedTextPreview: '',
      facts: [],
      bomItems: [],
      parsedAt: new Date().toISOString(),
    };
  }

  // 3. Check format support
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      id,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      formatSupported: false,
      status: 'UNSUPPORTED',
      securityWarnings: [`Unsupported file extension "${ext}". Audio, video, and binary executables are rejected.`],
      extractedTextPreview: '',
      facts: [],
      bomItems: [],
      parsedAt: new Date().toISOString(),
    };
  }

  // 4. ZIP archive safety inspection (Zip-Slip & Decompression Bomb protection)
  if (ext === '.zip' && input.zipEntries) {
    if (input.zipEntries.length > MAX_ZIP_ENTRY_COUNT) {
      return {
        id,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        formatSupported: true,
        status: 'REJECTED_SECURITY',
        securityWarnings: [`ZIP archive contains ${input.zipEntries.length} entries (max allowed: ${MAX_ZIP_ENTRY_COUNT}).`],
        extractedTextPreview: '',
        facts: [],
        bomItems: [],
        parsedAt: new Date().toISOString(),
      };
    }

    let totalUncompressed = 0;
    for (const entry of input.zipEntries) {
      const normalizedEntry = path.posix.normalize(entry.entryPath.replace(/\\/g, '/'));
      if (normalizedEntry.startsWith('..') || normalizedEntry.startsWith('/') || entry.entryPath.includes('..')) {
        return {
          id,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          formatSupported: true,
          status: 'REJECTED_SECURITY',
          securityWarnings: [`Blocked Zip-Slip path traversal entry inside archive: "${entry.entryPath}".`],
          extractedTextPreview: '',
          facts: [],
          bomItems: [],
          parsedAt: new Date().toISOString(),
        };
      }
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        return {
          id,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          formatSupported: true,
          status: 'REJECTED_SECURITY',
          securityWarnings: [
            `Blocked ZIP decompression bomb: uncompressed size exceeds ${MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES} bytes.`,
          ],
          extractedTextPreview: '',
          facts: [],
          bomItems: [],
          parsedAt: new Date().toISOString(),
        };
      }
    }
  }

  // 5. Sanitize content against prompt injection
  const rawText = input.contentText || '';
  const sanitized = sanitizeAgainstPromptInjection(rawText);
  if (sanitized.injectionDetected) {
    securityWarnings.push(...sanitized.warnings);
  }

  const cleanText = sanitized.sanitizedText;
  const facts: ExtractedFileFact[] = [];
  const bomItems: ParsedFileArtifact['bomItems'] = [];

  // 6. Extract structured facts & BOM rows with format-specific locators
  const lines = cleanText.split(/\r?\n/);
  let currentLocatorPrefix =
    ext === '.pdf'
      ? 'Page 1'
      : ext === '.xlsx' || ext === '.xls' || ext === '.csv'
        ? "Sheet 'Main'"
        : ext === '.pptx'
          ? 'Slide 1'
          : 'Section 1';

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Detect explicit Page / Sheet / Slide markers in extracted text
    const pageMarker = trimmed.match(/^---\s*(Page\s+\d+|Sheet\s+['"]?[\w\s-]+['"]?|Slide\s+\d+)\s*---$/i);
    if (pageMarker) {
      currentLocatorPrefix = pageMarker[1];
      return;
    }

    const rowLocator =
      ext === '.csv' || ext === '.xlsx' || ext === '.xls'
        ? `${currentLocatorPrefix} Row ${idx + 1}`
        : `${currentLocatorPrefix}, Line ${idx + 1}`;

    // Parse CSV / Tabular BOM rows: PartNumber, Description, Qty, TargetUnitPrice, MandatorySpecs
    if ((ext === '.csv' || ext === '.xlsx' || trimmed.includes('|') || trimmed.includes(',')) && idx > 0) {
      const cols = trimmed.includes('|')
        ? trimmed.split('|').map((c) => c.trim()).filter(Boolean)
        : trimmed.split(',').map((c) => c.trim());

      if (cols.length >= 3 && /^\d+$/.test(cols[2])) {
        const partNumber = cols[0];
        const description = cols[1];
        const qty = parseInt(cols[2], 10);
        const targetPrice = cols[3] ? parseFloat(cols[3].replace(/[^\d.]/g, '')) : undefined;
        const specSummary = cols[4] || description;

        bomItems.push({
          partNumber,
          description,
          quantity: qty,
          targetUnitPrice: !Number.isNaN(targetPrice ?? NaN) ? targetPrice : undefined,
          mandatorySpecSummary: specSummary,
          locator: rowLocator,
        });

        if (targetPrice !== undefined && !Number.isNaN(targetPrice)) {
          facts.push({
            id: `${id}_fact_${facts.length + 1}`,
            fileId: id,
            fileName: input.fileName,
            fileFormat: ext.slice(1).toUpperCase(),
            locator: `${rowLocator} Col D`,
            factType: 'bom_item',
            entityName: partNumber,
            field: 'unit_price',
            value: targetPrice,
            unit: 'INR',
            verbatimExcerpt: trimmed,
            confidence: 0.98,
          });
        }
      }
    }

    // Parse Key-Value Specifications or Quotation Lines (e.g., "12V DC Motor | Gearbox: Plastic | Unit Price: INR 480")
    const entitySpecMatch = trimmed.match(
      /^([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+){0,3})\s*[:|-]\s*(voltage|gearbox|torque|unit_price|shipping_fee|warranty|gst)\s*=\s*([^;|]+)/i
    );
    if (entitySpecMatch) {
      facts.push({
        id: `${id}_fact_${facts.length + 1}`,
        fileId: id,
        fileName: input.fileName,
        fileFormat: ext.slice(1).toUpperCase(),
        locator: rowLocator,
        factType: 'specification',
        entityName: entitySpecMatch[1].trim(),
        field: entitySpecMatch[2].trim().toLowerCase(),
        value: entitySpecMatch[3].trim(),
        verbatimExcerpt: trimmed,
        confidence: 0.95,
      });
    }
  });

  return {
    id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    formatSupported: true,
    status: cleanText.length > 0 || (input.zipEntries && input.zipEntries.length > 0) ? 'PARSED' : 'PARTIAL',
    securityWarnings,
    extractedTextPreview: cleanText.slice(0, 600),
    facts,
    bomItems,
    parsedAt: new Date().toISOString(),
  };
}
