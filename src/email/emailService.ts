import { env } from "../config/env.config";

// The actual Plunk API call — used directly by callers with no queue configured,
// and by the email worker when a queue IS configured. Exported so the worker
// (a separate module, to keep BullMQ out of request-handling code paths) can
// call the exact same send logic.
export const sendEmailNow = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> => {
  const res = await fetch(env.plunk.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.plunk.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      body: html,
      from: env.senderEmail,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Plunk email send failed (${res.status}): ${detail}`);
  }
};

