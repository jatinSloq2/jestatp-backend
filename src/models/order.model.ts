import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { BrokerConnection } from './brokerConnection.model';
import { Strategy } from './strategy.model';

export type OrderSegment = 'equity' | 'fno' | 'currency' | 'commodity';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
export type ProductType = 'CNC' | 'MIS' | 'NRML';
export type OrderStatus =
  | 'CREATED'
  | 'VALIDATED'
  | 'SUBMITTED'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'REJECTED';

export interface OrderAttributes {
  id: string;
  userId: string;
  brokerConnectionId: string;
  broker: string;
  brokerOrderId: string | null;
  // Set only when this order was placed automatically by a strategy's live
  // execution (see orderPlacement.service.ts); null for manual orders.
  // ON DELETE SET NULL — losing the strategy link must never delete real
  // order history.
  strategyId: string | null;
  exchange: string;
  segment: OrderSegment;
  tradingSymbol: string;
  instrumentToken: string | null;
  side: OrderSide;
  orderType: OrderType;
  productType: ProductType;
  quantity: number;
  filledQuantity: number;
  price: number | null;
  triggerPrice: number | null;
  averagePrice: number | null;
  status: OrderStatus;
  statusMessage: string | null;
  placedAt: Date | null;
  raw: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderCreationAttributes = Optional<
  OrderAttributes,
  | 'id'
  | 'brokerOrderId'
  | 'strategyId'
  | 'instrumentToken'
  | 'filledQuantity'
  | 'price'
  | 'triggerPrice'
  | 'averagePrice'
  | 'status'
  | 'statusMessage'
  | 'placedAt'
  | 'raw'
>;

export class Order extends Model<OrderAttributes, OrderCreationAttributes> implements OrderAttributes {
  public id!: string;
  public userId!: string;
  public brokerConnectionId!: string;
  public broker!: string;
  public brokerOrderId!: string | null;
  public strategyId!: string | null;
  public exchange!: string;
  public segment!: OrderSegment;
  public tradingSymbol!: string;
  public instrumentToken!: string | null;
  public side!: OrderSide;
  public orderType!: OrderType;
  public productType!: ProductType;
  public quantity!: number;
  public filledQuantity!: number;
  public price!: number | null;
  public triggerPrice!: number | null;
  public averagePrice!: number | null;
  public status!: OrderStatus;
  public statusMessage!: string | null;
  public placedAt!: Date | null;
  public raw!: Record<string, unknown> | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Order.init(
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
    // unique (nullable-safe — Postgres allows multiple NULL rows in a
    // unique index) so Order.upsert() in brokerSync.service.ts can actually
    // target this column in its ON CONFLICT clause instead of blindly
    // inserting a duplicate row every sync cycle. See migration
    // 20260101000016 for why this matters now that orderPlacement.service.ts
    // creates rows here before the broker sync job ever sees them.
    brokerOrderId: { type: DataTypes.STRING, allowNull: true, unique: true },
    strategyId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: Strategy, key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    exchange: { type: DataTypes.STRING(10), allowNull: false },
    segment: {
      type: DataTypes.ENUM('equity', 'fno', 'currency', 'commodity'),
      allowNull: false,
      defaultValue: 'equity',
    },
    tradingSymbol: { type: DataTypes.STRING(60), allowNull: false },
    instrumentToken: { type: DataTypes.STRING, allowNull: true },
    side: { type: DataTypes.ENUM('BUY', 'SELL'), allowNull: false },
    orderType: { type: DataTypes.ENUM('MARKET', 'LIMIT', 'SL', 'SL-M'), allowNull: false },
    productType: { type: DataTypes.ENUM('CNC', 'MIS', 'NRML'), allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    filledQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    price: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    triggerPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    averagePrice: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    status: {
      type: DataTypes.ENUM(
        'CREATED',
        'VALIDATED',
        'SUBMITTED',
        'OPEN',
        'PARTIALLY_FILLED',
        'FILLED',
        'CANCEL_REQUESTED',
        'CANCELLED',
        'REJECTED',
      ),
      allowNull: false,
      defaultValue: 'CREATED',
    },
    statusMessage: { type: DataTypes.STRING, allowNull: true },
    placedAt: { type: DataTypes.DATE, allowNull: true },
    raw: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Order',
    tableName: 'orders',
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['broker_connection_id'] },
      { fields: ['segment'] },
      { fields: ['status'] },
    ],
  },
);

User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'userId', as: 'user' });
BrokerConnection.hasMany(Order, { foreignKey: 'brokerConnectionId', as: 'orders' });
Order.belongsTo(BrokerConnection, { foreignKey: 'brokerConnectionId', as: 'brokerConnection' });
Strategy.hasMany(Order, { foreignKey: 'strategyId', as: 'orders' });
Order.belongsTo(Strategy, { foreignKey: 'strategyId' });
