import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, bigint } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Conversions table to store PDF conversion history
 */
export const conversions = mysqlTable("conversions", {
  id: int("id").autoincrement().primaryKey(),
  /** Unique conversion identifier */
  conversionId: varchar("conversionId", { length: 32 }).notNull().unique(),
  /** User who initiated the conversion (nullable for anonymous users) */
  userId: int("userId"),
  /** Original PDF filename */
  filename: varchar("filename", { length: 512 }).notNull(),
  /** S3 key for the uploaded PDF */
  pdfKey: varchar("pdfKey", { length: 1024 }),
  /** S3 URL for the uploaded PDF */
  pdfUrl: text("pdfUrl"),
  /** S3 key for the generated markdown */
  markdownKey: varchar("markdownKey", { length: 1024 }),
  /** S3 URL for the generated markdown */
  markdownUrl: text("markdownUrl"),
  /** Full markdown content */
  markdownContent: text("markdownContent"),
  /** Conversion status */
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  /** Total pages in the PDF */
  totalPages: int("totalPages"),
  /** Number of figures extracted */
  figuresExtracted: int("figuresExtracted"),
  /** Conversion method used */
  conversionMethod: varchar("conversionMethod", { length: 64 }),
  /** File size in bytes */
  fileSize: bigint("fileSize", { mode: "number" }),
  /** Error message if conversion failed */
  errorMessage: text("errorMessage"),
  /** Extracted images metadata as JSON */
  images: json("images").$type<Array<{ name: string; url: string; pageNumber: number; linkedQuestion?: string }>>(),
  /** Figure-question mappings as JSON */
  figureQuestionLinks: json("figureQuestionLinks").$type<Array<{ figureId: string; questionNumber: string; pageNumber: number; confidence: number }>>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type Conversion = typeof conversions.$inferSelect;
export type InsertConversion = typeof conversions.$inferInsert;
