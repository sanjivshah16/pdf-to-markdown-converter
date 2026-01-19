# PDF to Markdown Converter: Feature Implementation Plan

> **Document Version:** 1.0
> **Date:** January 2026
> **Target Platform:** macOS (M4 Max), Node.js + Python backend

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Feature 1: JPG/PNG Input Support](#feature-1-jpgpng-input-support)
3. [Feature 2: Batch Processing](#feature-2-batch-processing)
4. [Feature 3: Improved Image Context Association](#feature-3-improved-image-context-association)
5. [Feature 4: LLM Output Cleaner](#feature-4-llm-output-cleaner)
6. [LLM Integration Strategy](#llm-integration-strategy)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Appendix](#appendix)

---

## Executive Summary

This document outlines implementation plans for four major enhancements to the PDF to Markdown converter:

| Feature | Description | Complexity | Priority |
|---------|-------------|------------|----------|
| JPG/PNG Support | Accept image files as input | Low | High |
| Batch Processing | Process multiple files with folder selection | High | Medium |
| Image Context | LLM-powered figure placement | Medium | High |
| LLM Cleaner | AI-powered OCR cleanup | Medium | Medium |

### Recommended Implementation Order

1. **JPG/PNG Support** — Quick win, minimal changes
2. **Image Context Association** — Core quality improvement
3. **LLM Cleaner** — Enhances output quality
4. **Batch Processing** — Most complex, builds on other features

---

## Feature 1: JPG/PNG Input Support

### Overview

Extend the application to accept direct image uploads (JPG, PNG) in addition to PDF files. Images will be processed via OCR to extract text content.

### Current State

- Only PDF files accepted (`application/pdf`)
- Validation occurs in both frontend (`Home.tsx`) and backend (`routers.ts`)
- Processing pipeline assumes PDF input

### Files to Modify

| File | Changes Required |
|------|------------------|
| `client/src/pages/Home.tsx` | Update accept types, validation, UI feedback |
| `server/routers.ts` | Add file type detection, routing logic |
| `server/pdfProcessor.ts` | Add `processImage()` function |
| `server/pdf_converter.py` | Add `--mode image` flag for direct image OCR |

### Implementation Details

#### Step 1: Frontend Upload Validation

**File:** `client/src/pages/Home.tsx`

```typescript
// Current (lines 88-105)
if (droppedFile && droppedFile.type === "application/pdf") {
  setFile(droppedFile);
}

// Updated
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png";

if (droppedFile && ACCEPTED_TYPES.includes(droppedFile.type)) {
  setFile(droppedFile);
}

// Update file input
<input
  type="file"
  accept={ACCEPTED_EXTENSIONS}
  onChange={handleFileSelect}
/>
```

**Additional UI Changes:**
- Display file type icon (PDF icon vs image icon)
- Show appropriate preview (thumbnail for images)
- Adjust progress stages for image processing (no "page extraction")

#### Step 2: Backend File Type Detection

**File:** `server/routers.ts`

```typescript
convert: publicProcedure
  .input(z.object({
    filename: z.string(),
    fileData: z.string(), // Base64 encoded
    fileType: z.enum(["pdf", "image"]).optional(), // Auto-detect if not provided
  }))
  .mutation(async ({ input }) => {
    const { filename, fileData, fileType } = input;

    // Auto-detect file type from extension if not provided
    const detectedType = fileType || detectFileType(filename);

    if (detectedType === "image") {
      return await processImage(filename, fileData);
    } else {
      return await processPdf(filename, fileData);
    }
  })

function detectFileType(filename: string): "pdf" | "image" {
  const ext = filename.toLowerCase().split('.').pop();
  if (["jpg", "jpeg", "png"].includes(ext)) return "image";
  return "pdf";
}
```

#### Step 3: Image Processing Function

**File:** `server/pdfProcessor.ts`

```typescript
export async function processImage(
  filename: string,
  base64Data: string
): Promise<ConversionResult> {
  const conversionId = nanoid();
  const tempDir = path.join(os.tmpdir(), `conversion-${conversionId}`);
  const outputDir = path.join(tempDir, 'output');

  await fs.mkdir(outputDir, { recursive: true });

  // Save image to temp location
  const imagePath = path.join(tempDir, filename);
  await fs.writeFile(imagePath, Buffer.from(base64Data, 'base64'));

  // Run Python OCR
  const pythonScript = path.join(__dirname, 'pdf_converter.py');
  const result = await execAsync(
    `python3 "${pythonScript}" "${imagePath}" "${outputDir}" --mode image`,
    { timeout: 120000 } // 2 minute timeout for single image
  );

  // Read output
  const markdownPath = path.join(outputDir, `${path.parse(filename).name}.md`);
  const markdown = await fs.readFile(markdownPath, 'utf-8');

  return {
    conversionId,
    markdown,
    images: [{ name: filename, url: `/storage/${conversionId}/${filename}`, pageNumber: 1 }],
    totalPages: 1,
    figuresExtracted: 1,
    conversionMethod: "Direct Image OCR"
  };
}
```

#### Step 4: Python Image Mode

**File:** `server/pdf_converter.py`

```python
import argparse

def process_image(image_path: str, output_dir: str) -> dict:
    """Process a single image file with OCR."""
    from PIL import Image
    import pytesseract

    # Load image
    image = Image.open(image_path)

    # Run OCR with optimized config
    ocr_config = r'--oem 3 --psm 1'  # Auto page segmentation
    text = pytesseract.image_to_string(image, config=ocr_config)

    # Generate markdown
    filename = os.path.basename(image_path)
    markdown = f"# {filename}\n\n"
    markdown += f"![Original Image]({filename})\n\n"
    markdown += "## Extracted Text\n\n"
    markdown += text.strip()

    # Save output
    output_name = os.path.splitext(filename)[0]
    output_path = os.path.join(output_dir, f"{output_name}.md")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(markdown)

    # Copy original image to output
    shutil.copy(image_path, os.path.join(output_dir, filename))

    return {
        "markdown_file": output_path,
        "total_pages": 1,
        "figures_extracted": 1,
        "conversion_method": "Direct Image OCR"
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input_path", help="Path to PDF or image file")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("--mode", choices=["pdf", "image"], default="pdf")
    args = parser.parse_args()

    if args.mode == "image":
        result = process_image(args.input_path, args.output_dir)
    else:
        result = convert_pdf(args.input_path, args.output_dir)

    print(json.dumps(result))
```

### Edge Cases

| Edge Case | Handling Strategy |
|-----------|-------------------|
| HEIC/HEIF images (iOS) | Convert to JPEG using `pyheif` or show clear error |
| Very large images (>20MB) | Client-side resize before upload using canvas |
| Corrupt/truncated images | Validate image headers, return descriptive error |
| Low resolution images | Warn user, proceed with best-effort OCR |
| Images with no text | Return empty markdown with original image embedded |

### Testing Checklist

- [ ] JPG upload via drag-and-drop
- [ ] PNG upload via file browser
- [ ] Reject unsupported formats (GIF, WebP, etc.)
- [ ] Progress UI shows correct stages for images
- [ ] OCR output is accurate for clear images
- [ ] Original image preserved in output
- [ ] Error handling for corrupt files

---

## Feature 2: Batch Processing

### Overview

Enable users to select input and output folders for processing multiple files automatically, with progress tracking and organized output.

### Architecture Decision

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **Browser-based** | Use File System Access API | No setup, works in Chrome | Limited browser support |
| **CLI mode** | Separate command-line tool | Full filesystem access | Requires terminal usage |
| **Hybrid** | Both options available | Maximum flexibility | More code to maintain |

**Recommendation:** Implement browser-based approach with CLI as optional enhancement.

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `client/src/pages/Batch.tsx` | **New:** Batch processing UI |
| `client/src/components/FolderPicker.tsx` | **New:** Folder selection component |
| `server/routers.ts` | Add batch endpoints |
| `server/batchProcessor.ts` | **New:** Queue and process files |
| `server/db.ts` | Add batch job schema |

### Database Schema

**Add to `server/db.ts`:**

```typescript
interface BatchJob {
  batchId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  totalFiles: number;
  processedFiles: number;
  failedFiles: number;
  conversions: Array<{
    conversionId: string;
    filename: string;
    status: "pending" | "processing" | "completed" | "failed";
    error?: string;
  }>;
  outputPath?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// Add to database structure
interface Database {
  conversions: Conversion[];
  batchJobs: BatchJob[];  // NEW
  nextId: number;
  nextBatchId: number;    // NEW
}
```

### API Endpoints

**File:** `server/routers.ts`

```typescript
batch: {
  // Start a new batch job
  create: publicProcedure
    .input(z.object({
      files: z.array(z.object({
        filename: z.string(),
        fileData: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const batchId = nanoid();
      const batchJob = await createBatchJob(batchId, input.files);

      // Start processing in background
      processBatchAsync(batchId);

      return { batchId, totalFiles: input.files.length };
    }),

  // Get batch status
  status: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      return await getBatchJob(input.batchId);
    }),

  // Cancel batch job
  cancel: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ input }) => {
      return await cancelBatchJob(input.batchId);
    }),

  // Download all results as ZIP
  download: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      return await createBatchZip(input.batchId);
    }),
}
```

### Batch Processor Implementation

**File:** `server/batchProcessor.ts`

```typescript
import pLimit from 'p-limit';

const CONCURRENCY_LIMIT = 2; // Process 2 files at a time

export async function processBatchAsync(batchId: string): Promise<void> {
  const batch = await getBatchJob(batchId);
  const limit = pLimit(CONCURRENCY_LIMIT);

  await updateBatchJob(batchId, { status: "processing" });

  const tasks = batch.conversions.map((conv, index) =>
    limit(async () => {
      if (batch.status === "cancelled") return;

      try {
        // Update status to processing
        await updateBatchConversion(batchId, index, { status: "processing" });

        // Process the file
        const result = await processFile(conv.filename, conv.fileData);

        // Update status to completed
        await updateBatchConversion(batchId, index, {
          status: "completed",
          conversionId: result.conversionId,
        });

        await incrementBatchProgress(batchId);

      } catch (error) {
        await updateBatchConversion(batchId, index, {
          status: "failed",
          error: error.message,
        });
        await incrementBatchFailed(batchId);
      }
    })
  );

  await Promise.all(tasks);

  await updateBatchJob(batchId, {
    status: "completed",
    completedAt: new Date(),
  });
}
```

### Frontend Implementation

**File:** `client/src/pages/Batch.tsx`

```tsx
import { useState } from 'react';
import { trpc } from '../lib/trpc';

export default function Batch() {
  const [files, setFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);

  const createBatch = trpc.batch.create.useMutation();
  const batchStatus = trpc.batch.status.useQuery(
    { batchId: batchId! },
    { enabled: !!batchId, refetchInterval: 1000 }
  );

  const handleFolderSelect = async () => {
    try {
      // File System Access API (Chrome only)
      const dirHandle = await window.showDirectoryPicker();
      const selectedFiles: File[] = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          if (isValidFileType(file)) {
            selectedFiles.push(file);
          }
        }
      }

      setFiles(selectedFiles);
    } catch (err) {
      console.error('Folder selection cancelled or failed:', err);
    }
  };

  const startBatch = async () => {
    const fileData = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        fileData: await fileToBase64(file),
      }))
    );

    const result = await createBatch.mutateAsync({ files: fileData });
    setBatchId(result.batchId);
  };

  return (
    <div className="batch-processing">
      <h1>Batch Processing</h1>

      {/* Folder Selection */}
      <section className="folder-selection">
        <button onClick={handleFolderSelect}>
          Select Input Folder
        </button>

        {files.length > 0 && (
          <div className="file-list">
            <h3>{files.length} files selected</h3>
            <ul>
              {files.map((f, i) => (
                <li key={i}>{f.name} ({formatBytes(f.size)})</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Start Button */}
      {files.length > 0 && !batchId && (
        <button onClick={startBatch} className="start-batch">
          Start Batch Processing
        </button>
      )}

      {/* Progress Dashboard */}
      {batchStatus.data && (
        <section className="progress-dashboard">
          <h2>Progress</h2>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${(batchStatus.data.processedFiles / batchStatus.data.totalFiles) * 100}%`
              }}
            />
          </div>
          <p>
            {batchStatus.data.processedFiles} / {batchStatus.data.totalFiles} completed
            {batchStatus.data.failedFiles > 0 && (
              <span className="failed"> ({batchStatus.data.failedFiles} failed)</span>
            )}
          </p>

          {/* Individual file status */}
          <ul className="file-status-list">
            {batchStatus.data.conversions.map((conv, i) => (
              <li key={i} className={`status-${conv.status}`}>
                {conv.filename}: {conv.status}
                {conv.error && <span className="error">{conv.error}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

### Output Organization

```
output-folder/
├── document1/
│   ├── document1.md
│   └── images/
│       ├── figure_1_1.png
│       └── figure_1_2.png
├── document2/
│   ├── document2.md
│   └── images/
│       └── figure_1_1.png
├── document3/
│   └── document3.md
└── batch_summary.json
```

**batch_summary.json:**
```json
{
  "batchId": "abc123",
  "totalFiles": 10,
  "successful": 8,
  "failed": 2,
  "processingTime": "5m 32s",
  "files": [
    {
      "filename": "document1.pdf",
      "status": "completed",
      "pages": 5,
      "figures": 3,
      "outputPath": "document1/document1.md"
    },
    {
      "filename": "document2.pdf",
      "status": "failed",
      "error": "Corrupt PDF file"
    }
  ]
}
```

### Real-Time Progress with Server-Sent Events

**File:** `server/routers.ts`

```typescript
// Add SSE endpoint for real-time updates
app.get('/api/batch/:batchId/events', (req, res) => {
  const { batchId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to batch events
  const unsubscribe = subscribeToBatchEvents(batchId, (event) => {
    sendEvent(event.type, event.data);
  });

  req.on('close', () => {
    unsubscribe();
  });
});
```

### Browser Compatibility

| Browser | File System Access API | Fallback |
|---------|------------------------|----------|
| Chrome 86+ | Full support | — |
| Edge 86+ | Full support | — |
| Safari | Not supported | Multiple file input |
| Firefox | Not supported | Multiple file input |

**Fallback for unsupported browsers:**

```tsx
const handleFallbackSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
  const selectedFiles = Array.from(e.target.files || []);
  setFiles(selectedFiles.filter(isValidFileType));
};

// In JSX
{!('showDirectoryPicker' in window) && (
  <input
    type="file"
    multiple
    accept=".pdf,.jpg,.jpeg,.png"
    onChange={handleFallbackSelect}
  />
)}
```

---

## Feature 3: Improved Image Context Association

### Overview

Replace the current heuristic-based figure placement with LLM-powered analysis for accurate positioning of extracted images within the markdown output.

### Current Problem

The existing approach loses positional context:
- Figures are extracted with page numbers only
- Placement uses character-distance heuristics
- Images often end up at page breaks instead of their correct locations
- No semantic understanding of figure-text relationships

### Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PDF Processing                              │
├─────────────────────────────────────────────────────────────────┤
│  1. Extract raw text → markdown (existing)                       │
│  2. Extract figures with enhanced metadata:                      │
│     - Page number                                                │
│     - Bounding box coordinates                                   │
│     - Y-position ratio (0.0 = top, 1.0 = bottom)                │
│     - Surrounding text (50pts above/below)                       │
│     - Detected caption (if any)                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Multimodal LLM Analysis (per figure)                │
├─────────────────────────────────────────────────────────────────┤
│  Input:                                                          │
│    - Figure image (for vision models)                            │
│    - Surrounding markdown text (±2 pages)                        │
│    - Position metadata                                           │
│                                                                  │
│  LLM Tasks:                                                      │
│    1. Describe what the figure shows                             │
│    2. Identify the optimal insertion point                       │
│    3. Generate/improve caption if missing                        │
│    4. Find explicit references ("see Figure 3", etc.)            │
│    5. Calculate confidence score                                 │
│                                                                  │
│  Output:                                                         │
│    - insertion_point: line number or text marker                 │
│    - caption: "Figure X: Description"                            │
│    - references: [{line: 45, text: "see graph below"}]           │
│    - confidence: 0.92                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Markdown Assembly                             │
├─────────────────────────────────────────────────────────────────┤
│  - Insert figures at LLM-determined positions                    │
│  - Add generated captions                                        │
│  - Preserve figure-question links with confidence scores         │
└─────────────────────────────────────────────────────────────────┘
```

### Files to Modify

| File | Changes |
|------|---------|
| `server/pdf_converter.py` | Enhanced metadata extraction |
| `server/pdfProcessor.ts` | LLM integration for figure analysis |
| `server/figureAnalyzer.ts` | **New:** LLM-powered figure analysis |

### Enhanced Metadata Extraction

**File:** `server/pdf_converter.py`

```python
def extract_figure_with_context(page, figure_bbox, page_number, page_height):
    """Extract figure with comprehensive context for LLM analysis."""

    x0, y0, x1, y1 = figure_bbox

    # Calculate relative position
    y_position_ratio = y0 / page_height  # 0.0 = top, 1.0 = bottom

    # Extract surrounding text
    margin = 50  # points

    # Text above figure
    above_rect = fitz.Rect(0, max(0, y0 - margin), page.rect.width, y0)
    text_above = page.get_text("text", clip=above_rect).strip()

    # Text below figure
    below_rect = fitz.Rect(0, y1, page.rect.width, min(page_height, y1 + margin))
    text_below = page.get_text("text", clip=below_rect).strip()

    # Detect caption (typically immediately below figure)
    caption_rect = fitz.Rect(x0 - 10, y1, x1 + 10, y1 + 30)
    potential_caption = page.get_text("text", clip=caption_rect).strip()

    # Check if it looks like a caption
    caption = None
    caption_patterns = [
        r'^Figure\s+\d+',
        r'^Fig\.\s+\d+',
        r'^Table\s+\d+',
        r'^Chart\s+\d+',
        r'^Diagram\s+\d+',
    ]
    for pattern in caption_patterns:
        if re.match(pattern, potential_caption, re.IGNORECASE):
            caption = potential_caption
            break

    return {
        "page": page_number,
        "bbox": [x0, y0, x1, y1],
        "y_position_ratio": round(y_position_ratio, 3),
        "text_above": text_above[:200],  # Limit length
        "text_below": text_below[:200],
        "detected_caption": caption,
        "figure_width": x1 - x0,
        "figure_height": y1 - y0,
    }
```

### LLM Figure Analyzer

**File:** `server/figureAnalyzer.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';

interface FigureAnalysis {
  insertionPoint: {
    afterLine: number;
    afterText?: string;
    confidence: number;
  };
  suggestedCaption: string;
  figureDescription: string;
  explicitReferences: Array<{
    line: number;
    text: string;
    type: 'direct' | 'indirect';
  }>;
  linkedQuestions: string[];
}

interface AnalyzerConfig {
  provider: 'ollama' | 'gemini' | 'claude';
  model: string;
  apiKey?: string;
}

const FIGURE_ANALYSIS_PROMPT = `You are analyzing an extracted figure from a PDF document to determine its optimal placement in the markdown output.

FIGURE METADATA:
- Page: {page}
- Vertical position: {y_position_ratio} (0.0 = top of page, 1.0 = bottom)
- Detected caption: {caption}
- Text immediately above: {text_above}
- Text immediately below: {text_below}

SURROUNDING MARKDOWN CONTENT (from pages {page_start} to {page_end}):
"""
{markdown_context}
"""

TASKS:
1. Based on the figure image, describe what it shows (chart type, data, labels, etc.)
2. Find the optimal insertion point in the markdown where this figure belongs
3. Look for explicit references like "see Figure X", "as shown below", "the following diagram"
4. Look for implicit references discussing the figure's content
5. If no caption exists, suggest an appropriate one
6. Identify any questions this figure might be associated with

OUTPUT FORMAT (JSON):
{
  "figureDescription": "A bar chart showing quarterly revenue from 2020-2024",
  "insertionPoint": {
    "afterLine": 45,
    "afterText": "The revenue growth is illustrated below",
    "confidence": 0.9
  },
  "suggestedCaption": "Figure 3: Quarterly Revenue 2020-2024",
  "explicitReferences": [
    {"line": 44, "text": "see the chart below", "type": "indirect"}
  ],
  "linkedQuestions": ["12", "13"]
}`;

export async function analyzeFigure(
  figureImagePath: string,
  figureMetadata: FigureMetadata,
  markdownContext: string,
  config: AnalyzerConfig
): Promise<FigureAnalysis> {

  const prompt = FIGURE_ANALYSIS_PROMPT
    .replace('{page}', String(figureMetadata.page))
    .replace('{y_position_ratio}', String(figureMetadata.y_position_ratio))
    .replace('{caption}', figureMetadata.detected_caption || 'None detected')
    .replace('{text_above}', figureMetadata.text_above || 'None')
    .replace('{text_below}', figureMetadata.text_below || 'None')
    .replace('{page_start}', String(Math.max(1, figureMetadata.page - 1)))
    .replace('{page_end}', String(figureMetadata.page + 1))
    .replace('{markdown_context}', markdownContext);

  switch (config.provider) {
    case 'ollama':
      return await analyzeWithOllama(figureImagePath, prompt, config.model);
    case 'gemini':
      return await analyzeWithGemini(figureImagePath, prompt, config.apiKey!);
    case 'claude':
      return await analyzeWithClaude(figureImagePath, prompt, config.apiKey!);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

async function analyzeWithOllama(
  imagePath: string,
  prompt: string,
  model: string
): Promise<FigureAnalysis> {
  const imageBase64 = await fs.readFile(imagePath, { encoding: 'base64' });

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      images: [imageBase64],
      stream: false,
      format: 'json',
    }),
  });

  const result = await response.json();
  return JSON.parse(result.response);
}

async function analyzeWithGemini(
  imagePath: string,
  prompt: string,
  apiKey: string
): Promise<FigureAnalysis> {
  const imageBase64 = await fs.readFile(imagePath, { encoding: 'base64' });
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        }],
        generationConfig: {
          response_mime_type: 'application/json',
        },
      }),
    }
  );

  const result = await response.json();
  return JSON.parse(result.candidates[0].content.parts[0].text);
}

async function analyzeWithClaude(
  imagePath: string,
  prompt: string,
  apiKey: string
): Promise<FigureAnalysis> {
  const imageBase64 = await fs.readFile(imagePath, { encoding: 'base64' });
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: imageBase64,
          },
        },
        { type: 'text', text: prompt },
      ],
    }],
  });

  return JSON.parse(response.content[0].text);
}
```

### Integration with Processing Pipeline

**File:** `server/pdfProcessor.ts`

```typescript
import { analyzeFigure, AnalyzerConfig } from './figureAnalyzer';

export async function processPdfWithLLM(
  pdfPath: string,
  outputDir: string,
  llmConfig?: AnalyzerConfig
): Promise<ConversionResult> {
  // Step 1: Extract text and figures (existing code)
  const extractionResult = await runPythonExtraction(pdfPath, outputDir);

  // Step 2: If LLM is configured, analyze figures
  if (llmConfig && extractionResult.figures.length > 0) {
    const markdownContent = await fs.readFile(extractionResult.markdownPath, 'utf-8');

    // Analyze each figure
    const figureAnalyses = await Promise.all(
      extractionResult.figures.map(async (figure) => {
        const contextStart = Math.max(0, (figure.page - 2) * 2000);
        const contextEnd = Math.min(markdownContent.length, (figure.page + 1) * 2000);
        const context = markdownContent.slice(contextStart, contextEnd);

        return {
          figure,
          analysis: await analyzeFigure(
            path.join(outputDir, 'images', figure.filename),
            figure,
            context,
            llmConfig
          ),
        };
      })
    );

    // Step 3: Insert figures at determined positions
    const finalMarkdown = insertFiguresAtPositions(
      markdownContent,
      figureAnalyses
    );

    // Step 4: Save updated markdown
    await fs.writeFile(extractionResult.markdownPath, finalMarkdown);

    return {
      ...extractionResult,
      markdown: finalMarkdown,
      figureQuestionLinks: figureAnalyses.flatMap(fa =>
        fa.analysis.linkedQuestions.map(q => ({
          figureId: fa.figure.filename,
          questionNumber: q,
          pageNumber: fa.figure.page,
          confidence: fa.analysis.insertionPoint.confidence,
        }))
      ),
    };
  }

  return extractionResult;
}

function insertFiguresAtPositions(
  markdown: string,
  figureAnalyses: Array<{ figure: Figure; analysis: FigureAnalysis }>
): string {
  const lines = markdown.split('\n');

  // Sort by insertion point descending to avoid offset issues
  const sorted = [...figureAnalyses].sort(
    (a, b) => b.analysis.insertionPoint.afterLine - a.analysis.insertionPoint.afterLine
  );

  for (const { figure, analysis } of sorted) {
    const insertLine = analysis.insertionPoint.afterLine;
    const caption = analysis.suggestedCaption || `Figure from page ${figure.page}`;

    const figureMarkdown = [
      '',
      `![${caption}](images/${figure.filename})`,
      `*${caption}*`,
      '',
    ].join('\n');

    lines.splice(insertLine + 1, 0, figureMarkdown);
  }

  return lines.join('\n');
}
```

### Before/After Comparison

**Before (Heuristic-based):**
```markdown
## Page 3

**12.** Analyze the revenue trends shown in the graph and explain
the factors contributing to the Q3 decline.

**13.** Based on the data, project the expected revenue for Q1 2025.

---

<!-- Figures dumped at page break -->
![figure_3_1.png](images/figure_3_1.png)
```

**After (LLM-powered):**
```markdown
## Page 3

**12.** Analyze the revenue trends shown in the graph and explain
the factors contributing to the Q3 decline.

![Figure 3: Quarterly Revenue 2020-2024](images/figure_3_1.png)
*Figure 3: Quarterly Revenue 2020-2024*

**13.** Based on the data, project the expected revenue for Q1 2025.
```

---

## Feature 4: LLM Output Cleaner

### Overview

Add an optional post-processing step that uses an LLM to clean up OCR artifacts, fix formatting issues, and improve readability.

### Cleaning Tasks

| Task | Example |
|------|---------|
| Fix OCR character errors | `rn` → `m`, `0` → `O` in words |
| Repair broken words | `knowl-\nedge` → `knowledge` |
| Fix formatting | Broken headers, malformed lists |
| Remove artifacts | Repeated headers/footers, page numbers |
| Preserve technical content | Math notation, code blocks, formulas |

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `server/llmCleaner.ts` | **New:** LLM integration for text cleanup |
| `server/routers.ts` | Add clean endpoint |
| `client/src/pages/Home.tsx` | Add cleanup toggle/button |
| `client/src/pages/Settings.tsx` | **New:** LLM configuration |

### LLM Cleaner Implementation

**File:** `server/llmCleaner.ts`

```typescript
interface CleanerConfig {
  provider: 'ollama' | 'gemini' | 'claude' | 'openai';
  model: string;
  apiKey?: string;
}

const CLEANUP_PROMPT = `You are a document cleanup assistant. Fix the following OCR-extracted markdown text.

TASKS:
1. Fix obvious OCR errors (e.g., "rn" misread as "m", "0" misread as "O" in words, "1" as "l")
2. Repair words incorrectly split across lines (e.g., "knowl-\\nedge" → "knowledge")
3. Fix markdown formatting issues (headers, lists, tables)
4. Remove repeated headers, footers, and page numbers that appear in the text
5. Fix spacing issues (missing spaces, extra spaces)

CRITICAL RULES:
- DO NOT change the meaning of any text
- DO NOT add information that wasn't there
- DO NOT remove intentional content
- PRESERVE all mathematical notation and formulas exactly
- PRESERVE all figure/image references exactly as written
- PRESERVE question numbers and structure
- If unsure about a correction, leave the original text

INPUT TEXT:
"""
{text}
"""

OUTPUT (corrected markdown only, no explanations):`;

const CHUNK_SIZE = 4000; // ~4000 characters per chunk to stay within context limits
const CHUNK_OVERLAP = 200; // Overlap to maintain context at boundaries

export async function cleanMarkdown(
  rawMarkdown: string,
  config: CleanerConfig
): Promise<CleanupResult> {
  const chunks = splitIntoChunks(rawMarkdown, CHUNK_SIZE, CHUNK_OVERLAP);

  const cleanedChunks: string[] = [];
  const changes: Change[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const { cleaned, chunkChanges } = await cleanChunk(chunks[i], config, i);
    cleanedChunks.push(cleaned);
    changes.push(...chunkChanges);
  }

  const cleanedMarkdown = mergeChunks(cleanedChunks, CHUNK_OVERLAP);

  return {
    original: rawMarkdown,
    cleaned: cleanedMarkdown,
    changes,
    stats: {
      totalChanges: changes.length,
      chunksProcessed: chunks.length,
    },
  };
}

function splitIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    // Try to break at paragraph boundary
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const lastParagraph = text.lastIndexOf('\n\n', end);
      if (lastParagraph > start + chunkSize / 2) {
        end = lastParagraph;
      }
    }

    chunks.push(text.slice(start, end));
    start = end - overlap;
  }

  return chunks;
}

async function cleanChunk(
  chunk: string,
  config: CleanerConfig,
  chunkIndex: number
): Promise<{ cleaned: string; chunkChanges: Change[] }> {
  const prompt = CLEANUP_PROMPT.replace('{text}', chunk);

  let cleaned: string;

  switch (config.provider) {
    case 'ollama':
      cleaned = await cleanWithOllama(prompt, config.model);
      break;
    case 'gemini':
      cleaned = await cleanWithGemini(prompt, config.apiKey!);
      break;
    case 'claude':
      cleaned = await cleanWithClaude(prompt, config.apiKey!);
      break;
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }

  // Detect changes
  const chunkChanges = detectChanges(chunk, cleaned, chunkIndex);

  return { cleaned, chunkChanges };
}

async function cleanWithOllama(prompt: string, model: string): Promise<string> {
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
    }),
  });

  const result = await response.json();
  return result.response.trim();
}

async function cleanWithGemini(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const result = await response.json();
  return result.candidates[0].content.parts[0].text.trim();
}

async function cleanWithClaude(prompt: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}
```

### API Endpoint

**File:** `server/routers.ts`

```typescript
clean: publicProcedure
  .input(z.object({
    conversionId: z.string(),
    provider: z.enum(['ollama', 'gemini', 'claude']).default('ollama'),
    model: z.string().optional(),
    apiKey: z.string().optional(),
  }))
  .mutation(async ({ input }) => {
    const conversion = await getConversionById(input.conversionId);
    if (!conversion) {
      throw new Error('Conversion not found');
    }

    const config: CleanerConfig = {
      provider: input.provider,
      model: input.model || getDefaultModel(input.provider),
      apiKey: input.apiKey,
    };

    const result = await cleanMarkdown(conversion.markdownContent, config);

    // Store cleaned version (keep original)
    await updateConversion(input.conversionId, {
      cleanedMarkdownContent: result.cleaned,
      cleanupStats: result.stats,
    });

    return {
      cleaned: result.cleaned,
      changes: result.changes,
      stats: result.stats,
    };
  }),

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'ollama': return 'qwen2.5:14b';
    case 'gemini': return 'gemini-2.0-flash';
    case 'claude': return 'claude-3-5-haiku-20241022';
    default: return 'qwen2.5:14b';
  }
}
```

### Frontend Integration

**File:** `client/src/pages/Home.tsx`

```tsx
// Add to results section
const [showCleanupOptions, setShowCleanupOptions] = useState(false);
const [cleanupProvider, setCleanupProvider] = useState<'ollama' | 'gemini' | 'claude'>('ollama');
const [isCleaningUp, setIsCleaningUp] = useState(false);

const cleanMutation = trpc.pdf.clean.useMutation();

const handleCleanup = async () => {
  setIsCleaningUp(true);
  try {
    const result = await cleanMutation.mutateAsync({
      conversionId,
      provider: cleanupProvider,
    });
    setMarkdown(result.cleaned);
    setCleanupStats(result.stats);
  } finally {
    setIsCleaningUp(false);
  }
};

// In JSX
<div className="cleanup-section">
  <button
    onClick={() => setShowCleanupOptions(!showCleanupOptions)}
    className="cleanup-toggle"
  >
    ✨ Clean with AI
  </button>

  {showCleanupOptions && (
    <div className="cleanup-options">
      <select
        value={cleanupProvider}
        onChange={(e) => setCleanupProvider(e.target.value)}
      >
        <option value="ollama">Local (Ollama)</option>
        <option value="gemini">Google Gemini</option>
        <option value="claude">Anthropic Claude</option>
      </select>

      <button
        onClick={handleCleanup}
        disabled={isCleaningUp}
      >
        {isCleaningUp ? 'Cleaning...' : 'Start Cleanup'}
      </button>
    </div>
  )}

  {cleanupStats && (
    <div className="cleanup-stats">
      <p>✓ {cleanupStats.totalChanges} corrections made</p>
      <button onClick={() => setShowDiff(true)}>View Changes</button>
    </div>
  )}
</div>
```

### Diff View Component

```tsx
// client/src/components/DiffView.tsx
import { diffLines } from 'diff';

export function DiffView({ original, cleaned }: { original: string; cleaned: string }) {
  const diff = diffLines(original, cleaned);

  return (
    <div className="diff-view">
      {diff.map((part, index) => (
        <span
          key={index}
          className={
            part.added ? 'diff-added' :
            part.removed ? 'diff-removed' :
            'diff-unchanged'
          }
        >
          {part.value}
        </span>
      ))}
    </div>
  );
}
```

---

## LLM Integration Strategy

### Recommended Models

#### Local Models (Ollama) — For M4 Max MacBook

| Purpose | Model | Memory | Speed | Command |
|---------|-------|--------|-------|---------|
| **Figure Analysis** | Qwen2-VL 7B | ~6GB | ~40 tok/s | `ollama pull qwen2-vl:7b` |
| **Text Cleanup** | Qwen 2.5 14B | ~10GB | ~35 tok/s | `ollama pull qwen2.5:14b` |

**Setup Commands:**
```bash
# Install Ollama (if not installed)
brew install ollama

# Start Ollama service
ollama serve

# Pull recommended models
ollama pull qwen2-vl:7b
ollama pull qwen2.5:14b

# Verify installation
ollama list
```

#### Commercial APIs — For Production/Higher Quality

| Provider | Model | Use Case | Pricing (approx.) |
|----------|-------|----------|-------------------|
| **Google Gemini** | gemini-2.0-flash | Vision + Text | $0.10/1M input tokens |
| **Anthropic Claude** | claude-3-5-haiku | Text cleanup | $0.25/1M input tokens |
| **Anthropic Claude** | claude-sonnet-4-20250514 | Complex analysis | $3/1M input tokens |

**Gemini Setup:**
```typescript
// Get API key from: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini 2.0 Flash - excellent for vision tasks, very cost-effective
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: imageBase64 } }
        ]
      }]
    })
  }
);
```

### Cost Comparison

**Processing a 20-page PDF with 5 figures:**

| Provider | Figure Analysis | Text Cleanup | Total Cost |
|----------|-----------------|--------------|------------|
| **Ollama (Local)** | Free | Free | **$0.00** |
| **Gemini Flash** | ~$0.001 | ~$0.002 | **~$0.003** |
| **Claude Haiku** | ~$0.003 | ~$0.005 | **~$0.008** |
| **Claude Sonnet** | ~$0.02 | ~$0.03 | **~$0.05** |

### Hybrid Strategy (Recommended)

```typescript
interface LLMConfig {
  figureAnalysis: {
    provider: 'ollama' | 'gemini';
    model: string;
  };
  textCleanup: {
    provider: 'ollama' | 'claude';
    model: string;
  };
}

const DEFAULT_CONFIG: LLMConfig = {
  figureAnalysis: {
    provider: 'ollama',      // Use local by default
    model: 'qwen2-vl:7b',
  },
  textCleanup: {
    provider: 'ollama',      // Use local by default
    model: 'qwen2.5:14b',
  },
};

const QUALITY_CONFIG: LLMConfig = {
  figureAnalysis: {
    provider: 'gemini',      // Better vision understanding
    model: 'gemini-2.0-flash',
  },
  textCleanup: {
    provider: 'claude',      // Better text quality
    model: 'claude-3-5-haiku-20241022',
  },
};
```

### Environment Variables

```bash
# .env file
# Local LLM
OLLAMA_HOST=http://localhost:11434

# Google Gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Anthropic Claude
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Default provider (ollama | gemini | claude)
DEFAULT_LLM_PROVIDER=ollama
```

---

## Implementation Roadmap

### Phase 1: Foundation (JPG/PNG Support)
- [ ] Update frontend file validation
- [ ] Add backend file type detection
- [ ] Implement image processing function
- [ ] Add Python image mode
- [ ] Test with various image formats
- [ ] Handle edge cases (large images, corrupt files)

### Phase 2: Core Quality (Image Context)
- [ ] Enhance Python metadata extraction
- [ ] Create `figureAnalyzer.ts` module
- [ ] Implement Ollama integration
- [ ] Implement Gemini integration
- [ ] Update processing pipeline
- [ ] Test figure placement accuracy
- [ ] Add confidence thresholds

### Phase 3: Polish (LLM Cleaner)
- [ ] Create `llmCleaner.ts` module
- [ ] Implement chunking strategy
- [ ] Add cleanup API endpoint
- [ ] Create frontend cleanup UI
- [ ] Implement diff view
- [ ] Add settings page for API keys
- [ ] Test with various document types

### Phase 4: Scale (Batch Processing)
- [ ] Design batch database schema
- [ ] Implement batch processor
- [ ] Create batch API endpoints
- [ ] Build batch processing UI
- [ ] Add folder picker component
- [ ] Implement SSE for progress
- [ ] Create ZIP download functionality
- [ ] Add cancellation support
- [ ] Test with large batches

---

## Appendix

### A. File Structure After Implementation

```
pdf-to-markdown-converter/
├── client/
│   └── src/
│       ├── pages/
│       │   ├── Home.tsx          # Updated with cleanup UI
│       │   ├── History.tsx       # Existing
│       │   ├── Batch.tsx         # NEW: Batch processing
│       │   └── Settings.tsx      # NEW: LLM configuration
│       └── components/
│           ├── FolderPicker.tsx  # NEW: Folder selection
│           └── DiffView.tsx      # NEW: Change visualization
├── server/
│   ├── routers.ts                # Updated with new endpoints
│   ├── pdfProcessor.ts           # Updated with LLM integration
│   ├── pdf_converter.py          # Updated with enhanced extraction
│   ├── figureAnalyzer.ts         # NEW: LLM figure analysis
│   ├── llmCleaner.ts             # NEW: LLM text cleanup
│   ├── batchProcessor.ts         # NEW: Batch job handling
│   └── db.ts                     # Updated with batch schema
└── .env                          # API keys configuration
```

### B. Dependencies to Add

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "p-limit": "^4.0.0",
    "diff": "^5.1.0",
    "archiver": "^6.0.0"
  },
  "devDependencies": {
    "@types/diff": "^5.0.0",
    "@types/archiver": "^6.0.0"
  }
}
```

### C. Python Dependencies to Add

```txt
# requirements.txt additions
pyheif>=0.7.0      # For HEIC image support (optional)
```

### D. Testing Checklist

#### JPG/PNG Support
- [ ] JPG upload via drag-and-drop
- [ ] PNG upload via file browser
- [ ] Large image handling (>10MB)
- [ ] Corrupt file error handling
- [ ] OCR accuracy on clear images
- [ ] OCR handling of low-resolution images

#### Image Context
- [ ] Figure detection accuracy
- [ ] Caption extraction
- [ ] LLM placement decisions
- [ ] Confidence scoring
- [ ] Fallback when LLM unavailable

#### LLM Cleaner
- [ ] OCR error correction
- [ ] Formatting preservation
- [ ] Math notation preservation
- [ ] Chunking for long documents
- [ ] Diff accuracy

#### Batch Processing
- [ ] Folder selection (Chrome)
- [ ] Multi-file fallback (other browsers)
- [ ] Progress tracking
- [ ] Error handling for individual files
- [ ] Cancellation
- [ ] ZIP download

---

*Document generated for PDF to Markdown Converter enhancement planning.*
