'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('strategy_versions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      strategy_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'strategies', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      version: { type: Sequelize.INTEGER, allowNull: false },
      name: { type: Sequelize.STRING(150), allowNull: false },
      entry_conditions: { type: Sequelize.JSONB, allowNull: false },
      exit_conditions: { type: Sequelize.JSONB, allowNull: false },
      risk_config: { type: Sequelize.JSONB, allowNull: false },
      change_note: { type: Sequelize.STRING(255), allowNull: true },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('strategy_versions', ['strategy_id', 'version'], {
      unique: true,
      name: 'uq_strategy_version',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('strategy_versions');
  },
};
