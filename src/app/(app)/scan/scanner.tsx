"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

/** Uses the browser's built-in BarcodeDetector (Chrome/Android, Safari 17+). Falls back to manual entry. */
export function Scanner() {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "scanning" | "unsupported" | "denied" | "found">("idle");

  useEffect(() => {
    if (state !== "scanning") return;
    let stream: MediaStream | null = null;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });
        while (!stopped) {
          const codes = await detector.detect(video.current).catch(() => []);
          const hit = codes.map((c) => c.rawValue).find((v) => /\/a\/[A-Za-z0-9]+$/.test(v));
          if (hit) {
            setState("found");
            window.location.href = new URL(hit).pathname; // stay on this deployment
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setState("denied");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [state]);

  const start = () => setState(typeof window !== "undefined" && window.BarcodeDetector && navigator.mediaDevices ? "scanning" : "unsupported");

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
      {state === "scanning" || state === "found" ? (
        <video ref={video} className="mx-auto aspect-square w-full max-w-sm rounded-md bg-black object-cover" muted playsInline />
      ) : (
        <button type="button" onClick={start} className="w-full rounded-md bg-brand-600 py-3 text-sm font-medium text-white">Start camera</button>
      )}
      {state === "found" && <p className="mt-2 text-sm text-emerald-700">Found, opening…</p>}
      {state === "unsupported" && <p className="mt-2 text-sm text-amber-800">This browser cannot scan QR codes. Use your phone&apos;s camera app on the tag (it opens the same page) or enter the number below.</p>}
      {state === "denied" && <p className="mt-2 text-sm text-red-700">Camera access was blocked. Allow it in your browser settings, or enter the number below.</p>}
    </div>
  );
}
