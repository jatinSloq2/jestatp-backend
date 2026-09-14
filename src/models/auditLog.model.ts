import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';

export interface AuditLogAttributes {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt?: Date;
}

export type AuditLogCreationAttributes = Optional<
  AuditLogAttributes,
  'id' | 'userId' | 'entityType' | 'entityId' | 'ipAddress' | 'userAgent' | 'metadata'
>;

export class AuditLog extends Model<AuditLogAttributes, AuditLogCreationAttributes> implements AuditLogAttributes {
  public id!: string;
  public userId!: string | null;
  public action!: string;
  public entityType!: string | null;
  public entityId!: string | null;
  public ipAddress!: string | null;
  public userAgent!: string | null;
  public metadata!: Record<string, unknown> | null;
  public readonly createdAt!: Date;
}

AuditLog.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: User, key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    action: { type: DataTypes.STRING(100), allowNull: false },
    entityType: { type: DataTypes.STRING(50), allowNull: true },
    entityId: { type: DataTypes.STRING(100), allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    modelName: 'AuditLog',
    tableName: 'audit_logs',
    timestamps: true,
    updatedAt: false,
  },
);
