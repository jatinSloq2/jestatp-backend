'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('strategies', 'broker', {
      type: Sequelize.ENUM('dhan', 'zerodha', 'groww'),
      allowNull: false,
      defaultValue: 'zerodha', // backfill default for any pre-existing rows; new rows always specify it explicitly (see strategyDefinitionSchema)
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('strategies', 'broker');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_strategies_broker";');
  },
};
