/**
 * Neo-Brutalist Document Lab - PDF to Markdown Converter
 * Design: Bold geometric shapes, 4px borders, Bubblegum Pink accents
 * Typography: Space Grotesk (headlines), IBM Plex Mono (technical)
 */

import { useState, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { FileUp, FileText, Image, Download, Trash2, CheckCircle, AlertCircle, Loader2, Clock, Link2, Eye, Code, Archive, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Streamdown } from "streamdown";
import JSZip from "jszip";

interface ConversionResult {
  conversionId: string;
  markdown: string;
  images: { name: string; url: string; pageNumber: number }[];
  totalPages: number;
  figuresExtracted: number;
  conversionMethod: string;
  figureQuestionLinks: { figureId: string; questionNumber: string; pageNumber: number; confidence: number }[];
}

interface ProcessingStatus {
  stage: string;
  progress: number;
  message: string;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [previewMode, setPreviewMode] = useState<"rendered" | "raw">("rendered");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // tRPC mutation for PDF conversion
  const convertMutation = trpc.pdf.convert.useMutation({
    onSuccess: (data) => {
      setResult({
        conversionId: data.conversionId,
        markdown: data.markdown,
        images: data.images,
        totalPages: data.totalPages,
        figuresExtracted: data.figuresExtracted,
        conversionMethod: data.conversionMethod,
        figureQuestionLinks: data.figureQuestionLinks,
      });
      setIsProcessing(false);
      setStatus({ stage: "complete", progress: 100, message: "Conversion complete!" });

      // Show conversion method in toast
      const isDocling = data.conversionMethod.toLowerCase().includes("docling");
      toast.success(
        `PDF converted successfully using ${isDocling ? "Docling" : "PyMuPDF + Tesseract"}!`,
        {
          icon: isDocling ? <Sparkles className="w-4 h-4" /> : undefined,
          description: `${data.totalPages} pages, ${data.figuresExtracted} figures extracted`,
        }
      );
    },
    onError: (error) => {
      setIsProcessing(false);
      setStatus(null);
      toast.error(`Conversion failed: ${error.message}`);
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === "application/pdf") {
      setFile(droppedFile);
      setResult(null);
      toast.success("PDF file loaded successfully!");
    } else {
      toast.error("Please upload a PDF file");
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setResult(null);
      toast.success("PDF file loaded successfully!");
    } else {
      toast.error("Please upload a PDF file");
    }
  }, []);

  const handleConvert = async () => {
    if (!file) return;

    setIsProcessing(true);
    setResult(null);

    // Show progress stages
    const stages = [
      { stage: "upload", progress: 10, message: "Uploading PDF..." },
      { stage: "extract", progress: 25, message: "Extracting pages..." },
      { stage: "ocr", progress: 50, message: "Converting with Docling..." },
      { stage: "figures", progress: 70, message: "Extracting figures..." },
      { stage: "format", progress: 85, message: "Formatting markdown..." },
    ];

    // Animate through stages
    for (const stage of stages) {
      setStatus(stage);
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    // Convert file to base64 and send to backend
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      convertMutation.mutate({
        filename: file.name,
        fileData: base64,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadMarkdown = () => {
    if (!result) return;

    const blob = new Blob([result.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file?.name.replace('.pdf', '.md') || "converted.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Markdown file downloaded!");
  };

  const handleDownloadZip = async () => {
    if (!result) return;

    const zip = new JSZip();
    const baseName = file?.name.replace('.pdf', '') || "converted";

    // Add markdown file
    zip.file(`${baseName}.md`, result.markdown);

    // Create images folder and fetch images
    const imagesFolder = zip.folder("images");

    toast.info("Preparing ZIP file...", { duration: 2000 });

    // Fetch and add all images
    for (const img of result.images) {
      try {
        const response = await fetch(img.url);
        const blob = await response.blob();
        imagesFolder?.file(img.name, blob);
      } catch (error) {
        console.error(`Failed to fetch image ${img.name}:`, error);
      }
    }

    // Generate and download ZIP
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("ZIP file downloaded with markdown + images!");
  };

  // Process markdown to replace image paths with actual URLs for preview
  const processedMarkdown = useMemo(() => {
    if (!result) return "";

    let md = result.markdown;

    // Replace image references like ![...](images/filename.png) with actual URLs
    for (const img of result.images) {
      // Match various image markdown patterns
      const patterns = [
        new RegExp(`!\\[([^\\]]*)\\]\\(images/${img.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
        new RegExp(`!\\[([^\\]]*)\\]\\(\\./images/${img.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'),
      ];

      for (const pattern of patterns) {
        md = md.replace(pattern, `![$1](${img.url})`);
      }
    }

    // Also insert images at page breaks if they're not already in the text
    // This helps show images inline with the content
    const imagesByPage: Record<number, typeof result.images> = {};
    for (const img of result.images) {
      if (!imagesByPage[img.pageNumber]) {
        imagesByPage[img.pageNumber] = [];
      }
      imagesByPage[img.pageNumber].push(img);
    }

    // Check if images are referenced in markdown, if not, add them at end of their page section
    for (const img of result.images) {
      if (!md.includes(img.url)) {
        // Find the page section and append image after it
        const pagePattern = new RegExp(`(## Page ${img.pageNumber}[\\s\\S]*?)(?=## Page \\d+|---\\s*\\n\\s*## Extracted Figures|$)`);
        const match = md.match(pagePattern);
        if (match) {
          const pageContent = match[1];
          const insertPoint = match.index! + pageContent.length;
          const imageMarkdown = `\n\n![Figure from page ${img.pageNumber}](${img.url})\n`;
          md = md.slice(0, insertPoint) + imageMarkdown + md.slice(insertPoint);
        }
      }
    }

    return md;
  }, [result]);

  const handleClear = () => {
    setFile(null);
    setResult(null);
    setStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="brutal-border border-t-0 border-x-0 bg-card">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary brutal-border flex items-center justify-center">
                <FileText className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">PDF → MARKDOWN</h1>
                <p className="text-sm font-mono text-muted-foreground">DOCUMENT LAB v1.0</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/history">
                <Button variant="outline" className="brutal-btn bg-card">
                  <Clock className="w-4 h-4 mr-2" />
                  History
                </Button>
              </Link>
              <div className="hidden sm:flex items-center gap-2 font-mono text-sm">
                <span className="px-3 py-1 bg-primary text-primary-foreground brutal-border text-xs font-semibold">
                  DOCLING + TESSERACT
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8 flex-1">
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Upload Zone - 3 columns */}
          <div className="lg:col-span-3">
            <div className="brutal-card p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-8 h-8 bg-[#1A1A1A] text-[#F5F5F0] flex items-center justify-center text-sm font-mono">01</span>
                UPLOAD PDF
              </h2>
              
              <div
                className={`upload-zone p-8 lg:p-12 text-center cursor-pointer ${isDragging ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                {file ? (
                  <div className="space-y-4">
                    <div className="w-20 h-20 mx-auto bg-primary brutal-border flex items-center justify-center">
                      <FileText className="w-10 h-10 text-primary-foreground" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">{file.name}</p>
                      <p className="font-mono text-sm text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClear();
                      }}
                      className="brutal-btn bg-card"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="w-20 h-20 mx-auto bg-muted brutal-border flex items-center justify-center">
                      <FileUp className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">DROP PDF HERE</p>
                      <p className="font-mono text-sm text-muted-foreground">
                        or click to browse
                      </p>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">
                      Supports scanned PDFs with two-column layouts
                    </p>
                  </div>
                )}
              </div>

              {/* Convert Button */}
              <div className="mt-6">
                <Button
                  onClick={handleConvert}
                  disabled={!file || isProcessing}
                  className="w-full brutal-btn bg-primary text-primary-foreground hover:bg-[#E05A6D] py-6 text-lg font-bold"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      PROCESSING...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5 mr-2" />
                      CONVERT TO MARKDOWN
                    </>
                  )}
                </Button>
              </div>

              {/* Progress */}
              {status && isProcessing && (
                <div className="mt-6 space-y-2">
                  <div className="flex justify-between items-center font-mono text-sm">
                    <span>{status.message}</span>
                    <span className="font-bold">{status.progress}%</span>
                  </div>
                  <div className="progress-brutal">
                    <div 
                      className="progress-brutal-fill"
                      style={{ width: `${status.progress}%` }}
                    />
                    <span className="progress-brutal-text">{status.progress}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Status & Results - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Status Card */}
            <div className="brutal-card p-6">
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <span className="w-8 h-8 bg-[#1A1A1A] text-[#F5F5F0] flex items-center justify-center text-sm font-mono">02</span>
                STATUS
              </h2>
              
              <div className="space-y-3">
                <StatusItem 
                  label="File" 
                  value={file ? file.name : "No file selected"} 
                  active={!!file}
                />
                <StatusItem 
                  label="Size" 
                  value={file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "—"} 
                  active={!!file}
                />
                <StatusItem 
                  label="Status" 
                  value={isProcessing ? status?.stage || "Processing" : result ? "Complete" : "Ready"} 
                  active={isProcessing || !!result}
                  success={!!result}
                />
                {result && (
                  <>
                    <StatusItem
                      label="Method"
                      value={result.conversionMethod.includes("Docling") ? "Docling" : "PyMuPDF"}
                      active
                      success={result.conversionMethod.includes("Docling")}
                    />
                    <StatusItem
                      label="Pages"
                      value={result.totalPages.toString()}
                      active
                    />
                    <StatusItem
                      label="Figures"
                      value={result.figuresExtracted.toString()}
                      active
                    />
                    <StatusItem
                      label="Links"
                      value={result.figureQuestionLinks.length.toString()}
                      active
                    />
                  </>
                )}
              </div>
            </div>

            {/* Results Card */}
            {result && (
              <div className="brutal-card p-6">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center text-sm font-mono">
                    <CheckCircle className="w-5 h-5" />
                  </span>
                  RESULTS
                </h2>

                <div className="space-y-4">
                  {/* Conversion Method Badge */}
                  <div className="flex items-center justify-center">
                    <span className={`px-3 py-2 brutal-border text-sm font-mono font-semibold flex items-center gap-2 ${
                      result.conversionMethod.toLowerCase().includes("docling")
                        ? "bg-green-100 text-green-800 border-green-600"
                        : "bg-blue-100 text-blue-800 border-blue-600"
                    }`}>
                      {result.conversionMethod.toLowerCase().includes("docling") && (
                        <Sparkles className="w-4 h-4" />
                      )}
                      {result.conversionMethod}
                    </span>
                  </div>

                  {/* Download Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={handleDownloadMarkdown}
                      className="brutal-btn bg-primary text-primary-foreground hover:bg-[#E05A6D]"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      .MD
                    </Button>
                    <Button
                      onClick={handleDownloadZip}
                      className="brutal-btn bg-[#1A1A1A] text-[#F5F5F0] hover:bg-[#333]"
                    >
                      <Archive className="w-4 h-4 mr-1" />
                      .ZIP
                    </Button>
                  </div>

                  {/* Figure-Question Links */}
                  {result.figureQuestionLinks.length > 0 && (
                    <div>
                      <p className="font-mono text-sm text-muted-foreground mb-2 flex items-center gap-1">
                        <Link2 className="w-3 h-3" />
                        FIGURE-QUESTION LINKS ({result.figureQuestionLinks.length})
                      </p>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {result.figureQuestionLinks.map((link, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between p-2 bg-primary/10 brutal-border border-2 font-mono text-xs"
                          >
                            <span>Q{link.questionNumber} → {link.figureId}</span>
                            <span className="text-muted-foreground">
                              {Math.round(link.confidence * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Extracted Images */}
                  {result.images.length > 0 && (
                    <div>
                      <p className="font-mono text-sm text-muted-foreground mb-2 flex items-center gap-1">
                        <Image className="w-3 h-3" />
                        EXTRACTED FIGURES ({result.images.length})
                      </p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {result.images.map((img, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center gap-2 p-2 bg-muted brutal-border border-2"
                          >
                            <Image className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-mono text-sm truncate">{img.name}</span>
                            <span className="font-mono text-xs text-muted-foreground ml-auto">p.{img.pageNumber}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Info Card */}
            <div className="brutal-card p-6 bg-muted">
              <h3 className="font-bold mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                HOW IT WORKS
              </h3>
              <ul className="space-y-2 font-mono text-sm text-muted-foreground">
                <li>• Tesseract OCR extracts text from scanned pages</li>
                <li>• Two-column layouts are processed separately</li>
                <li>• Figures are extracted and linked to questions</li>
                <li>• Output includes markdown + image files</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Preview Section */}
        {result && (
          <div className="mt-8">
            <div className="brutal-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <span className="w-8 h-8 bg-[#1A1A1A] text-[#F5F5F0] flex items-center justify-center text-sm font-mono">03</span>
                  PREVIEW
                </h2>
                <div className="flex items-center gap-2">
                  <Button
                    variant={previewMode === "rendered" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPreviewMode("rendered")}
                    className={`brutal-btn ${previewMode === "rendered" ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    Rendered
                  </Button>
                  <Button
                    variant={previewMode === "raw" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPreviewMode("raw")}
                    className={`brutal-btn ${previewMode === "raw" ? "bg-primary text-primary-foreground" : "bg-card"}`}
                  >
                    <Code className="w-4 h-4 mr-1" />
                    Raw
                  </Button>
                </div>
              </div>
              
              <div className="bg-muted brutal-border p-4 max-h-[600px] overflow-auto">
                {previewMode === "rendered" ? (
                  <div className="prose prose-sm max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:my-2 prose-li:my-0 prose-img:my-4 prose-img:rounded-lg prose-img:border-2 prose-img:border-gray-300">
                    <Streamdown>{processedMarkdown}</Streamdown>
                  </div>
                ) : (
                  <pre className="font-mono text-sm whitespace-pre-wrap">{result.markdown}</pre>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="brutal-border border-b-0 border-x-0 bg-card mt-auto">
        <div className="container py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 font-mono text-sm text-muted-foreground">
            <p>PDF TO MARKDOWN CONVERTER</p>
            <p>POWERED BY DOCLING + TESSERACT OCR</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatusItem({ 
  label, 
  value, 
  active = false,
  success = false 
}: { 
  label: string; 
  value: string; 
  active?: boolean;
  success?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-2 bg-muted brutal-border border-2">
      <span className="font-mono text-sm text-muted-foreground uppercase">{label}</span>
      <span className={`font-mono text-sm font-semibold truncate ml-2 ${
        success ? 'text-green-600' : active ? 'text-foreground' : 'text-muted-foreground'
      }`}>
        {value}
      </span>
    </div>
  );
}
