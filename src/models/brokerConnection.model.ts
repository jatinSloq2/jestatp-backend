import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';

export type BrokerName = 'dhan' | 'zerodha' | 'groww';
export type BrokerConnectionStatus = 'pending' | 'connected' | 'expired' | 'revoked' | 'error';

export interface BrokerConnectionAttributes {
  id: string;
  userId: string;
  broker: BrokerName;
  clientId: string | null; // broker-side client/user code
  apiKeyEncrypted: string | null;
  apiSecretEncrypted: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: BrokerConnectionStatus;
  lastSyncedAt: Date | null;
  meta: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BrokerConnectionCreationAttributes = Optional<
  BrokerConnectionAttributes,
  | 'id'
  | 'clientId'
  | 'apiKeyEncrypted'
  | 'apiSecretEncrypted'
  | 'accessTokenEncrypted'
  | 'refreshTokenEncrypted'
  | 'tokenExpiresAt'
  | 'status'
  | 'lastSyncedAt'
  | 'meta'
>;

export class BrokerConnection
  extends Model<BrokerConnectionAttributes, BrokerConnectionCreationAttributes>
  implements BrokerConnectionAttributes
{
  public id!: string;
  public userId!: string;
  public broker!: BrokerName;
  public clientId!: string | null;
  public apiKeyEncrypted!: string | null;
  public apiSecretEncrypted!: string | null;
  public accessTokenEncrypted!: string | null;
  public refreshTokenEncrypted!: string | null;
  public tokenExpiresAt!: Date | null;
  public status!: BrokerConnectionStatus;
  public lastSyncedAt!: Date | null;
  public meta!: Record<string, unknown> | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

BrokerConnection.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
    },
    broker: {
      type: DataTypes.ENUM('dhan', 'zerodha', 'groww'),
      allowNull: false,
    },
    clientId: { type: DataTypes.STRING, allowNull: true },
    apiKeyEncrypted: { type: DataTypes.TEXT, allowNull: true },
    apiSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
    accessTokenEncrypted: { type: DataTypes.TEXT, allowNull: true },
    refreshTokenEncrypted: { type: DataTypes.TEXT, allowNull: true },
    tokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'connected', 'expired', 'revoked', 'error'),
      allowNull: false,
      defaultValue: 'pending',
    },
    lastSyncedAt: { type: DataTypes.DATE, allowNull: true },
    meta: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    modelName: 'BrokerConnection',
    tableName: 'broker_connections',
    timestamps: true,
    indexes: [{ unique: true, fields: ['user_id', 'broker'] }],
  },
);

User.hasMany(BrokerConnection, { foreignKey: 'userId', as: 'brokerConnections' });
BrokerConnection.belongsTo(User, { foreignKey: 'userId', as: 'user' });
