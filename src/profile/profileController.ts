import { Request, Response, NextFunction } from "express";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { errorMessage } from "../utils/helper";
import { ProfileService } from "./profileService";
import { validateEmail, validatePassword, validateProfile } from "./validator/profile";

const s3 = new S3BucketService();
const profileService = new ProfileService(s3)

export class ProfileController {
  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.params.userId;
      if (!userId) {
        throw new ApiError('User ID is required', 400);
      }
      
      const isValid = validateProfile(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateProfile.errors),
          errors: validateProfile.errors,
        });
      }
      const image = req.file;
      const result = await profileService.createOrUpdateProfile(req.body, userId, image);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
  
  public static upsertMyProfile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) {
        throw new ApiError('Authentication required', 401);
      }

      const isValid = validateProfile(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateProfile.errors),
          errors: validateProfile.errors,
        });
      }
      const image = req.file;
      const result = await profileService.createOrUpdateProfile(
        req.body,
        req.user.id,
        image,
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static handleChangeMyPassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        throw new ApiError('Authentication required', 401);
      }

      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || typeof currentPassword !== 'string') {
        throw new ApiError('Your current password is required', 400);
      }

      const isValid = validatePassword({ password: newPassword });
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validatePassword.errors),
          errors: validatePassword.errors,
        });
      }

      const result = await profileService.changeOwnPassword(
        req.user.id,
        currentPassword,
        newPassword,
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static handleGetProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.userId
      if (!userId) {
        throw new ApiError('User ID is required', 400);
      }

      const result = await profileService.getUserProfile(userId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static handleGetMyProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      if (!req.user) {
        throw new ApiError('Authentication required', 401);
      }

      const result = await profileService.getUserProfile(req.user.id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
  
  public static handleDeleteProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.params.userId;
      if (!userId) {
        throw new ApiError('User ID is required', 400);
      }
       
      const result = await profileService.removeProfile(userId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
  
  public static handleDeleteUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const id = req.params.id;
      if (!id) {
        throw new ApiError('User ID is required', 400);
      }
       
      const result = await profileService.removeUser(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };  
  
  public static handleUpdateEmail = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const id = req.params.id;
      if (!id) {
        throw new ApiError('User ID is required', 400);
      }
      const isValid = validateEmail(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateEmail.errors),
          errors: validateEmail.errors,
        });
      }
       
      const result = await profileService.updateUserEmail(id, req.body.email);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }; 
 
 public static handleUpdatePassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const id = req.params.id;
      if (!id) {
        throw new ApiError('User ID is required', 400);
      }
       
      const isValid = validatePassword(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validatePassword.errors),
          errors: validatePassword.errors,
        });
      }
      
      const result = await profileService.changePassword(id, req.body.password);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }; 
}