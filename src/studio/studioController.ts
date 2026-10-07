import { Request, Response } from "express";
import { StudioService } from "./studioService";
import { S3BucketService } from "../bucket/s3BucketService";
import { AuditService } from "../audit/auditService";
import { ApiError } from "../middleware/apiError";

const studioService = new StudioService(new S3BucketService());
const audit = new AuditService();

export class StudioController {
  // Public storefront config for the studio resolved by resolveTenant.
  public static config = async (req: Request, res: Response) => {
    const result = await studioService.getPublicConfig(req.studioId);
    return res.status(200).json({ message: "Studio config", data: result });
  };

  // ---- Admin: branding --------------------------------------------------

  public static getBranding = async (req: Request, res: Response) => {
    const result = await studioService.getBranding(req.studioId);
    return res.status(200).json(result);
  };

  public static updateBranding = async (req: Request, res: Response) => {
    const result = await studioService.updateBranding(
      req.studioId,
      req.body ?? {},
    );
    return res.status(200).json(result);
  };

  // ---- Custom domain ----------------------------------------------------

  public static resolveDomain = async (req: Request, res: Response) => {
    const host = String(req.query.host ?? "");
    if (!host) throw new ApiError("host is required", 400);
    const result = await studioService.resolveByDomain(host);
    return res.status(200).json(result);
  };

  public static getDomain = async (req: Request, res: Response) => {
    const result = await studioService.getDomain(req.studioId);
    return res.status(200).json(result);
  };

  public static setDomain = async (req: Request, res: Response) => {
    const result = await studioService.setDomain(
      req.studioId,
      String(req.body?.domain ?? ""),
    );
    return res.status(200).json(result);
  };

  public static verifyDomain = async (req: Request, res: Response) => {
    const result = await studioService.verifyDomain(req.studioId);
    return res.status(200).json(result);
  };

  public static getBilling = async (req: Request, res: Response) => {
    const result = await studioService.getBilling(req.studioId);
    return res.status(200).json(result);
  };

  public static startBillingChange = async (req: Request, res: Response) => {
    const plan = String(req.body?.plan ?? "");
    const cadence = String(req.body?.cadence ?? "");
    const result = await studioService.startBillingChange(
      req.studioId,
      plan,
      cadence,
    );
    return res.status(200).json(result);
  };

  public static applyBillingChange = async (req: Request, res: Response) => {
    const reference = String(req.body?.reference ?? "");
    const plan = String(req.body?.plan ?? "");
    const cadence = String(req.body?.cadence ?? "");
    const result = await studioService.applyBillingChange(
      req.studioId,
      reference,
      plan,
      cadence,
    );
    return res.status(200).json(result);
  };

  public static startRenewal = async (req: Request, res: Response) => {
    const result = await studioService.startRenewal(req.studioId);
    return res.status(200).json(result);
  };

  public static applyRenewal = async (req: Request, res: Response) => {
    const reference = String(req.body?.reference ?? "");
    const result = await studioService.applyRenewal(req.studioId, reference);
    return res.status(200).json(result);
  };

  public static getLoyalty = async (req: Request, res: Response) => {
    const result = await studioService.getLoyalty(req.studioId);
    return res.status(200).json(result);
  };

  public static updateLoyalty = async (req: Request, res: Response) => {
    const result = await studioService.updateLoyalty(
      req.studioId,
      req.body ?? {},
    );
    return res.status(200).json(result);
  };

  // ---- Admin: content ---------------------------------------------------

  public static getContent = async (req: Request, res: Response) => {
    const result = await studioService.getContent(req.studioId);
    return res.status(200).json(result);
  };

  // ---- Admin: payout ----------------------------------------------------

  public static getPayout = async (req: Request, res: Response) => {
    const result = await studioService.getPayout(req.studioId);
    return res.status(200).json(result);
  };

  public static resolvePayout = async (req: Request, res: Response) => {
    const accountNumber = String(req.query.accountNumber ?? "");
    const provider = String(req.query.provider ?? "");
    const result = await studioService.resolvePayoutAccount(
      req.studioId,
      accountNumber,
      provider,
    );
    return res.status(200).json(result);
  };

  public static updatePayout = async (req: Request, res: Response) => {
    const result = await studioService.updatePayout(
      req.studioId,
      req.body ?? {},
    );
    await audit.record({
      actor: {
        id: req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
      },
      action: "studio.payout_connected",
      targetType: "Studio",
      targetId: req.studioId ?? undefined,
      studioId: req.studioId ?? undefined,
      metadata: { provider: req.body?.provider },
    });
    return res.status(200).json(result);
  };

  public static updateContent = async (req: Request, res: Response) => {
    const result = await studioService.updateContent(
      req.studioId,
      req.body ?? {},
    );
    return res.status(200).json(result);
  };
}
