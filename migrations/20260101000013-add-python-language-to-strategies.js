'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    for (const table of ['strategies', 'strategy_versions']) {
      await queryInterface.addColumn(table, 'language', {
        type: Sequelize.ENUM('dsl', 'python'),
        allowNull: false,
        defaultValue: 'dsl',
      });
      await queryInterface.addColumn(table, 'python_code', { type: Sequelize.TEXT, allowNull: true });

      // DSL-authored strategies keep entry/exit_conditions required; a
      // python-language strategy has no entry/exit blocks at all (its logic
      // lives entirely in python_code), so those columns have to become
      // nullable rather than staying NOT NULL.
      await queryInterface.changeColumn(table, 'entry_conditions', { type: Sequelize.JSONB, allowNull: true });
      await queryInterface.changeColumn(table, 'exit_conditions', { type: Sequelize.JSONB, allowNull: true });

      await queryInterface.sequelize.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT chk_${table}_language_payload CHECK (
          (language = 'dsl' AND entry_conditions IS NOT NULL AND exit_conditions IS NOT NULL AND python_code IS NULL)
          OR
          (language = 'python' AND python_code IS NOT NULL)
        );
      `);
    }
  },

  down: async (queryInterface, Sequelize) => {
    for (const table of ['strategies', 'strategy_versions']) {
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS chk_${table}_language_payload;`);
      await queryInterface.changeColumn(table, 'entry_conditions', { type: Sequelize.JSONB, allowNull: false });
      await queryInterface.changeColumn(table, 'exit_conditions', { type: Sequelize.JSONB, allowNull: false });
      await queryInterface.removeColumn(table, 'python_code');
      await queryInterface.removeColumn(table, 'language');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_strategies_language";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_strategy_versions_language";');
  },
};
