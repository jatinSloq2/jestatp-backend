import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { BrokerConnection } from './brokerConnection.model';

export type PositionSegment = 'equity' | 'fno' | 'currency' | 'commodity';

export interface PositionAttributes {
  id: string;
  userId: string;
  brokerConnectionId: string;
  broker: string;
  exchange: string;
  segment: PositionSegment;
  tradingSymbol: string;
  productType: string;
  quantity: number;
  averagePrice: number;
  lastTradedPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  raw: Record<string, unknown> | null;
  syncedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PositionCreationAttributes = Optional<
  PositionAttributes,
  'id' | 'lastTradedPrice' | 'realizedPnl' | 'unrealizedPnl' | 'raw'
>;

export class Position extends Model<PositionAttributes, PositionCreationAttributes> implements PositionAttributes {
  public id!: string;
  public userId!: string;
  public brokerConnectionId!: string;
  public broker!: string;
  public exchange!: string;
  public segment!: PositionSegment;
  public tradingSymbol!: string;
  public productType!: string;
  public quantity!: number;
  public averagePrice!: number;
  public lastTradedPrice!: number | null;
  public realizedPnl!: number;
  public unrealizedPnl!: number;
  public raw!: Record<string, unknown> | null;
  public syncedAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Position.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    brokerConnectionId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: BrokerConnection, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    broker: { type: DataTypes.STRING(20), allowNull: false },
    exchange: { type: DataTypes.STRING(10), allowNull: false },
    segment: {
      type: DataTypes.ENUM('equity', 'fno', 'currency', 'commodity'),
      allowNull: false,
      defaultValue: 'equity',
    },
    tradingSymbol: { type: DataTypes.STRING(60), allowNull: false },
    productType: { type: DataTypes.STRING(10), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    averagePrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    lastTradedPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    realizedPnl: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    unrealizedPnl: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    raw: { type: DataTypes.JSONB, allowNull: true },
    syncedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'Position',
    tableName: 'positions',
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['broker_connection_id'] },
      { unique: true, fields: ['broker_connection_id', 'trading_symbol', 'product_type'] },
    ],
  },
);

User.hasMany(Position, { foreignKey: 'userId', as: 'positions' });
Position.belongsTo(User, { foreignKey: 'userId', as: 'user' });
BrokerConnection.hasMany(Position, { foreignKey: 'brokerConnectionId', as: 'positions' });
Position.belongsTo(BrokerConnection, { foreignKey: 'brokerConnectionId', as: 'brokerConnection' });
