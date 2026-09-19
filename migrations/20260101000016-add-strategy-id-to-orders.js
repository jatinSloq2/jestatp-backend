'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('orders', 'strategy_id', {
      type: Sequelize.UUID,
      allowNull: true, // null for orders placed manually (outside any strategy)
      references: { model: 'strategies', key: 'id' },
      onDelete: 'SET NULL', // deleting/archiving a strategy must never delete real order history
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('orders', ['strategy_id']);

    // syncOrders() (brokerSync.service.ts) calls Order.upsert() keyed on
    // broker_order_id, but without a UNIQUE constraint on that column
    // Sequelize/Postgres has nothing to conflict against, so every sync
    // cycle was silently INSERTing a fresh duplicate row per broker order
    // instead of updating the existing one. Harmless while nothing ever
    // pre-created an Order row before syncing existed to find, but the live
    // strategy engine (orderPlacement.service.ts) now creates the Order row
    // itself before the broker even responds — without this constraint the
    // next sync cycle would duplicate every single strategy-placed order.
    // Postgres unique indexes allow multiple NULLs, so this doesn't affect
    // orders that don't have a broker_order_id yet (freshly created, not
    // yet confirmed by the broker).
    await queryInterface.sequelize.query(
      'ALTER TABLE orders ADD CONSTRAINT uq_orders_broker_order_id UNIQUE (broker_order_id);',
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_broker_order_id;');
    await queryInterface.removeIndex('orders', ['strategy_id']);
    await queryInterface.removeColumn('orders', 'strategy_id');
  },
};
