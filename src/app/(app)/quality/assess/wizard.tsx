"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { NA_DESC, QUESTIONS, RATINGS, SPARE_PARTS_STATUS, validateAssessment, type Answers, type Component, type ComponentResult } from "@/lib/inspection.pure";
import { btnClass, cx } from "@/components/ui";
import { submitAssessmentAction, type AssessState } from "./actions";

type Props = {
  asset: { id: string; number: string; name: string; process: string; designCavities: number | null; activeCavities: number | null; lifetime: number | null; lastRaw: number | null; annualVolume: number | null; lastRunDate: string };
  template: { name: string; components: Component[] };
  previous: Record<string, number | null>;
  mode: "bench" | "machine";
  video: boolean;
};

// Written out in full so Tailwind generates them (colours from the Mold Health Rating chart).
const RATING_STYLE: Record<string, string> = {
  "5": "peer-checked:border-emerald-700 peer-checked:bg-emerald-50",
  "4": "peer-checked:border-emerald-500 peer-checked:bg-emerald-50",
  "3": "peer-checked:border-yellow-400 peer-checked:bg-yellow-50",
  "2": "peer-checked:border-orange-500 peer-checked:bg-orange-50",
  "1": "peer-checked:border-red-500 peer-checked:bg-red-50",
  na: "peer-checked:border-gray-400 peer-checked:bg-gray-50",
};
const word = (r: number | null | undefined) => (r == null ? "N/A" : RATINGS[r as 1 | 2 | 3 | 4 | 5]?.word ?? "—");

/** Read one component's answers from the form, in the shape the shared validation expects. */
function readComponent(fd: FormData, c: Component): ComponentResult {
  const r = String(fd.get(`r.${c.key}`) ?? "");
  return {
    ...c,
    score: r === "na" ? null : r === "" ? (undefined as unknown as null) : Number(r),
    note: String(fd.get(`n.${c.key}`) ?? ""),
    checkResults: c.checks.map((text, i) => ({ text, ok: fd.get(`c.${c.key}.${i}`) === "yes" ? true : fd.get(`c.${c.key}.${i}`) === "no" ? false : null })),
    photos: fd.getAll(`p.${c.key}`).filter((f) => f instanceof File && f.size > 0).length,
  };
}
function readAnswers(fd: FormData, mode: Answers["mode"]): Answers {
  const s = (k: string) => String(fd.get(k) ?? "");
  const yn = (k: string) => (s(k) === "yes" ? true : s(k) === "no" ? false : null);
  return {
    mode, dynamic: { cavitiesRunning: null, cavitiesTotal: null, lastRunDate: null, totalShots: null, annualVolume: null },
    qualityIssues: yn("qualityIssues"), qualityNote: s("qualityNote"), operationalIssues: yn("operationalIssues"), operationalNote: s("operationalNote"),
    spareParts: (s("spareParts") || null) as Answers["spareParts"], sparePartsNote: s("sparePartsNote"), supplyRisk: yn("supplyRisk"), supplyRiskNote: s("supplyRiskNote"),
    overallCondition: s("overallCondition"), recommendations: s("recommendations"), video: false,
  };
}
const complete: Answers = { mode: "bench", dynamic: { cavitiesRunning: null, cavitiesTotal: null, lastRunDate: null, totalShots: null, annualVolume: null }, qualityIssues: false, qualityNote: "", operationalIssues: false, operationalNote: "", spareParts: "Okay", sparePartsNote: "", supplyRisk: false, supplyRiskNote: "", overallCondition: "x", recommendations: "", video: false };

function YesNo({ name, label }: { name: string; label: string }) {
  return (
    <fieldset className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
      <legend className="sr-only">{label}</legend>
      <span className="text-sm">{label}</span>
      <span className="flex gap-1">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="cursor-pointer">
            <input type="radio" name={name} value={v} className="peer sr-only" aria-label={`${label}: ${v.toUpperCase()}`} />
            <span className={cx("inline-block rounded-md border px-3 py-1 text-xs font-semibold peer-checked:text-white", v === "yes" ? "border-emerald-600 text-emerald-700 peer-checked:bg-emerald-600" : "border-red-600 text-red-700 peer-checked:bg-red-600")}>{v.toUpperCase()}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

export function AssessmentWizard({ asset, template, previous, mode, video }: Props) {
  const steps = ["details", ...template.components.map((c) => c.key), "questions", "review"];
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [review, setReview] = useState<{ c: ComponentResult[]; issues: string[] } | null>(null);
  const [state, action, pending] = useActionState<AssessState, FormData>(submitAssessmentAction, {});
  const form = useRef<HTMLFormElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [rec, setRec] = useState<"off" | "recording" | "saved" | "denied">("off");

  // Bench assessments can record video in the background; it stops automatically at the final step.
  useEffect(() => {
    if (!video || mode !== "bench" || typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 360, facingMode: "environment" }, audio: true })
      .then((s) => {
        stream = s;
        const r = new MediaRecorder(s, { videoBitsPerSecond: 600_000 });
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = () => {
          const blob = new Blob(chunks.current, { type: r.mimeType || "video/webm" });
          const dt = new DataTransfer();
          dt.items.add(new File([blob], `assessment-${asset.number}.webm`, { type: blob.type.split(";")[0] }));
          if (videoInput.current) videoInput.current.files = dt.files;
          setRec("saved");
          s.getTracks().forEach((t) => t.stop());
        };
        r.start(5000);
        recorder.current = r;
        setRec("recording");
      })
      .catch(() => setRec("denied"));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [video, mode, asset.number]);

  function check(target: number) {
    const fd = new FormData(form.current!);
    const key = steps[step];
    let e: string[] = [];
    if (target > step) {
      const comp = template.components.find((c) => c.key === key);
      if (comp) e = validateAssessment([readComponent(fd, comp)], complete);
      if (key === "details") e = validateAssessment([], { ...complete, qualityIssues: readAnswers(fd, mode).qualityIssues, qualityNote: readAnswers(fd, mode).qualityNote }).concat(Number(fd.get("cavitiesRunning")) > (asset.designCavities ?? Infinity) ? ["Cavities running can't exceed the total."] : []);
      if (key === "questions") e = validateAssessment([], { ...readAnswers(fd, mode), qualityIssues: false });
    }
    setErrors(e);
    if (e.length) return;
    if (steps[target] === "review") {
      const comps = template.components.map((c) => readComponent(fd, c));
      setReview({ c: comps, issues: validateAssessment(comps, readAnswers(fd, mode)) });
      if (recorder.current?.state === "recording") recorder.current.stop();
    }
    setStep(target);
    window.scrollTo({ top: 0 });
  }

  const current = steps[step];
  const comp = template.components.find((c) => c.key === current);
  const index = template.components.findIndex((c) => c.key === current);

  return (
    <form ref={form} action={action} className="mx-auto max-w-3xl" encType="multipart/form-data">
      <input type="hidden" name="assetId" value={asset.id} />
      <input type="hidden" name="mode" value={mode} />
      <input ref={videoInput} type="file" name="video" className="hidden" aria-hidden="true" tabIndex={-1} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <p><span className="font-semibold">{asset.number}</span> {asset.name} · {template.name} · {mode === "bench" ? "Bench" : "On machine"}</p>
        <p className="flex items-center gap-3 text-ink-500">
          {rec === "recording" && <span className="font-medium text-red-600">● Recording</span>}
          {rec === "saved" && <span className="text-emerald-700">Video ready</span>}
          {rec === "denied" && <span className="text-amber-700">Camera not available: no video</span>}
          Step {step + 1} of {steps.length}
        </p>
      </div>
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-brand-600 transition-all" style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>

      {errors.length > 0 && <ul role="alert" className="mb-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {state.errors && state.errors.length > 0 && <ul role="alert" className="mb-4 space-y-1 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      {/* Step: asset details and live data */}
      <section className={cx("space-y-4 rounded-lg border border-gray-200 bg-white p-5", current !== "details" && "hidden")}>
        <h2 className="font-semibold">Asset details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className="label">Cavities running</span>
            <span className="flex items-center gap-2"><input name="cavitiesRunning" inputMode="numeric" defaultValue={asset.activeCavities ?? ""} className="input w-24" aria-label="Cavities running" /> out of {asset.designCavities ?? "—"}</span>
          </label>
          <label className="block text-sm"><span className="label">Last run date</span><input type="date" name="lastRunDate" defaultValue={asset.lastRunDate} className="input" /></label>
          <label className="block text-sm"><span className="label">Total shots (counter)</span><input name="totalShots" inputMode="numeric" defaultValue={asset.lastRaw ?? ""} className="input" /><span className="mt-1 block text-xs text-ink-500">A higher value is recorded as a shot reading.</span></label>
          <label className="block text-sm"><span className="label">Annual volume (parts)</span><input name="annualVolume" inputMode="numeric" defaultValue={asset.annualVolume ?? ""} className="input" /><span className="mt-1 block text-xs text-ink-500">Updates the passport when the assessment is approved.</span></label>
        </div>
        <YesNo name="qualityIssues" label={QUESTIONS.qualityIssues} />
        <textarea name="qualityNote" rows={2} placeholder="If yes: describe the quality issues" className="input" aria-label="Quality issues" />
      </section>

      {/* Steps: one per mold element */}
      {template.components.map((c) => (
        <section key={c.key} className={cx("space-y-4 rounded-lg border border-gray-200 bg-white p-5", current !== c.key && "hidden")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{c.label}</h2>
            <span className="text-xs text-ink-500">Previous condition: <strong>{c.key in previous ? word(previous[c.key]) : "none recorded"}</strong></span>
          </div>
          {c.checks.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Key points</p>
              {c.checks.map((t, i) => <YesNo key={i} name={`c.${c.key}.${i}`} label={t} />)}
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Condition rating</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["5", "4", "3", "2", "1", "na"] as const).map((v) => (
                <label key={v} className="cursor-pointer">
                  <input type="radio" name={`r.${c.key}`} value={v} className="peer sr-only" aria-label={`${c.label}: ${v === "na" ? "Not applicable" : `${v} ${word(Number(v))}`}`} />
                  <span className={cx("block h-full rounded-md border-2 border-transparent bg-white p-2 text-xs ring-1 ring-gray-200 peer-checked:ring-0", RATING_STYLE[v])}>
                    <span className="block text-sm font-semibold">{v === "na" ? "N/A" : `${v} · ${word(Number(v))}`}</span>
                    <span className="text-ink-500">{v === "na" ? NA_DESC : RATINGS[Number(v) as 1].desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <label className="block text-sm"><span className="label">Comment</span><textarea name={`n.${c.key}`} rows={2} className="input" placeholder="Required for a NO answer or a Poor/Unacceptable rating: what you found and how to correct it" /></label>
          <label className="block text-sm"><span className="label">Photos</span><input type="file" name={`p.${c.key}`} accept="image/*" capture="environment" multiple className="block text-sm" /><span className="mt-1 block text-xs text-ink-500">Required when a check is NO.</span></label>
        </section>
      ))}

      {/* Step: questions */}
      <section className={cx("space-y-4 rounded-lg border border-gray-200 bg-white p-5", current !== "questions" && "hidden")}>
        <h2 className="font-semibold">Issues, spare parts and comments</h2>
        <YesNo name="operationalIssues" label={QUESTIONS.operationalIssues} />
        <textarea name="operationalNote" rows={2} placeholder="If yes: describe the operational issues" className="input" aria-label="Operational issues" />
        <fieldset className="space-y-2">
          <legend className="text-sm">{QUESTIONS.sparePartsNeeded}</legend>
          <div className="flex gap-2">{Object.keys(SPARE_PARTS_STATUS).map((k) => <label key={k} className="flex items-center gap-1 text-sm"><input type="radio" name="spareParts" value={k} /> {k}</label>)}</div>
          <textarea name="sparePartsNote" rows={2} placeholder="If needed: which parts" className="input" aria-label="Spare parts needed" />
        </fieldset>
        <YesNo name="supplyRisk" label={QUESTIONS.supplyRisk} />
        <textarea name="supplyRiskNote" rows={2} placeholder="If yes: the risk and the repair or replacement required" className="input" aria-label="Supply risk" />
        <label className="block text-sm"><span className="label">{QUESTIONS.overallCondition}</span><textarea name="overallCondition" rows={3} className="input" /></label>
        <label className="block text-sm"><span className="label">{QUESTIONS.recommendations}</span><textarea name="recommendations" rows={3} className="input" /></label>
        <label className="block text-sm"><span className="label">Other photos</span><input type="file" name="photos" accept="image/*" multiple className="block text-sm" /></label>
      </section>

      {/* Step: review */}
      {current === "review" && review && (
        <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-semibold">Review and submit</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {review.c.map((c) => (
              <li key={c.key} className="flex justify-between gap-3 py-1.5">
                <span>{c.label}{c.checkResults.some((k) => k.ok === false) && <span className="ml-2 text-xs text-red-700">{c.checkResults.filter((k) => k.ok === false).length} NO</span>}</span>
                <span className={cx("font-medium", c.score != null && c.score <= 2 && "text-red-700")}>{word(c.score)}</span>
              </li>
            ))}
          </ul>
          {review.c.some((c) => c.score === 1) && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">An Unacceptable rating means the tool should not run until corrected. Approvers and maintenance are alerted when you submit; approval quarantines the mold.</p>}
          {review.issues.length > 0 && <ul role="alert" className="space-y-1 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{review.issues.map((e) => <li key={e}>{e}</li>)}</ul>}
          <button type="submit" disabled={pending || review.issues.length > 0} className={btnClass("primary")}>{pending ? "Submitting…" : "Submit assessment"}</button>
        </section>
      )}

      <div className="mt-4 flex justify-between">
        <button type="button" onClick={() => { setErrors([]); setStep(Math.max(0, step - 1)); }} disabled={step === 0} className={btnClass("secondary")}>Back</button>
        {current !== "review" && <button type="button" onClick={() => check(step + 1)} className={btnClass("primary")}>{index >= 0 && index === template.components.length - 1 ? "Next: questions" : steps[step + 1] === "review" ? "Review" : comp ? "Next element" : "Start inspection"}</button>}
      </div>
    </form>
  );
}
