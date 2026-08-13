(() => {
  'use strict';

  const SESSION_KEY = 'vistos-session';
  const config = window.VISTOS_CONFIG || {};

  class ApiError extends Error {
    constructor(code, message) {
      super(message || 'Não foi possível concluir a solicitação.');
      this.name = 'ApiError';
      this.code = code || 'API_ERROR';
    }
  }

  class ApiClient {
    constructor(apiUrl) {
      this.apiUrl = apiUrl;
    }

    get token() {
      return sessionStorage.getItem(SESSION_KEY) || '';
    }

    set token(value) {
      if (value) sessionStorage.setItem(SESSION_KEY, value);
      else sessionStorage.removeItem(SESSION_KEY);
    }

    request(action, params = {}, authenticated = true) {
      if (!this.apiUrl || this.apiUrl.includes('APP_SCRIPT_URL_AQUI')) {
        return Promise.reject(new ApiError('NOT_CONFIGURED', 'O endereço do Apps Script ainda não foi configurado.'));
      }

      return new Promise((resolve, reject) => {
        const callback = `__vistos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const url = new URL(this.apiUrl);
        const script = document.createElement('script');
        let settled = false;

        const cleanup = () => {
          delete window[callback];
          script.remove();
        };

        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new ApiError('TIMEOUT', 'O servidor demorou para responder. Verifique sua internet.'));
        }, 20000);

        window[callback] = (payload) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          cleanup();
          if (!payload || payload.ok !== true) {
            const error = payload && payload.error ? payload.error : {};
            if (error.code === 'UNAUTHORIZED') this.token = '';
            reject(new ApiError(error.code, error.message));
            return;
          }
          resolve(payload.data);
        };

        url.searchParams.set('action', action);
        url.searchParams.set('callback', callback);
        if (authenticated && this.token) url.searchParams.set('session', this.token);
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        });

        script.async = true;
        script.src = url.toString();
        script.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          cleanup();
          reject(new ApiError('NETWORK_ERROR', 'Não foi possível acessar o servidor.'));
        };
        document.head.appendChild(script);
      });
    }
  }

  const api = new ApiClient(config.apiUrl);

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function ensureAuth() {
    const dialog = document.getElementById('loginDialog');
    const form = document.getElementById('loginForm');
    const input = document.getElementById('pinInput');
    const errorNode = document.getElementById('loginError');

    if (api.token) {
      try {
        return await api.request('me');
      } catch (error) {
        if (error.code !== 'UNAUTHORIZED') toast(error.message, 'error');
      }
    }

    dialog.showModal();
    window.setTimeout(() => input.focus(), 80);

    return new Promise((resolve) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const pin = input.value.trim();
        errorNode.textContent = '';

        if (!/^\d{6,12}$/.test(pin)) {
          errorNode.textContent = 'Digite um PIN de 6 a 12 números.';
          return;
        }

        setBusy(button, true, 'Entrando…');
        try {
          const result = await api.request('login', { pinHash: await sha256(pin) }, false);
          api.token = result.token;
          input.value = '';
          dialog.close();
          resolve(await api.request('me'));
        } catch (error) {
          errorNode.textContent = error.message;
          input.select();
        } finally {
          setBusy(button, false);
        }
      });
    });
  }

  function setBusy(element, busy, label) {
    if (!element) return;
    if (busy) {
      element.dataset.originalLabel = element.innerHTML;
      element.disabled = true;
      if (label) element.textContent = label;
    } else {
      element.disabled = false;
      if (element.dataset.originalLabel) {
        element.innerHTML = element.dataset.originalLabel;
        delete element.dataset.originalLabel;
      }
    }
  }

  function toast(message, type = 'info') {
    const region = document.getElementById('toastRegion');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast toast-${type}`;
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }

  function formatDate(value, options = {}) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      ...options
    }).format(new Date(value));
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function setupTheme() {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('vistos-theme', next);
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.content = next === 'dark' ? '#101512' : '#f4f6f1';
    });
  }

  function setupDialogs() {
    document.addEventListener('click', (event) => {
      const closeButton = event.target.closest('.close-dialog');
      if (closeButton) closeButton.closest('dialog')?.close();
    });

    document.querySelectorAll('dialog:not([data-static])').forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    });
  }

  async function logout() {
    try {
      await api.request('logout');
    } catch (_) {
      // A sessão local deve ser encerrada mesmo se a rede falhar.
    }
    api.token = '';
    location.reload();
  }

  setupTheme();
  setupDialogs();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  window.Vistos = Object.freeze({
    api,
    ApiError,
    ensureAuth,
    formatDate,
    logout,
    normalizeText,
    setBusy,
    sha256,
    toast
  });
})();
