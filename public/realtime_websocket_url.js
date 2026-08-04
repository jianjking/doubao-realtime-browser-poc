'use strict';

(() => {
  const ALLOWED_PATHS = new Set(['/realtime', '/fortune-asr']);
  const LOCAL_RELAY_ORIGIN = 'ws://127.0.0.1:3001';

  function isLoopbackHostname(hostname) {
    const normalized = String(hostname || '')
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    if (normalized === 'localhost' || normalized === '::1') {
      return true;
    }

    const octets = normalized.split('.');
    return octets.length === 4
      && octets[0] === '127'
      && octets.every((octet) => (
        /^\d{1,3}$/.test(octet)
        && Number(octet) >= 0
        && Number(octet) <= 255
      ));
  }

  function resolveRealtimeWebSocketUrl(pathname, locationValue) {
    if (!ALLOWED_PATHS.has(pathname)) {
      throw new TypeError('Unsupported realtime WebSocket path');
    }

    const runtimeLocation = locationValue
      || (typeof window === 'object' ? window.location : null);
    if (!runtimeLocation) {
      throw new TypeError('Browser location is required');
    }

    const protocol = String(runtimeLocation.protocol || '');
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new TypeError('Unsupported page protocol');
    }

    const host = String(runtimeLocation.host || '');
    if (!host || host.trim() !== host) {
      throw new TypeError('Current page host is invalid');
    }

    let pageUrl;
    try {
      pageUrl = new URL(`${protocol}//${host}/`);
    } catch {
      throw new TypeError('Current page host is invalid');
    }
    if (pageUrl.username || pageUrl.password || pageUrl.host !== host) {
      throw new TypeError('Current page host is invalid');
    }

    if (protocol === 'http:' && isLoopbackHostname(pageUrl.hostname)) {
      return `${LOCAL_RELAY_ORIGIN}${pathname}`;
    }

    const websocketProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${websocketProtocol}//${host}${pathname}`;
  }

  const api = Object.freeze({
    isLoopbackHostname,
    resolveRealtimeWebSocketUrl,
  });

  if (typeof window === 'object') {
    window.RealtimeWebSocketUrl = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})();
