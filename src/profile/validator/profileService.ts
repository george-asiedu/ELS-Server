import { UserRepository } from "../../auth/userRepository";
import { ApiError } from "../../middleware/apiError";
import { Profile } from "../../models/user";

export class ProfileService extends UserRepository {
  public async createOrUpdateProfile(data: Profile, userId: string) {
    if(!userId) {
      throw new ApiError("User ID is required", 400);
    }
    
    try {
      const profile = await this.createProfile(userId, data);
          
      if (!profile) {
        throw new ApiError("Failed to process profile", 500);
      }
    
      return {
        message: "Profile processed successfully",
        data: profile,
      };
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new ApiError("User not found", 404);
      }
      throw error;
    }    
  }
  
  public async getUserProfile(userId: string) {
    const profile = await this.getProfile(userId);
  
    if (!profile) {
      throw new ApiError("Profile not found", 404);
    }
  
    return {
      message: "Profile retrieved successfully",
      data: profile,
    };
  }
  
  public async removeProfile(userId: string) {
    const profile = await this.getProfile(userId);
      
    if (!profile) {
      throw new ApiError("Profile not found", 404);
    }
  
    await this.deleteProfile(profile.id);
  
    return {
      message: "Profile deleted successfully",
    };
  }
  
  public async removeUser(id: string) {
    const user = await this.getByID(id);
      
    if (!user) {
      throw new ApiError("User not found", 404);
    }
  
    await this.deleteUser(user.id);
  
    return {
      message: "Profile deleted successfully",
    };
  }
  
  public async updateUserEmail(id: string, email: string) {
    const existingUser = await this.getByID(id);
    if (!existingUser) {
      throw new ApiError("User not found", 404);
    }
  
    await this.updateEmail(id, email);
    return { message: "Email updated successfully" };
  }
  
  public async changePassword(id: string, password: string) {
    const existingUser = await this.getByID(id);
    if (!existingUser) {
      throw new ApiError("User not found", 404);
    }
  
    await this.updatePassword(id, password);
  
    return { message: "Password updated successfully" };
  }
}