'use strict';

const crypto = require('node:crypto');

const INTERNAL_AUTH_REQUIRED_RESPONSE = {
  error: {
    code: 'INTERNAL_AUTH_REQUIRED',
    message: 'Internal authentication required',
  },
};

const INTERNAL_TOKEN_ERROR_MESSAGE =
  'internal API token must be a base64url string of at least 32 characters';

function createRequireInternalToken({ token } = {}) {
  if (
    typeof token !== 'string'
    || token.length < 32
    || !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new TypeError(INTERNAL_TOKEN_ERROR_MESSAGE);
  }

  const expectedToken = Buffer.from(token, 'utf8');

  return function requireInternalToken(request, response, next) {
    response.setHeader('Cache-Control', 'no-store');

    const authorization = request.headers.authorization;
    const bearerMatch = typeof authorization === 'string'
      ? /^Bearer ([^\s]+)$/i.exec(authorization)
      : null;
    const receivedToken = bearerMatch
      ? Buffer.from(bearerMatch[1], 'utf8')
      : null;
    const authenticated = (
      receivedToken !== null
      && receivedToken.length === expectedToken.length
      && crypto.timingSafeEqual(receivedToken, expectedToken)
    );

    if (!authenticated) {
      response.setHeader(
        'WWW-Authenticate',
        'Bearer realm="business-internal"'
      );
      response.status(401).json(INTERNAL_AUTH_REQUIRED_RESPONSE);
      return;
    }

    next();
  };
}

module.exports = {
  INTERNAL_AUTH_REQUIRED_RESPONSE,
  createRequireInternalToken,
};
