import { Router, Request, Response } from "express";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { authenticate, requireCustomer } from "../middleware/auth";

class WishlistService extends Connection {
  public async ids(userId: string) {
    const rows = await this.wishlistItem.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { productId: true },
    });
    return rows.map((r) => r.productId);
  }

  public async add(userId: string, productId: string) {
    const product = await this.product.findFirst({
      where: { id: productId, active: true },
      select: { id: true },
    });
    if (!product) throw new ApiError("Product is not available", 404);
    const saved = await this.wishlistItem.findFirst({
      where: { userId, productId },
      select: { id: true },
    });
    if (!saved) await this.wishlistItem.create({ data: { userId, productId } });
  }

  public async remove(userId: string, productId: string) {
    await this.wishlistItem.deleteMany({ where: { userId, productId } });
  }
}

const wishlist = new WishlistService();
const router: Router = Router();
router.use(authenticate, requireCustomer);

const list = async (req: Request, res: Response) =>
  res.status(200).json({
    message: "Wishlist retrieved",
    data: await wishlist.ids(req.user.id),
  });

router.get("/", list);
router.post("/:productId", async (req: Request, res: Response) => {
  await wishlist.add(req.user.id, String(req.params.productId));
  return list(req, res);
});
router.delete("/:productId", async (req: Request, res: Response) => {
  await wishlist.remove(req.user.id, String(req.params.productId));
  return list(req, res);
});

export default router;
