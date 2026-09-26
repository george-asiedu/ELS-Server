import { env } from "../config/env.config";

// Plunk accepts up to 10 attachments totalling 10MB, base64-encoded.
// See https://docs.useplunk.com/api-reference/public-api/sendEmail
export interface EmailAttachment {
  filename: string;
  content: string; // base64
  contentType: string;
  disposition?: "attachment" | "inline";
}

const MAX_ATTACHMENTS = 10;
// Plunk's documented cap. Base64 inflates by ~4/3, and this is measured on the
// encoded payload, which is what actually travels.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// The actual Plunk API call — used directly by callers with no queue configured,
// and by the email worker when a queue IS configured. Exported so the worker
// (a separate module, to keep BullMQ out of request-handling code paths) can
// call the exact same send logic.
export const sendEmailNow = async ({
  to,
  subject,
  html,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<void> => {
  // Drop anything oversized rather than failing the whole send: the email body
  // already states what was paid, so a customer is better off with the mail and
  // no PDF than with no mail at all.
  // Plunk rejects a filename containing a newline or quote, and a path
  // separator would be meaningless to a mail client — sanitise here as well as
  // at the call site, so no future caller can break a send with a bad name.
  let safeAttachments = attachments
    ?.filter((a) => a.filename && a.content)
    .map((a) => ({
      ...a,
      filename:
        a.filename.replace(/[\r\n"'\\/]+/g, "").slice(0, 120) || "attachment",
    }));
  if (safeAttachments?.length) {
    if (safeAttachments.length > MAX_ATTACHMENTS) {
      console.warn(
        `Dropping ${safeAttachments.length - MAX_ATTACHMENTS} attachment(s) over Plunk's limit of ${MAX_ATTACHMENTS}`,
      );
      safeAttachments = safeAttachments.slice(0, MAX_ATTACHMENTS);
    }
    const total = safeAttachments.reduce((n, a) => n + a.content.length, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      console.error(
        `Attachments total ${total} bytes, over the ${MAX_ATTACHMENT_BYTES} limit — sending "${subject}" without them`,
      );
      safeAttachments = [];
    }
  }

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
      ...(safeAttachments?.length ? { attachments: safeAttachments } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Plunk email send failed (${res.status}): ${detail}`);
  }
};

