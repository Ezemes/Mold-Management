"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps, ReactNode } from "react";
import { btnClass, cx, type BtnVariant } from "./ui";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  confirm,
  className,
  ...p
}: ComponentProps<"button"> & { pendingText?: string; variant?: BtnVariant; size?: "sm" | "md"; confirm?: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...p}
      disabled={pending || p.disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        p.onClick?.(e);
      }}
      className={cx(btnClass(variant, size), className)}
    >
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}
