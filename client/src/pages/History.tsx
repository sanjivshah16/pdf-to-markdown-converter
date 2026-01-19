/**
 * Conversion History Page
 * Displays past PDF conversions with download and view options
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  FileText, 
  Download, 
  Trash2, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Loader2,
  ArrowLeft,
  Image,
  Link2,
  Eye
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { format } from "date-fns";

interface Conversion {
  id: number;
  conversionId: string;
  filename: string;
  status: "pending" | "processing" | "completed" | "failed";
  totalPages: number | null;
  figuresExtracted: number | null;
  conversionMethod: string | null;
  fileSize: number | null;
  createdAt: Date;
  completedAt: Date | null;
  images: Array<{ name: string; url: string; pageNumber: number }> | null;
  figureQuestionLinks: Array<{ figureId: string; questionNumber: string; pageNumber: number; confidence: number }> | null;
  markdownContent: string | null;
}

export default function History() {
  const [selectedConversion, setSelectedConversion] = useState<string | null>(null);
  
  const { data: historyData, isLoading, refetch } = trpc.pdf.history.useQuery({
    limit: 50,
    offset: 0,
  });

  const deleteMutation = trpc.pdf.delete.useMutation({
    onSuccess: () => {
      toast.success("Conversion deleted");
      refetch();
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const handleDelete = (conversionId: string) => {
    if (confirm("Are you sure you want to delete this conversion?")) {
      deleteMutation.mutate({ conversionId });
    }
  };

  const handleDownload = (conversion: Conversion) => {
    if (!conversion.markdownContent) {
      toast.error("No markdown content available");
      return;
    }
    
    const blob = new Blob([conversion.markdownContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = conversion.filename.replace('.pdf', '.md');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Markdown downloaded!");
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-600" />;
      case "processing":
        return <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "processing":
        return "Processing";
      default:
        return "Pending";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="brutal-border border-t-0 border-x-0 bg-card">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="outline" size="sm" className="brutal-btn bg-card">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </Link>
              <div className="w-12 h-12 bg-primary brutal-border flex items-center justify-center">
                <Clock className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">CONVERSION HISTORY</h1>
                <p className="text-sm font-mono text-muted-foreground">
                  {historyData?.total || 0} CONVERSIONS
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !historyData?.conversions.length ? (
          <div className="brutal-card p-12 text-center">
            <div className="w-20 h-20 mx-auto bg-muted brutal-border flex items-center justify-center mb-4">
              <FileText className="w-10 h-10 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold mb-2">No Conversions Yet</h2>
            <p className="font-mono text-sm text-muted-foreground mb-6">
              Upload a PDF to get started
            </p>
            <Link href="/">
              <Button className="brutal-btn bg-primary text-primary-foreground">
                Convert a PDF
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {historyData.conversions.map((conversion) => (
              <div 
                key={conversion.conversionId}
                className="brutal-card p-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  {/* File Info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-12 h-12 bg-muted brutal-border flex items-center justify-center flex-shrink-0">
                      <FileText className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold truncate">{conversion.filename}</p>
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                        {getStatusIcon(conversion.status)}
                        <span>{getStatusText(conversion.status)}</span>
                        <span>•</span>
                        <span>{formatFileSize(conversion.fileSize)}</span>
                        <span>•</span>
                        <span>{format(new Date(conversion.createdAt), "MMM d, yyyy h:mm a")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  {conversion.status === "completed" && (
                    <div className="flex items-center gap-4 font-mono text-sm">
                      <div className="flex items-center gap-1 px-2 py-1 bg-muted brutal-border border-2">
                        <FileText className="w-3 h-3" />
                        <span>{conversion.totalPages || 0} pages</span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-1 bg-muted brutal-border border-2">
                        <Image className="w-3 h-3" />
                        <span>{conversion.figuresExtracted || 0} figures</span>
                      </div>
                      {conversion.figureQuestionLinks && conversion.figureQuestionLinks.length > 0 && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-primary/20 brutal-border border-2">
                          <Link2 className="w-3 h-3" />
                          <span>{conversion.figureQuestionLinks.length} links</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {conversion.status === "completed" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedConversion(
                            selectedConversion === conversion.conversionId 
                              ? null 
                              : conversion.conversionId
                          )}
                          className="brutal-btn bg-card"
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          {selectedConversion === conversion.conversionId ? "Hide" : "Preview"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(conversion as Conversion)}
                          className="brutal-btn bg-card"
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(conversion.conversionId)}
                      disabled={deleteMutation.isPending}
                      className="brutal-btn bg-card hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded Preview */}
                {selectedConversion === conversion.conversionId && conversion.markdownContent && (
                  <div className="mt-4 pt-4 border-t-4 border-[#1A1A1A]">
                    {/* Figure-Question Links */}
                    {conversion.figureQuestionLinks && conversion.figureQuestionLinks.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-bold text-sm mb-2 flex items-center gap-2">
                          <Link2 className="w-4 h-4" />
                          FIGURE-QUESTION LINKS
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {(conversion.figureQuestionLinks as Array<{ figureId: string; questionNumber: string; confidence: number }>).map((link, idx) => (
                            <div 
                              key={idx}
                              className="px-2 py-1 bg-primary/10 brutal-border border-2 font-mono text-xs"
                            >
                              Q{link.questionNumber} → {link.figureId}
                              <span className="ml-1 text-muted-foreground">
                                ({Math.round(link.confidence * 100)}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Markdown Preview */}
                    <div className="bg-muted brutal-border p-4 max-h-64 overflow-auto">
                      <pre className="font-mono text-sm whitespace-pre-wrap">
                        {conversion.markdownContent.slice(0, 2000)}
                        {conversion.markdownContent.length > 2000 && "..."}
                      </pre>
                    </div>

                    {/* Images Preview */}
                    {conversion.images && (conversion.images as Array<{ name: string; url: string }>).length > 0 && (
                      <div className="mt-4">
                        <h4 className="font-bold text-sm mb-2 flex items-center gap-2">
                          <Image className="w-4 h-4" />
                          EXTRACTED FIGURES ({(conversion.images as Array<{ name: string }>).length})
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {(conversion.images as Array<{ name: string; url: string }>).slice(0, 10).map((img, idx) => (
                            <div 
                              key={idx}
                              className="px-2 py-1 bg-muted brutal-border border-2 font-mono text-xs"
                            >
                              {img.name}
                            </div>
                          ))}
                          {(conversion.images as Array<{ name: string }>).length > 10 && (
                            <div className="px-2 py-1 bg-muted brutal-border border-2 font-mono text-xs text-muted-foreground">
                              +{(conversion.images as Array<{ name: string }>).length - 10} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
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
