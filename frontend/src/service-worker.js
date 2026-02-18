/* eslint-disable no-restricted-globals */
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  ({ request, url }) => {
    if (request.mode !== 'navigate') {
      return false;
    }
    if (url.pathname.startsWith('/_')) {
      return false;
    }
    if (fileExtensionRegexp.test(url.pathname)) {
      return false;
    }
    return true;
  },
  createHandlerBoundToURL(`${process.env.PUBLIC_URL}/index.html`)
);

registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ['script', 'style', 'worker'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'orderly-static-resources',
  })
);

registerRoute(
  ({ request, url }) => url.origin === self.location.origin && request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'orderly-images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
  new NetworkOnly()
);

const APPWRITE_ENDPOINT =
  process.env.REACT_APP_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1';

let appwriteOrigin = 'https://fra.cloud.appwrite.io';
let appwritePathPrefix = '/v1';
try {
  const parsedEndpoint = new URL(APPWRITE_ENDPOINT);
  appwriteOrigin = parsedEndpoint.origin;
  appwritePathPrefix = parsedEndpoint.pathname.replace(/\/+$/, '') || '/';
} catch (_) {
  // Keep defaults if endpoint parsing fails.
}

registerRoute(
  ({ url }) =>
    url.origin === appwriteOrigin &&
    (url.pathname === appwritePathPrefix || url.pathname.startsWith(`${appwritePathPrefix}/`)),
  new NetworkOnly()
);

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
