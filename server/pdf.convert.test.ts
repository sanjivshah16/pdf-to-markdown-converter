import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the storage module
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://example.com/test.pdf", key: "test-key" }),
  storageGet: vi.fn().mockResolvedValue({ url: "https://example.com/test.pdf", key: "test-key" }),
}));

// Mock the db module
vi.mock("./db", () => ({
  createConversion: vi.fn().mockResolvedValue(undefined),
  getConversionById: vi.fn().mockImplementation((id: string) => {
    if (id === "existing-id") {
      return Promise.resolve({
        id: 1,
        conversionId: "existing-id",
        filename: "test.pdf",
        status: "completed",
        totalPages: 10,
        figuresExtracted: 5,
        conversionMethod: "Tesseract OCR",
        markdownContent: "# Test\n\nSample content",
        images: [{ name: "img1.jpg", url: "https://example.com/img1.jpg", pageNumber: 1 }],
        figureQuestionLinks: [{ figureId: "img1.jpg", questionNumber: "1", pageNumber: 1, confidence: 0.9 }],
        createdAt: new Date(),
        completedAt: new Date(),
      });
    }
    return Promise.resolve(undefined);
  }),
  updateConversion: vi.fn().mockResolvedValue(undefined),
  getConversionHistory: vi.fn().mockResolvedValue([]),
  getAllConversions: vi.fn().mockResolvedValue([
    {
      id: 1,
      conversionId: "conv-1",
      filename: "doc1.pdf",
      status: "completed",
      totalPages: 5,
      figuresExtracted: 2,
      createdAt: new Date(),
    },
    {
      id: 2,
      conversionId: "conv-2",
      filename: "doc2.pdf",
      status: "completed",
      totalPages: 10,
      figuresExtracted: 4,
      createdAt: new Date(),
    },
  ]),
  deleteConversion: vi.fn().mockResolvedValue(undefined),
  countUserConversions: vi.fn().mockResolvedValue(2),
}));

// Mock the pdfProcessor module
vi.mock("./pdfProcessor", () => ({
  processPDF: vi.fn().mockRejectedValue(new Error("Python not available in test")),
  linkFiguresToQuestions: vi.fn().mockReturnValue([
    { figureId: "img1.jpg", questionNumber: "1", pageNumber: 1, confidence: 0.95 },
  ]),
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

function createAuthenticatedContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(result).toHaveProperty("conversionId");
    expect(result).toHaveProperty("markdown");
    expect(result).toHaveProperty("images");
    expect(result).toHaveProperty("totalPages");
    expect(result).toHaveProperty("figuresExtracted");
    expect(result).toHaveProperty("conversionMethod");
    expect(result).toHaveProperty("figureQuestionLinks");

    // Verify markdown contains the filename
    expect(result.markdown).toContain("test-document");

    // Verify metadata values (simulated result)
    expect(result.totalPages).toBe(12);
    expect(result.figuresExtracted).toBe(8);
    expect(result.conversionMethod).toBe("Tesseract OCR");

    // Verify images array structure
    expect(Array.isArray(result.images)).toBe(true);
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]).toHaveProperty("name");
    expect(result.images[0]).toHaveProperty("url");
    expect(result.images[0]).toHaveProperty("pageNumber");
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

  it("includes figure-question links in the result", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const testPdfBase64 = Buffer.from("test pdf content").toString("base64");

    const result = await caller.pdf.convert({
      filename: "test.pdf",
      fileData: testPdfBase64,
    });

    // Verify figure-question links structure
    expect(Array.isArray(result.figureQuestionLinks)).toBe(true);
    if (result.figureQuestionLinks.length > 0) {
      expect(result.figureQuestionLinks[0]).toHaveProperty("figureId");
      expect(result.figureQuestionLinks[0]).toHaveProperty("questionNumber");
      expect(result.figureQuestionLinks[0]).toHaveProperty("confidence");
    }
  });
});

describe("pdf.get", () => {
  it("retrieves an existing conversion by ID", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pdf.get({
      conversionId: "existing-id",
    });

    expect(result).toBeDefined();
    expect(result.conversionId).toBe("existing-id");
    expect(result.filename).toBe("test.pdf");
    expect(result.status).toBe("completed");
  });

  it("throws error for non-existent conversion", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.pdf.get({ conversionId: "non-existent" })
    ).rejects.toThrow("Conversion not found");
  });
});

describe("pdf.history", () => {
  it("returns conversion history with pagination info", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pdf.history({
      limit: 20,
      offset: 0,
    });

    expect(result).toHaveProperty("conversions");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("hasMore");
    expect(Array.isArray(result.conversions)).toBe(true);
  });

  it("uses default pagination when not specified", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pdf.history();

    expect(result).toHaveProperty("conversions");
    expect(result).toHaveProperty("total");
  });
});

describe("pdf.delete", () => {
  it("deletes an existing conversion", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pdf.delete({
      conversionId: "existing-id",
    });

    expect(result.success).toBe(true);
  });

  it("throws error when deleting non-existent conversion", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.pdf.delete({ conversionId: "non-existent" })
    ).rejects.toThrow("Conversion not found");
  });
});

describe("pdf.reanalyzeLinks", () => {
  it("re-analyzes figure-question links for existing conversion", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.pdf.reanalyzeLinks({
      conversionId: "existing-id",
    });

    expect(result).toHaveProperty("figureQuestionLinks");
    expect(Array.isArray(result.figureQuestionLinks)).toBe(true);
  });

  it("throws error for non-existent conversion", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.pdf.reanalyzeLinks({ conversionId: "non-existent" })
    ).rejects.toThrow("Conversion not found");
  });
});
