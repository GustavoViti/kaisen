// Handles PWA install prompt (Android / Chrome)
let deferredPrompt = null;

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
