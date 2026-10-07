import { Request, Response } from "express";
import { ContactService } from "./contactService";

const contactService = new ContactService();

export class ContactController {
  public static get = async (_req: Request, res: Response) => {
    const result = await contactService.get();
    return res.status(200).json(result);
  };

  public static update = async (req: Request, res: Response) => {
    const result = await contactService.update(req.body);
    return res.status(200).json(result);
  };
}
