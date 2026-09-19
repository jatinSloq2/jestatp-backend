'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('strategy_runtime_states', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      strategy_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true, // one runtime row per strategy
        references: { model: 'strategies', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Timestamp (epoch ms) of the most recent candle this strategy has
      // already reacted to — the live engine's de-dupe key so a tick that
      // finds no new closed bar since last time is a cheap no-op.
      last_processed_bar_timestamp: { type: Sequelize.BIGINT, allowNull: true },
      // Mirrors simulateTrades' OpenPositionSnapshot shape when a position is
      // currently open; null when flat. This IS the authoritative "are we in
      // a trade right now" record — see liveEngine.ts.
      open_position: { type: Sequelize.JSONB, allowNull: true },
      // Python strategies only: the `ctx.state` dict round-tripped between
      // live sandbox calls so the strategy "remembers" itself across ticks.
      python_state: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // Daily counters (maxTradesPerDay / maxLossPerDay from risk config),
      // reset when `day` no longer matches the candle's IST calendar day.
      trades_today: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      loss_today: { type: Sequelize.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
      day: { type: Sequelize.STRING(10), allowNull: true }, // 'YYYY-MM-DD' in IST
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.createTable('strategy_trades', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      strategy_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'strategies', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      mode: { type: Sequelize.ENUM('paper', 'live'), allowNull: false },
      entry_timestamp: { type: Sequelize.BIGINT, allowNull: false },
      entry_price: { type: Sequelize.DECIMAL(14, 4), allowNull: false },
      exit_timestamp: { type: Sequelize.BIGINT, allowNull: true },
      exit_price: { type: Sequelize.DECIMAL(14, 4), allowNull: true },
      quantity: { type: Sequelize.DECIMAL(14, 4), allowNull: false },
      exit_reason: { type: Sequelize.STRING(30), allowNull: true },
      pnl: { type: Sequelize.DECIMAL(14, 2), allowNull: true },
      // Set only for mode='live' once order placement exists — see
      // liveEngine.ts's explicit "not implemented yet" guard for why this is
      // nullable today even for entries that logically should have one.
      entry_order_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'orders', key: 'id' } },
      exit_order_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'orders', key: 'id' } },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('strategy_trades', ['strategy_id', 'entry_timestamp']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('strategy_trades');
    await queryInterface.dropTable('strategy_runtime_states');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_strategy_trades_mode";');
  },
};
