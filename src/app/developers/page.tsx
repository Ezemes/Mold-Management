import Link from "next/link";
import { openApiSpec } from "@/lib/openapi";
import { appUrl } from "@/lib/mail";
import { Logo } from "@/components/logo";

export const metadata = { title: "API & webhooks" };

type Op = { summary: string; description: string; "x-scope": string; parameters?: { name: string; in: string; description: string }[]; requestBody?: unknown };

const VERIFY = `import crypto from "node:crypto";

// rawBody: the request body exactly as received (string), header: X-PM-Signature
export function verify(secret, rawBody, header) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(\`\${m[1]}.\${rawBody}\`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}`;

export default function DevelopersPage() {
  const base = appUrl("").replace(/\/$/, "");
  const spec = openApiSpec(base);
  const paths = Object.entries(spec.paths) as [string, Record<string, Op>][];
  const example = `curl -X POST ${base}/api/v1/readings \\
  -H "Authorization: Bearer pmk_…" -H "Content-Type: application/json" \\
  -d '{"readings":[{"asset":"M-0001","value":412500,"read_at":"2026-10-22T06:00:00Z"}]}'`;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/"><Logo /></Link>
          <a href="/api/v1/openapi.json" className="text-sm text-brand-700 hover:underline">openapi.json</a>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-10 px-6 py-10 text-sm text-ink-700">
        <section>
          <h1 className="text-2xl font-semibold text-ink-900">API and webhooks</h1>
          <p className="mt-3 max-w-3xl">{spec.info.description}</p>
          <p className="mt-2">Base URL: <code className="rounded bg-gray-100 px-1.5 py-0.5">{base}/api/v1</code></p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs text-gray-100">{example}</pre>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink-900">Endpoints</h2>
          <div className="space-y-3">
            {paths.flatMap(([path, ops]) =>
              Object.entries(ops).map(([method, o]) => (
                <div key={`${method} ${path}`} className="rounded-lg border border-gray-200 bg-white p-4">
                  <p className="font-mono text-sm"><span className={method === "post" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{method.toUpperCase()}</span> {path}</p>
                  <p className="mt-1 font-medium text-ink-900">{o.summary}</p>
                  <p className="mt-1 text-xs">{o.description}</p>
                  {o.parameters && o.parameters.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs">{o.parameters.map((p) => <li key={p.name}><code className="rounded bg-gray-100 px-1">{p.name}</code> <span className="text-ink-500">({p.in})</span> {p.description}</li>)}</ul>
                  )}
                </div>
              )),
            )}
          </div>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink-900">Webhooks</h2>
          <p className="max-w-3xl">{spec["x-webhooks"].description}</p>
          <ul className="mt-3 space-y-1">
            {Object.entries(spec["x-webhooks"].events).map(([k, v]) => <li key={k}><code className="rounded bg-gray-100 px-1">{k}</code> {v}</li>)}
          </ul>
          <p className="mt-4 font-medium text-ink-900">Verifying the signature (Node.js)</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-900 p-4 text-xs text-gray-100">{VERIFY}</pre>
        </section>
      </main>
    </div>
  );
}
