'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'email_verification_otp_hash', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'email_verification_otp_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'email_verification_last_sent_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'two_factor_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('users', 'two_factor_method', {
      type: Sequelize.ENUM('email', 'totp'),
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'two_factor_secret_encrypted', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'two_factor_otp_hash', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'two_factor_otp_expires_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'two_factor_otp_last_sent_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'email_verification_otp_hash');
    await queryInterface.removeColumn('users', 'email_verification_otp_expires_at');
    await queryInterface.removeColumn('users', 'email_verification_last_sent_at');
    await queryInterface.removeColumn('users', 'two_factor_enabled');
    await queryInterface.removeColumn('users', 'two_factor_method');
    await queryInterface.removeColumn('users', 'two_factor_secret_encrypted');
    await queryInterface.removeColumn('users', 'two_factor_otp_hash');
    await queryInterface.removeColumn('users', 'two_factor_otp_expires_at');
    await queryInterface.removeColumn('users', 'two_factor_otp_last_sent_at');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_two_factor_method";');
  },
};
