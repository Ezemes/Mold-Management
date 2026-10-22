import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import type { RowError } from "@/lib/importer";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, FlashFromParams, Notice, PageHeader, Stat, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { applyImportAction } from "../actions";

export default async function ImportJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["import_export", "view"]);
  const job = await db.importJob.findFirst({ where: { id, orgId: ctx.org.id } });
  if (!job) notFound();
  const errors = job.errors as RowError[];
  const ok = job.rowCount - new Set(errors.map((e) => e.row)).size;
  return (
    <>
      <PageHeader back={{ href: "/import-export", label: "Import & export" }} title={job.filename} subtitle={`${job.kind} import · uploaded ${fmtDateTime(job.createdAt, ctx.org.timezone)}`} actions={<Badge status={job.status} />} />
      <FlashFromParams params={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Rows" value={job.rowCount} />
        <Stat label="Valid rows" value={ok} />
        <Stat label="Rows with errors" value={job.rowCount - ok} />
      </div>
      {job.status === "applied" ? (
        <Notice tone="success">Applied {fmtDateTime(job.appliedAt, ctx.org.timezone)}. Every change is in the audit log.</Notice>
      ) : errors.length ? (
        <Notice tone="error">Fix these rows in your spreadsheet and upload it again. Nothing has been imported.</Notice>
      ) : (
        <Card title="Ready to import">
          <p className="mb-3 text-sm text-ink-700">All {job.rowCount} rows are valid. Applying re-checks them against the latest data, then imports everything in one step: either all rows succeed or none do.</p>
          {job.createdById === ctx.user.id && ctx.can("import_export", "create") && (
            <form action={applyImportAction}><input type="hidden" name="id" value={job.id} /><SubmitButton pendingText="Importing…">Apply import</SubmitButton></form>
          )}
        </Card>
      )}
      {errors.length > 0 && (
        <Table head={["Row", "Problem"]}>
          {errors.slice(0, 500).map((e, i) => <tr key={i}><Td className="tabular-nums">{e.row}</Td><Td className="text-red-700">{e.message}</Td></tr>)}
        </Table>
      )}
      {errors.length > 500 && <p className="mt-2 text-xs text-ink-500">Showing the first 500 of {errors.length} problems.</p>}
    </>
  );
}
