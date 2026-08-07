'use strict';

const express = require('express');
const {
  AUTH_REQUIRED_RESPONSE,
} = require('../middleware/require_session');

function createAccountRouter({
  requireSession,
  userStore,
  maskChineseMobile,
  accountService,
  getPaymentCapabilities,
}) {
  const accountRouter = express.Router();
  const disabledPaymentPermissions = Object.freeze({
    canRecharge: false,
    paymentMode: 'disabled',
    paymentProviders: Object.freeze({
      alipay: false,
      wechat: false,
    }),
    publicPaymentEntryEnabled: false,
  });

  function readPaymentPermissions() {
    return typeof getPaymentCapabilities === 'function'
      ? getPaymentCapabilities()
      : disabledPaymentPermissions;
  }

  accountRouter.get('/me', requireSession, (request, response) => {
    if (request.auth.principal.type === 'user') {
      const user = userStore.findById(request.auth.principal.id);
      if (!user || user.status !== 'active') {
        response.status(401).json(AUTH_REQUIRED_RESPONSE);
        return;
      }
      const account = accountService.getPublicAccountForUser(user.id);
      if (!account) {
        response.status(401).json(AUTH_REQUIRED_RESPONSE);
        return;
      }

      response.status(200).json({
        principal: request.auth.principal,
        profile: {
          phoneMasked: maskChineseMobile(user.phoneE164),
        },
        account,
        permissions: readPaymentPermissions(),
      });
      return;
    }

    response.status(200).json({
      principal: request.auth.principal,
      account: null,
      permissions: {
        ...readPaymentPermissions(),
        canRecharge: false,
        paymentProviders: {
          alipay: false,
          wechat: false,
        },
      },
    });
  });

  return accountRouter;
}

module.exports = {
  createAccountRouter,
};
