import Link from "next/link";
import { db } from "@/lib/db";
import { assetScope, requireOrg } from "@/lib/auth";
import { moldsForPress, pressesForMold, pressScope, type Check } from "@/lib/compat";
import { fmtDate } from "@/lib/format";
import { Badge, Card, cx, EmptyState, Field, FlashFromParams, Input, Notice, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubTabs } from "@/components/sub-tabs";
import { PRESS_TABS } from "@/lib/tabs";

export const metadata = { title: "Compatibility finder" };

const STATUS = { approved: ["green", "Approved"], compatible: ["blue", "Compatible (unqualified)"], incompatible: ["red", "Incompatible"] } as const;

function Reasons({ checks }: { checks: Check[] }) {
  const fails = checks.filter((c) => c.result === "fail");
  const unknown = checks.filter((c) => c.result === "unknown");
  return (
    <div className="text-xs">
      {fails.length ? (
        <ul className="space-y-0.5 text-red-700">{fails.map((c) => <li key={c.rule}><strong>{c.label}:</strong> {c.detail}</li>)}</ul>
      ) : (
        <p className="text-emerald-700">All checked rules pass.</p>
      )}
      <details className="mt-1 text-ink-500">
        <summary className="cursor-pointer">{checks.length} rules{unknown.length ? `, ${unknown.length} not checked` : ""}</summary>
        <ul className="mt-1 space-y-0.5">
          {checks.map((c) => (
            <li key={c.rule} className={cx(c.result === "fail" && "text-red-700", c.result === "pass" && "text-ink-700")}>
              {c.result === "pass" ? "✓" : c.result === "fail" ? "✗" : "?"} {c.label}: {c.detail}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export default async function FinderPage({ searchParams }: { searchParams: Promise<{ mold?: string; press?: string; site?: string; show?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireOrg(["assets", "view"]);
  const mode = sp.press ? "press" : "mold";
  const query = (mode === "press" ? sp.press : sp.mold)?.trim() ?? "";
  const subject = query
    ? await db.asset.findFirst({
        where: { AND: [mode === "press" ? pressScope(ctx) : assetScope(ctx), { number: { equals: query, mode: "insensitive" } }, { assetType: { kind: mode } }] },
        include: { site: true },
      })
    : null;
  const sites = await db.site.findMany({ where: { orgId: ctx.org.id, active: true, assets: { some: { assetType: { kind: "press" }, deletedAt: null } } }, orderBy: { name: "asc" } });
  const rows = subject ? (mode === "mold" ? await pressesForMold(ctx, subject.id, sp.site || undefined) : await moldsForPress(ctx, subject.id)) : [];
  const shown = sp.show === "ok" ? rows.filter((r) => r.status !== "incompatible") : rows;
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader title="Presses" subtitle="Check a mold against every press (or a press against every mold). Each failed rule shows why." />
      <SubTabs tabs={PRESS_TABS} active="/presses/finder" />
      <FlashFromParams params={sp} />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Which presses can run this mold?">
          <form className="flex flex-wrap items-end gap-3">
            <Field label="Mold number" name="mold"><Input name="mold" defaultValue={mode === "mold" ? query : ""} placeholder="M-0001" required /></Field>
            <Field label="Presses at" name="site"><Select name="site" placeholder="All sites" options={sites.map((s) => [s.id, s.name] as [string, string])} defaultValue={sp.site ?? ""} /></Field>
            <button className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Find presses</button>
          </form>
        </Card>
        <Card title="Which molds can run on this press?">
          <form className="flex flex-wrap items-end gap-3">
            <Field label="Press number" name="press"><Input name="press" defaultValue={mode === "press" ? query : ""} placeholder="P-0001" required /></Field>
            <button className="rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Find molds</button>
          </form>
        </Card>
      </div>

      {query && !subject && <Notice tone="error">No {mode} numbered “{query}” in your scope.</Notice>}
      {subject && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Link href={`/assets/${subject.id}`} className="font-semibold text-brand-700 hover:underline">{subject.number} {subject.name}</Link> at {subject.site.name}:{" "}
              <span className="text-emerald-700">{count("approved")} approved</span> · <span className="text-sky-700">{count("compatible")} compatible</span> · <span className="text-red-700">{count("incompatible")} incompatible</span>
            </p>
            <Link href={`/presses/finder?${new URLSearchParams({ ...(mode === "mold" ? { mold: query } : { press: query }), ...(sp.site ? { site: sp.site } : {}), ...(sp.show === "ok" ? {} : { show: "ok" }) })}`} className="text-xs text-brand-700 hover:underline">
              {sp.show === "ok" ? "Show all" : "Hide incompatible"}
            </Link>
          </div>
          {shown.length === 0 ? <EmptyState title={`No ${mode === "mold" ? "presses" : "molds"} to compare`} /> : (
            <Table head={[mode === "mold" ? "Press" : "Mold", "Site", "Result", "Why"]}>
              {shown.map((r) => (
                <tr key={r.other.id}>
                  <Td><Link href={`/assets/${r.other.id}`} className="font-medium hover:text-brand-700">{r.other.number}</Link><p className="text-xs text-ink-500">{r.other.name}</p></Td>
                  <Td className="text-xs">{r.other.site.name}{r.other.site.partner && <p className="text-ink-500">{r.other.site.partner.name}</p>}{r.other.siteId === subject.siteId && <p className="text-emerald-700">same site</p>}</Td>
                  <Td>
                    <Badge color={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge>
                    {r.pair && <p className="mt-1 text-xs text-ink-500">since {fmtDate(r.pair.approvedAt, ctx.org.timezone)}</p>}
                  </Td>
                  <Td className="max-w-xl"><Reasons checks={r.verdict.checks} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </>
  );
}
