import { Router, Request, Response } from "express";
import { S3BucketService } from "./s3BucketService";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();
const storage = new S3BucketService();
const scopes = new Set(["gallery", "services", "products", "appointments", "studio", "profiles", "reviews", "misc"]);

// Studio media is always uploaded with authenticated, short-lived part URLs.
// Booking reference photos can also be uploaded by customer accounts.
router.post("/multipart/initiate", authenticate, async (req: Request, res: Response) => {
  const { category, fileName, contentType, size } = req.body ?? {};
  if (typeof category !== "string" || !scopes.has(category)) throw new ApiError("Invalid media category", 400);
  if (category === "appointments") {
    if (req.user?.role !== "CUSTOMER") throw new ApiError("Customer access required", 403);
  } else if (category === "profiles") {
    if (req.user?.role !== "CUSTOMER" && req.user?.role !== "ADMIN") throw new ApiError("Profile upload access required", 403);
  } else if (req.user?.role !== "ADMIN") {
    throw new ApiError("Admin access required", 403);
  }
  const upload = await storage.initiateMultipart({
    category,
    fileName: String(fileName ?? ""),
    contentType: String(contentType ?? ""),
    size: Number(size),
  });
  res.status(201).json({ message: "Upload started", data: upload });
});

router.post("/multipart/complete", authenticate, async (req: Request, res: Response) => {
  const { key, uploadId, parts } = req.body ?? {};
  if (!Array.isArray(parts)) throw new ApiError("Upload parts are required", 400);
  const url = await storage.completeMultipart(String(key ?? ""), String(uploadId ?? ""), parts);
  res.status(200).json({ message: "Upload completed", data: { url } });
});

router.post("/multipart/abort", authenticate, async (req: Request, res: Response) => {
  const { key, uploadId } = req.body ?? {};
  await storage.abortMultipart(String(key ?? ""), String(uploadId ?? ""));
  res.status(200).json({ message: "Upload cancelled" });
});

export default router;
