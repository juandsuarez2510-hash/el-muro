/* ==========================================================================
   EL MURO · Lógica de la aplicación
   ========================================================================== */

/* ==========================================================================
   CONFIGURACIÓN GENERAL
   ========================================================================== */

// Usuarios permitidos (solo dos, según especificación del cliente).
// En un entorno real las contraseñas nunca deberían vivir en el cliente:
// esto es una demo local, para producción usar Supabase Auth / Firebase Auth.
const USERS = {
  'Juanelo': { password: '27deoctubre', color: '#8b5cf6' },
  'Yayiz':   { password: '27deoctubre', color: '#14b8a6' },
};

const STORAGE_KEYS = {
  session: 'muro_session_v1',
  notes:   'muro_notes_v1',
};

/* ==========================================================================
   MÓDULO DE NUBE — SUPABASE
   --------------------------------------------------------------------------
   Para que las notas se vean en tiempo real entre distintos dispositivos:

   1. Crea un proyecto gratis en https://supabase.com
   2. En el "SQL Editor" del proyecto, corre el script de supabase-setup.sql
      (crea la tabla "notes" y sus permisos).
   3. En Database > Replication, activa Realtime para la tabla "notes".
   4. En Project Settings > API, copia "Project URL" y "anon public key".
   5. Pégalas aquí abajo, en supabaseUrl y supabaseAnonKey.

   Mientras estos dos campos estén vacíos, la app sigue funcionando 100%
   local con localStorage (nada se rompe si no la configuras).
   ========================================================================== */

const CLOUD_CONFIG = {
  supabaseUrl: 'https://deyamgscbzujpwygywdt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWFtZ3NjYnp1anB3eWd5d2R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MDE5NjIsImV4cCI6MjEwMTE3Nzk2Mn0.A7f9Adl_ye2wYiUK_f33U3TmBj29zF5fUc6bn__HCJw',
};

let supabaseClient = null;

// La nube está activa solo si hay credenciales Y el SDK de supabase-js
// se cargó correctamente (script en el <head> de index.html).
function isCloudEnabled() {
  return !!(CLOUD_CONFIG.supabaseUrl && CLOUD_CONFIG.supabaseAnonKey && window.supabase);
}

function initSupabase() {
  if (!isCloudEnabled()) return;
  supabaseClient = window.supabase.createClient(CLOUD_CONFIG.supabaseUrl, CLOUD_CONFIG.supabaseAnonKey);
}

async function fetchNotesFromCloud() {
  const { data, error } = await supabaseClient
    .from('notes')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error cargando notas desde Supabase', error);
    return [];
  }
  // La tabla usa "created_at" (snake_case); el resto de la app usa "createdAt".
  return data.map(row => ({
    id: row.id,
    author: row.author,
    text: row.text || '',
    attachments: row.attachments || [],
    createdAt: row.created_at,
  }));
}

async function saveNoteToCloud(note) {
  const { error } = await supabaseClient.from('notes').insert([{
    id: note.id,
    author: note.author,
    text: note.text,
    attachments: note.attachments,
    created_at: note.createdAt,
  }]);
  if (error) console.error('Error guardando la nota en Supabase', error);
}

async function deleteNoteFromCloud(id) {
  const { error } = await supabaseClient.from('notes').delete().eq('id', id);
  if (error) console.error('Error eliminando la nota en Supabase', error);
}

// Escucha inserciones/borrados de CUALQUIER dispositivo y avisa con onChange.
function subscribeToRealtime(onChange) {
  supabaseClient
    .channel('public:notes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, onChange)
    .subscribe();
}


/* ==========================================================================
   ESTADO EN MEMORIA
   ========================================================================== */
let currentUser = null;         // nombre del usuario logueado
let notes = [];                 // arreglo de notas (de la nube o de localStorage)
let pendingAttachments = [];    // adjuntos de la nota que se está redactando
let realtimeSubscribed = false; // evita suscribirse dos veces a Supabase Realtime

/* ==========================================================================
   HELPERS DE PERSISTENCIA LOCAL
   ========================================================================== */
async function loadNotes() {
  if (isCloudEnabled()) {
    notes = await fetchNotesFromCloud();
    persistNotesLocally(); // se guarda también localmente como caché offline
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.notes);
    notes = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error leyendo notas de localStorage', e);
    notes = [];
  }
}

function persistNotesLocally() {
  localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(notes));
}

function saveSession(username) {
  localStorage.setItem(STORAGE_KEYS.session, username);
}

function readSession() {
  return localStorage.getItem(STORAGE_KEYS.session);
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

/* ==========================================================================
   UTILIDADES
   ========================================================================== */
function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function formatDateTime(iso) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  const timePart = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function fileIcon(mime, name) {
  if (mime.includes('pdf')) return 'fa-file-pdf text-rose-400';
  if (mime.includes('word') || name.match(/\.docx?$/i)) return 'fa-file-word text-blue-400';
  if (mime.includes('presentation') || name.match(/\.pptx?$/i)) return 'fa-file-powerpoint text-orange-400';
  if (mime.includes('image')) return 'fa-file-image text-emerald-400';
  return 'fa-file text-slate-400';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function uid() {
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/* ==========================================================================
   LOGIN
   ========================================================================== */
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;

  const match = Object.keys(USERS).find(u => u.toLowerCase() === user.toLowerCase());

  if (match && USERS[match].password === pass) {
    loginError.classList.add('hidden');
    saveSession(match);
    enterApp(match);
  } else {
    loginError.classList.remove('hidden');
    loginForm.classList.remove('anim-in');
    void loginForm.offsetWidth; // reinicia la animación
    loginForm.classList.add('anim-in');
  }
});

async function enterApp(username) {
  currentUser = username;
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  appScreen.classList.add('view-fade-enter');

  setupUserUI();
  await loadNotes();
  renderFeed();

  // Al primer login con la nube activa, escuchamos cambios de CUALQUIER
  // dispositivo (el otro usuario) y refrescamos el muro automáticamente.
  if (isCloudEnabled() && !realtimeSubscribed) {
    realtimeSubscribed = true;
    subscribeToRealtime(async () => {
      notes = await fetchNotesFromCloud();
      persistNotesLocally();
      renderFeed();
    });
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  clearSession();
  currentUser = null;
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginScreen.classList.add('anim-in');
  document.getElementById('login-form').reset();
});

function setupUserUI() {
  const u = USERS[currentUser];

  // Avatar del compositor
  const compAvatar = document.getElementById('composer-avatar');
  compAvatar.textContent = initials(currentUser);
  compAvatar.style.background = `linear-gradient(135deg, ${u.color}, ${u.color}99)`;
  compAvatar.style.boxShadow = `0 0 0 2px rgba(15,23,42,1), 0 0 0 4px ${u.color}55`;

  // Badge del header
  const badge = document.getElementById('current-user-badge');
  badge.innerHTML = `
    <span class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-700 text-white"
      style="background:${u.color}">${initials(currentUser)}</span>
    <span class="text-sm text-slate-300">${escapeHtml(currentUser)}</span>
  `;
  badge.classList.remove('hidden');
}

/* ==========================================================================
   COMPOSITOR DE NOTAS
   ========================================================================== */
const noteInput = document.getElementById('note-input');
const publishBtn = document.getElementById('publish-btn');
const pendingWrap = document.getElementById('pending-attachments');
const fileInput = document.getElementById('file-input');

function refreshPublishState() {
  const hasContent = noteInput.value.trim().length > 0 || pendingAttachments.length > 0;
  publishBtn.disabled = !hasContent;
}
noteInput.addEventListener('input', refreshPublishState);

// Auto-resize del textarea
noteInput.addEventListener('input', () => {
  noteInput.style.height = 'auto';
  noteInput.style.height = Math.min(noteInput.scrollHeight, 220) + 'px';
});

/* --- Adjuntar archivo --- */
document.getElementById('attach-file-btn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files || []);
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB, límite razonable para guardar en localStorage

  for (const file of files) {
    if (file.size > MAX_SIZE) {
      alert(`"${file.name}" supera los 5MB y no se puede adjuntar en el almacenamiento local.`);
      continue;
    }
    const dataUrl = await readFileAsDataURL(file);
    pendingAttachments.push({
      type: 'file',
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      dataUrl,
    });
  }
  fileInput.value = '';
  renderPendingAttachments();
  refreshPublishState();
});

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* --- Adjuntar enlace (modal) --- */
const linkModal = document.getElementById('link-modal');
const linkInput = document.getElementById('link-input');

document.getElementById('attach-link-btn').addEventListener('click', () => {
  linkModal.classList.remove('hidden');
  linkModal.classList.add('flex');
  linkInput.value = '';
  linkInput.focus();
});
document.getElementById('link-cancel').addEventListener('click', closeLinkModal);
linkModal.addEventListener('click', (e) => { if (e.target === linkModal) closeLinkModal(); });

function closeLinkModal() {
  linkModal.classList.add('hidden');
  linkModal.classList.remove('flex');
}

document.getElementById('link-confirm').addEventListener('click', () => {
  let url = linkInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let hostname = url;
  try { hostname = new URL(url).hostname.replace('www.', ''); } catch (_) {}

  pendingAttachments.push({ type: 'link', url, hostname });
  closeLinkModal();
  renderPendingAttachments();
  refreshPublishState();
});

/* --- Render de adjuntos pendientes (antes de publicar) --- */
function renderPendingAttachments() {
  pendingWrap.innerHTML = pendingAttachments.map((att, idx) => {
    if (att.type === 'file') {
      return `
        <div class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg pl-2.5 pr-1.5 py-1.5 text-xs anim-fade">
          <i class="fa-solid ${fileIcon(att.mime, att.name)}"></i>
          <span class="max-w-[140px] truncate text-slate-300">${escapeHtml(att.name)}</span>
          <button data-remove="${idx}" class="remove-pending w-5 h-5 rounded-full hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-rose-400">
            <i class="fa-solid fa-xmark text-[10px]"></i>
          </button>
        </div>`;
    }
    return `
      <div class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg pl-2.5 pr-1.5 py-1.5 text-xs anim-fade">
        <i class="fa-solid fa-link text-cyanx"></i>
        <span class="max-w-[140px] truncate text-slate-300">${escapeHtml(att.hostname)}</span>
        <button data-remove="${idx}" class="remove-pending w-5 h-5 rounded-full hover:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-rose-400">
          <i class="fa-solid fa-xmark text-[10px]"></i>
        </button>
      </div>`;
  }).join('');

  pendingWrap.querySelectorAll('.remove-pending').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingAttachments.splice(Number(btn.dataset.remove), 1);
      renderPendingAttachments();
      refreshPublishState();
    });
  });
}

/* --- Publicar --- */
publishBtn.addEventListener('click', async () => {
  const text = noteInput.value.trim();
  if (!text && pendingAttachments.length === 0) return;

  const note = {
    id: typeof uid === 'function' ? uid() : Date.now().toString(36),
    author: currentUser,
    text,
    attachments: pendingAttachments.slice(),
    createdAt: new Date().toISOString(),
  };

  // 1) Publicación optimista: se ve de inmediato en este dispositivo.
  notes.unshift(note);
  persistNotesLocally();

  // Reset del compositor
  noteInput.value = '';
  noteInput.style.height = 'auto';
  pendingAttachments = 0;
  renderPendingAttachments();
  refreshPublishState();

  renderFeed(true /* animar la nota recién creada */);

  // 2) Si la nube está activa, se guarda ahí; Realtime avisará al otro
  //    dispositivo automáticamente, sin que este tenga que recargar.
  if (isCloudEnabled()) {
    await saveNoteToCloud(note);
  }
});

/* ==========================================================================
   BÚSQUEDA Y FILTROS
   ========================================================================== */
const searchInput = document.getElementById('search-input');
const dateFilter = document.getElementById('date-filter');
const clearFiltersBtn = document.getElementById('clear-filters');

searchInput.addEventListener('input', () => { renderFeed(); toggleClearBtn(); });
dateFilter.addEventListener('change', () => { renderFeed(); toggleClearBtn(); });
clearFiltersBtn.addEventListener('click', () => {
  searchInput.value = '';
  dateFilter.value = '';
  renderFeed();
  toggleClearBtn();
});

function toggleClearBtn() {
  const active = searchInput.value.trim() !== '' || dateFilter.value !== '';
  clearFiltersBtn.classList.toggle('hidden', !active);
}

function getFilteredNotes() {
  const term = searchInput.value.trim().toLowerCase();
  const day = dateFilter.value; // formato YYYY-MM-DD

  return notes.filter(n => {
    const matchesTerm = !term || n.text.toLowerCase().includes(term) || n.author.toLowerCase().includes(term);
    const matchesDay = !day || n.createdAt.slice(0, 10) === day;
    return matchesTerm && matchesDay;
  });
}

/* ==========================================================================
   RENDER DEL FEED
   ========================================================================== */
const feedEl = document.getElementById('notes-feed');
const emptyState = document.getElementById('empty-state');
const noResultsState = document.getElementById('no-results-state');

function renderFeed(justPublished = false) {
  const filtered = getFilteredNotes();

  feedEl.innerHTML = '';
  emptyState.classList.add('hidden');
  noResultsState.classList.add('hidden');

  if (notes.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  if (filtered.length === 0) {
    noResultsState.classList.remove('hidden');
    return;
  }

  filtered.forEach((note, i) => {
    feedEl.appendChild(buildNoteCard(note, justPublished && i === 0));
  });
}

function buildNoteCard(note, animate) {
  const u = USERS[note.author] || { color: '#64748b' };
  const isMine = note.author === currentUser;

  const card = document.createElement('article');
  card.className = `note-card glass rounded-2xl p-4 sm:p-5 border-l-[3px] ${animate ? 'anim-in' : ''}`;
  card.style.borderLeftColor = u.color;
  card.dataset.id = note.id;

  const attachmentsHtml = (note.attachments || []).map(att => {
    if (att.type === 'file') {
      const isImage = att.mime.startsWith('image/');
      return `
        <div class="flex items-center gap-3 bg-slate-900/50 border border-slate-700/70 rounded-xl p-2.5">
          ${isImage
            ? `<img src="${att.dataUrl}" class="w-10 h-10 rounded-lg object-cover shrink-0" alt="${escapeHtml(att.name)}" />`
            : `<div class="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fa-solid ${fileIcon(att.mime, att.name)} text-lg"></i></div>`
          }
          <div class="min-w-0 flex-1">
            <p class="text-sm text-slate-200 truncate">${escapeHtml(att.name)}</p>
            <p class="text-xs text-slate-500">${formatBytes(att.size)}</p>
          </div>
          <a href="${att.dataUrl}" download="${escapeHtml(att.name)}" title="Descargar"
            class="w-8 h-8 rounded-full hover:bg-violet/20 hover:text-violet text-slate-400 flex items-center justify-center transition shrink-0">
            <i class="fa-solid fa-download text-sm"></i>
          </a>
        </div>`;
    }
    return `
      <a href="${att.url}" target="_blank" rel="noopener noreferrer"
        class="flex items-center gap-3 bg-slate-900/50 border border-slate-700/70 rounded-xl p-2.5 hover:border-cyanx/60 transition group">
        <div class="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
          <i class="fa-solid fa-link text-cyanx"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-slate-200 truncate group-hover:text-cyanx transition">${escapeHtml(att.hostname)}</p>
          <p class="text-xs text-slate-500 truncate">${escapeHtml(att.url)}</p>
        </div>
        <i class="fa-solid fa-arrow-up-right-from-square text-slate-500 group-hover:text-cyanx transition shrink-0"></i>
      </a>`;
  }).join('');

  card.innerHTML = `
    <div class="flex items-start gap-3">
      <div class="shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-display font-700 text-white text-sm"
        style="background:linear-gradient(135deg, ${u.color}, ${u.color}99); box-shadow:0 0 0 2px rgba(15,23,42,1), 0 0 0 4px ${u.color}40;">
        ${initials(note.author)}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-display font-600 text-white truncate">${escapeHtml(note.author)}</span>
            ${isMine ? '<span class="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-800/70 px-1.5 py-0.5 rounded">Tú</span>' : ''}
          </div>
          ${isMine ? `<button class="delete-note w-7 h-7 rounded-full hover:bg-rose-500/15 hover:text-rose-400 text-slate-600 flex items-center justify-center transition shrink-0" title="Eliminar nota"><i class="fa-solid fa-trash text-xs"></i></button>` : ''}
        </div>
        <p class="text-xs text-slate-500 mb-2">${formatDateTime(note.createdAt)}</p>
        ${note.text ? `<p class="text-slate-200 text-[15px] leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(note.text)}</p>` : ''}
        ${attachmentsHtml ? `<div class="mt-3 space-y-2">${attachmentsHtml}</div>` : ''}
      </div>
    </div>
  `;

  const delBtn = card.querySelector('.delete-note');
  if (delBtn) {
    delBtn.addEventListener('click', () => deleteNote(note.id));
  }

  return card;
}

function deleteNote(id) {
  const card = feedEl.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.style.transition = 'opacity .2s ease, transform .2s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateX(12px) scale(0.98)';
  }
  setTimeout(async () => {
    notes = notes.filter(n => n.id !== id);
    persistNotesLocally();
    renderFeed();

    if (isCloudEnabled()) {
      await deleteNoteFromCloud(id);
    }
  }, 180);
}

/* Publicar también con Ctrl/Cmd + Enter */
noteInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !publishBtn.disabled) {
    publishBtn.click();
  }
});

/* ==========================================================================
   ARRANQUE DE LA APP
   --------------------------------------------------------------------------
   Se ejecuta al final, después de que TODAS las funciones y variables de
   arriba ya existen. Si esto se ejecutara antes de tiempo (por ejemplo, en
   medio del archivo) y hubiera una sesión guardada, se rompería toda la
   inicialización posterior: por eso siempre debe ir al final.
   ========================================================================== */
(function bootSession() {
  initSupabase(); // no hace nada si CLOUD_CONFIG sigue vacío
  const saved = readSession();
  if (saved && USERS[saved]) {
    enterApp(saved);
  }
  toggleClearBtn();
})();