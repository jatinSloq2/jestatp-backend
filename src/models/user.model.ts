import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type UserRole = 'user' | 'admin';
export type AuthProvider = 'local' | 'google';
export type TwoFactorMethod = 'email' | 'totp';

export interface UserAttributes {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string | null;
  authProvider: AuthProvider;
  googleId: string | null;
  avatarUrl: string | null;
  role: UserRole;
  isEmailVerified: boolean;
  isActive: boolean;
  lastLoginAt: Date | null;

  // Email verification (signup)
  emailVerificationOtpHash: string | null;
  emailVerificationOtpExpiresAt: Date | null;
  emailVerificationLastSentAt: Date | null;

  // Two-factor authentication (opt-in, user-enabled)
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  twoFactorSecretEncrypted: string | null; // TOTP secret, AES-256-GCM encrypted
  twoFactorOtpHash: string | null; // pending email-OTP challenge (login or setup confirmation)
  twoFactorOtpExpiresAt: Date | null;
  twoFactorOtpLastSentAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type UserCreationAttributes = Optional<
  UserAttributes,
  | 'id'
  | 'passwordHash'
  | 'googleId'
  | 'avatarUrl'
  | 'isEmailVerified'
  | 'isActive'
  | 'lastLoginAt'
  | 'authProvider'
  | 'role'
  | 'emailVerificationOtpHash'
  | 'emailVerificationOtpExpiresAt'
  | 'emailVerificationLastSentAt'
  | 'twoFactorEnabled'
  | 'twoFactorMethod'
  | 'twoFactorSecretEncrypted'
  | 'twoFactorOtpHash'
  | 'twoFactorOtpExpiresAt'
  | 'twoFactorOtpLastSentAt'
>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public fullName!: string;
  public email!: string;
  public passwordHash!: string | null;
  public authProvider!: AuthProvider;
  public googleId!: string | null;
  public avatarUrl!: string | null;
  public role!: UserRole;
  public isEmailVerified!: boolean;
  public isActive!: boolean;
  public lastLoginAt!: Date | null;

  public emailVerificationOtpHash!: string | null;
  public emailVerificationOtpExpiresAt!: Date | null;
  public emailVerificationLastSentAt!: Date | null;

  public twoFactorEnabled!: boolean;
  public twoFactorMethod!: TwoFactorMethod | null;
  public twoFactorSecretEncrypted!: string | null;
  public twoFactorOtpHash!: string | null;
  public twoFactorOtpExpiresAt!: Date | null;
  public twoFactorOtpLastSentAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  /** Strips sensitive fields before sending the user object to the client */
  public toSafeJSON() {
    return {
      id: this.id,
      fullName: this.fullName,
      email: this.email,
      authProvider: this.authProvider,
      avatarUrl: this.avatarUrl,
      role: this.role,
      isEmailVerified: this.isEmailVerified,
      isActive: this.isActive,
      lastLoginAt: this.lastLoginAt,
      twoFactorEnabled: this.twoFactorEnabled,
      twoFactorMethod: this.twoFactorMethod,
      createdAt: this.createdAt,
    };
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    fullName: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    authProvider: {
      type: DataTypes.ENUM('local', 'google'),
      allowNull: false,
      defaultValue: 'local',
    },
    googleId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    avatarUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      allowNull: false,
      defaultValue: 'user',
    },
    isEmailVerified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    emailVerificationOtpHash: { type: DataTypes.STRING, allowNull: true },
    emailVerificationOtpExpiresAt: { type: DataTypes.DATE, allowNull: true },
    emailVerificationLastSentAt: { type: DataTypes.DATE, allowNull: true },

    twoFactorEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    twoFactorMethod: { type: DataTypes.ENUM('email', 'totp'), allowNull: true },
    twoFactorSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
    twoFactorOtpHash: { type: DataTypes.STRING, allowNull: true },
    twoFactorOtpExpiresAt: { type: DataTypes.DATE, allowNull: true },
    twoFactorOtpLastSentAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
  },
);
