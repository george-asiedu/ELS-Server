import { ErrorObject } from "ajv";
import * as bcrypt from "bcrypt";
import jwt, { SignOptions } from "jsonwebtoken";
import { randomBytes } from "crypto";
import { Payload, AuthToken } from "../models/user";
import { env } from "../config/env.config";

// Short, shareable referral code — random uppercase alphanumeric (default 6 chars).
export const generateReferralCode = (length = 6): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
};

export const getPasswordHash = async (password: string) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

export const verifyPassword = async (
  password: string,
  hashed: string,
): Promise<boolean> => {
  return await bcrypt.compare(password, hashed);
};

export const generateCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export type ValidatorError =
  | ErrorObject<string, Record<string, any>, unknown>
  | { instancePath: string; message: string };

// Helper function to safely extract ajv error message
export const errorMessage = (errors: ValidatorError[] | null | undefined) => {
  return errors
    ?.map((e) => {
      if (e.instancePath === "") {
        return e.message;
      }
      return e.instancePath.replace("/", "") + " : " + e.message;
    })
    .join(", ");
};

//global type-safe request handler
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email: string;
        role: string;
      };
      rawBody?: Buffer;
    }
  }
}

export const loginToken = (user: Payload) => {
  const secret = env.JWT_SECRET;
  const accessDuration = env.JWT_EXPIRATION;
  const refreshDuration = env.JWT_REFRESH_EXPIRES;

  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      token: AuthToken.ACCESS_TOKEN,
    },
    secret,
    { expiresIn: accessDuration } as SignOptions,
  );

  const refreshToken = jwt.sign(
    {
      sub: user.id,
      token: AuthToken.REFRESH_TOKEN,
    },
    secret,
    { expiresIn: refreshDuration } as SignOptions,
  );

  return { accessToken, refreshToken };
};

export const generateToken = (user: Payload) => {
  const secret = env.JWT_SECRET;
  const tokenDuration = "30m";

  return jwt.sign(
    {
      sub: user.email,
    },
    secret,
    { expiresIn: tokenDuration } as SignOptions,
  );
};
