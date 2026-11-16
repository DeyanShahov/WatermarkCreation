/**
 * Boot module - initializes the app and handles PWA registration.
 */

import { initializeApp } from './main.js';
import './styles/main.css';

// Register service worker for PWA
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    // Dev server without PWA plugin - nothing to register
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  registerServiceWorker();
});