'use strict';

const express = require('express');

function createRoleRouter({ roleService } = {}) {
  if (!roleService) {
    throw new TypeError('roleService is required');
  }

  const roleRouter = express.Router();

  roleRouter.get('/roles', (_request, response) => {
    response.status(200).json({
      roles: roleService.listPublicRoles(),
    });
  });

  return roleRouter;
}

module.exports = {
  createRoleRouter,
};
