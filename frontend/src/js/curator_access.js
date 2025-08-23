// Curator Access page logic (migrated from inline script)
(function(){
  const KEYS = { CREDS: 'artlens.creds', AUTH: 'artlens.auth' };

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
        showMsg('Signed in. Redirecting…', true);
        setTimeout(()=>{ location.href = './curator_dashboard.html'; }, 200);
      } else {
        showMsg('Invalid email or password.');
      }
    } catch (e) {
      showMsg('Unexpected error. Please try again.');
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    initCreds();
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
  });
})();
