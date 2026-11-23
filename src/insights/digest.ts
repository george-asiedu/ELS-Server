import { createTenantClient } from "../tenant/tenantClient";
import { runAsSuperAdmin, runWithTenant } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { platformBrandForPlan, firstName } from "../notifications/brand";
import { weeklyInsights } from "../notifications/templates/report";
import { notifyStudioAdmins } from "../push/pushService";
import { studioLink } from "../utils/studioLink";
import { ghs } from "../notifications/format";
import { insightsFor, type Finding } from "./insightsService";

// Two scheduled jobs that bring insights to people instead of waiting for them
// to open the page: a Monday email with the week and its top actions, and a
// daily check that pushes only the things that can't wait. Both are for the
// plans that include Insights, and each can be switched off by the business.

const { raw } = createTenantClient();
const DAY = 86_400_000;

/** The Monday of this week, as a label: one digest and one alert per finding per week. */
const weekKey = (now = new Date()) => {
  const d = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)
    .toISOString()
    .slice(0, 10);
};

const eligible = () =>
  raw.studio.findMany({
    where: { status: "ACTIVE", plan: { in: ["PREMIUM", "STOREFRONT"] } },
    select: { id: true, name: true, slug: true, plan: true },
  });

const impactText = (f: Finding) =>
  f.impact ? `about ${ghs(f.impact.amount)} ${f.impact.per}` : null;

export const sendWeeklyDigests = async () =>
  runAsSuperAdmin(async () => {
    const notifications = new NotificationService();
    let sent = 0,
      skipped = 0;
    const errors: string[] = [];
    for (const studio of await eligible()) {
      try {
        const settings = await raw.studioSettings.findUnique({
          where: { studioId: studio.id },
          select: { weeklyDigest: true, revenueGoal: true },
        });
        if (settings?.weeklyDigest === false) {
          skipped++;
          continue;
        }
        const data = await runWithTenant({ studioId: studio.id } as never, () =>
          insightsFor(studio.id, 7, true),
        );
        // Nothing to say and nothing happened: no email.
        if (!data.findings.length && data.money.revenue === 0) {
          skipped++;
          continue;
        }
        const admins = await raw.user.findMany({
          where: { studioId: studio.id, role: "ADMIN" },
          select: { email: true, profile: { select: { fullName: true } } },
        });
        const goal = data.goal;
        const goalLine =
          goal.target && goal.projected !== null
            ? `This month so far: ${ghs(goal.monthToDate)} of your ${ghs(goal.target)} goal, on pace for ${ghs(goal.projected)}.`
            : null;
        const week = weekKey();
        for (const a of admins) {
          const { subject, html } = weeklyInsights(
            platformBrandForPlan(studio.plan),
            {
              adminFirstName: firstName(a.profile?.fullName ?? "there"),
              businessName: studio.name,
              revenue: ghs(data.money.revenue),
              revenueChange: data.money.revenueChange,
              profit: ghs(data.money.profit),
              findings: data.findings.slice(0, 3).map((f) => ({
                title: f.title,
                detail: f.detail,
                impact: impactText(f),
              })),
              goalLine,
              insightsUrl: studioLink(studio.slug, "/admin/insights"),
            },
          );
          await notifications.send({
            template: NotificationTemplate.INSIGHTS_WEEKLY,
            to: a.email,
            subject,
            html,
            studioId: studio.id,
            entityType: "Studio",
            entityId: `${studio.id}:${week}`,
            pushBody: data.findings[0]
              ? `This week: ${data.findings[0].title}`
              : "Your week is ready",
          });
          sent++;
        }
      } catch (e) {
        errors.push(`${studio.slug}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    return { sent, skipped, errors: errors.slice(0, 5) };
  });

/** Findings that are worth interrupting someone for. */
const URGENT = new Set(["overdue-orders", "stock-running-out", "unpaid-bills"]);

export const sendInsightAlerts = async () =>
  runAsSuperAdmin(async () => {
    let alerts = 0;
    const errors: string[] = [];
    for (const studio of await eligible()) {
      try {
        const settings = await raw.studioSettings.findUnique({
          where: { studioId: studio.id },
          select: { insightAlerts: true },
        });
        if (settings?.insightAlerts === false) continue;
        const data = await runWithTenant({ studioId: studio.id } as never, () =>
          insightsFor(studio.id, 30, true),
        );
        for (const f of data.findings.filter(
          (x) => x.severity === "high" && URGENT.has(x.id),
        )) {
          // Once per finding per week: the log's unique key stops a daily repeat.
          await notifyStudioAdmins(
            studio.id,
            {
              template: `INSIGHT_ALERT_${f.id}`,
              entityId: `${studio.id}:${weekKey()}`,
              entityType: "Studio",
            },
            {
              title: f.title,
              body:
                [impactText(f), f.items[0]?.label].filter(Boolean).join(". ") ||
                f.detail.slice(0, 120),
              url: "/admin/insights",
              tag: `insight:${f.id}`,
            },
          ).catch(() => 0);
          alerts++;
        }
      } catch (e) {
        errors.push(`${studio.slug}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    return { alerts, errors: errors.slice(0, 5) };
  });
