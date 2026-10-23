import { Request, Response } from "express";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { AuditService } from "../audit/auditService";
import { UserDirectoryService } from "./userDirectoryService";

const users = new UserDirectoryService();
const audit = new AuditService();

const listQuery = (req: Request) => ({
  search: typeof req.query.search === "string" ? req.query.search : undefined,
  role: typeof req.query.role === "string" ? req.query.role : undefined,
  page: Number(req.query.page) || 1,
  pageSize: Number(req.query.pageSize) || 20,
});

const idParam = (req: Request) => {
  const { id } = req.params;
  if (!id) throw new ApiError("User id is required", HttpCode.BAD_REQUEST);
  return String(id);
};

const actor = (req: Request) => ({
  id: req.user?.id,
  email: req.user?.email,
  role: req.user?.role,
});

export class UserDirectoryController {
  // ---- Studio admin: their own studio's users, read-only ----
  public static studioList = async (req: Request, res: Response) => {
    // No studioId filter here: the tenant scope already limits it.
    return res.status(200).json(await users.list(listQuery(req)));
  };

  public static studioDetail = async (req: Request, res: Response) => {
    return res.status(200).json(await users.detail(idParam(req)));
  };

  // ---- Super admin: every studio, with edit and delete ----
  public static platformList = async (req: Request, res: Response) => {
    const studioId =
      typeof req.query.studioId === "string" ? req.query.studioId : undefined;
    return res.status(200).json(
      await users.list({
        ...listQuery(req),
        ...(studioId ? { studioId } : {}),
      }),
    );
  };

  public static platformDetail = async (req: Request, res: Response) => {
    return res.status(200).json(await users.detail(idParam(req)));
  };

  public static platformUpdate = async (req: Request, res: Response) => {
    const id = idParam(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await users.update(id, {
      fullName: body.fullName,
      phone: body.phone,
      location: body.location,
      email: body.email,
    });
    await audit.record({
      actor: actor(req),
      action: "user.updated",
      targetType: "User",
      targetId: id,
      ...(result.data.studio?.id ? { studioId: result.data.studio.id } : {}),
      metadata: Object.fromEntries(
        Object.entries(body).filter(([k]) =>
          ["fullName", "phone", "location", "email"].includes(k),
        ),
      ),
    });
    return res.status(200).json({ ...result, message: "User updated" });
  };

  public static platformRemove = async (req: Request, res: Response) => {
    const id = idParam(req);
    const result = await users.remove(id);
    await audit.record({
      actor: actor(req),
      action: "user.deleted",
      targetType: "User",
      targetId: id,
      ...(result.data.studioId ? { studioId: result.data.studioId } : {}),
      metadata: { email: result.data.email },
    });
    return res.status(200).json(result);
  };
}
