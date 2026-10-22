import { redirect } from "next/navigation";

/** Evaluations are now recorded with the guided assessment. */
export default async function NewEvaluationPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const sp = await searchParams;
  redirect(`/quality/assess${sp.asset ? `?asset=${encodeURIComponent(sp.asset)}` : ""}`);
}
