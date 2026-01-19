// Local JSON file-based database for PDF converter
// No external database required - stores everything in a local JSON file

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database types (simplified from drizzle schema)
export interface Conversion {
  id: number;
  conversionId: string;
  userId: number | null;
  filename: string;
  pdfKey: string | null;
  pdfUrl: string | null;
  markdownKey: string | null;
  markdownUrl: string | null;
  markdownContent: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  totalPages: number | null;
  figuresExtracted: number | null;
  conversionMethod: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  images: Array<{ name: string; url: string; pageNumber: number; linkedQuestion?: string }> | null;
  figureQuestionLinks: Array<{ figureId: string; questionNumber: string; pageNumber: number; confidence: number }> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export type InsertConversion = Partial<Conversion> & {
  conversionId: string;
  filename: string;
};

interface Database {
  conversions: Conversion[];
  nextId: number;
}

// Database file path
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "local-db.json");

function loadDb(): Database {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
      // Convert date strings back to Date objects
      data.conversions = data.conversions.map((c: any) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        completedAt: c.completedAt ? new Date(c.completedAt) : null,
      }));
      return data;
    }
  } catch (error) {
    console.warn("[Database] Failed to load database, creating new one:", error);
  }
  return { conversions: [], nextId: 1 };
}

function saveDb(db: Database): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// User functions (simplified - no actual user management needed for local use)
export async function upsertUser(): Promise<void> {
  // No-op for local use
}

export async function getUserByOpenId(): Promise<undefined> {
  return undefined;
}

// ============================================
// Conversion History Queries
// ============================================

export async function createConversion(conversion: InsertConversion): Promise<void> {
  const db = loadDb();

  const newConversion: Conversion = {
    id: db.nextId++,
    conversionId: conversion.conversionId,
    userId: conversion.userId ?? null,
    filename: conversion.filename,
    pdfKey: conversion.pdfKey ?? null,
    pdfUrl: conversion.pdfUrl ?? null,
    markdownKey: conversion.markdownKey ?? null,
    markdownUrl: conversion.markdownUrl ?? null,
    markdownContent: conversion.markdownContent ?? null,
    status: conversion.status ?? "pending",
    totalPages: conversion.totalPages ?? null,
    figuresExtracted: conversion.figuresExtracted ?? null,
    conversionMethod: conversion.conversionMethod ?? null,
    fileSize: conversion.fileSize ?? null,
    errorMessage: conversion.errorMessage ?? null,
    images: conversion.images ?? null,
    figureQuestionLinks: conversion.figureQuestionLinks ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: conversion.completedAt ?? null,
  };

  db.conversions.push(newConversion);
  saveDb(db);
}

export async function getConversionById(conversionId: string): Promise<Conversion | undefined> {
  const db = loadDb();
  return db.conversions.find(c => c.conversionId === conversionId);
}

export async function updateConversion(
  conversionId: string,
  updates: Partial<InsertConversion>
): Promise<void> {
  const db = loadDb();
  const index = db.conversions.findIndex(c => c.conversionId === conversionId);

  if (index !== -1) {
    db.conversions[index] = {
      ...db.conversions[index],
      ...updates,
      updatedAt: new Date(),
    } as Conversion;
    saveDb(db);
  }
}

export async function getConversionHistory(
  userId?: number,
  limit: number = 20,
  offset: number = 0
): Promise<Conversion[]> {
  const db = loadDb();

  // Sort by createdAt descending
  const sorted = [...db.conversions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  return sorted.slice(offset, offset + limit);
}

export async function getAllConversions(
  limit: number = 50,
  offset: number = 0
): Promise<Conversion[]> {
  const db = loadDb();

  // Sort by createdAt descending
  const sorted = [...db.conversions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  return sorted.slice(offset, offset + limit);
}

export async function deleteConversion(conversionId: string): Promise<void> {
  const db = loadDb();
  db.conversions = db.conversions.filter(c => c.conversionId !== conversionId);
  saveDb(db);
}

export async function countUserConversions(userId?: number): Promise<number> {
  const db = loadDb();
  return db.conversions.length;
}
