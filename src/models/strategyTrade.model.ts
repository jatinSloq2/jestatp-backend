import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Strategy } from './strategy.model';
import { User } from './user.model';
import { Order } from './order.model';
import { BacktestTrade } from '../modules/strategies/backtest/backtestEngine';

export type StrategyTradeMode = 'paper' | 'live';

export interface StrategyTradeAttributes {
  id: string;
  strategyId: string;
  userId: string;
  mode: StrategyTradeMode;
  entryTimestamp: number;
  entryPrice: number;
  exitTimestamp: number | null;
  exitPrice: number | null;
  quantity: number;
  exitReason: BacktestTrade['exitReason'] | null;
  pnl: number | null;
  entryOrderId: string | null;
  exitOrderId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type StrategyTradeCreationAttributes = Optional<
  StrategyTradeAttributes,
  'id' | 'exitTimestamp' | 'exitPrice' | 'exitReason' | 'pnl' | 'entryOrderId' | 'exitOrderId'
>;

/**
 * The permanent record of what a strategy actually did — one row per
 * entry, updated in place with exit details when the position closes (so a
 * still-open trade shows up as a row with null exit fields, not "no row
 * yet"). This is the source of truth for the strategy's live/paper P&L and
 * trade history UI; `StrategyRuntimeState` is just the engine's scratch
 * memory for deciding what to do *next*.
 */
export class StrategyTrade extends Model<StrategyTradeAttributes, StrategyTradeCreationAttributes> implements StrategyTradeAttributes {
  public id!: string;
  public strategyId!: string;
  public userId!: string;
  public mode!: StrategyTradeMode;
  public entryTimestamp!: number;
  public entryPrice!: number;
  public exitTimestamp!: number | null;
  public exitPrice!: number | null;
  public quantity!: number;
  public exitReason!: BacktestTrade['exitReason'] | null;
  public pnl!: number | null;
  public entryOrderId!: string | null;
  public exitOrderId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StrategyTrade.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    strategyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Strategy, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' }, onDelete: 'CASCADE' },
    mode: { type: DataTypes.ENUM('paper', 'live'), allowNull: false },
    entryTimestamp: { type: DataTypes.BIGINT, allowNull: false },
    entryPrice: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
    exitTimestamp: { type: DataTypes.BIGINT, allowNull: true },
    exitPrice: { type: DataTypes.DECIMAL(14, 4), allowNull: true },
    quantity: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
    exitReason: { type: DataTypes.STRING(30), allowNull: true },
    pnl: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    entryOrderId: { type: DataTypes.UUID, allowNull: true, references: { model: Order, key: 'id' } },
    exitOrderId: { type: DataTypes.UUID, allowNull: true, references: { model: Order, key: 'id' } },
  },
  {
    sequelize,
    modelName: 'StrategyTrade',
    tableName: 'strategy_trades',
    underscored: true,
    timestamps: true,
  },
);

Strategy.hasMany(StrategyTrade, { foreignKey: 'strategyId', as: 'trades' });
StrategyTrade.belongsTo(Strategy, { foreignKey: 'strategyId' });
