'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('holdings', {
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
        references: { model: 'broker_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      broker: { type: Sequelize.STRING(20), allowNull: false },
      exchange: { type: Sequelize.STRING(10), allowNull: false },
      trading_symbol: { type: Sequelize.STRING(60), allowNull: false },
      isin: { type: Sequelize.STRING(20), allowNull: true },
      quantity: { type: Sequelize.DECIMAL(14, 4), allowNull: false, defaultValue: 0 },
      average_price: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      last_traded_price: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      raw: { type: Sequelize.JSONB, allowNull: true },
      synced_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('holdings', ['user_id']);
    await queryInterface.addIndex('holdings', ['broker_connection_id']);
    await queryInterface.addIndex('holdings', ['broker_connection_id', 'trading_symbol'], {
      unique: true,
      name: 'uq_holding_symbol',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('holdings');
  },
};