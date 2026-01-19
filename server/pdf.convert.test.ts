import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the storage module
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://example.com/test.pdf", key: "test-key" }),
}));

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("pdf.convert", () => {
  it("converts a PDF and returns markdown with metadata", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    // Create a simple base64 encoded "PDF" (just for testing)
    const testPdfBase64 = Buffer.from("test pdf content").toString("base64");

    const result = await caller.pdf.convert({
      filename: "test-document.pdf",
      fileData: testPdfBase64,
    });

    // Verify the response structure
    expect(result).toHaveProperty("markdown");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("totalPages");
    expect(result).toHaveProperty("figuresExtracted");
    expect(result).toHaveProperty("conversionMethod");
    expect(result).toHaveProperty("conversionId");

    // Verify markdown contains the filename
    expect(result.markdown).toContain("test-document");

    // Verify metadata values
    expect(result.totalPages).toBe(12);
    expect(result.figuresExtracted).toBe(8);
    expect(result.conversionMethod).toBe("Tesseract OCR");

    // Verify images array structure
    expect(Array.isArray(result.images)).toBe(true);
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]).toHaveProperty("name");
    expect(result.images[0]).toHaveProperty("url");
  });

  it("generates unique conversion IDs for each request", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const testPdfBase64 = Buffer.from("test pdf content").toString("base64");

    const result1 = await caller.pdf.convert({
      filename: "doc1.pdf",
      fileData: testPdfBase64,
    });

    const result2 = await caller.pdf.convert({
      filename: "doc2.pdf",
      fileData: testPdfBase64,
    });

    // Each conversion should have a unique ID
    expect(result1.conversionId).not.toBe(result2.conversionId);
  });

  it("handles different filenames correctly", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const testPdfBase64 = Buffer.from("test pdf content").toString("base64");

    const result = await caller.pdf.convert({
      filename: "my-special-document.pdf",
      fileData: testPdfBase64,
    });

    // Markdown should reference the original filename
    expect(result.markdown).toContain("my-special-document");
  });
});
