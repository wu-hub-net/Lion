(function () {
  'use strict';

  const ACCOUNT_KEY = 'lions-accounts-v2';
  const ADMIN_CODE_HASH = '56a7633d755b5d24a72548f89c0737d392a9b19d9411dc371e8d060f19fb3a54';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const authScreen = document.getElementById('authScreen');
  const appRoot = document.getElementById('appRoot');
  const appTemplate = document.getElementById('appTemplate');
  let scriptsLoaded = false;
  let scriptsLoading = null;
  let activeAuth = null;
  let authMode = 'login';

  function bytesToBase64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function deriveCredentials(password, saltBytes) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({
      name: 'PBKDF2', salt: saltBytes, iterations: 210000, hash: 'SHA-256',
    }, material, 512));
    const verifier = bytesToBase64(bits.slice(0, 32));
    const key = await crypto.subtle.importKey('raw', bits.slice(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { verifier, key };
  }

  async function decryptProfile(account, key) {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(account.iv) }, key, base64ToBytes(account.cipher));
    return JSON.parse(decoder.decode(clear));
  }

  async function createSecureAccount(email, password, role, name, org) {
    const normalizedEmail = email.trim().toLowerCase();
    const id = await sha256(normalizedEmail);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { verifier, key } = await deriveCredentials(password, salt);
    const profile = {
      loginEmail: normalizedEmail,
      name: name.trim() || 'LIONS User',
      org: org.trim() || (role === 'student' ? 'Student workspace' : role === 'admin' ? 'LIONS administration' : 'Reviewer workspace'),
      phone: '', contactEmail: normalizedEmail, channel: '', github: '', avatar: '',
      school: role === 'student' ? org.trim() : '', graduationYear: '', availability: 'Open to opportunities',
      sharing: { phone: false, email: false, channel: false, github: true, photo: true, org: true, graduation: true, availability: true },
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(profile)));
    return {
      user: { ...profile, id, role },
      key,
      account: { id, role, salt: bytesToBase64(salt), verifier, iv: bytesToBase64(iv), cipher: bytesToBase64(new Uint8Array(cipher)), version: 2 },
    };
  }

  function getAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '[]'); } catch (error) { return []; }
  }

  async function authenticate(event) {
    event.preventDefault();
    const email = document.getElementById('authEmail').value.trim().toLowerCase();
    const password = document.getElementById('authPassword').value;
    const role = document.querySelector('input[name="authRole"]:checked').value;
    const hint = document.getElementById('authHint');
    const accounts = getAccounts();
    try {
      if (authMode === 'register') {
        if (role === 'admin' && await sha256(document.getElementById('authAdminCode').value) !== ADMIN_CODE_HASH) {
          hint.textContent = 'The administrator invite code is not valid.';
          return;
        }
        const created = await createSecureAccount(email, password, role, document.getElementById('authName').value, document.getElementById('authOrg').value);
        if (accounts.some((account) => account.id === created.account.id)) {
          hint.textContent = 'An account already exists for this email.';
          return;
        }
        accounts.push(created.account);
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
        await mountApp(created.user, created.key);
        return;
      }
      const accountId = await sha256(email);
      const account = accounts.find((item) => item.role === role && item.id === accountId);
      if (!account) throw new Error('Invalid account');
      const credentials = await deriveCredentials(password, base64ToBytes(account.salt));
      if (credentials.verifier !== account.verifier) throw new Error('Invalid password');
      const profile = await decryptProfile(account, credentials.key);
      await mountApp({ ...profile, id: account.id, role: account.role }, credentials.key);
    } catch (error) {
      hint.textContent = 'Email, password or selected role does not match.';
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function loadAuthenticatedScripts() {
    if (scriptsLoaded) return;
    if (!scriptsLoading) {
      scriptsLoading = (async () => {
        await loadScript('app.js?v=20260916-1');
        await loadScript('mobile.js?v=20260916-1');
        await loadScript('node_modules/mammoth/mammoth.browser.min.js');
        await loadScript('profile-admin.js?v=20260916-1');
        scriptsLoaded = true;
      })();
    }
    await scriptsLoading;
  }

  async function mountApp(user, key) {
    activeAuth = { user, key };
    window.__lionsBootstrapAuth = activeAuth;
    appRoot.replaceChildren(appTemplate.content.cloneNode(true));
    authScreen.classList.add('hidden');
    history.replaceState({ authenticated: true }, '', '/dashboard');
    await loadAuthenticatedScripts();
    authScreen.remove();
  }

  function showLogin() {
    activeAuth = null;
    window.__lionsBootstrapAuth = null;
    appRoot.replaceChildren();
    if (!authScreen.isConnected) document.body.insertBefore(authScreen, appRoot);
    authScreen.classList.remove('hidden');
    history.replaceState({ authenticated: false }, '', '/login');
    bindAuthForm();
  }

  function bindAuthForm() {
    const form = document.getElementById('authForm');
    if (!form || form.dataset.authBound === 'true') return;
    form.dataset.authBound = 'true';
    form.addEventListener('submit', authenticate);
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
      authMode = tab.dataset.authMode;
      document.querySelectorAll('.auth-tab').forEach((item) => item.classList.toggle('active', item === tab));
      document.getElementById('authNameWrap').classList.toggle('hidden', authMode !== 'register');
      document.getElementById('authOrgWrap').classList.toggle('hidden', authMode !== 'register');
      document.getElementById('authName').required = authMode === 'register';
      document.getElementById('authSubmitLabel').textContent = authMode === 'login' ? 'Log in' : 'Create account';
      document.getElementById('authHint').textContent = authMode === 'login' ? 'Use your LIONS account to continue.' : 'Private account fields are encrypted on this device.';
      updateAdminCodeVisibility();
    }));
    document.querySelectorAll('input[name="authRole"]').forEach((radio) => radio.addEventListener('change', updateAdminCodeVisibility));
  }

  function updateAdminCodeVisibility() {
    const isAdmin = document.querySelector('input[name="authRole"]:checked')?.value === 'admin';
    const wrap = document.getElementById('authAdminCodeWrap');
    wrap.classList.toggle('hidden', authMode !== 'register' || !isAdmin);
    document.getElementById('authAdminCode').required = authMode === 'register' && isAdmin;
  }

  window.lionsAuth = {
    logout() {
      window.lionsClearActiveUser?.();
      window.location.replace('/login');
    },
  };

  window.addEventListener('popstate', () => {
    if (activeAuth && window.location.pathname === '/login') history.replaceState({ authenticated: true }, '', '/dashboard');
    if (!activeAuth && window.location.pathname !== '/login') history.replaceState({ authenticated: false }, '', '/login');
  });

  bindAuthForm();
  if (window.location.pathname !== '/' && window.location.pathname !== '/login') history.replaceState({ authenticated: false }, '', '/login');
}());
