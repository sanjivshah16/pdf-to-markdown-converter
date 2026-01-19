// Local file storage for PDF converter
// Stores files in a local directory instead of S3/cloud storage

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Local storage directory - can be customized via STORAGE_DIR env var
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve(__dirname, "..", "local-storage");

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function getFullPath(key: string): string {
  return path.join(STORAGE_DIR, key);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const fullPath = getFullPath(key);

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  if (typeof data === "string") {
    fs.writeFileSync(fullPath, data, "utf-8");
  } else {
    fs.writeFileSync(fullPath, data);
  }

  // Return local URL (will be served by Express static middleware)
  const url = `/storage/${key}`;

  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const url = `/storage/${key}`;
  return { key, url };
}

export async function storageRead(relKey: string): Promise<Buffer | null> {
  const key = normalizeKey(relKey);
  const fullPath = getFullPath(key);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath);
}

export function getStorageDir(): string {
  return STORAGE_DIR;
}
