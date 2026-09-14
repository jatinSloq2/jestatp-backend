'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('positions', {
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
      segment: {
        type: Sequelize.ENUM('equity', 'fno', 'currency', 'commodity'),
        allowNull: false,
        defaultValue: 'equity',
      },
      trading_symbol: { type: Sequelize.STRING(60), allowNull: false },
      product_type: { type: Sequelize.STRING(10), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      average_price: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      last_traded_price: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      realized_pnl: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      unrealized_pnl: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      raw: { type: Sequelize.JSONB, allowNull: true },
      synced_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('positions', ['user_id']);
    await queryInterface.addIndex('positions', ['broker_connection_id']);
    await queryInterface.addIndex('positions', ['broker_connection_id', 'trading_symbol', 'product_type'], {
      unique: true,
      name: 'uq_position_symbol_product',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('positions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_positions_segment";');
  },
};
