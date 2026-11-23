import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { brandFromStudio, firstName, storefrontFallbackBrand } from "../notifications/brand";
import { renderShell, button, esc, brandColor } from "../notifications/design/shell";
import { notifyUsers } from "../push/pushService";
import { getTenantContext } from "../tenant/context";
import { studioLink } from "../utils/studioLink";

// The waitlist: customers who want a slot on a full day. When a booking that
// day is cancelled, everyone waiting for it is told (email, plus push for
// account holders) with a link straight to that day; the first to book wins.

const dayOf = (raw: unknown) => {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiError("Pick a date", 400);
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) throw new ApiError("That date has passed", 400);
  return d;
};

export class WaitlistService extends Connection {
  private notifications = new NotificationService();

  public async join(input: Record<string, unknown>, userId?: string) {
    const date = dayOf(input.date);
    const serviceId = typeof input.serviceId === "string" ? input.serviceId : "";
    const service = await this.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new ApiError("Pick a service", 400);
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
    const email = typeof input.email === "string" && input.email.trim() ? input.email.trim().toLowerCase().slice(0, 120) : null;
    const phone = typeof input.phone === "string" && input.phone.trim() ? input.phone.trim().slice(0, 30) : null;
    if (!name) throw new ApiError("Enter your name", 400);
    if (!email && !userId) throw new ApiError("Enter your email so we can tell you when a slot opens", 400);
    const already = await this.waitlistEntry.findFirst({
      where: { date, serviceId, notifiedAt: null, ...(userId ? { userId } : { email }) },
      select: { id: true },
    });
    if (!already)
      await this.waitlistEntry.create({ data: { date, serviceId, name, email, phone, ...(userId ? { userId } : {}) } });
    return { message: "You're on the waitlist. We'll tell you if a slot opens that day." };
  }

  /** Admin: who's waiting for a day. */
  public async forDay(rawDate: unknown) {
    const date = dayOf(rawDate);
    const data = await this.waitlistEntry.findMany({ where: { date }, orderBy: { createdAt: "asc" } });
    return { data };
  }

  /** A slot opened on this day: tell everyone still waiting for it. */
  public async slotOpened(date: Date) {
    const waiting = await this.waitlistEntry.findMany({ where: { date, notifiedAt: null } });
    if (!waiting.length) return;
    const studio = await this.currentStudioBranding();
    if (!studio) return;
    const brand = brandFromStudio(studio, storefrontFallbackBrand);
    const day = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const services = new Map(
      (await this.service.findMany({ where: { id: { in: waiting.map((w) => w.serviceId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]),
    );
    for (const w of waiting) {
      const path = `/book?service=${w.serviceId}&date=${date.toISOString().slice(0, 10)}`;
      const url = studioLink(studio.slug, path);
      try {
        if (w.email) {
          const what = services.get(w.serviceId) ?? "your appointment";
          await this.notifications.send({
            template: NotificationTemplate.WAITLIST_SLOT_OPEN,
            to: w.email,
            subject: `A slot opened on ${day}`,
            html: renderShell({
              brand,
              previewText: `Book ${what} at ${studio.name} before someone else does.`,
              bodyHtml: `
                <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Good news, ${esc(firstName(w.name))}</h1>
                <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
                  A slot has opened at ${esc(studio.name)} on ${esc(day)} for ${esc(what)}. Other people are waiting too, so the first to book gets it.
                </p>
                ${button("Book now", url, brandColor(brand))}`,
            }),
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "WaitlistEntry",
            entityId: w.id,
            pushUrl: path,
          });
        } else if (w.userId) {
          await notifyUsers([w.userId], { title: studio.name, body: `A slot opened on ${day}. Book it before someone else does.`, url: path });
        }
        await this.waitlistEntry.update({ where: { id: w.id }, data: { notifiedAt: new Date() } });
      } catch (e) {
        console.warn("Waitlist notice failed:", (e as Error).message);
      }
    }
  }
}
