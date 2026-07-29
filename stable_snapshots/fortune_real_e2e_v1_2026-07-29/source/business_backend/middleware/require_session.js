'use strict';

const SESSION_COOKIE_NAME = 'companion_session';

const AUTH_REQUIRED_RESPONSE = {
  error: {
    code: 'AUTH_REQUIRED',
    message: 'Authentication required',
  },
};

function readCookie(cookieHeader, expectedName) {
  if (typeof cookieHeader !== 'string') {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    if (name !== expectedName) {
      continue;
    }

    const encodedValue = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return null;
    }
  }

  return null;
}

function createRequireSession({ sessionService }) {
  return function requireSession(request, response, next) {
    const rawToken = readCookie(
      request.headers.cookie,
      SESSION_COOKIE_NAME
    );
    const auth = sessionService.verifySession(rawToken);

    if (!auth) {
      response.status(401).json(AUTH_REQUIRED_RESPONSE);
      return;
    }

    request.auth = auth;
    next();
  };
}

module.exports = {
  AUTH_REQUIRED_RESPONSE,
  SESSION_COOKIE_NAME,
  createRequireSession,
  readCookie,
};
