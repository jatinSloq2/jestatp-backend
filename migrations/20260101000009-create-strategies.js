'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('strategies', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      instrument: { type: Sequelize.STRING(60), allowNull: false },
      exchange: { type: Sequelize.STRING(10), allowNull: false },
      segment: {
        type: Sequelize.ENUM('equity', 'fno', 'currency', 'commodity'),
        allowNull: false,
        defaultValue: 'equity',
      },
      timeframe: {
        type: Sequelize.ENUM('1m', '3m', '5m', '15m', '30m', '1h', '1d'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('draft', 'active', 'paused', 'archived'),
        allowNull: false,
        defaultValue: 'draft',
      },
      execution_mode: {
        type: Sequelize.ENUM('paper', 'live'),
        allowNull: false,
        defaultValue: 'paper',
      },
      current_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      entry_conditions: { type: Sequelize.JSONB, allowNull: false },
      exit_conditions: { type: Sequelize.JSONB, allowNull: false },
      risk_config: { type: Sequelize.JSONB, allowNull: false },
      last_validated_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('strategies', ['user_id']);
    await queryInterface.addIndex('strategies', ['status']);
    await queryInterface.addIndex('strategies', ['user_id', 'status']);
    await queryInterface.sequelize.query(
      'ALTER TABLE strategies ADD CONSTRAINT chk_strategies_version_positive CHECK (current_version > 0);',
    );
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('strategies');
    for (const t of ['segment', 'timeframe', 'status', 'execution_mode']) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_strategies_${t}";`);
    }
  },
};
