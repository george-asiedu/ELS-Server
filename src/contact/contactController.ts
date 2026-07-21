import { Request, Response, NextFunction } from "express";
import { ContactService } from "./contactService";

const contactService = new ContactService();

export class ContactController {
  public static get = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await contactService.get();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await contactService.update(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
