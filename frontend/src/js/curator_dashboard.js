import { initEmbeddingModel, embedFromCanvas } from './embedding.js';
import { BACKEND_URL, CROP_SIZE } from './constants.js';
import { getLang } from './db.js';

const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('statusMsg');
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}
function setLoading(loading) {
  if (submitBtn) submitBtn.disabled = !!loading;
}

async function imageToCanvas224(file) {
  const can = document.createElement('canvas');
  can.width = can.height = CROP_SIZE;
  const ctx = can.getContext('2d', { willReadFrequently: true });
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  // Center-crop square then scale to 224
  const s = Math.min(img.width, img.height);
  const sx = Math.max(0, Math.floor((img.width - s) / 2));
  const sy = Math.max(0, Math.floor((img.height - s) / 2));
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(img, sx, sy, s, s, 0, 0, CROP_SIZE, CROP_SIZE);
  URL.revokeObjectURL(img.src);
  return can;
}

function buildDescriptions(fd) {
  const it = (fd.get('desc_it') || '').trim();
  const en = (fd.get('desc_en') || '').trim();
  const out = {};
  if (it) out.it = it;
  if (en) out.en = en;
  return Object.keys(out).length ? out : undefined;
}

function descriptorIdFor(file, index) {
  const base = (file.name || `img_${index+1}`)
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') || `img-${index+1}`;
  return base;
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  setLoading(true);
  setStatus('Preparazione modello…');
  try {
    const filesInput = /** @type {HTMLInputElement} */ (document.querySelector('input[name="images"]'));
    const files = filesInput?.files;
    if (!files || !files.length) { alert('Seleziona almeno un’immagine'); return; }

    // Init model
    await initEmbeddingModel();

    // Compute embeddings locally
    const visual_descriptors = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Calcolo embedding ${i+1}/${files.length}…`);
      const f = files[i];
      const can = await imageToCanvas224(f);
      const embedding = embedFromCanvas(can); // already L2-normalized
      visual_descriptors.push({ id: descriptorIdFor(f, i), embedding });
    }

    const payload = {
      title: (fd.get('title') || '').trim() || null,
      artist: (fd.get('artist') || '').trim() || null,
      year: (fd.get('year') || '').trim() || null,
      museum: (fd.get('museum') || '').trim() || null,
      location: (fd.get('location') || '').trim() || null,
      descriptions: buildDescriptions(fd),
      visual_descriptors,
    };

    // Token admin
    const defaultToken = (typeof localStorage !== 'undefined' ? localStorage.getItem('X_ADMIN_TOKEN') : '') || '';
    let token = defaultToken || '';
    if (!token) token = prompt('Inserisci X-Admin-Token') || '';
    if (!token) { alert('Token mancante. Operazione annullata.'); return; }
    try { if (localStorage) localStorage.setItem('X_ADMIN_TOKEN', token); } catch {}

    setStatus('Salvataggio in corso…');
    const res = await fetch(`${BACKEND_URL}/artworks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': token
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t}`);
    }
    const json = await res.json().catch(() => ({}));
    setStatus('Operazione completata.');
    alert(`Opera salvata!\nID: ${json.id || '(generato)'}\nDescrittori: ${visual_descriptors.length}`);
    form.reset();
  } catch (err) {
    console.error('Admin save error:', err);
    setStatus('Errore durante il salvataggio.');
    alert(`Errore durante il salvataggio: ${err?.message || err}`);
  } finally {
    setLoading(false);
    setTimeout(() => setStatus(''), 1200);
  }
}

const formEl = document.getElementById('f');
if (formEl) formEl.addEventListener('submit', onSubmit);

// Dashboard auth guard and UI helpers (migrated from curator_dashboard.html inline scripts)
(function(){
  // Detect curator dashboard by presence of main container or form
  const isDashboard = document.querySelector('.cdash') || document.getElementById('f');
  if (!isDashboard) return;

  // i18n dictionary for Curator Dashboard
  const I18N = {
    it: {
      title: 'Dashboard Curatore',
      subtitle: 'Gestisci la collezione del museo',
      signOut: 'Esci',
      tabs: ['Aggiungi Opera', 'Gestisci Collezione'],
      sectionTitle: 'Aggiungi Nuova Opera',
      dzStrong: 'Clicca per caricare',
      dzSmall: '',
      imagesLabel: "Immagini Opera d'Arte",
      fields: {
        title: { label: 'Titolo', ph: 'Inserisci il titolo dell\'opera' },
        artist: { label: 'Artista', ph: 'Inserisci il nome dell\'artista' },
        year: { label: 'Anno', ph: 'es. 1620 ca.' },
        museum: { label: 'Museo', ph: 'es. Uffizi' },
        location: { label: 'Posizione', ph: 'Sala / Collocazione' },
        desc_it: { label: 'Descrizione IT', ph: 'Descrizione in italiano' },
        desc_en: { label: 'Descrizione EN', ph: 'Descrizione in inglese' }
      },
      save: 'Salva Opera',
      filesSelected: (n)=> n ? `${n} file selezionati` : '',
      manage: {
        sectionTitle: 'Gestione Collezione',
        countSuffix: 'opere in collezione',
        headers: { title: 'Titolo', images: 'Immagini', actions: '' },
        loadFailRow: 'Impossibile caricare la collezione',
        emptyRow: 'Nessuna opera presente',
        filesCount: (n)=> n===1 ? '1 file' : `${n} file`,
        edit: 'Modifica',
        delete: 'Elimina',
        confirmDeleteArtwork: 'Eliminare questa opera? L’operazione non può essere annullata.',
        editArtwork: 'Modifica Opera',
        close: 'Chiudi',
        fieldLabels: { Title:'Titolo', Artist:'Artista', Year:'Anno', Museum:'Museo', Location:'Posizione', ItalianDescription:'Descrizione Italiana', EnglishDescription:'Descrizione Inglese' },
        imageFiles: 'File Immagine',
        add: 'Aggiungi',
        cancel: 'Annulla',
        saveChanges: 'Salva Modifiche',
        deleteImageConfirm: (name)=> `Eliminare l’immagine "${name}"?`,
        remove: 'Rimuovi',
        tokenPrompt: 'Inserisci X-Admin-Token',
        deleteFailed: 'Eliminazione non riuscita: ',
        saveFailed: 'Salvataggio non riuscito: ',
        detailsLoadFailed: 'Impossibile caricare i dettagli dell’opera'
      }
    },
    en: {
      title: 'Curator Dashboard',
      subtitle: "Manage your museum's artwork collection",
      signOut: 'Sign Out',
      tabs: ['Add Artwork', 'Manage Collection'],
      sectionTitle: 'Add New Artwork',
      dzStrong: 'Click to upload',
      dzSmall: '',
      imagesLabel: 'Artwork Images',
      fields: {
        title: { label: 'Title', ph: 'Enter artwork title' },
        artist: { label: 'Artist', ph: 'Enter artist name' },
        year: { label: 'Year', ph: 'e.g., 1620 ca.' },
        museum: { label: 'Museum', ph: 'e.g., Uffizi' },
        location: { label: 'Location', ph: 'Room / Placement' },
        desc_it: { label: 'IT description', ph: 'Description in Italian' },
        desc_en: { label: 'EN description', ph: 'Description in English' }
      },
      save: 'Save Artwork',
      filesSelected: (n)=> n ? `${n} file selected` : '',
      manage: {
        sectionTitle: 'Collection Management',
        countSuffix: 'artworks in collection',
        headers: { title: 'Title', images: 'Images', actions: '' },
        loadFailRow: 'Failed to load collection',
        emptyRow: 'No artworks yet',
        filesCount: (n)=> n===1 ? '1 file' : `${n} files`,
        edit: 'Edit',
        delete: 'Delete',
        confirmDeleteArtwork: 'Delete this artwork? This cannot be undone.',
        editArtwork: 'Edit Artwork',
        close: 'Close',
        fieldLabels: { Title:'Title', Artist:'Artist', Year:'Year', Museum:'Museum', Location:'Location', ItalianDescription:'Italian Description', EnglishDescription:'English Description' },
        imageFiles: 'Image Files',
        add: 'Add',
        cancel: 'Cancel',
        saveChanges: 'Save Changes',
        deleteImageConfirm: (name)=> `Delete image "${name}"?`,
        remove: 'Remove',
        tokenPrompt: 'Enter X-Admin-Token',
        deleteFailed: 'Delete failed: ',
        saveFailed: 'Save failed: ',
        detailsLoadFailed: 'Failed to load artwork details'
      }
    }
  };
  function t(){ return I18N[getLang()] || I18N.it; }

  function applyLang(){
    const lang = getLang();
    try { document.documentElement.setAttribute('lang', (lang === 'en' ? 'en' : 'it')); } catch {}
    const tr = t();

    const title = document.querySelector('.head .title');
    const subtitle = document.querySelector('.head .subtitle');
    if (title) title.innerHTML = (lang === 'en') ? 'Curator <br/>Dashboard' : 'Dashboard <br/>Curatore';
    if (subtitle) subtitle.innerHTML = (lang === 'en') ? "Manage your museum's<br/>artwork collection" : 'Gestisci la collezione<br/>del museo';

    const signOut = document.querySelector('#signOutBtn span');
    if (signOut) signOut.textContent = tr.signOut;

    const tabs = document.querySelectorAll('.tabs .tab');
    if (tabs && tabs.length >= 2) {
      tabs[0].textContent = tr.tabs[0];
      tabs[1].textContent = tr.tabs[1];
    }

    const h2 = document.getElementById('addTitle');
    if (h2) {
      const ico = h2.querySelector('.h2-ico');
      h2.textContent = tr.sectionTitle;
      if (ico) { h2.prepend(ico); h2.insertBefore(document.createTextNode(' '), ico.nextSibling); }
    }

    const dz = document.getElementById('drop');
    if (dz) {
      const strong = dz.querySelector('strong');
      const small = dz.querySelector('small');
      if (strong) strong.textContent = tr.dzStrong;
      if (small) small.textContent = tr.dzSmall;
    }

    // Images field label (file input)
    const imgLabel = document.querySelector('label[for="images"]');
    if (imgLabel && tr.imagesLabel) imgLabel.textContent = tr.imagesLabel;

    // Manage section static labels
    try {
      const trm = tr.manage;
      const mt = document.getElementById('mgmtTitle');
      if (mt && trm?.sectionTitle) mt.textContent = trm.sectionTitle;
      const cnt = document.querySelector('.mgmt-count');
      if (cnt && trm?.countSuffix) {
        const n = (cnt.querySelector('#mgmtCount')?.textContent || '0');
        cnt.innerHTML = `<span id="mgmtCount">${n}</span> ${trm.countSuffix}`;
      }
      const th1 = document.querySelector('#collectionTable thead th:nth-child(1)');
      const th2 = document.querySelector('#collectionTable thead th:nth-child(2)');
      const th3 = document.querySelector('#collectionTable thead th:nth-child(3)');
      if (th1 && trm?.headers?.title) th1.textContent = trm.headers.title;
      if (th2 && trm?.headers?.images) th2.textContent = trm.headers.images;
      if (th3 && trm?.headers?.actions) th3.textContent = trm.headers.actions;
    } catch {}

    // Fields labels and placeholders
    const map = [
      { id: 'title', key: 'title' },
      { id: 'artist', key: 'artist' },
      { id: 'year', key: 'year' },
      { id: 'museum', key: 'museum' },
      { id: 'location', key: 'location' },
      { id: 'desc_it', key: 'desc_it' },
      { id: 'desc_en', key: 'desc_en' }
    ];
    map.forEach(({id, key})=>{
      const input = document.getElementById(id);
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) label.textContent = tr.fields[key].label;
      if (input && 'placeholder' in input) input.placeholder = tr.fields[key].ph;
    });

    const saveBtn = document.getElementById('submitBtn');
    if (saveBtn) saveBtn.textContent = tr.save;
  }

  // Auth guard and optional logout handling
  try {
    const AUTH_KEY = 'artlens.auth';
    const qs = new URLSearchParams(location.search);
    if (qs.has('logout')) { try { localStorage.removeItem(AUTH_KEY); } catch(_) {} }
    const authed = !!localStorage.getItem(AUTH_KEY);
    if (!authed) { location.replace('./curator_access.html'); return; }
  } catch (e) {
    try { location.replace('./curator_access.html'); } catch(_) {}
    return;
  }

  applyLang();
  window.addEventListener('storage', (e)=>{ if (e.key === 'lang') applyLang(); });

  // Dropzone behavior for image uploads
  const drop = document.getElementById('drop');
  const input = document.getElementById('images');
  function openPicker(){ try { input?.click(); } catch(_) {} }
  function stop(e){ try { e.preventDefault(); e.stopPropagation(); } catch(_) {} }
  if (drop && input) {
    drop.addEventListener('click', openPicker);
    drop.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { stop(e); openPicker(); }});
    ['dragenter','dragover'].forEach(ev=> drop.addEventListener(ev, (e)=>{ stop(e); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> drop.addEventListener(ev, (e)=>{ stop(e); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e)=>{ const files = e.dataTransfer?.files; if (files?.length) { try { input.files = files; } catch(_) {} input.dispatchEvent(new Event('change',{bubbles:true})); }});
  }
  const out = document.getElementById('statusMsg');
  const previews = document.getElementById('previews');
  let previewURLs = [];
  function clearPreviews(){
    try { previewURLs.forEach(url => URL.revokeObjectURL(url)); } catch(_) {}
    previewURLs = [];
    if (previews) previews.innerHTML = '';
  }
  function renderPreviews(fileList){
    if (!previews) return;
    clearPreviews();
    const files = Array.from(fileList || []);
    const frag = document.createDocumentFragment();
    files.forEach((f)=>{
      if (!f || !f.type?.startsWith('image/')) return;
      const url = URL.createObjectURL(f);
      previewURLs.push(url);
      const fig = document.createElement('figure');
      fig.className = 'preview';
      const img = document.createElement('img');
      img.src = url; img.alt = 'Anteprima immagine';
      fig.appendChild(img);
      frag.appendChild(fig);
    });
    previews.appendChild(frag);
  }
  if (input) input.addEventListener('change', ()=>{
    const n = input.files?.length || 0;
    if (out) {
      try {
        const lang = getLang();
        const tr = (I18N[lang] || I18N.it);
        out.textContent = tr.filesSelected(n);
      } catch(_) {
        out.textContent = n ? `${n} file selected` : '';
      }
    }
    if (n) renderPreviews(input.files);
    else clearPreviews();
  });

  // Clear previews on form reset
  const form = document.getElementById('f');
  if (form) form.addEventListener('reset', ()=>{ clearPreviews(); if (out) out.textContent=''; });

  // Sign out
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', ()=>{ try { localStorage.removeItem('artlens.auth'); } catch(_) {} location.href = './curator_access.html'; });
  // ------------------------------
  // Manage Collection: tabs + table
  // ------------------------------
  const tabs = document.querySelectorAll('.tabs .tab');
  const addSection = document.getElementById('addSection');
  const manageSection = document.getElementById('manageSection');
  const tbody = document.getElementById('collectionBody');
  const countEl = document.getElementById('mgmtCount');

  function switchTab(idx){
    tabs.forEach((b,i)=>{ b.classList.toggle('active', i===idx); b.setAttribute('aria-selected', i===idx ? 'true' : 'false'); });
    if (addSection) addSection.style.display = (idx===0 ? '' : 'none');
    if (manageSection) manageSection.style.display = (idx===1 ? '' : 'none');
    if (idx===1) {
      // lazy load on first open or refresh every time
      loadCollection();
    }
  }

  tabs.forEach((b,i)=> b.addEventListener('click', ()=> switchTab(i)));

  function iconEdit(){
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  }
  function iconTrash(){
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
  }

  async function loadCollection(){
    try {
      if (tbody) tbody.innerHTML = '';
      const res = await fetch(`${BACKEND_URL}/catalog?with_image_counts=1`);
      const items = await res.json();
      renderCollection(Array.isArray(items) ? items : []);
    } catch (e) {
      console.error('Load collection error', e);
      if (tbody) {
        const trm = (I18N[getLang()] || I18N.it).manage;
        tbody.innerHTML = `<tr><td colspan="3" style="color:#a33;">${trm.loadFailRow}</td></tr>`;
      }
    }
  }

  function renderCollection(items){
    if (countEl) countEl.textContent = String(items.length || 0);
    if (!tbody) return;
    const trm = (I18N[getLang()] || I18N.it).manage;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan=\"3\" style=\"color:#5e718f;\">${trm.emptyRow}</td></tr>`;
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((it)=>{
      const tr = document.createElement('tr');
      const n = Number(it.image_count||0);
      tr.innerHTML = `
        <td class=\"col-title\">${escapeHtml(it.title || '')}</td>
        <td class=\"col-images\">${trm.filesCount(n)}</td>
        <td class=\"col-actions\">
          <button class=\"btn-edit\" data-id=\"${it.id}\" type=\"button\" title=\"${trm.edit}\" aria-label=\"${trm.edit}\">${iconEdit()}</button>
          <button class=\"btn-del\" data-id=\"${it.id}\" type=\"button\" title=\"${trm.delete}\" aria-label=\"${trm.delete}\">${iconTrash()}</button>
        </td>
      `;
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);

    // attach handlers
    tbody.querySelectorAll('.btn-del').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const id = e.currentTarget.getAttribute('data-id');
        if (!id) return;
        const trm = (I18N[getLang()] || I18N.it).manage;
        if (!confirm(trm.confirmDeleteArtwork)) return;
        let token = '';
        try { token = localStorage.getItem('X_ADMIN_TOKEN') || ''; } catch{}
        if (!token) token = prompt(trm.tokenPrompt) || '';
        if (!token) return;
        try {
          const resp = await fetch(`${BACKEND_URL}/artworks/${encodeURIComponent(id)}`, { method:'DELETE', headers: { 'X-Admin-Token': token }});
          if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`${resp.status} ${t}`);
          }
          await loadCollection();
        } catch(err){
          const trm2 = (I18N[getLang()] || I18N.it).manage;
          alert(trm2.deleteFailed + (err?.message || err));
        }
      });
    });

    tbody.querySelectorAll('.btn-edit').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.currentTarget.getAttribute('data-id');
        if (id) openEditModal(id);
      });
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"]+/g, (c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]);
  }

  // Default active tab = first (Add). Manage is lazy loaded on click.
  // If URL has ?tab=manage switch to it.
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('tab') === 'manage') switchTab(1);
  } catch {}

  // ------------------------------
  // Edit Modal
  // ------------------------------
  async function openEditModal(artId){
    const ov = document.createElement('div');
    ov.className = 'md-overlay';
    const trm = (I18N[getLang()] || I18N.it).manage;
    ov.innerHTML = `
      <div class="md-card" role="dialog" aria-modal="true" aria-labelledby="mdTitle">
        <div class="md-header">
          <h3 id="mdTitle" class="md-title">${trm.editArtwork}</h3>
          <button class="md-close" type="button" title="${trm.close}" aria-label="${trm.close}">&times;</button>
        </div>
        <div class="md-body">
          <div class="md-grid">
            <div>
              <div class="md-label">${trm.fieldLabels.Title}</div>
              <input id="md_title" class="md-input" />
            </div>
            <div>
              <div class="md-label">${trm.fieldLabels.Artist}</div>
              <input id="md_artist" class="md-input" />
            </div>
            <div>
              <div class="md-label">${trm.fieldLabels.Year}</div>
              <input id="md_year" class="md-input" />
            </div>
            <div>
              <div class="md-label">${trm.fieldLabels.Museum}</div>
              <input id="md_museum" class="md-input" />
            </div>
            <div class="full">
              <div class="md-label">${trm.fieldLabels.Location}</div>
              <input id="md_location" class="md-input" />
            </div>
            <div class="full">
              <div class="md-label">${trm.fieldLabels.ItalianDescription}</div>
              <textarea id="md_desc_it" class="md-textarea"></textarea>
            </div>
            <div class="full">
              <div class="md-label">${trm.fieldLabels.EnglishDescription}</div>
              <textarea id="md_desc_en" class="md-textarea"></textarea>
            </div>
          </div>

          <div class="file-sec">
            <h3>${trm.imageFiles}</h3>
            <div id="md_file_list" class="file-list"></div>
            <div class="add-row">
              <button id="md_add_btn" class="add-btn" type="button">+ ${trm.add}</button>
              <input id="md_hidden_file" type="file" accept="image/png,image/jpeg" multiple style="display:none" />
            </div>
          </div>

          <div class="md-footer">
            <button id="md_cancel" type="button" class="btn-cancel">${trm.cancel}</button>
            <button id="md_save" type="button" class="btn-primary">${trm.saveChanges}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    const close = ()=>{ try { ov.remove(); } catch(_){} };
    ov.querySelector('.md-close')?.addEventListener('click', close);
    ov.querySelector('#md_cancel')?.addEventListener('click', close);

    // Fetch details
    let data;
    try {
      const r = await fetch(`${BACKEND_URL}/artworks/${encodeURIComponent(artId)}`);
      if (!r.ok) throw new Error(await r.text());
      data = await r.json();
    } catch (e) {
      const trmE = (I18N[getLang()] || I18N.it).manage;
      alert(trmE.detailsLoadFailed);
      close();
      return;
    }

    // Prefill fields
    const $ = (id)=> ov.querySelector(id);
    $('#md_title').value = data.title || '';
    $('#md_artist').value = data.artist || '';
    $('#md_year').value = data.year || '';
    $('#md_museum').value = data.museum || '';
    $('#md_location').value = data.location || '';
    const desc = (data.descriptions && typeof data.descriptions === 'object') ? data.descriptions : {};
    $('#md_desc_it').value = desc.it || '';
    $('#md_desc_en').value = desc.en || '';

    const listEl = $('#md_file_list');
    const hiddenFile = $('#md_hidden_file');
    const addBtn = $('#md_add_btn');
    const addName = $('#md_add_filename');
    const usedIds = new Set((data.descriptors||[]).map(d=> String(d.descriptor_id)));
    const existing = Array.isArray(data.descriptors) ? [...data.descriptors] : [];
    const pending = [];

    function makeUnique(base){
      let b = base || 'img';
      let i = 2;
      while (usedIds.has(b)) { b = `${base}-${i++}`; }
      usedIds.add(b);
      return b;
    }

    function renderList(){
      if (!listEl) return;
      listEl.innerHTML = '';
      const frag = document.createDocumentFragment();
      // Existing items
      existing.forEach((d)=>{
        const row = document.createElement('div');
        row.className = 'file-row';
        const trm = (I18N[getLang()] || I18N.it).manage;
        row.innerHTML = `<div class="file-name">${escapeHtml(d.descriptor_id)}</div>` +
          `<button class="file-del" type="button" title="${trm.delete}">${iconTrash()}</button>`;
        row.querySelector('.file-del').addEventListener('click', async ()=>{
          if (!confirm(trm.deleteImageConfirm(d.descriptor_id))) return;
          let token = '';
          try { token = localStorage.getItem('X_ADMIN_TOKEN') || ''; } catch{}
          if (!token) token = prompt(trm.tokenPrompt) || '';
          if (!token) return;
          try {
            const resp = await fetch(`${BACKEND_URL}/artworks/${encodeURIComponent(artId)}/descriptors/${encodeURIComponent(d.descriptor_id)}`, { method:'DELETE', headers:{'X-Admin-Token': token}});
            if (!resp.ok) throw new Error(await resp.text());
            const idx = existing.findIndex(x=> x.descriptor_id === d.descriptor_id);
            if (idx >= 0) existing.splice(idx,1);
            renderList();
          } catch (err){ alert('Delete failed: ' + (err?.message || err)); }
        });
        frag.appendChild(row);
      });
      // Pending items
      pending.forEach((p,idx)=>{
        const row = document.createElement('div');
        row.className = 'file-row';
        const trm = (I18N[getLang()] || I18N.it).manage;
        row.innerHTML = `<div class="file-name">${escapeHtml(p.filename || p.id)}</div>` +
          `<button class="file-del" type="button" title="${trm.remove}">${iconTrash()}</button>`;
        row.querySelector('.file-del').addEventListener('click', ()=>{
          pending.splice(idx,1);
          renderList();
        });
        frag.appendChild(row);
      });
      listEl.appendChild(frag);
    }

    renderList();

    addBtn?.addEventListener('click', ()=> hiddenFile?.click());
    hiddenFile?.addEventListener('change', async ()=>{
      const files = Array.from(hiddenFile.files || []);
      if (!files.length) return;
      addName.value = files[0].name;
      await initEmbeddingModel();
      for (const f of files){
        const can = await imageToCanvas224(f);
        const embedding = embedFromCanvas(can);
        let base = descriptorIdFor(f, pending.length);
        base = makeUnique(base);
        pending.push({ id: base, filename: f.name, embedding });
      }
      hiddenFile.value = '';
      renderList();
    });

    function buildDescriptions(){
      const it = ($('#md_desc_it').value || '').trim();
      const en = ($('#md_desc_en').value || '').trim();
      const d = {}; if (it) d.it = it; if (en) d.en = en; return d;
    }

    $('#md_save')?.addEventListener('click', async ()=>{
      const payload = {
        id: artId,
        title: ($('#md_title').value || '').trim() || null,
        artist: ($('#md_artist').value || '').trim() || null,
        year: ($('#md_year').value || '').trim() || null,
        museum: ($('#md_museum').value || '').trim() || null,
        location: ($('#md_location').value || '').trim() || null,
        descriptions: buildDescriptions(),
        visual_descriptors: pending.map(p=> ({ id: p.id, embedding: p.embedding }))
      };
      let token = '';
      try { token = localStorage.getItem('X_ADMIN_TOKEN') || ''; } catch{}
      if (!token) token = prompt('Enter X-Admin-Token') || '';
      if (!token) return;
      try {
        const res = await fetch(`${BACKEND_URL}/artworks`, { method:'POST', headers:{ 'Content-Type':'application/json','X-Admin-Token': token}, body: JSON.stringify(payload)});
        if (!res.ok) throw new Error(await res.text());
        close();
        await loadCollection();
      } catch (err){
        const trm = (I18N[getLang()] || I18N.it).manage;
        alert(trm.saveFailed + (err?.message || err));
      }
    });
  }
})();
