import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';

export interface RefreshTokenAttributes {
  id: string;
  userId: string;
  tokenHash: string; // SHA-256 hash of the refresh JWT — the raw token is never stored
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null; // set on rotation, for replay-detection
  createdAt?: Date;
  updatedAt?: Date;
}

export type RefreshTokenCreationAttributes = Optional<
  RefreshTokenAttributes,
  'id' | 'userAgent' | 'ipAddress' | 'revokedAt' | 'replacedByTokenHash'
>;

export class RefreshToken
  extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes>
  implements RefreshTokenAttributes
{
  public id!: string;
  public userId!: string;
  public tokenHash!: string;
  public userAgent!: string | null;
  public ipAddress!: string | null;
  public expiresAt!: Date;
  public revokedAt!: Date | null;
  public replacedByTokenHash!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  public get isActive(): boolean {
    return !this.revokedAt && this.expiresAt > new Date();
  }
}

RefreshToken.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    tokenHash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    replacedByTokenHash: { type: DataTypes.STRING(128), allowNull: true },
  },
  {
    sequelize,
    modelName: 'RefreshToken',
    tableName: 'refresh_tokens',
    timestamps: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['expires_at'] }],
  },
);

User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens' });
RefreshToken.belongsTo(User, { foreignKey: 'userId', as: 'user' });
