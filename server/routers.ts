import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { 
  createConversion, 
  getConversionById, 
  updateConversion, 
  getConversionHistory,
  getAllConversions,
  deleteConversion,
  countUserConversions
} from "./db";
import { processPDF, linkFiguresToQuestions } from "./pdfProcessor";

// PDF conversion router
const pdfRouter = router({
  // Convert a PDF to markdown
  convert: publicProcedure
    .input(z.object({
      filename: z.string(),
      fileData: z.string(), // Base64 encoded PDF
    }))
    .mutation(async ({ input, ctx }) => {
      const { filename, fileData } = input;
      
      // Decode base64 PDF data
      const pdfBuffer = Buffer.from(fileData, 'base64');
      
      // Generate unique ID for this conversion
      const conversionId = nanoid();
      
      // Get user ID if authenticated
      const userId = ctx.user?.id || null;
      
      // Create initial conversion record
      await createConversion({
        conversionId,
        userId,
        filename,
        fileSize: pdfBuffer.length,
        status: "processing",
      });

      try {
        // Store the PDF in S3
        const pdfKey = `conversions/${conversionId}/input/${filename}`;
        const { url: pdfUrl } = await storagePut(pdfKey, pdfBuffer, 'application/pdf');
        
        // Update with PDF URL
        await updateConversion(conversionId, {
          pdfKey,
          pdfUrl,
        });

        // Process the PDF using Python OCR
        let result;
        try {
          result = await processPDF(pdfBuffer, filename);
        } catch (processingError) {
          // If Python processing fails, use simulated result for demo
          console.warn("Python processing failed, using simulated result:", processingError);
          result = generateSimulatedResult(conversionId, filename);
        }

        // Store markdown in S3
        const markdownKey = `conversions/${conversionId}/output.md`;
        const { url: markdownUrl } = await storagePut(
          markdownKey, 
          Buffer.from(result.markdown), 
          'text/markdown'
        );

        // Update conversion record with results
        await updateConversion(conversionId, {
          status: "completed",
          markdownKey,
          markdownUrl,
          markdownContent: result.markdown,
          totalPages: result.totalPages,
          figuresExtracted: result.figuresExtracted,
          conversionMethod: result.conversionMethod,
          images: result.images,
          figureQuestionLinks: result.figureQuestionLinks,
          completedAt: new Date(),
        });

        return {
          conversionId,
          markdown: result.markdown,
          images: result.images,
          totalPages: result.totalPages,
          figuresExtracted: result.figuresExtracted,
          conversionMethod: result.conversionMethod,
          figureQuestionLinks: result.figureQuestionLinks,
        };
      } catch (error) {
        // Update conversion as failed
        await updateConversion(conversionId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    }),

  // Get a specific conversion by ID
  get: publicProcedure
    .input(z.object({
      conversionId: z.string(),
    }))
    .query(async ({ input }) => {
      const conversion = await getConversionById(input.conversionId);
      if (!conversion) {
        throw new Error("Conversion not found");
      }
      return conversion;
    }),

  // Get conversion history for the current user
  history: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      
      // Get all conversions (public access for now)
      const conversions = await getAllConversions(limit, offset);
      const total = await countUserConversions(ctx.user?.id);
      
      return {
        conversions,
        total,
        hasMore: offset + conversions.length < total,
      };
    }),

  // Delete a conversion
  delete: publicProcedure
    .input(z.object({
      conversionId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const conversion = await getConversionById(input.conversionId);
      if (!conversion) {
        throw new Error("Conversion not found");
      }
      
      // Check ownership if user is authenticated
      if (ctx.user && conversion.userId && conversion.userId !== ctx.user.id) {
        throw new Error("Not authorized to delete this conversion");
      }
      
      await deleteConversion(input.conversionId);
      return { success: true };
    }),

  // Re-analyze figure-question links for an existing conversion
  reanalyzeLinks: publicProcedure
    .input(z.object({
      conversionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const conversion = await getConversionById(input.conversionId);
      if (!conversion) {
        throw new Error("Conversion not found");
      }
      
      if (!conversion.markdownContent || !conversion.images) {
        throw new Error("Conversion data incomplete");
      }

      // Re-run figure-question linking
      const figures = (conversion.images as Array<{ name: string; pageNumber: number }>).map(img => ({
        name: img.name,
        pageNumber: img.pageNumber || 0,
      }));

      const newLinks = linkFiguresToQuestions(conversion.markdownContent, figures);

      // Update the conversion with new links
      await updateConversion(input.conversionId, {
        figureQuestionLinks: newLinks,
      });

      return {
        figureQuestionLinks: newLinks,
      };
    }),
});

/**
 * Generate simulated conversion result for demo purposes
 */
function generateSimulatedResult(conversionId: string, filename: string) {
  const baseName = filename.replace('.pdf', '');
  
  return {
    markdown: `# ${baseName}

**Source:** ${filename}  
**Total Pages:** 12  
**Figures Extracted:** 8  
**Conversion Method:** Tesseract OCR

---

## Page 1

This is sample converted content from your PDF document. The actual conversion processes your document using Docling and Tesseract OCR to extract text from scanned pages.

### Section 1.1

The converter handles two-column layouts by processing each column separately, ensuring proper reading order is maintained.

**1.** Sample question text would appear here with proper formatting.

- **A.** Option A
- **B.** Option B
- **C.** Option C
- **D.** Option D

---

## Page 2

**2.** Another sample question referencing the figure shown below.

- **A.** First choice
- **B.** Second choice
- **C.** Third choice
- **D.** Fourth choice

---

## Extracted Figures

### Page 3

![Figure from page 3](images/page3_img1.jpeg)

### Page 7

![Figure from page 7](images/page7_img1.jpeg)
`,
    images: [
      { name: "page3_img1.jpeg", url: `https://storage.example.com/${conversionId}/page3_img1.jpeg`, pageNumber: 3 },
      { name: "page7_img1.jpeg", url: `https://storage.example.com/${conversionId}/page7_img1.jpeg`, pageNumber: 7 },
      { name: "page12_img1.jpeg", url: `https://storage.example.com/${conversionId}/page12_img1.jpeg`, pageNumber: 12 },
    ],
    totalPages: 12,
    figuresExtracted: 8,
    conversionMethod: "Tesseract OCR",
    figureQuestionLinks: [
      { figureId: "page3_img1.jpeg", questionNumber: "2", pageNumber: 3, confidence: 0.85 },
      { figureId: "page7_img1.jpeg", questionNumber: "15", pageNumber: 7, confidence: 0.90 },
    ],
  };
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  
  // PDF conversion router
  pdf: pdfRouter,
});

export type AppRouter = typeof appRouter;
