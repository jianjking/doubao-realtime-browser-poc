'use strict';

const express = require('express');
const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

function createAccountRouter({
  requireSession,
  userStore,
  maskChineseMobile,
}) {
  const accountRouter = express.Router();

  accountRouter.get('/me', requireSession, (request, response) => {
    if (request.auth.principal.type === 'user') {
      const user = userStore.findById(request.auth.principal.id);
      if (!user || user.status !== 'active') {
        response.status(401).json(AUTH_REQUIRED_RESPONSE);
        return;
      }

      response.status(200).json({
        principal: request.auth.principal,
        profile: {
          phoneMasked: maskChineseMobile(user.phoneE164),
        },
        account: null,
        permissions: {
          canRecharge: true,
        },
      });
      return;
    }

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
