import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { Strategy } from './strategy.model';
import { User } from './user.model';
import { EntryBlock, ExitBlock, RiskConfig } from '../modules/strategies/dsl/types';

export interface StrategyVersionAttributes {
  id: string;
  strategyId: string;
  version: number;
  name: string;
  entryConditions: EntryBlock;
  exitConditions: ExitBlock;
  riskConfig: RiskConfig;
  changeNote: string | null;
  createdBy: string | null;
  createdAt?: Date;
}

export type StrategyVersionCreationAttributes = Optional<StrategyVersionAttributes, 'id' | 'changeNote' | 'createdBy'>;

export class StrategyVersion
  extends Model<StrategyVersionAttributes, StrategyVersionCreationAttributes>
  implements StrategyVersionAttributes
{
  public id!: string;
  public strategyId!: string;
  public version!: number;
  public name!: string;
  public entryConditions!: EntryBlock;
  public exitConditions!: ExitBlock;
  public riskConfig!: RiskConfig;
  public changeNote!: string | null;
  public createdBy!: string | null;
  public readonly createdAt!: Date;
}

StrategyVersion.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    strategyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Strategy, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    version: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING(150), allowNull: false },
    entryConditions: { type: DataTypes.JSONB, allowNull: false },
    exitConditions: { type: DataTypes.JSONB, allowNull: false },
    riskConfig: { type: DataTypes.JSONB, allowNull: false },
    changeNote: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: User, key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
  },
  {
    sequelize,
    modelName: 'StrategyVersion',
    tableName: 'strategy_versions',
    timestamps: true,
    updatedAt: false, // versions are immutable snapshots
    indexes: [{ unique: true, fields: ['strategy_id', 'version'] }],
  },
);

Strategy.hasMany(StrategyVersion, { foreignKey: 'strategyId', as: 'versions' });
StrategyVersion.belongsTo(Strategy, { foreignKey: 'strategyId', as: 'strategy' });
