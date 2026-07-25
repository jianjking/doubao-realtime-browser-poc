'use strict';

const express = require('express');

function createAccountRouter({ requireSession }) {
  const accountRouter = express.Router();

  accountRouter.get('/me', requireSession, (request, response) => {
    response.status(200).json({
      principal: request.auth.principal,
      account: null,
      permissions: {
        canRecharge: false,
      },
    });
  });

  return accountRouter;
}

module.exports = {
  createAccountRouter,
};
