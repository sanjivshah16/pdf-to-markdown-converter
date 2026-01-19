import { eq, desc, and, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, conversions, InsertConversion, Conversion } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============================================
// Conversion History Queries
// ============================================

/**
 * Create a new conversion record
 */
export async function createConversion(conversion: InsertConversion): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot create conversion: database not available");
    return;
  }

  await db.insert(conversions).values(conversion);
}

/**
 * Get a conversion by its unique conversionId
 */
export async function getConversionById(conversionId: string): Promise<Conversion | undefined> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get conversion: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(conversions)
    .where(eq(conversions.conversionId, conversionId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Update a conversion record
 */
export async function updateConversion(
  conversionId: string,
  updates: Partial<InsertConversion>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update conversion: database not available");
    return;
  }

  await db
    .update(conversions)
    .set(updates)
    .where(eq(conversions.conversionId, conversionId));
}

/**
 * Get conversion history for a user (or all public conversions if no userId)
 */
export async function getConversionHistory(
  userId?: number,
  limit: number = 20,
  offset: number = 0
): Promise<Conversion[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get conversion history: database not available");
    return [];
  }

  // If userId provided, get user's conversions; otherwise get anonymous conversions
  const whereClause = userId 
    ? eq(conversions.userId, userId)
    : isNull(conversions.userId);

  const result = await db
    .select()
    .from(conversions)
    .where(whereClause)
    .orderBy(desc(conversions.createdAt))
    .limit(limit)
    .offset(offset);

  return result;
}

/**
 * Get all conversions (for admin or public listing)
 */
export async function getAllConversions(
  limit: number = 50,
  offset: number = 0
): Promise<Conversion[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get all conversions: database not available");
    return [];
  }

  const result = await db
    .select()
    .from(conversions)
    .orderBy(desc(conversions.createdAt))
    .limit(limit)
    .offset(offset);

  return result;
}

/**
 * Delete a conversion by ID (for cleanup or user request)
 */
export async function deleteConversion(conversionId: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot delete conversion: database not available");
    return;
  }

  await db.delete(conversions).where(eq(conversions.conversionId, conversionId));
}

/**
 * Count total conversions for a user
 */
export async function countUserConversions(userId?: number): Promise<number> {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  const whereClause = userId 
    ? eq(conversions.userId, userId)
    : isNull(conversions.userId);

  const result = await db
    .select()
    .from(conversions)
    .where(whereClause);

  return result.length;
}
