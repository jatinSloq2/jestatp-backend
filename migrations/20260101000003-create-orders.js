'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('orders', {
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
      broker_order_id: { type: Sequelize.STRING, allowNull: true },
      exchange: { type: Sequelize.STRING(10), allowNull: false },
      segment: {
        type: Sequelize.ENUM('equity', 'fno', 'currency', 'commodity'),
        allowNull: false,
        defaultValue: 'equity',
      },
      trading_symbol: { type: Sequelize.STRING(60), allowNull: false },
      instrument_token: { type: Sequelize.STRING, allowNull: true },
      side: { type: Sequelize.ENUM('BUY', 'SELL'), allowNull: false },
      order_type: { type: Sequelize.ENUM('MARKET', 'LIMIT', 'SL', 'SL-M'), allowNull: false },
      product_type: { type: Sequelize.ENUM('CNC', 'MIS', 'NRML'), allowNull: false },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      filled_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      price: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      trigger_price: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      average_price: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      status: {
        type: Sequelize.ENUM(
          'CREATED',
          'VALIDATED',
          'SUBMITTED',
          'OPEN',
          'PARTIALLY_FILLED',
          'FILLED',
          'CANCEL_REQUESTED',
          'CANCELLED',
          'REJECTED',
        ),
        allowNull: false,
        defaultValue: 'CREATED',
      },
      status_message: { type: Sequelize.STRING, allowNull: true },
      placed_at: { type: Sequelize.DATE, allowNull: true },
      raw: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('orders', ['user_id']);
    await queryInterface.addIndex('orders', ['broker_connection_id']);
    await queryInterface.addIndex('orders', ['segment']);
    await queryInterface.addIndex('orders', ['status']);
    await queryInterface.addIndex('orders', ['user_id', 'broker', 'segment'], { name: 'idx_orders_user_broker_segment' });
    await queryInterface.addIndex('orders', ['broker_order_id']);
    await queryInterface.sequelize.query(
      'ALTER TABLE orders ADD CONSTRAINT chk_orders_quantity_positive CHECK (quantity > 0);',
    );
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('orders');
    for (const t of ['segment', 'side', 'order_type', 'product_type', 'status']) {
      await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "enum_orders_${t}";`);
    }
  },
};
