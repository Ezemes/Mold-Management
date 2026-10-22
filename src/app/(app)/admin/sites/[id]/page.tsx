import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/auth";
import { Card, FlashFromParams, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveSiteAction } from "../../actions";
import { SiteFields } from "../../site-form";

export default async function SitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(["sites", "view"]);
  const site = await db.site.findFirst({ where: { id, orgId: ctx.org.id }, include: { _count: { select: { assets: { where: { deletedAt: null } } } } } });
  if (!site) notFound();
  const [divisions, partners] = await Promise.all([
    db.division.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
    db.partner.findMany({ where: { orgId: ctx.org.id }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/admin/sites", label: "Sites" }} title={site.name} subtitle={<Link href={`/assets?site=${site.id}`} className="text-brand-700 hover:underline">{site._count.assets} assets at this site →</Link>} />
      <FlashFromParams params={sp} />
      <Card>
        <form action={saveSiteAction} className="space-y-4">
          <input type="hidden" name="id" value={site.id} />
          <SiteFields s={site} divisions={divisions} partners={partners} />
          {ctx.can("sites", "edit") && <SubmitButton>Save site</SubmitButton>}
        </form>
      </Card>
    </>
  );
}
