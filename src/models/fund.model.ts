import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { BrokerConnection } from './brokerConnection.model';

export interface FundAttributes {
  id: string;
  userId: string;
  brokerConnectionId: string;
  broker: string;
  availableBalance: number;
  usedMargin: number;
  totalBalance: number;
  collateral: number;
  raw: Record<string, unknown> | null;
  syncedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export type FundCreationAttributes = Optional<
  FundAttributes,
  'id' | 'usedMargin' | 'totalBalance' | 'collateral' | 'raw'
>;

export class Fund extends Model<FundAttributes, FundCreationAttributes> implements FundAttributes {
  public id!: string;
  public userId!: string;
  public brokerConnectionId!: string;
  public broker!: string;
  public availableBalance!: number;
  public usedMargin!: number;
  public totalBalance!: number;
  public collateral!: number;
  public raw!: Record<string, unknown> | null;
  public syncedAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Fund.init(
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
      unique: true,
      references: { model: BrokerConnection, key: 'id' },
    },
    broker: { type: DataTypes.STRING(20), allowNull: false },
    availableBalance: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    usedMargin: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    totalBalance: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    collateral: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    raw: { type: DataTypes.JSONB, allowNull: true },
    syncedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: 'Fund',
    tableName: 'funds',
    timestamps: true,
  },
);

User.hasMany(Fund, { foreignKey: 'userId', as: 'funds' });
Fund.belongsTo(User, { foreignKey: 'userId', as: 'user' });
BrokerConnection.hasOne(Fund, { foreignKey: 'brokerConnectionId', as: 'fund' });
Fund.belongsTo(BrokerConnection, { foreignKey: 'brokerConnectionId', as: 'brokerConnection' });
