import { Connection } from "../db/dbConnection";
import { Profile, Signup } from "../models/user";
import { getPasswordHash } from "../utils/helper";

export class UserRepository extends Connection {
  public async getByEmail(email: string) {
    const user = await this.user.findUnique({
      where: { email },
    });
    return user;
  }

  public async getByID(id: string) {
    const user = await this.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
      },
    });
    return user;
  }

  public async checkExistingUser(email: string) {
    const existingUser = await this.user.findUnique({
      where: { email },
      select: { email: true },
    });

    return !!existingUser;
  }

  public async createUser(data: Signup) {
    const hashedPassword = await getPasswordHash(data.password);
    const newUser = await this.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
      },
    });

    return newUser;
  }

  public async createProfile(userId: string, data: Profile) {
    const existing = await this.profile.findUnique({
      where: { userId },
    });

    const profileData: any = {};
    if (data.firstName !== undefined) profileData.firstName = data.firstName;
    if (data.lastName !== undefined) profileData.lastName = data.lastName;
    if (data.phone !== undefined) profileData.phone = data.phone;
    if (data.avatar !== undefined) profileData.avatar = data.avatar;
    if (data.location !== undefined) profileData.location = data.location;

    const include = {
      user: {
        select: { id: true, email: true, role: true, status: true },
      },
    };

    if (existing) {
      const updated = await this.profile.update({
        where: { id: existing.id },
        data: profileData,
        include,
      });
      return updated;
    }

    const created = await this.profile.create({
      data: {
        ...profileData,
        user: { connect: { id: userId } },
      },
      include,
    });

    return created;
  }

  public async getProfile(id: string) {
    const profile = await this.profile.findUnique({
      where: { userId: id },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });
    return profile;
  }

  public async deleteUser(id: string) {
    return await this.user.delete({
      where: { id },
    });
  }

  public async deleteProfile(id: string) {
    return await this.profile.delete({
      where: { id },
    });
  }
}
