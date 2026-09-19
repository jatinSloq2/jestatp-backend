'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('alerts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      strategy_id: {
        type: Sequelize.UUID,
        allowNull: true, // null for alerts not tied to a specific strategy
        references: { model: 'strategies', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      severity: { type: Sequelize.ENUM('info', 'warning', 'critical'), allowNull: false },
      // Machine-readable category (e.g. 'live_order_rejected', 'position_stuck') so the
      // frontend/future rules can branch on it without parsing `message`.
      type: { type: Sequelize.STRING(60), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      acknowledged_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('alerts', ['user_id', 'acknowledged_at']);
    await queryInterface.addIndex('alerts', ['strategy_id']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('alerts');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_alerts_severity";');
  },
};
