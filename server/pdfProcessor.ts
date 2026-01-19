/**
 * PDF Processor - Node.js wrapper for Python OCR conversion
 * Executes the Python script and handles file management
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";

// ES module compatibility - get __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Timeout for Python processing (10 minutes for large PDFs)
const PYTHON_TIMEOUT_MS = 600000;

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
    // Find the script path - try multiple locations
    const possiblePaths = [
      path.resolve(__dirname, "pdf_converter.py"),
      path.resolve(process.cwd(), "server", "pdf_converter.py"),
      "/home/ubuntu/pdf-to-markdown-converter/server/pdf_converter.py",
    ];
    
    let actualScriptPath: string | null = null;
    for (const scriptPath of possiblePaths) {
      if (fs.existsSync(scriptPath)) {
        actualScriptPath = scriptPath;
        break;
      }
    }
    
    if (!actualScriptPath) {
      reject(new Error(`PDF converter script not found. Tried: ${possiblePaths.join(", ")}`));
      return;
    }

    console.log(`[PDF Processor] Using script: ${actualScriptPath}`);
    console.log(`[PDF Processor] Input PDF: ${pdfPath}`);
    console.log(`[PDF Processor] Output dir: ${outputDir}`);

    const pythonProcess = spawn("python3", [
      actualScriptPath,
      pdfPath,
      "-o", outputDir,
      "-m", "docling"
    ], {
      env: {
        ...process.env,
        // Fix OpenMP library conflict on macOS
        KMP_DUPLICATE_LIB_OK: "TRUE",
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = "";
    let stderr = "";
    let totalPages = 0;
    let currentPage = 0;

    // Set timeout
    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGTERM');
      reject(new Error(`Python converter timed out after ${PYTHON_TIMEOUT_MS / 1000} seconds`));
    }, PYTHON_TIMEOUT_MS);

    pythonProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[Python stdout] ${output.trim()}`);
      
      // Parse progress from output
      const pageMatch = output.match(/Processing page (\d+)\/(\d+)/);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1]);
        totalPages = parseInt(pageMatch[2]);
        const progress = Math.round(20 + (currentPage / totalPages) * 50);
        onProgress?.({
          stage: "ocr",
          progress,
          message: `Processing page ${currentPage} of ${totalPages}...`
        });
      }
      
      // Check for figure extraction
      const figureMatch = output.match(/Extracted (\d+) embedded figures/);
      if (figureMatch) {
        onProgress?.({
          stage: "figures",
          progress: 15,
          message: `Extracted ${figureMatch[1]} figures...`
        });
      }
    });

    pythonProcess.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[Python stderr] ${output.trim()}`);
    });

    pythonProcess.on("close", (code) => {
      clearTimeout(timeout);
      
      if (code !== 0) {
        console.error(`[PDF Processor] Python exited with code ${code}`);
        console.error(`[PDF Processor] stderr: ${stderr}`);
        reject(new Error(`Python converter failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Read the generated files
        const baseName = path.basename(pdfPath, ".pdf");
        const markdownPath = `${outputDir}/${baseName}.md`;
        const metadataPath = `${outputDir}/${baseName}_metadata.json`;
        const imagesDir = `${outputDir}/images`;

        console.log(`[PDF Processor] Looking for markdown at: ${markdownPath}`);
        console.log(`[PDF Processor] Looking for metadata at: ${metadataPath}`);

        // Read markdown content
        let markdown = "";
        if (fs.existsSync(markdownPath)) {
          markdown = fs.readFileSync(markdownPath, "utf-8");
          console.log(`[PDF Processor] Markdown file size: ${markdown.length} chars`);
        } else {
          console.error(`[PDF Processor] Markdown file not found at ${markdownPath}`);
          // List directory contents for debugging
          if (fs.existsSync(outputDir)) {
            const files = fs.readdirSync(outputDir);
            console.log(`[PDF Processor] Output directory contents: ${files.join(", ")}`);
          }
        }

        // Read metadata
        let metadata: any = { figures: [], question_figure_map: {}, total_pages: 0 };
        if (fs.existsSync(metadataPath)) {
          metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
          console.log(`[PDF Processor] Metadata loaded: ${metadata.figures?.length || 0} figures`);
        }

        // List image files
        const figures: PythonConverterResult["figures"] = [];
        if (fs.existsSync(imagesDir)) {
          const imageFiles = fs.readdirSync(imagesDir);
          console.log(`[PDF Processor] Found ${imageFiles.length} image files`);
          
          for (const file of imageFiles) {
            // Match both figure_X_Y.png (Docling detected) and pageX_imgY.ext (PyMuPDF embedded)
            const doclingMatch = file.match(/figure_(\d+)_(\d+)/);
            const pymupdfMatch = file.match(/page(\d+)_img(\d+)/);

            let pageNum = 0;
            let figureType = "embedded_image";

            if (doclingMatch) {
              pageNum = parseInt(doclingMatch[1]);
              figureType = "detected_figure";
            } else if (pymupdfMatch) {
              pageNum = parseInt(pymupdfMatch[1]);
              figureType = "embedded_image";
            }

            figures.push({
              page: pageNum,
              filename: file,
              path: `${imagesDir}/${file}`,
              type: file.includes("_full") ? "page_render" : figureType
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

        // Count detected and embedded figures (not full page renders)
        const embeddedFigures = figures.filter(f => f.type === "embedded_image" || f.type === "detected_figure");

        resolve({
          markdown,
          figures,
          totalPages: metadata.total_pages || totalPages || Math.max(...figures.map(f => f.page), 0),
          figuresExtracted: embeddedFigures.length,
          conversionMethod: "PyMuPDF + Tesseract OCR",
          figureQuestionLinks
        });
      } catch (error) {
        reject(new Error(`Failed to read conversion results: ${error}`));
      }
    });

    pythonProcess.on("error", (error) => {
      clearTimeout(timeout);
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
    // Only upload detected figures and embedded images, not full page renders
    if (figure.type !== "embedded_image" && figure.type !== "detected_figure") continue;
    
    try {
      const imagePath = figure.path;
      if (!fs.existsSync(imagePath)) continue;

      const imageBuffer = fs.readFileSync(imagePath);
      const ext = path.extname(figure.filename).toLowerCase();
      const contentType = ext === ".png" ? "image/png" : "image/jpeg";
      
      const imageKey = `conversions/${conversionId}/images/${figure.filename}`;
      const { url } = await storagePut(imageKey, imageBuffer, contentType);
      
      uploadedImages.push({
        name: figure.filename,
        url,
        pageNumber: figure.page
      });
    } catch (error) {
      console.error(`[PDF Processor] Failed to upload image ${figure.filename}:`, error);
    }
  }
  
  return uploadedImages;
}

/**
 * Link figures to questions based on proximity and content analysis
 * This is a heuristic-based approach that can be improved with ML
 */
export function linkFiguresToQuestions(
  markdown: string,
  images: ConversionResult["images"]
): ConversionResult["figureQuestionLinks"] {
  const links: ConversionResult["figureQuestionLinks"] = [];
  
  // Find all question numbers in the markdown
  const questionPattern = /\*\*(\d+)\.\*\*/g;
  const questions: Array<{ number: string; position: number }> = [];
  
  let match;
  while ((match = questionPattern.exec(markdown)) !== null) {
    questions.push({
      number: match[1],
      position: match.index
    });
  }
  
  // For each image, find the nearest question
  for (const image of images) {
    // Find image reference in markdown
    const imagePattern = new RegExp(`!\\[.*?\\]\\(.*?${image.name}.*?\\)`, 'g');
    const imageMatch = imagePattern.exec(markdown);
    
    if (imageMatch) {
      const imagePosition = imageMatch.index;
      
      // Find the closest question before this image
      let closestQuestion: { number: string; distance: number } | null = null;
      
      for (const q of questions) {
        if (q.position < imagePosition) {
          const distance = imagePosition - q.position;
          if (!closestQuestion || distance < closestQuestion.distance) {
            closestQuestion = { number: q.number, distance };
          }
        }
      }
      
      if (closestQuestion && closestQuestion.distance < 5000) {
        // Calculate confidence based on distance
        const confidence = Math.max(0.5, 1 - (closestQuestion.distance / 5000));
        
        links.push({
          figureId: image.name,
          questionNumber: closestQuestion.number,
          pageNumber: image.pageNumber,
          confidence: Math.round(confidence * 100) / 100
        });
      }
    }
  }
  
  return links;
}
