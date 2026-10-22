import Link from "next/link";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { Badge, btnClass, Card, Field, FlashFromParams, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { validateImportAction } from "./actions";

export const metadata = { title: "Import & export" };

export default async function ImportExportPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["import_export", "view"]);
  const [types, jobs] = await Promise.all([
    db.assetType.findMany({ where: { orgId: ctx.org.id, archived: false }, orderBy: { createdAt: "asc" } }),
    db.importJob.findMany({ where: { orgId: ctx.org.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  return (
    <>
      <PageHeader title="Import & export" subtitle="Upload a CSV, review the dry-run report, then apply. Nothing changes until you apply." />
      <FlashFromParams params={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        {ctx.can("import_export", "create") && (
          <Card title="Import">
            <form action={validateImportAction} className="space-y-3" encType="multipart/form-data">
              <Field label="What are you importing?"><Select name="kind" options={{ assets: "Assets (create or update by number)", readings: "Shot readings" }} /></Field>
              <Field label="CSV file (max 5 MB, 10,000 rows)"><input type="file" name="file" accept=".csv,text/csv" required className="block text-sm" /></Field>
              <SubmitButton pendingText="Checking…">Validate (dry run)</SubmitButton>
            </form>
            <div className="mt-4 border-t border-gray-100 pt-3 text-sm">
              <p className="mb-2 font-medium">Templates</p>
              <ul className="space-y-1">
                {types.map((t) => <li key={t.id}><a className="text-brand-700 hover:underline" href={`/import-export/template/assets?type=${t.key}`}>Assets: {t.name}</a></li>)}
                <li><a className="text-brand-700 hover:underline" href="/import-export/template/readings" download>Shot readings</a></li>
              </ul>
              <p className="mt-2 text-xs text-ink-500">Dates: YYYY-MM-DD or DD-MM-YYYY. Numbers may use Indian grouping (1,00,000). Sites match by name or code. Times are {ctx.org.timezone}.</p>
            </div>
          </Card>
        )}
        <Card title="Export">
          <div className="flex flex-wrap gap-2">
            <a className={btnClass("secondary")} href="/import-export/assets.csv">All assets (CSV)</a>
            <a className={btnClass("secondary")} href="/import-export/readings.csv">All shot readings (CSV)</a>
          </div>
          <p className="mt-3 text-xs text-ink-500">Exports contain only assets in your scope. The asset export uses the same columns as the import template, so you can edit it in Excel and import it back.</p>
        </Card>
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold">Recent imports</h2>
      <Table head={["File", "Kind", "Rows", "Errors", "Status", "When"]} empty="No imports yet.">
        {jobs.map((j) => (
          <tr key={j.id} className="hover:bg-gray-50">
            <Td><Link href={`/import-export/${j.id}`} className="font-medium hover:text-brand-700">{j.filename}</Link></Td>
            <Td>{j.kind}</Td><Td>{j.rowCount}</Td><Td>{j.errorCount}</Td>
            <Td><Badge status={j.status} /></Td>
            <Td className="text-xs text-ink-500">{fmtDateTime(j.createdAt, ctx.org.timezone)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
