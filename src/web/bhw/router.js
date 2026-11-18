import { Store } from './store.js';
import { renderDashboard } from './dashboard.js';
import { renderSurvey } from './survey.js';
import { renderMyForms } from './forms.js';

export function initRouter(appRoot) {
  const navIds = ['home', 'survey', 'forms'];

  function updateNav(activeId) {
    navIds.forEach(id => {
      document.getElementById(`nav-${id}`).classList.toggle('active', id === activeId);
      document.getElementById(`mob-nav-${id}`).classList.toggle('active', id === activeId);
    });
  }

  async function route() {
    const hash = window.location.hash;
    appRoot.innerHTML = ''; 

    if (hash === '' || hash === '#' || hash === '#/') {
      updateNav('home');
      await renderDashboard(appRoot);
    } else if (hash.startsWith('#/survey')) {
      updateNav('survey');
      const param = hash.split('/')[2]; 
      await renderSurvey(appRoot, param);
    } else if (hash.startsWith('#/forms')) {
      updateNav('forms');
      await renderMyForms(appRoot, hash.split('/')[2]);
    } else {
      window.location.hash = '#/';
    }
  }

  window.addEventListener('hashchange', route);
  route(); 
}