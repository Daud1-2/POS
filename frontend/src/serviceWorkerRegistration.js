const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/
    )
);

let didAttachControllerChange = false;
let didReloadForControllerChange = false;

const triggerSkipWaiting = (registration) => {
  if (!registration || !registration.waiting) return;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
};

const registerValidSW = (swUrl, config) => {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (installingWorker.state !== 'installed') return;

          if (navigator.serviceWorker.controller) {
            triggerSkipWaiting(registration);
            if (config && config.onUpdate) {
              config.onUpdate(registration);
            }
          } else if (config && config.onSuccess) {
            config.onSuccess(registration);
          }
        };
      };

      if (registration.waiting && navigator.serviceWorker.controller) {
        triggerSkipWaiting(registration);
      }
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Error during service worker registration:', error);
    });
};

const checkValidServiceWorker = (swUrl, config) => {
  fetch(swUrl, {
    headers: { 'Service-Worker': 'script' },
  })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf('javascript') === -1)
      ) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => {
            window.location.reload();
          });
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {
      // eslint-disable-next-line no-console
      console.log('No internet connection found. App is running in offline mode.');
    });
};

const registerControllerReloadHandler = () => {
  if (didAttachControllerChange) return;
  didAttachControllerChange = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (didReloadForControllerChange) return;
    didReloadForControllerChange = true;
    window.location.reload();
  });
};

export const register = (config) => {
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  registerControllerReloadHandler();

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;
    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      navigator.serviceWorker.ready.then(() => {
        // eslint-disable-next-line no-console
        console.log('Service worker is active on localhost.');
      });
    } else {
      registerValidSW(swUrl, config);
    }
  });
};

export const unregister = () => {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error.message);
    });
};
