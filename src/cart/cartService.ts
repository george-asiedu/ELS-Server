import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";

const itemsInclude = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          promoPrice: true,
          imageUrl: true,
          stock: true,
          trackStock: true,
          active: true,
          category: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

export class CartService extends Connection {
  private async getOrCreate(userId: string) {
    const existing = await this.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.cart.create({ data: { userId } });
  }

  public async getMine(userId: string) {
    await this.getOrCreate(userId);
    const cart = await this.cart.findUnique({
      where: { userId },
      include: itemsInclude,
    });
    return { message: "Cart retrieved successfully", data: cart };
  }

  public async addItem(userId: string, productId: string, quantity: number) {
    const qty = Math.max(1, Math.floor(quantity || 1));
    const product = await this.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) {
      throw new ApiError("Product is not available", 404);
    }

    const cart = await this.getOrCreate(userId);
    const existingItem = await this.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });
    const desired = (existingItem?.quantity ?? 0) + qty;

    // Respect available stock when the product tracks inventory.
    const finalQty = product.trackStock
      ? Math.min(desired, product.stock)
      : desired;
    if (product.trackStock && product.stock <= 0) {
      throw new ApiError("Product is out of stock", 400);
    }

    if (existingItem) {
      await this.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: finalQty },
      });
    } else {
      await this.cartItem.create({
        data: { cartId: cart.id, productId, quantity: finalQty },
      });
    }
    return this.getMine(userId);
  }

  public async updateItem(userId: string, productId: string, quantity: number) {
    const cart = await this.getOrCreate(userId);
    const item = await this.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });
    if (!item) throw new ApiError("Item not in cart", 404);

    const qty = Math.floor(quantity);
    if (qty <= 0) {
      await this.cartItem.delete({ where: { id: item.id } });
      return this.getMine(userId);
    }

    const product = await this.product.findUnique({ where: { id: productId } });
    const finalQty =
      product?.trackStock && product.stock >= 0
        ? Math.min(qty, product.stock)
        : qty;

    await this.cartItem.update({
      where: { id: item.id },
      data: { quantity: finalQty },
    });
    return this.getMine(userId);
  }

  public async removeItem(userId: string, productId: string) {
    const cart = await this.getOrCreate(userId);
    await this.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    return this.getMine(userId);
  }

  public async clear(userId: string) {
    const cart = await this.getOrCreate(userId);
    await this.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getMine(userId);
  }
}
