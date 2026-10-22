import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Root() {
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
