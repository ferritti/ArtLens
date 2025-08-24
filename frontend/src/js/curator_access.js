// Curator Access page logic (migrated from inline script)
import { getLang, setLang } from './db.js';

(function(){
  const KEYS = { CREDS: 'artlens.creds', AUTH: 'artlens.auth' };

  // Simple localization dictionary for this page
  const I18N = {
    it: {
      back: 'Indietro',
      title: 'Accesso Curatore',
      subtitle: 'Accedi per gestire la collezione di opere',
      emailLabel: 'Email',
      emailPh: 'curator@museum.com',
      passLabel: 'Password',
      passPh: 'Inserisci la password',
      signIn: 'Accedi',
      msg_ok: 'Accesso effettuato. Reindirizzamento…',
      msg_bad: 'Email o password non validi.',
      msg_err: 'Errore imprevisto. Riprova.'
    },
    en: {
      back: 'Back',
      title: 'Curator Access',
      subtitle: "Sign in to manage the artwork collection",
      emailLabel: 'Email',
      emailPh: 'curator@museum.com',
      passLabel: 'Password',
      passPh: 'Enter your password',
      signIn: 'Sign In',
      msg_ok: 'Signed in. Redirecting…',
      msg_bad: 'Invalid email or password.',
      msg_err: 'Unexpected error. Please try again.'
    }
  };

  function t(){ return I18N[getLang()] || I18N.it; }

  function applyLang(){
    const lang = getLang();
    try { document.documentElement.setAttribute('lang', (lang === 'en' ? 'en' : 'it')); } catch {}
    const back = document.querySelector('.top span');
    const title = document.querySelector('h1.title');
    const subtitle = document.querySelector('p.subtitle');
    const emailLbl = document.querySelector('label:nth-of-type(1)');
    const emailInput = document.querySelector('input[name="email"]');
    const passLbl = document.querySelector('label:nth-of-type(2)');
    const passInput = document.querySelector('input[name="password"]');
    const btn = document.getElementById('signInBtn');

    const tr = t();
    if (back) back.textContent = tr.back;
    if (title) title.textContent = tr.title;
    if (subtitle) subtitle.textContent = tr.subtitle;
    if (emailLbl) emailLbl.childNodes[0].nodeValue = tr.emailLabel; // preserve nested span.field
    if (emailInput) emailInput.placeholder = tr.emailPh;
    if (passLbl) passLbl.childNodes[0].nodeValue = tr.passLabel;
    if (passInput) passInput.placeholder = tr.passPh;
    if (btn) btn.textContent = tr.signIn;
  }

  function initCreds(){
    try {
      if (!localStorage.getItem(KEYS.CREDS)) {
        localStorage.setItem(KEYS.CREDS, JSON.stringify({ email: 'curator@museum.com', password: 'tesi2025' }));
      }
    } catch(_) {}
  }
  function alreadyAuthed(){
    try { return !!localStorage.getItem(KEYS.AUTH); } catch(_) { return false; }
  }
  function setAuthed(){
    try { localStorage.setItem(KEYS.AUTH, JSON.stringify({ at: Date.now() })); } catch(_) {}
  }
  function showMsg(msg, ok){
    var el = document.getElementById('loginMsg');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = ok ? '#1b7f3a' : '#b3261e';
  }
  function handleLogin(){
    const form = document.querySelector('form');
    const email = (form?.querySelector('input[name="email"]').value || '').trim().toLowerCase();
    const pass = form?.querySelector('input[name="password"]').value || '';
    try {
      const creds = JSON.parse(localStorage.getItem(KEYS.CREDS) || 'null');
      if (creds && email === String(creds.email || '').toLowerCase() && pass === String(creds.password || '')) {
        setAuthed();
        showMsg(t().msg_ok, true);
        setTimeout(()=>{ location.href = './curator_dashboard.html'; }, 200);
      } else {
        showMsg(t().msg_bad);
      }
    } catch (e) {
      showMsg(t().msg_err);
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    initCreds();
    applyLang();
    if (alreadyAuthed()) {
      // Optionally auto-redirect if already authenticated
      // location.replace('./curator_dashboard.html');
    }
    const btn = document.getElementById('signInBtn');
    if (btn) btn.addEventListener('click', handleLogin);
    const form = document.querySelector('form');
    if (form) {
      form.addEventListener('keydown', function(ev){
        if (ev.key === 'Enter') { ev.preventDefault(); handleLogin(); }
      });
    }
    // React to language changes made elsewhere (e.g., from homepage) while open
    window.addEventListener('storage', (e)=>{ if (e.key === 'lang') applyLang(); });
  });
})();
