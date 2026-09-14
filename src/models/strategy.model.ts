import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { EntryBlock, ExitBlock, RiskConfig } from '../modules/strategies/dsl/types';
import { ExecutionMode, StrategyStatus, Timeframe } from '../modules/strategies/dsl/constants';

export type { StrategyStatus, ExecutionMode };

export interface StrategyAttributes {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  instrument: string;
  exchange: string;
  segment: 'equity' | 'fno' | 'currency' | 'commodity';
  timeframe: Timeframe;
  status: StrategyStatus;
  executionMode: ExecutionMode;
  currentVersion: number;
  entryConditions: EntryBlock;
  exitConditions: ExitBlock;
  riskConfig: RiskConfig;
  lastValidatedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export type StrategyCreationAttributes = Optional<
  StrategyAttributes,
  'id' | 'description' | 'status' | 'executionMode' | 'currentVersion' | 'lastValidatedAt' | 'segment'
>;

export class Strategy extends Model<StrategyAttributes, StrategyCreationAttributes> implements StrategyAttributes {
  public id!: string;
  public userId!: string;
  public name!: string;
  public description!: string | null;
  public instrument!: string;
  public exchange!: string;
  public segment!: 'equity' | 'fno' | 'currency' | 'commodity';
  public timeframe!: Timeframe;
  public status!: StrategyStatus;
  public executionMode!: ExecutionMode;
  public currentVersion!: number;
  public entryConditions!: EntryBlock;
  public exitConditions!: ExitBlock;
  public riskConfig!: RiskConfig;
  public lastValidatedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date | null;

  /** Reassembles the canonical "Strategy JSON" the doc's pipeline (Builder -> JSON -> Validator -> Engine) operates on. */
  public toStrategyDefinition() {
    return {
      instrument: this.instrument,
      exchange: this.exchange,
      timeframe: this.timeframe,
      entry: this.entryConditions,
      exit: this.exitConditions,
      risk: this.riskConfig,
    };
  }
}

Strategy.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    instrument: { type: DataTypes.STRING(60), allowNull: false },
    exchange: { type: DataTypes.STRING(10), allowNull: false },
    segment: {
      type: DataTypes.ENUM('equity', 'fno', 'currency', 'commodity'),
      allowNull: false,
      defaultValue: 'equity',
    },
    timeframe: {
      type: DataTypes.ENUM('1m', '3m', '5m', '15m', '30m', '1h', '1d'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('draft', 'active', 'paused', 'archived'),
      allowNull: false,
      defaultValue: 'draft',
    },
    executionMode: {
      type: DataTypes.ENUM('paper', 'live'),
      allowNull: false,
      defaultValue: 'paper',
    },
    currentVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    entryConditions: { type: DataTypes.JSONB, allowNull: false },
    exitConditions: { type: DataTypes.JSONB, allowNull: false },
    riskConfig: { type: DataTypes.JSONB, allowNull: false },
    lastValidatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Strategy',
    tableName: 'strategies',
    timestamps: true,
    paranoid: true, // soft delete via deleted_at — archived strategies (and their version history) are never hard-deleted
    indexes: [{ fields: ['user_id'] }, { fields: ['status'] }, { fields: ['user_id', 'status'] }],
  },
);

User.hasMany(Strategy, { foreignKey: 'userId', as: 'strategies' });
Strategy.belongsTo(User, { foreignKey: 'userId', as: 'user' });
