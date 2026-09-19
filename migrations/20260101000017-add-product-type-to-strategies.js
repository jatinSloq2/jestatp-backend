'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('strategies', 'product_type', {
      type: Sequelize.ENUM('CNC', 'MIS', 'NRML'),
      allowNull: false,
      defaultValue: 'MIS',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('strategies', 'product_type');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_strategies_product_type";');
  },
};
