import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { Strategy } from './strategy.model';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertType =
  | 'live_entry_rejected'
  | 'live_exit_rejected'
  | 'live_entry_failed'
  | 'live_exit_failed'
  | 'strategy_execution_error'
  | 'manual_order_rejected';

export interface AlertAttributes {
  id: string;
  userId: string;
  strategyId: string | null;
  severity: AlertSeverity;
  type: AlertType;
  message: string;
  metadata: Record<string, unknown> | null;
  acknowledgedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type AlertCreationAttributes = Optional<AlertAttributes, 'id' | 'strategyId' | 'metadata' | 'acknowledgedAt'>;

/**
 * Something that happened during automated (or manual) trading that a human
 * should actually see — not just a log line. Raised by alerting.service.ts,
 * which also emails `severity: 'critical'` alerts immediately (see
 * sendMail in utils/mailer.ts) since those represent the engine no longer
 * being sure it's doing the right thing with real money (e.g. a live exit
 * order that got rejected while a position is still open at the broker).
 */
export class Alert extends Model<AlertAttributes, AlertCreationAttributes> implements AlertAttributes {
  public id!: string;
  public userId!: string;
  public strategyId!: string | null;
  public severity!: AlertSeverity;
  public type!: AlertType;
  public message!: string;
  public metadata!: Record<string, unknown> | null;
  public acknowledgedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Alert.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false, references: { model: User, key: 'id' }, onDelete: 'CASCADE' },
    strategyId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: Strategy, key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), allowNull: false },
    type: { type: DataTypes.STRING(60), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    acknowledgedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    modelName: 'Alert',
    tableName: 'alerts',
    underscored: true,
    timestamps: true,
  },
);

User.hasMany(Alert, { foreignKey: 'userId', as: 'alerts' });
Alert.belongsTo(User, { foreignKey: 'userId' });
Strategy.hasMany(Alert, { foreignKey: 'strategyId', as: 'alerts' });
Alert.belongsTo(Strategy, { foreignKey: 'strategyId' });
