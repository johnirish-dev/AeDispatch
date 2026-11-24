import { Store } from './store.js';
import { setBearerToken, setSignInPage, get } from '../shared/api.js';
import { initRouter } from './router.js';
import { initAutoSync } from './sync.js';

function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
    // Local drafts and the retry queue still work without service workers.
  });
}

function applyContext(me) {
  document.getElementById('user-brgy').textContent = `Barangay ${me.barangay.name}`;
  document.getElementById('user-avatar').textContent = me.barangay.name.substring(0, 2).toUpperCase();
  document.getElementById('mobile-user-brgy').textContent = `Barangay ${me.barangay.name}`;
  document.getElementById('mobile-user-avatar').textContent = me.barangay.name.substring(0, 2).toUpperCase();
  window.bhwContext = me;
}

function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    const label = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleBtn.setAttribute('data-tooltip', label);
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  });
}

async function init() {
  // The shared helper sends a 401 to the officer login. A BHW with a bad link must stay here and see the message.
  setSignInPage(null);
  registerOfflineShell();
  initSidebarToggle();

  const url = new URL(window.location.href);
  let token = url.searchParams.get('token');

  if (token) {
    Store.setToken(token);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  } else {
    token = Store.getToken();
  }

  const appRoot = document.getElementById('app-root');

  if (!token) {
    appRoot.innerHTML = '<div style="padding: 20px;">This link is not valid. Ask the health office for a new one.</div>';
    return;
  }

  setBearerToken(token);

  // The saved forms are kept per barangay, so the barangay of this link must be known before anything is read or
  // synced: from the server, or (offline) from what this phone remembered about this link.
  try {
    const me = await get('/api/bhw/me');
    Store.rememberToken(token, me.barangay.id);
    Store.useBarangay(me.barangay.id);
    Store.setContext(me);
    applyContext(me);
    initAutoSync();
    initRouter(appRoot);
  } catch (err) {
    if (err.status === 401) {
      appRoot.innerHTML = '<div style="padding: 20px;">This link is not valid. Ask the health office for a new one.</div>';
      Store.setToken(null);
    } else {
      const known = Store.barangayOfToken(token);
      if (known !== null) Store.useBarangay(known);
      const cached = known === null ? null : Store.getContext();
      if (!cached) {
        appRoot.innerHTML = '<div style="padding: 20px;">Connect once to load this BHW workspace for offline use.</div>';
        return;
      }
      applyContext(cached);
      initAutoSync();
      initRouter(appRoot);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
