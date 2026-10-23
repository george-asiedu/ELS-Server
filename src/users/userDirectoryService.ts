import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { revokeLoginSessions } from "../auth/sessionService";

// Customer and admin accounts, for the super admin's Users tab (every
// studio) and a studio admin's Customers page (their own studio only: the
// tenant extension scopes every query here to the request's studio, so the
// same code serves both and a studio can never see another's users).
// Passwords, reset tokens and session data are never selected.

const MAX_PAGE_SIZE = 100;
const ROLES = ["CUSTOMER", "ADMIN"] as const;
type ListedRole = (typeof ROLES)[number];

export interface UserListQuery {
  search?: string | undefined;
  role?: string | undefined;
  studioId?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export class UserDirectoryService extends Connection {
  public async list(q: UserListQuery) {
    const pageSize = Math.min(
      Math.max(Number(q.pageSize) || 20, 1),
      MAX_PAGE_SIZE,
    );
    const page = Math.max(Number(q.page) || 1, 1);
    const search = q.search?.trim();
    const role = ROLES.includes(q.role as ListedRole)
      ? (q.role as ListedRole)
      : undefined;

    const where = {
      // Super admins aren't studio users and are managed elsewhere.
      role: role ? role : { in: [...ROLES] },
      ...(q.studioId ? { studioId: q.studioId } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              {
                profile: {
                  fullName: { contains: search, mode: "insensitive" as const },
                },
              },
              { profile: { phone: { contains: search } } },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      this.user.count({ where }),
      this.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          role: true,
          studioId: true,
          createdAt: true,
          profile: { select: { fullName: true, phone: true } },
        },
      }),
    ]);

    const ids = users.map((u) => u.id);
    const [bookings, spend, studios] = await Promise.all([
      this.appointment.groupBy({
        by: ["userId"],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.spendByUser(ids),
      this.studio.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                users.map((u) => u.studioId).filter(Boolean) as string[],
              ),
            ],
          },
        },
        select: { id: true, name: true, slug: true, ownerUserId: true },
      }),
    ]);
    const bookingsBy = new Map(bookings.map((b) => [b.userId, b._count._all]));
    const studioBy = new Map(studios.map((s) => [s.id, s]));

    return {
      message: "Users",
      data: users.map((u) => {
        const studio = u.studioId ? studioBy.get(u.studioId) : undefined;
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          fullName: u.profile?.fullName ?? null,
          phone: u.profile?.phone ?? null,
          studio: studio
            ? { id: studio.id, name: studio.name, slug: studio.slug }
            : null,
          isOwner: Boolean(studio && studio.ownerUserId === u.id),
          bookings: bookingsBy.get(u.id) ?? 0,
          totalSpent: spend.get(u.id) ?? 0,
          createdAt: u.createdAt,
        };
      }),
      pagination: {
        page,
        pageSize,
        total,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  public async detail(id: string) {
    const user = await this.user.findFirst({
      where: { id, role: { in: [...ROLES] } },
      select: {
        id: true,
        email: true,
        role: true,
        studioId: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: { fullName: true, phone: true, location: true, avatar: true },
        },
        loyaltyPoints: { select: { points: true, lifetimePoints: true } },
        referralCode: { select: { code: true, uses: true } },
      },
    });
    if (!user) throw new ApiError("User not found", HttpCode.NOT_FOUND);

    const [studio, bookingCount, orderCount, spend, appointments, orders] =
      await Promise.all([
        user.studioId
          ? this.studio.findUnique({
              where: { id: user.studioId },
              select: { id: true, name: true, slug: true, ownerUserId: true },
            })
          : null,
        this.appointment.count({ where: { userId: id } }),
        this.order.count({ where: { userId: id } }),
        this.spendByUser([id]),
        this.appointment.findMany({
          where: { userId: id },
          orderBy: [{ appointmentDate: "desc" }, { id: "desc" }],
          take: 5,
          select: {
            id: true,
            appointmentDate: true,
            appointmentTime: true,
            status: true,
            totalPrice: true,
            service: { select: { name: true } },
          },
        }),
        this.order.findMany({
          where: { userId: id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            total: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      message: "User",
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.profile?.fullName ?? null,
        phone: user.profile?.phone ?? null,
        location: user.profile?.location ?? null,
        avatar: user.profile?.avatar ?? null,
        studio: studio
          ? { id: studio.id, name: studio.name, slug: studio.slug }
          : null,
        isOwner: Boolean(studio && studio.ownerUserId === user.id),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        loyaltyPoints: user.loyaltyPoints?.points ?? 0,
        lifetimePoints: user.loyaltyPoints?.lifetimePoints ?? 0,
        referralCode: user.referralCode?.code ?? null,
        referralUses: user.referralCode?.uses ?? 0,
        bookings: bookingCount,
        orders: orderCount,
        totalSpent: spend.get(id) ?? 0,
        recentAppointments: appointments.map((a) => ({
          id: a.id,
          date: a.appointmentDate,
          time: a.appointmentTime,
          status: a.status,
          service: a.service?.name ?? null,
          amount: a.totalPrice ?? 0,
        })),
        recentOrders: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          total: o.total,
          status: o.status,
          createdAt: o.createdAt,
        })),
      },
    };
  }

  /** Super admin only: name, phone, location and email. */
  public async update(
    id: string,
    input: {
      fullName?: unknown;
      phone?: unknown;
      location?: unknown;
      email?: unknown;
    },
  ) {
    const user = await this.user.findFirst({
      where: { id, role: { in: [...ROLES] } },
      select: { id: true, email: true, studioId: true },
    });
    if (!user) throw new ApiError("User not found", HttpCode.NOT_FOUND);

    const text = (v: unknown, label: string, max: number) => {
      if (v === undefined) return undefined;
      if (v !== null && typeof v !== "string")
        throw new ApiError(`${label} must be text`, 400);
      const t = (v as string | null)?.trim() || null;
      if (t && t.length > max) throw new ApiError(`${label} is too long`, 400);
      return t;
    };
    const fullName = text(input.fullName, "Name", 120);
    const phone = text(input.phone, "Phone", 30);
    const location = text(input.location, "Location", 200);
    let email: string | undefined;
    if (input.email !== undefined) {
      const e = text(input.email, "Email", 254)?.toLowerCase();
      if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        throw new ApiError("Enter a valid email address", 400);
      }
      if (e !== user.email) {
        // Unique per studio.
        const taken = await this.user.findFirst({
          where: { email: e, studioId: user.studioId, NOT: { id } },
          select: { id: true },
        });
        if (taken)
          throw new ApiError(
            "Another account in this studio uses that email",
            409,
          );
        email = e;
      }
    }

    if (email) await this.user.update({ where: { id }, data: { email } });
    const profileData = {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(location !== undefined ? { location } : {}),
    };
    if (Object.keys(profileData).length) {
      await this.profile.upsert({
        where: { userId: id },
        update: profileData,
        create: { userId: id, studioId: user.studioId, ...profileData },
      });
    }
    return this.detail(id);
  }

  /**
   * Super admin only. Bookings and orders stay on the studio's books with the
   * account link cleared; the profile, reviews and loyalty go with the account.
   */
  public async remove(id: string) {
    const user = await this.user.findFirst({
      where: { id, role: { in: [...ROLES] } },
      select: { id: true, email: true, studioId: true },
    });
    if (!user) throw new ApiError("User not found", HttpCode.NOT_FOUND);
    if (user.studioId) {
      const studio = await this.studio.findUnique({
        where: { id: user.studioId },
        select: { ownerUserId: true },
      });
      if (studio?.ownerUserId === id) {
        throw new ApiError(
          "This is the studio's owner account. Delete or transfer the studio instead.",
          HttpCode.BAD_REQUEST,
        );
      }
    }
    await revokeLoginSessions(id);
    await this.user.delete({ where: { id } });
    return {
      message: "User deleted",
      data: { id, email: user.email, studioId: user.studioId },
    };
  }

  /** Money each user has paid: booking payments plus orders, minus refunds. */
  private async spendByUser(ids: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    if (!ids.length) return m;
    const [payments, orders] = await Promise.all([
      this.payment.findMany({
        where: {
          status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
          appointment: { userId: { in: ids } },
        },
        select: {
          amount: true,
          refundedAmount: true,
          appointment: { select: { userId: true } },
        },
      }),
      this.order.findMany({
        where: { userId: { in: ids }, status: { in: ["PAID", "FULFILLED"] } },
        select: { userId: true, total: true, refundedAmount: true },
      }),
    ]);
    const add = (uid: string | null | undefined, v: number) => {
      if (uid) m.set(uid, (m.get(uid) ?? 0) + v);
    };
    for (const p of payments)
      add(p.appointment?.userId, p.amount - (p.refundedAmount ?? 0));
    for (const o of orders) add(o.userId, o.total - (o.refundedAmount ?? 0));
    for (const [k, v] of m) m.set(k, round2(v));
    return m;
  }
}
