"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashPassword, PASSWORD_RULE, requireUser, validPassword, verifyPassword } from "@/lib/auth";
import { str } from "@/lib/forms";

function back(msg: string, kind: "error" | "ok" = "error"): never {
  redirect(`/profile?${kind}=${encodeURIComponent(msg)}`);
}

export async function updateProfileAction(fd: FormData) {
  const { user } = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { firstName: str(fd, "first_name"), lastName: str(fd, "last_name"), phone: str(fd, "phone") } });
  back("Profile updated.", "ok");
}

export async function changePasswordAction(fd: FormData) {
  const { user } = await requireUser();
  if (!(await verifyPassword(str(fd, "current_password"), user.passwordHash))) back("Current password is incorrect.");
  if (!validPassword(str(fd, "new_password"))) back(PASSWORD_RULE);
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(str(fd, "new_password")) } });
  back("Password changed.", "ok");
}
