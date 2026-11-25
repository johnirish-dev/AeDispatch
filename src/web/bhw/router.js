import { Store } from './store.js';
import { renderDashboard } from './dashboard.js';
import { renderSurvey } from './survey.js';
import { renderMyForms } from './forms.js';
import { showModal } from './alerts.js';

export function initRouter(appRoot) {
  const navIds = ['home', 'survey', 'forms'];
  let currentHash = window.location.hash || '#/';

  function updateNav(activeId) {
    navIds.forEach(id => {
      document.getElementById(`nav-${id}`).classList.toggle('active', id === activeId);
      document.getElementById(`mob-nav-${id}`).classList.toggle('active', id === activeId);
    });
  }

  async function route(hash = window.location.hash || '#/') {
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
    currentHash = hash;
  }

  async function handleHashChange() {
    const nextHash = window.location.hash || '#/';
    const guard = window.bhwSurveyExitGuard;
    const leavingSurvey = currentHash.startsWith('#/survey') && !nextHash.startsWith('#/survey');

    if (guard && leavingSurvey && guard.isDirty()) {
      window.history.replaceState({}, '', currentHash);
      const choice = await showModal({
        type: 'warning',
        title: 'Unsaved changes',
        message: 'Save your progress to finish later, or discard this survey before leaving.',
        mobileMessage: 'Save your progress to finish later, or discard this survey.',
        dismissible: false,
        actions: [
          { label: 'Save draft', value: 'save', primary: true },
          { label: 'Discard changes', value: 'discard', danger: true },
          { label: 'Keep editing', value: 'keep' }
        ]
      });

      if (choice === 'keep' || choice === null) return;
      if (choice === 'save' && !guard.saveAndExit()) return;
      if (choice === 'discard') guard.discard();
    }

    if (leavingSurvey) delete window.bhwSurveyExitGuard;
    window.history.replaceState({}, '', nextHash);
    await route(nextHash);
  }

  window.addEventListener('hashchange', handleHashChange);
  route(currentHash);
}
