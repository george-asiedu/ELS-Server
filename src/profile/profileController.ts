import { Request, Response } from "express";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { ProfileService } from "./profileService";
import { validateEmail, validatePassword, validateProfile } from "./validator/profile";
import { assertValid } from "../utils/validation";

const s3 = new S3BucketService();
const profileService = new ProfileService()

export class ProfileController {
  public static create = async (
    req: Request,
    res: Response,
  ) => {
    const userId = req.params.userId;
    if (!userId) {
      throw new ApiError('User ID is required', 400);
    }
    if (req.user?.role !== "ADMIN" && req.user?.id !== userId) {
      throw new ApiError("You can only update your own profile", 403);
    }
    
    assertValid(validateProfile, req.body);
    if (req.body.avatar) req.body.avatar = s3.assertOwnedMediaUrl(String(req.body.avatar), "profiles");
    const result = await profileService.createOrUpdateProfile(req.body, userId);
    return res.status(200).json(result);
  };
  
  public static upsertMyProfile = async (
    req: Request,
    res: Response,
  ) => {
    if (!req.user) {
      throw new ApiError('Authentication required', 401);
    }

    assertValid(validateProfile, req.body);
    if (req.body.avatar) req.body.avatar = s3.assertOwnedMediaUrl(String(req.body.avatar), "profiles");
    const result = await profileService.createOrUpdateProfile(
      req.body,
      req.user.id,
    );
    return res.status(200).json(result);
  };

  public static handleChangeMyPassword = async (
    req: Request,
    res: Response,
  ) => {
    if (!req.user) {
      throw new ApiError('Authentication required', 401);
    }

    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new ApiError('Your current password is required', 400);
    }

    assertValid(validatePassword, { password: newPassword });

    const result = await profileService.changeOwnPassword(
      req.user.id,
      currentPassword,
      newPassword,
    );
    return res.status(200).json(result);
  };

  public static handleGetProfile = async (
    req: Request,
    res: Response,
  ) => {
    const userId = req.params.userId
    if (!userId) {
      throw new ApiError('User ID is required', 400);
    }
    if (req.user?.role !== "ADMIN" && req.user?.id !== userId) {
      throw new ApiError("You can only view your own profile", 403);
    }

    const result = await profileService.getUserProfile(userId);
    if (result.data.avatar) result.data.avatar = s3.deliveryUrl(result.data.avatar);
    return res.status(200).json(result);
  };

  public static handleGetMyProfile = async (
    req: Request,
    res: Response,
  ) => {
    if (!req.user) {
      throw new ApiError('Authentication required', 401);
    }

    const result = await profileService.getUserProfile(req.user.id);
    if (result.data.avatar) result.data.avatar = s3.deliveryUrl(result.data.avatar);
    return res.status(200).json(result);
  };
  
  public static handleDeleteProfile = async (
    req: Request,
    res: Response,
  ) => {
    const userId = req.params.userId;
    if (!userId) {
      throw new ApiError('User ID is required', 400);
    }
     
    const result = await profileService.removeProfile(userId);
    return res.status(200).json(result);
  };
  
  public static handleDeleteUser = async (
    req: Request,
    res: Response,
  ) => {
    const id = req.params.id;
    if (!id) {
      throw new ApiError('User ID is required', 400);
    }
     
    const result = await profileService.removeUser(id);
    return res.status(200).json(result);
  };  
  
  public static handleUpdateEmail = async (
    req: Request,
    res: Response,
  ) => {
    const id = req.params.id;
    if (!id) {
      throw new ApiError('User ID is required', 400);
    }
    assertValid(validateEmail, req.body);
     
    const result = await profileService.updateUserEmail(id, req.body.email);
    return res.status(200).json(result);
  }; 
 
 public static handleUpdatePassword = async (
    req: Request,
    res: Response,
  ) => {
    const id = req.params.id;
    if (!id) {
      throw new ApiError('User ID is required', 400);
    }
     
    assertValid(validatePassword, req.body);
    
    const result = await profileService.changePassword(id, req.body.password);
    return res.status(200).json(result);
  }; 
}
