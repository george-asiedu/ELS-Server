import { Request, Response } from "express";
import { ApiError } from "../middleware/apiError";
import { AuditService } from "../audit/auditService";
import { listJobs, runJobNow, setJobEnabled } from "./scheduler";

const audit = new AuditService();

const jobKey = (req: Request) => {
  const key = req.params.key;
  if (!key) throw new ApiError("Job key is required", 400);
  return key;
};

export class SchedulerController {
  public static list = async (_req: Request, res: Response) => {
    return res
      .status(200)
      .json({ message: "Scheduled jobs", data: await listJobs() });
  };

  public static setEnabled = async (req: Request, res: Response) => {
    const key = jobKey(req);
    if (typeof req.body?.enabled !== "boolean") {
      throw new ApiError("enabled must be true or false", 400);
    }
    const job = await setJobEnabled(key, req.body.enabled, req.user.email);
    await audit.record({
      actor: { id: req.user.id, email: req.user.email, role: req.user.role },
      action: req.body.enabled
        ? "scheduler.job.enabled"
        : "scheduler.job.disabled",
      targetType: "ScheduledJob",
      targetId: key,
    });
    return res.status(200).json({
      message: `${job.label} ${job.enabled ? "turned on" : "turned off"}`,
      data: job,
    });
  };

  public static runNow = async (req: Request, res: Response) => {
    const key = jobKey(req);
    const job = await runJobNow(key, req.user.email);
    await audit.record({
      actor: { id: req.user.id, email: req.user.email, role: req.user.role },
      action: "scheduler.job.run_now",
      targetType: "ScheduledJob",
      targetId: key,
    });
    return res.status(202).json({ message: `${job.label} started`, data: job });
  };
}
