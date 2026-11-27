import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import { stockFor, usesOptionStock } from "../product/pricing";

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
          sizes: true,
          colors: true,
          unit: true,
          variants: true,
          availableFrom: true,
          minQuantity: true,
          bulkTiers: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

export class CartService extends Connection {
  private s3 = new S3BucketService();
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
    cart?.items.forEach((item) => {
      item.product.imageUrl = this.s3.deliveryUrl(item.product.imageUrl);
    });
    return { message: "Cart retrieved successfully", data: cart };
  }

  /** Options must be ones the product offers, and required if it offers any. */
  private assertOptions(
    product: { sizes: string[]; colors: string[] },
    size: string,
    color: string,
  ) {
    if (product.sizes.length && !product.sizes.includes(size)) {
      throw new ApiError("Please choose a size", 400);
    }
    if (!product.sizes.length && size) throw new ApiError("Invalid size", 400);
    const names = product.colors.map((c) => c.split("|")[0]);
    if (names.length && !names.includes(color)) {
      throw new ApiError("Please choose a colour", 400);
    }
    if (!names.length && color) throw new ApiError("Invalid colour", 400);
  }

  // Stock is shared by a product's options, so other options of it in the cart
  // count too, unless each option has its own stock: then only that option's.
  private async otherLinesQty(
    cartId: string,
    productId: string,
    lineId?: string,
    sameOption?: string,
  ) {
    const lines = await this.cartItem.findMany({
      where: {
        cartId,
        productId,
        ...(lineId ? { id: { not: lineId } } : {}),
        ...(sameOption !== undefined ? { size: sameOption } : {}),
      },
      select: { quantity: true },
    });
    return lines.reduce((n, l) => n + l.quantity, 0);
  }

  public async addItem(
    userId: string,
    productId: string,
    quantity: number,
    size = "",
    color = "",
  ) {
    const qty = Math.max(1, Math.floor(quantity || 1));
    const product = await this.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) {
      throw new ApiError("Product is not available", 404);
    }
    this.assertOptions(product, size, color);
    const room = stockFor(product, size);
    if (product.trackStock && room <= 0) {
      throw new ApiError(
        usesOptionStock(product)
          ? `"${size}" is out of stock`
          : "Product is out of stock",
        400,
      );
    }

    const cart = await this.getOrCreate(userId);
    const existingItem = await this.cartItem.findFirst({
      where: { cartId: cart.id, productId, size, color },
    });
    const others = await this.otherLinesQty(
      cart.id,
      productId,
      existingItem?.id,
      usesOptionStock(product) ? size : undefined,
    );
    const desired = (existingItem?.quantity ?? 0) + qty;
    const finalQty = product.trackStock
      ? Math.min(desired, room - others)
      : desired;
    if (finalQty <= 0) {
      throw new ApiError("You already have all our stock in your bag", 400);
    }

    if (existingItem) {
      await this.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: finalQty },
      });
    } else {
      await this.cartItem.create({
        data: { cartId: cart.id, productId, quantity: finalQty, size, color },
      });
    }
    return this.getMine(userId);
  }

  public async updateItem(
    userId: string,
    productId: string,
    quantity: number,
    size = "",
    color = "",
  ) {
    const cart = await this.getOrCreate(userId);
    const item = await this.cartItem.findFirst({
      where: { cartId: cart.id, productId, size, color },
    });
    if (!item) throw new ApiError("Item not in cart", 404);

    const qty = Math.floor(quantity);
    if (qty <= 0) {
      await this.cartItem.delete({ where: { id: item.id } });
      return this.getMine(userId);
    }

    const product = await this.product.findUnique({ where: { id: productId } });
    const others = await this.otherLinesQty(
      cart.id,
      productId,
      item.id,
      product && usesOptionStock(product) ? size : undefined,
    );
    const finalQty = product?.trackStock
      ? Math.max(1, Math.min(qty, stockFor(product, size) - others))
      : qty;

    await this.cartItem.update({
      where: { id: item.id },
      data: { quantity: finalQty },
    });
    return this.getMine(userId);
  }

  public async removeItem(
    userId: string,
    productId: string,
    size = "",
    color = "",
  ) {
    const cart = await this.getOrCreate(userId);
    await this.cartItem.deleteMany({
      where: { cartId: cart.id, productId, size, color },
    });
    return this.getMine(userId);
  }

  public async clear(userId: string) {
    const cart = await this.getOrCreate(userId);
    await this.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.getMine(userId);
  }
}
