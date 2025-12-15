import { Login, Signup } from "../models/user";
import { UserRepository } from "./userRepository";
import {
  loginToken,
  verifyPassword,
} from "../utils/helper";
import { ApiError } from "../middleware/apiError";

export class AuthService extends UserRepository {
  public async signup(data: Signup) {
    const existingUser = await this.checkExistingUser(data.email);
    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    await this.createUser(data);

    return { message: "User created successfully" };
  }

  public async login(data: Login) {
    const user = await this.getByEmail(data.email);
    if (!user) {
      throw new ApiError("Invalid email or password", 400);
    }

    const isPasswordValid = await verifyPassword(data.password, user.password);
    if (!isPasswordValid) {
      throw new ApiError("Invalid email or password", 400);
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    const token = loginToken(payload);

    return {
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        token,
      },
    };
  }
}
