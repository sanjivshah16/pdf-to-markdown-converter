/**
 * PDF Processor - Node.js wrapper for Python OCR conversion
 * Executes the Python script and handles file management
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";
import { storagePut, storageGet } from "./storage";

export interface ConversionResult {
  conversionId: string;
  markdown: string;
  images: Array<{
    name: string;
    url: string;
    pageNumber: number;
    linkedQuestion?: string;
  }>;
  totalPages: number;
  figuresExtracted: number;
  conversionMethod: string;
  figureQuestionLinks: Array<{
    figureId: string;
    questionNumber: string;
    pageNumber: number;
    confidence: number;
  }>;
}

export interface ProcessingProgress {
  stage: string;
  progress: number;
  message: string;
}

/**
 * Process a PDF file using the Python OCR converter
 */
export async function processPDF(
  pdfBuffer: Buffer,
  filename: string,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<ConversionResult> {
  const conversionId = nanoid();
  const tempDir = `/tmp/pdf_conversion_${conversionId}`;
  const outputDir = `${tempDir}/output`;
  const pdfPath = `${tempDir}/${filename}`;

  try {
    // Create temp directories
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    // Write PDF to temp file
    fs.writeFileSync(pdfPath, pdfBuffer);

    onProgress?.({ stage: "extract", progress: 10, message: "Starting PDF extraction..." });

    // Execute Python converter
    const result = await executePythonConverter(pdfPath, outputDir, onProgress);

    onProgress?.({ stage: "upload", progress: 80, message: "Uploading results to storage..." });

    // Upload results to S3
    const uploadedImages = await uploadImagesToS3(conversionId, outputDir, result.figures);

    // Upload markdown to S3
    const markdownContent = result.markdown;
    const markdownKey = `conversions/${conversionId}/output.md`;
    await storagePut(markdownKey, Buffer.from(markdownContent), "text/markdown");

    onProgress?.({ stage: "complete", progress: 100, message: "Conversion complete!" });

    // Clean up temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      conversionId,
      markdown: markdownContent,
      images: uploadedImages,
      totalPages: result.totalPages,
      figuresExtracted: result.figuresExtracted,
      conversionMethod: result.conversionMethod,
      figureQuestionLinks: result.figureQuestionLinks,
    };
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    throw error;
  }
}

interface PythonConverterResult {
  markdown: string;
  figures: Array<{
    page: number;
    filename: string;
    path: string;
    type: string;
  }>;
  totalPages: number;
  figuresExtracted: number;
  conversionMethod: string;
  figureQuestionLinks: Array<{
    figureId: string;
    questionNumber: string;
    pageNumber: number;
    confidence: number;
  }>;
}

/**
 * Execute the Python PDF converter script
 */
async function executePythonConverter(
  pdfPath: string,
  outputDir: string,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<PythonConverterResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "pdf_converter.py");
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      reject(new Error("PDF converter script not found"));
      return;
    }

    const pythonProcess = spawn("python3", [
      scriptPath,
      pdfPath,
      "-o", outputDir,
      "-m", "tesseract"
    ]);

    let stdout = "";
    let stderr = "";
    let currentPage = 0;

    pythonProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      
      // Parse progress from output
      const pageMatch = output.match(/Processing page (\d+)\/(\d+)/);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1]);
        const totalPages = parseInt(pageMatch[2]);
        const progress = Math.round(20 + (currentPage / totalPages) * 50);
        onProgress?.({
          stage: "ocr",
          progress,
          message: `Processing page ${currentPage} of ${totalPages}...`
        });
      }
    });

    pythonProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python converter failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Read the generated files
        const baseName = path.basename(pdfPath, ".pdf");
        const markdownPath = `${outputDir}/${baseName}.md`;
        const metadataPath = `${outputDir}/${baseName}_metadata.json`;
        const imagesDir = `${outputDir}/images`;

        // Read markdown content
        const markdown = fs.existsSync(markdownPath)
          ? fs.readFileSync(markdownPath, "utf-8")
          : "";

        // Read metadata
        let metadata: any = { figures: [], question_figure_map: {} };
        if (fs.existsSync(metadataPath)) {
          metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
        }

        // List image files
        const figures: PythonConverterResult["figures"] = [];
        if (fs.existsSync(imagesDir)) {
          const imageFiles = fs.readdirSync(imagesDir);
          for (const file of imageFiles) {
            const pageMatch = file.match(/page(\d+)/);
            figures.push({
              page: pageMatch ? parseInt(pageMatch[1]) : 0,
              filename: file,
              path: `${imagesDir}/${file}`,
              type: file.includes("_full") ? "page_render" : "embedded_image"
            });
          }
        }

        // Parse figure-question links from metadata
        const figureQuestionLinks: PythonConverterResult["figureQuestionLinks"] = [];
        if (metadata.question_figure_map) {
          for (const [questionNum, figureNames] of Object.entries(metadata.question_figure_map)) {
            for (const figureName of figureNames as string[]) {
              const fig = figures.find(f => f.filename === figureName);
              figureQuestionLinks.push({
                figureId: figureName,
                questionNumber: questionNum,
                pageNumber: fig?.page || 0,
                confidence: 0.8 // Heuristic-based linking
              });
            }
          }
        }

        // Count embedded images only
        const embeddedFigures = figures.filter(f => f.type === "embedded_image");

        resolve({
          markdown,
          figures,
          totalPages: Math.max(...figures.map(f => f.page), 0),
          figuresExtracted: embeddedFigures.length,
          conversionMethod: "Tesseract OCR",
          figureQuestionLinks
        });
      } catch (error) {
        reject(new Error(`Failed to read conversion results: ${error}`));
      }
    });

    pythonProcess.on("error", (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

/**
 * Upload extracted images to S3
 */
async function uploadImagesToS3(
  conversionId: string,
  outputDir: string,
  figures: PythonConverterResult["figures"]
): Promise<ConversionResult["images"]> {
  const uploadedImages: ConversionResult["images"] = [];
  
  for (const figure of figures) {
    // Only upload embedded images, not full page renders
    if (figure.type !== "embedded_image") continue;
    
    try {
      const imagePath = figure.path;
      if (!fs.existsSync(imagePath)) continue;

      const imageBuffer = fs.readFileSync(imagePath);
      const ext = path.extname(figure.filename).toLowerCase();
      const contentType = ext === ".png" ? "image/png" : 
                         ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : 
                         "image/png";

      const s3Key = `conversions/${conversionId}/images/${figure.filename}`;
      const { url } = await storagePut(s3Key, imageBuffer, contentType);

      uploadedImages.push({
        name: figure.filename,
        url,
        pageNumber: figure.page
      });
    } catch (error) {
      console.error(`Failed to upload image ${figure.filename}:`, error);
    }
  }

  return uploadedImages;
}

/**
 * Enhanced figure-question linking with proximity analysis
 */
export function linkFiguresToQuestions(
  markdown: string,
  figures: Array<{ name: string; pageNumber: number }>
): Array<{
  figureId: string;
  questionNumber: string;
  pageNumber: number;
  confidence: number;
}> {
  const links: Array<{
    figureId: string;
    questionNumber: string;
    pageNumber: number;
    confidence: number;
  }> = [];

  // Keywords that indicate a question references a figure
  const figureKeywords = [
    'figure', 'graph', 'diagram', 'shown', 'below', 'above',
    'image', 'chart', 'table', 'illustration', 'picture',
    'as shown', 'in the figure', 'following figure', 'refer to',
    'based on', 'according to the', 'use the following'
  ];

  // Extract questions with their page context
  const pagePattern = /## Page (\d+)([\s\S]*?)(?=## Page \d+|$)/g;
  const questionPattern = /\*\*(\d+)\.\*\*\s*([\s\S]*?)(?=\*\*\d+\.\*\*|$)/g;

  let pageMatch;
  while ((pageMatch = pagePattern.exec(markdown)) !== null) {
    const pageNum = parseInt(pageMatch[1]);
    const pageContent = pageMatch[2];

    let questionMatch;
    while ((questionMatch = questionPattern.exec(pageContent)) !== null) {
      const questionNum = questionMatch[1];
      const questionText = questionMatch[2].toLowerCase();

      // Check if question references a figure
      const referencesFigure = figureKeywords.some(kw => questionText.includes(kw));

      if (referencesFigure) {
        // Find figures on the same page or adjacent pages
        const nearbyFigures = figures.filter(fig => 
          Math.abs(fig.pageNumber - pageNum) <= 1
        );

        for (const fig of nearbyFigures) {
          // Calculate confidence based on proximity
          const pageDistance = Math.abs(fig.pageNumber - pageNum);
          const confidence = pageDistance === 0 ? 0.95 : 0.75;

          links.push({
            figureId: fig.name,
            questionNumber: questionNum,
            pageNumber: fig.pageNumber,
            confidence
          });
        }
      }
    }
  }

  // Remove duplicates and keep highest confidence
  const uniqueLinks = new Map<string, typeof links[0]>();
  for (const link of links) {
    const key = `${link.figureId}-${link.questionNumber}`;
    const existing = uniqueLinks.get(key);
    if (!existing || existing.confidence < link.confidence) {
      uniqueLinks.set(key, link);
    }
  }

  return Array.from(uniqueLinks.values());
}
