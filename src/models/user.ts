import "multer";

export interface Signup {
  email: string;
  password: string;
}

export interface Login {
  email: string;
  password: string;
}

export enum AuthToken {
  ACCESS_TOKEN = "ACCESS_TOKEN",
  REFRESH_TOKEN = "REFRESH_TOKEN",
}

export interface Payload {
  id: string;
  email: string;
  role: string;
}

export interface JwtTokenPayload {
  sub: string;
  token: AuthToken;
  exp: number;
}

export interface Profile {
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatar?: string;
  location?: string;
}

export type UploadedFile = Express.Multer.File;