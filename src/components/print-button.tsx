"use client";

import { btnClass } from "./ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btnClass("primary")}>Print</button>;
}
