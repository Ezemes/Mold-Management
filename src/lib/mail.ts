import "server-only";

/**
 * Outbound email. No provider is configured yet, so messages are written to the
 * server log. Replace the body of sendMail with a real provider (e.g. Resend, SES).
 */
export async function sendMail(to: string, subject: string, text: string) {
  console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
}

export function appUrl(path: string) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

export const showDevSecrets = process.env.NODE_ENV !== "production";
