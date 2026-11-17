import { Store } from './store.js';
import { setBearerToken, get } from '../shared/api.js';
import { initRouter } from './router.js';

function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    const label = isCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleBtn.setAttribute('title', label);
    toggleBtn.setAttribute('data-tooltip', label);
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
  });
}

async function init() {
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

  try {
    const me = await get('/api/bhw/me');

    document.getElementById('user-brgy').textContent = `Barangay ${me.barangay.name}`;
    const initials = me.barangay.name.substring(0, 2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;

    window.bhwContext = me;
    initRouter(appRoot);
  } catch (err) {
    if (err.status === 401) {
      appRoot.innerHTML = '<div style="padding: 20px;">This link is not valid. Ask the health office for a new one.</div>';
      Store.setToken(null);
    } else {
      appRoot.innerHTML = '<div style="padding: 20px;">Error connecting to the server.</div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);