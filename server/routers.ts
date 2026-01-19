import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

// PDF conversion router
const pdfRouter = router({
  convert: publicProcedure
    .input(z.object({
      filename: z.string(),
      fileData: z.string(), // Base64 encoded PDF
    }))
    .mutation(async ({ input }) => {
      const { filename, fileData } = input;
      
      // Decode base64 PDF data
      const pdfBuffer = Buffer.from(fileData, 'base64');
      
      // Generate unique ID for this conversion
      const conversionId = nanoid();
      
      // Store the PDF in S3
      const pdfKey = `pdfs/${conversionId}/${filename}`;
      await storagePut(pdfKey, pdfBuffer, 'application/pdf');
      
      // For now, return a simulated conversion result
      // In production, this would call the actual Python conversion script
      const simulatedResult = {
        markdown: `# ${filename.replace('.pdf', '')}\n\n**Source:** ${filename}  \n**Total Pages:** 12  \n**Figures Extracted:** 8  \n**Conversion Method:** Tesseract OCR\n\n---\n\n## Page 1\n\nThis is sample converted content from your PDF document. The actual conversion processes your document using Docling and Tesseract OCR to extract text from scanned pages.\n\n### Section 1.1\n\nThe converter handles two-column layouts by processing each column separately, ensuring proper reading order is maintained.\n\n**1.** Sample question text would appear here with proper formatting.\n\n- **A.** Option A\n- **B.** Option B\n- **C.** Option C\n- **D.** Option D\n\n---\n\n## Extracted Figures\n\n### Page 3\n\n![Figure from page 3](images/page3_img1.jpeg)\n\n### Page 7\n\n![Figure from page 7](images/page7_img1.jpeg)\n`,
        images: [
          { name: "page3_img1.jpeg", url: `https://storage.example.com/${conversionId}/page3_img1.jpeg` },
          { name: "page7_img1.jpeg", url: `https://storage.example.com/${conversionId}/page7_img1.jpeg` },
          { name: "page12_img1.jpeg", url: `https://storage.example.com/${conversionId}/page12_img1.jpeg` },
        ],
        totalPages: 12,
        figuresExtracted: 8,
        conversionMethod: "Tesseract OCR",
        conversionId,
      };
      
      return simulatedResult;
    }),
});

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
