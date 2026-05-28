// Handles PWA install prompt (Android / Chrome)
let deferredPrompt = null;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!sessionStorage.getItem('pwa-install-dismissed')) {
    showBanner();
  }
});

window.addEventListener('appinstalled', () => {
  hideBanner();
  deferredPrompt = null;
});

// iOS: mostra banner de instrução manual se não está no modo standalone
if (isIOS() && !isStandalone() && !sessionStorage.getItem('ios-install-dismissed')) {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ios-install-banner')?.classList.add('show');
  });
}

function showBanner() {
  document.getElementById('install-banner')?.classList.add('show');
}

function hideBanner() {
  document.getElementById('install-banner')?.classList.remove('show');
}

window.installPWA = async function () {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (outcome === 'accepted') hideBanner();
};

window.dismissInstall = function () {
  sessionStorage.setItem('pwa-install-dismissed', '1');
  hideBanner();
};

window.dismissIOSInstall = function () {
  sessionStorage.setItem('ios-install-dismissed', '1');
  document.getElementById('ios-install-banner')?.classList.remove('show');
};
