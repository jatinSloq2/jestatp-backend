import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { BrokerConnection } from './brokerConnection.model';

export interface HoldingAttributes {
  id: string;
  userId: string;
  brokerConnectionId: string;
  broker: string;
  exchange: string;
  tradingSymbol: string;
  isin: string | null;
  quantity: number;
  averagePrice: number;
  /**
   * Last price known from the *periodic broker sync* — not live. Groww and
   * Dhan's holdings endpoints don't return a price at all; Zerodha's does,
   * but it's still only as fresh as the last sync. The holdings page
   * overlays this with a real live tick from the feed service — this
   * column is purely the "last known, worst case" fallback.
   */
  lastTradedPrice: number | null;
  raw: Record<string, unknown> | null;
  syncedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type HoldingCreationAttributes = Optional<HoldingAttributes, 'id' | 'isin' | 'lastTradedPrice' | 'raw'>;

export class Holding extends Model<HoldingAttributes, HoldingCreationAttributes> implements HoldingAttributes {
  public id!: string;
  public userId!: string;
  public brokerConnectionId!: string;
  public broker!: string;
  public exchange!: string;
  public tradingSymbol!: string;
  public isin!: string | null;
  public quantity!: number;
  public averagePrice!: number;
  public lastTradedPrice!: number | null;
  public raw!: Record<string, unknown> | null;
  public syncedAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Holding.init(
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
    tradingSymbol: { type: DataTypes.STRING(60), allowNull: false },
    isin: { type: DataTypes.STRING(20), allowNull: true },
    quantity: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
    averagePrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    lastTradedPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    raw: { type: DataTypes.JSONB, allowNull: true },
    syncedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'Holding',
    tableName: 'holdings',
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['broker_connection_id'] },
      { unique: true, fields: ['broker_connection_id', 'trading_symbol'] },
    ],
  },
);

User.hasMany(Holding, { foreignKey: 'userId', as: 'holdings' });
Holding.belongsTo(User, { foreignKey: 'userId', as: 'user' });
BrokerConnection.hasMany(Holding, { foreignKey: 'brokerConnectionId', as: 'holdings' });
Holding.belongsTo(BrokerConnection, { foreignKey: 'brokerConnectionId', as: 'brokerConnection' });