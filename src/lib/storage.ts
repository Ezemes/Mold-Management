import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Document storage. Local disk by default (STORAGE_DIR). In production point this at
 * object storage in an Indian region (spec D8) by replacing put/get.
 */
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage");

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/(plain|csv)|application\/(zip|x-zip-compressed|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|msword|octet-stream)|model\/.+)$/;

export async function putFile(orgId: string, bytes: Buffer) {
  const key = `${orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes);
  return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function getFile(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return readFile(full);
}
