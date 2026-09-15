'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.addColumn('users', 'reset_password_token_hash', {
            type: Sequelize.STRING,
            allowNull: true,
        });
        await queryInterface.addColumn('users', 'reset_password_expires_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
        await queryInterface.addColumn('users', 'reset_password_last_sent_at', {
            type: Sequelize.DATE,
            allowNull: true,
        });
    },
    down: async (queryInterface) => {
        await queryInterface.removeColumn('users', 'reset_password_token_hash');
        await queryInterface.removeColumn('users', 'reset_password_expires_at');
        await queryInterface.removeColumn('users', 'reset_password_last_sent_at');
    },
};