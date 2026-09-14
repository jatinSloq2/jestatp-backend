'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('funds', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      broker_connection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'broker_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      broker: { type: Sequelize.STRING(20), allowNull: false },
      available_balance: { type: Sequelize.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
      used_margin: { type: Sequelize.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
      total_balance: { type: Sequelize.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
      collateral: { type: Sequelize.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
      raw: { type: Sequelize.JSONB, allowNull: true },
      synced_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('funds');
  },
};
