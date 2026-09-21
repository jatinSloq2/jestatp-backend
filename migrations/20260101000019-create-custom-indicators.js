'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('custom_indicators', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      // Reserved for the no-code "Formula Builder" mode described in the
      // Strategy Studio design doc — not built yet (see custom-indicators
      // module's README note); every row today is 'python'.
      kind: { type: Sequelize.ENUM('python', 'formula'), allowNull: false, defaultValue: 'python' },
      code: { type: Sequelize.TEXT, allowNull: false },
      // User-facing input schema + last-saved defaults, e.g. {"period": 14, "multiplier": 2.0}
      params: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      last_validated_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('custom_indicators', ['user_id']);
    // Partial unique index (not addConstraint) so it only applies to
    // non-deleted rows — otherwise a deleted "RSI Momentum" would block
    // ever creating a new indicator with that same name.
    await queryInterface.addIndex('custom_indicators', ['user_id', 'name'], {
      unique: true,
      where: { deleted_at: null },
      name: 'uq_custom_indicators_user_name',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('custom_indicators');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_custom_indicators_kind";');
  },
};
