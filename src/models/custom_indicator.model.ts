import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';

export type CustomIndicatorKind = 'python' | 'formula';

export interface CustomIndicatorAttributes {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  kind: CustomIndicatorKind;
  code: string;
  params: Record<string, number | string>;
  lastValidatedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export type CustomIndicatorCreationAttributes = Optional<
  CustomIndicatorAttributes,
  'id' | 'description' | 'kind' | 'params' | 'lastValidatedAt'
>;

/**
 * A user-authored indicator (today: always Python `calculate(data,
 * params)` — see jestatp-sandbox-service's indicator_contract.py) that's
 * reusable across strategies via `ctx.custom("name")` in Python strategy
 * code. See customIndicators.service.ts for how its series gets
 * precomputed into a strategy run's `customSeries` map.
 */
export class CustomIndicator extends Model<CustomIndicatorAttributes, CustomIndicatorCreationAttributes> implements CustomIndicatorAttributes {
  public id!: string;
  public userId!: string;
  public name!: string;
  public description!: string | null;
  public kind!: CustomIndicatorKind;
  public code!: string;
  public params!: Record<string, number | string>;
  public lastValidatedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date | null;
}

CustomIndicator.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: User, key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    kind: { type: DataTypes.ENUM('python', 'formula'), allowNull: false, defaultValue: 'python' },
    code: { type: DataTypes.TEXT, allowNull: false },
    params: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lastValidatedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'CustomIndicator',
    tableName: 'custom_indicators',
    timestamps: true,
    paranoid: true, // soft delete via deleted_at, matching Strategy
    indexes: [{ fields: ['user_id'] }],
  },
);

User.hasMany(CustomIndicator, { foreignKey: 'userId', as: 'customIndicators' });
CustomIndicator.belongsTo(User, { foreignKey: 'userId', as: 'user' });
