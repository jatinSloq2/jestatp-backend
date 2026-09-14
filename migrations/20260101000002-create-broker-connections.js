'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('broker_connections', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      broker: { type: Sequelize.ENUM('dhan', 'zerodha', 'groww'), allowNull: false },
      client_id: { type: Sequelize.STRING, allowNull: true },
      api_key_encrypted: { type: Sequelize.TEXT, allowNull: true },
      api_secret_encrypted: { type: Sequelize.TEXT, allowNull: true },
      access_token_encrypted: { type: Sequelize.TEXT, allowNull: true },
      refresh_token_encrypted: { type: Sequelize.TEXT, allowNull: true },
      token_expires_at: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM('pending', 'connected', 'expired', 'revoked', 'error'),
        allowNull: false,
        defaultValue: 'pending',
      },
      last_synced_at: { type: Sequelize.DATE, allowNull: true },
      meta: { type: Sequelize.JSONB, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    });
    await queryInterface.addIndex('broker_connections', ['user_id', 'broker'], {
      unique: true,
      name: 'uq_user_broker',
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('broker_connections');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_broker_connections_broker";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_broker_connections_status";');
  },
};
