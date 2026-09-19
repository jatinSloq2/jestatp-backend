import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Strategy } from './strategy.model';

export interface PersistedOpenPosition {
  entryIndex: number;
  entryTimestamp: number;
  entryPrice: number;
  quantity: number;
  stopLossPrice: number;
  targetPrice: number;
  trailingStopPrice: number | null;
  // The StrategyTrade row created when this position was opened — closing
  // the position UPDATES this same row (exit fields) rather than creating a
  // second one. See liveEngine.ts.
  tradeId: string;
  // Set only for executionMode='live' strategies once the entry order was
  // actually placed (see orderPlacement.service.ts); null for paper trades
  // and for live orders that were rejected (in which case the position was
  // never actually opened — see liveEngine.ts's handling of a REJECTED entry).
  entryOrderId: string | null;
}

export interface StrategyRuntimeStateAttributes {
  id: string;
  strategyId: string;
  lastProcessedBarTimestamp: number | null;
  openPosition: PersistedOpenPosition | null;
  pythonState: Record<string, unknown>;
  tradesToday: number;
  lossToday: number;
  day: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type StrategyRuntimeStateCreationAttributes = Optional<
  StrategyRuntimeStateAttributes,
  'id' | 'lastProcessedBarTimestamp' | 'openPosition' | 'pythonState' | 'tradesToday' | 'lossToday' | 'day'
>;

/**
 * One row per strategy — the live engine's entire memory of "what is this
 * strategy currently doing" between ticks (see liveEngine.ts). Deliberately
 * NOT derived by replaying strategy_trades on every tick: reading one row
 * is O(1) regardless of how long the strategy has been running.
 */
export class StrategyRuntimeState
  extends Model<StrategyRuntimeStateAttributes, StrategyRuntimeStateCreationAttributes>
  implements StrategyRuntimeStateAttributes
{
  public id!: string;
  public strategyId!: string;
  public lastProcessedBarTimestamp!: number | null;
  public openPosition!: PersistedOpenPosition | null;
  public pythonState!: Record<string, unknown>;
  public tradesToday!: number;
  public lossToday!: number;
  public day!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StrategyRuntimeState.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    strategyId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: { model: Strategy, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    lastProcessedBarTimestamp: { type: DataTypes.BIGINT, allowNull: true },
    openPosition: { type: DataTypes.JSONB, allowNull: true },
    pythonState: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    tradesToday: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lossToday: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    day: { type: DataTypes.STRING(10), allowNull: true },
  },
  {
    sequelize,
    modelName: 'StrategyRuntimeState',
    tableName: 'strategy_runtime_states',
    underscored: true,
    timestamps: true,
  },
);

Strategy.hasOne(StrategyRuntimeState, { foreignKey: 'strategyId', as: 'runtimeState' });
StrategyRuntimeState.belongsTo(Strategy, { foreignKey: 'strategyId' });
