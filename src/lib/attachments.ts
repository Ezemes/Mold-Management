import "server-only";
import type { Prisma } from "@prisma/client";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, putFile } from "./storage";

export class AttachmentError extends Error {}

/** Validate and store uploaded files from a form field; returns rows to insert. */
export async function storeUploads(orgId: string, files: FormDataEntryValue[], max = 10) {
  const real = files.filter((f): f is File => f instanceof File && f.size > 0);
  if (real.length > max) throw new AttachmentError(`Attach at most ${max} files.`);
  const out: { filename: string; mimeType: string; sizeBytes: number; sha256: string; storageKey: string }[] = [];
  for (const f of real) {
    if (f.size > MAX_UPLOAD_BYTES) throw new AttachmentError(`${f.name} is larger than 25 MB.`);
    const mime = f.type || "application/octet-stream";
    if (!ALLOWED_MIME.test(mime)) throw new AttachmentError(`${f.name}: file type ${mime} is not allowed.`);
    const stored = await putFile(orgId, Buffer.from(await f.arrayBuffer()));
    out.push({ filename: f.name.slice(0, 200), mimeType: mime, sizeBytes: f.size, sha256: stored.sha256, storageKey: stored.key });
  }
  return out;
}

export async function saveAttachments(tx: Prisma.TransactionClient, orgId: string, ownerType: "handover" | "work_order" | "evaluation", ownerId: string, rows: Awaited<ReturnType<typeof storeUploads>>, userId: string) {
  if (rows.length) await tx.attachment.createMany({ data: rows.map((r) => ({ ...r, orgId, ownerType, ownerId, uploadedById: userId })) });
}
