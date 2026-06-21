/**
 * =========================================================
 * NovaNews — script.js
 * Toàn b? logic: GNews API, Firebase Auth & Firestore,
 * Google AI D?ch thu?t, Ví di?n t?, Tích di?m
 * =========================================================
 */

// =========================================================
// 1. C?U HÌNH & KH?I T?O
// =========================================================

/** GNews API Configuration */
const GNEWS_CONFIG = {
  
  baseUrl: '', // Dùng API proxy qua Vercel Serverless Function
  PAGE_SIZE: 10,       
  MAX_ARTICLES: 100,   
};

/** Firebase Configuration */
const firebaseConfig = {
  apiKey: "AIzaSyA5Y5xK25iK56UgRqIYzNKSqqzlGdOJ_Hs",
  authDomain: "novanews-e93f1.firebaseapp.com",
  projectId: "novanews-e93f1",
  storageBucket: "novanews-e93f1.firebasestorage.app",
  messagingSenderId: "323136735842",
  appId: "1:323136735842:web:2db7994b1e26bb6a8a1f3b",
  measurementId: "G-W92XN9KY4K"
};



/** T? l? d?i di?m */
const EXCHANGE_RATE = { points: 1000, money: 10000 }; // 1000d = 10,000 VNÐ
/** Ði?m thu?ng m?i bài d?c d? th?i gian */
const POINTS_PER_ARTICLE = 5;
/** Th?i gian d?c t?i thi?u d? nh?n di?m (giây) */
const READ_THRESHOLD = 20;

// =========================================================
// 2. KH?I T?O FIREBASE
// =========================================================

/** Import Firebase modules t? CDN (dùng compat version cho d?) */
let auth, db, googleProvider;
let currentUser = null;

/**
 * Kh?i t?o Firebase và các services
 * S? d?ng Firebase compat (global) qua CDN script
 */
async function initFirebase() {
  try {
    // Load Firebase scripts d?ng
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');

    // Kh?i t?o app
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();
    googleProvider = new firebase.auth.GoogleAuthProvider();

    // L?ng nghe tr?ng thái dang nh?p
    auth.onAuthStateChanged(handleAuthStateChange);

    console.log('? Firebase kh?i t?o thành công');
  } catch (err) {
    console.warn('?? Firebase không kh? d?ng (demo mode):', err.message);
    // Ch?y ? ch? d? demo n?u Firebase không load du?c
    setupDemoMode();
  }
}

/**
 * T?i script d?ng và tr? v? Promise
 * @param {string} src - URL c?a script
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}



// =========================================================
// 3. QU?N LÝ TR?NG THÁI UI
// =========================================================

/** State toàn c?c */
const STATE = {
  articles: [],          // T?t c? bài vi?t dã t?i
  filteredArticles: [],  // Bài vi?t sau khi l?c
  currentPage: 0,        // Trang hi?n t?i
  articlesPerPage: 12,   // S? bài m?i trang
  currentCategory: 'general',
  currentArticle: null,  // Bài vi?t dang xem
  readTimer: null,       // Timer d?c bài
  readSeconds: 0,        // S? giây dã d?c
  pointAwarded: false,   // Ðã trao di?m chua
  userProfile: null,     // D? li?u user t? Firestore
  isDemoMode: false,     // Ch? d? demo (không có Firebase)
};

/** C?p nh?t ngày tháng trên header */
function updateHeaderDate() {
  const el = document.getElementById('headerDate');
  if (!el) return;
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  el.textContent = now.toLocaleDateString('vi-VN', options);
}

// =========================================================
// 4. GNEWS API — T?I TIN T?C
// =========================================================

/**
 * T?i bài vi?t t? GNews API
 * @param {string} category - Chuyên m?c tin t?c
 * @param {string} query - T? khóa tìm ki?m (tùy ch?n)
 */
async function fetchNews(category = 'general', query = '') {
  showLoading();
  STATE.articles = [];
  STATE.currentPage = 0;

  try {
    let url;
    if (query) {
      url = `${GNEWS_CONFIG.baseUrl}?q=${encodeURIComponent(query)}`;
    } else {
      url = `${GNEWS_CONFIG.baseUrl}?category=${category}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`GNews API l?i: ${res.status}`);

    const data = await res.json();
    STATE.articles = data.articles || [];

    // C?p nh?t tiêu d? danh sách
    updateSectionTitle(category, query, STATE.articles.length);

    // Render bài vi?t
    renderNewsGrid();

    // Hi?n th? hero (featured)
    if (STATE.articles.length > 0) {
      renderHero(STATE.articles.slice(0, 4));
      updateTicker(STATE.articles[0].title);
    }

  } catch (err) {
    console.error('GNews fetch error:', err);
    showError('Không th? t?i tin t?c. Ðang dùng d? li?u m?u.');
    loadDemoArticles(); // Fallback d? li?u m?u
  }
}

/**
 * T?i thêm bài vi?t (pagination)
 */
async function loadMoreArticles() {
  STATE.currentPage++;
  const start = STATE.currentPage * STATE.articlesPerPage;
  const end = start + STATE.articlesPerPage;
  const batch = STATE.filteredArticles.slice(start, end);

  if (batch.length === 0) {
    document.getElementById('btnLoadMore').textContent = 'Ðã h?t bài vi?t';
    document.getElementById('btnLoadMore').disabled = true;
    return;
  }

  renderArticleCards(batch, true); // append=true
}

/** Render Hero Section */
function renderHero(articles) {
  const heroMain = document.getElementById('heroMain');
  const heroSidebar = document.getElementById('heroSidebar');
  if (!heroMain || !heroSidebar || !articles[0]) return;

  const main = articles[0];

  // Hero chính
  heroMain.innerHTML = `
    <img class="hero-article-img"
      src="${main.image || 'https://placehold.co/800x420/1a1a1a/c9a84c?text=NovaNews'}"
      alt="${escapeHtml(main.title)}"
      onerror="this.src='https://placehold.co/800x420/1a1a1a/c9a84c?text=NovaNews'"
    />
    <div class="hero-content">
      <span class="hero-category">${main.source?.name || 'Tin t?c'}</span>
      <h2 class="hero-title">${escapeHtml(main.title)}</h2>
      <div class="hero-meta">${formatDate(main.publishedAt)}</div>
    </div>
    <div class="hero-overlay"></div>
  `;
  heroMain.onclick = () => openArticleModal(main);

  // Hero sidebar
  heroSidebar.innerHTML = articles.slice(1, 4).map(a => `
    <div class="hero-side-item" onclick="openArticleModal(${JSON.stringify(a).replace(/"/g, '&quot;')})">
      <img class="hero-side-img"
        src="${a.image || 'https://placehold.co/70x70/1a1a1a/c9a84c?text=N'}"
        alt=""
        onerror="this.src='https://placehold.co/70x70/1a1a1a/c9a84c?text=N'"
      />
      <div class="hero-side-content">
        <div class="hero-side-title">${escapeHtml(a.title)}</div>
        <div class="hero-side-meta">${formatDate(a.publishedAt)}</div>
      </div>
    </div>
  `).join('');
}

/** Render lu?i bài vi?t */
function renderNewsGrid() {
  const grid = document.getElementById('newsGrid');
  if (!grid) return;

  STATE.filteredArticles = STATE.articles;
  const firstBatch = STATE.filteredArticles.slice(1, STATE.articlesPerPage + 1);

  grid.innerHTML = '';
  renderArticleCards(firstBatch, false);

  // C?p nh?t count
  const countEl = document.getElementById('articleCount');
  if (countEl) countEl.textContent = `${STATE.articles.length} bài vi?t`;

  // Load more button
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (loadMoreWrap) {
    loadMoreWrap.style.display = STATE.filteredArticles.length > STATE.articlesPerPage + 1 ? 'block' : 'none';
  }
}

/**
 * Render các th? bài vi?t vào grid
 * @param {Array} articles - Danh sách bài vi?t
 * @param {boolean} append - Có append vào grid không hay clear tru?c
 */
function renderArticleCards(articles, append = false) {
  const grid = document.getElementById('newsGrid');
  if (!grid) return;

  if (!append) grid.innerHTML = '';

  articles.forEach(article => {
    const card = createArticleCard(article);
    grid.appendChild(card);
  });
}

/**
 * T?o th? HTML cho m?t bài báo
 * @param {Object} article - Ð?i tu?ng bài báo t? GNews
 * @returns {HTMLElement}
 */
function createArticleCard(article) {
  const div = document.createElement('div');
  div.className = 'article-card';

  div.innerHTML = `
    <div class="card-img-wrap">
      ${article.image
        ? `<img class="card-img" src="${article.image}" alt="${escapeHtml(article.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=card-img-placeholder>??</div>'" />`
        : `<div class="card-img-placeholder">??</div>`
      }
    </div>
    <div class="card-body">
      <div class="card-source">
        <span class="card-source-name">${escapeHtml(article.source?.name || 'Tin t?c')}</span>
      </div>
      <h3 class="card-title">${escapeHtml(article.title)}</h3>
      <p class="card-desc">${escapeHtml(article.description || '')}</p>
      <div class="card-footer">
        <span class="card-date">${formatDate(article.publishedAt)}</span>
        <div class="card-actions">
          <button class="card-btn translate-btn" title="D?ch sang ti?ng Vi?t">?? D?ch</button>
          <button class="card-btn">Ð?c ?</button>
        </div>
      </div>
    </div>
  `;

  // Click card body = m? modal
  div.querySelector('.card-body').addEventListener('click', (e) => {
    if (!e.target.closest('.card-btn')) {
      openArticleModal(article);
    }
  });

  // Click ?nh = m? modal
  div.querySelector('.card-img-wrap').addEventListener('click', () => openArticleModal(article));

  // Nút Ð?c
  const btnRead = div.querySelectorAll('.card-btn')[1];
  if (btnRead) btnRead.addEventListener('click', () => openArticleModal(article));

  // Nút D?ch
  const btnTranslate = div.querySelector('.translate-btn');
  if (btnTranslate) {
    btnTranslate.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnTranslate.textContent = '? Ðang d?ch...';
      btnTranslate.disabled = true;
      const translated = await translateText(
        (article.title + '\n\n' + (article.description || '')).trim()
      );
      if (translated) {
        const descEl = div.querySelector('.card-desc');
        const titleEl = div.querySelector('.card-title');
        const parts = translated.split('\n\n');
        if (titleEl && parts[0]) titleEl.textContent = parts[0];
        if (descEl && parts[1]) descEl.textContent = parts[1];
        btnTranslate.textContent = '? Ðã d?ch';
      } else {
        btnTranslate.textContent = '? L?i d?ch';
      }
    });
  }

  return div;
}

// =========================================================
// 5. MODAL BÀI BÁO CHI TI?T & TÍCH ÐI?M
// =========================================================

/**
 * M? modal xem bài báo chi ti?t + b?t d?u timer tích di?m
 * @param {Object} article - Ð?i tu?ng bài báo
 */
function openArticleModal(article) {
  STATE.currentArticle = article;
  STATE.readSeconds = 0;
  STATE.pointAwarded = false;

  const modal = document.getElementById('articleModal');
  const body = document.getElementById('articleModalBody');
  if (!modal || !body) return;

  body.innerHTML = `
    ${article.image ? `
      <img class="article-hero-img"
        src="${article.image}"
        alt="${escapeHtml(article.title)}"
        onerror="this.style.display='none'"
      />
    ` : ''}
    <div class="article-modal-source">${escapeHtml(article.source?.name || 'Tin t?c')}</div>
    <h1 class="article-modal-title">${escapeHtml(article.title)}</h1>
    <div class="article-modal-meta">
      ?? ${formatDate(article.publishedAt)}
    </div>
    <div class="article-modal-desc" id="articleDesc">
      ${escapeHtml(article.description || article.content || 'Nh?n "Ð?c bài d?y d?" d? xem chi ti?t.')}
    </div>
  `;

  // C?p nh?t link bài g?c
  const linkBtn = document.getElementById('btnReadFull');
  if (linkBtn) linkBtn.href = article.url || '#';

  // ?n di?m cu
  const pointEl = document.getElementById('pointEarned');
  if (pointEl) pointEl.classList.add('hidden');

  // Reset timer hi?n th?
  const timerEl = document.getElementById('timerCount');
  if (timerEl) timerEl.textContent = '0';

  // Hi?n modal
  showModal('articleModal');

  // B?t d?u timer tích di?m
  startReadTimer();
}

/**
 * B?t d?u d?m th?i gian d?c bài và trao di?m khi d? th?i gian
 */
function startReadTimer() {
  clearReadTimer();
  STATE.readSeconds = 0;

  STATE.readTimer = setInterval(() => {
    STATE.readSeconds++;

    const timerEl = document.getElementById('timerCount');
    if (timerEl) timerEl.textContent = STATE.readSeconds;

    // Trao di?m khi d?c d? th?i gian
    if (STATE.readSeconds >= READ_THRESHOLD && !STATE.pointAwarded) {
      STATE.pointAwarded = true;
      awardReadingPoints();
    }
  }, 1000);
}

/** D?ng timer d?c bài */
function clearReadTimer() {
  if (STATE.readTimer) {
    clearInterval(STATE.readTimer);
    STATE.readTimer = null;
  }
}

/**
 * Trao di?m thu?ng cho ngu?i dùng sau khi d?c xong bài
 */
async function awardReadingPoints() {
  if (!currentUser) {
    // Chua dang nh?p - hi?n th? thông báo
    showToast('?? Ðang nh?p d? tích di?m khi d?c báo!', 'info');
    return;
  }

  const pointEl = document.getElementById('pointEarned');
  const pointCount = document.getElementById('pointsEarnedCount');

  if (pointCount) pointCount.textContent = POINTS_PER_ARTICLE;
  if (pointEl) pointEl.classList.remove('hidden');

  // C?p nh?t di?m trong Firestore
  try {
    await addPointsToUser(POINTS_PER_ARTICLE, `Ð?c bài: ${STATE.currentArticle?.title?.slice(0, 50) || 'bài báo'}`);
    showToast(`? +${POINTS_PER_ARTICLE} di?m thu?ng!`, 'success');
  } catch (err) {
    console.error('L?i c?ng di?m:', err);
  }
}

// =========================================================
// 6. GOOGLE AI — D?CH THU?T
// =========================================================

/**
 * D?ch van b?n t? ti?ng Anh sang ti?ng Vi?t qua Gemini API
 * @param {string} text - Van b?n c?n d?ch
 * @returns {Promise<string|null>} - Van b?n dã d?ch
 */
async function translateText(text) {
  if (!text || text.trim().length === 0) return null;

  try {
    const prompt = `D?ch do?n van sau t? ti?ng Anh sang ti?ng Vi?t m?t cách t? nhiên và chính xác. Ch? tr? l?i b?n d?ch, không có gi?i thích thêm:\n\n${text}`;

    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error: ${errData?.error || response.status}`);
    }

    const data = await response.json();
    const translated = data.translated;
    return translated || null;

  } catch (err) {
    console.error('L?i d?ch thu?t:', err);
    return null;
  }
}

/**
 * X? lý s? ki?n nh?n nút "D?ch" trong modal bài báo
 */
async function handleTranslateInModal() {
  const btn = document.getElementById('btnTranslate');
  if (!btn || !STATE.currentArticle) return;

  const textToTranslate = [
    STATE.currentArticle.title,
    STATE.currentArticle.description || STATE.currentArticle.content || ''
  ].filter(Boolean).join('\n\n');

  btn.textContent = '? Ðang d?ch...';
  btn.classList.add('loading');

  const translated = await translateText(textToTranslate);

  btn.classList.remove('loading');

  if (translated) {
    // Hi?n th? b?n d?ch
    const descEl = document.getElementById('articleDesc');
    if (descEl) {
      // Ki?m tra dã có vùng d?ch chua
      let translatedBox = document.getElementById('translatedBox');
      if (!translatedBox) {
        translatedBox = document.createElement('div');
        translatedBox.id = 'translatedBox';
        translatedBox.className = 'article-modal-translated';
        descEl.parentNode.insertBefore(translatedBox, descEl.nextSibling);
      }
      translatedBox.innerHTML = `
        <div class="translated-label">???? B?N D?CH TI?NG VI?T</div>
        <div class="translated-text">${escapeHtml(translated)}</div>
      `;
    }

    btn.innerHTML = `? Ðã d?ch`;
    showToast('? Ðã d?ch thành công!', 'success');
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg> D?ch sang Ti?ng Vi?t`;
    showToast('? L?i d?ch thu?t. Th? l?i sau.', 'error');
  }
}

// =========================================================
// 7. FIREBASE AUTH — ÐANG KÝ / ÐANG NH?P
// =========================================================

/**
 * X? lý thay d?i tr?ng thái dang nh?p
 * @param {Object|null} user - Firebase user object
 */
async function handleAuthStateChange(user) {
  currentUser = user;

  if (user) {
    // Ðã dang nh?p
    document.getElementById('authArea')?.classList.add('hidden');
    document.getElementById('userArea')?.classList.remove('hidden');

    // Hi?n th? tên rút g?n
    const displayName = user.displayName || user.email.split('@')[0];
    const nameEl = document.getElementById('userNameShort');
    const avatarEl = document.getElementById('userAvatarInitial');
    if (nameEl) nameEl.textContent = displayName.slice(0, 10);
    if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();

    // T?i d? li?u user t? Firestore
    await loadUserProfile(user.uid);
    updateWalletBadge();

    showToast(`?? Chào m?ng, ${displayName}!`, 'success');
  } else {
    // Chua dang nh?p
    currentUser = null;
    STATE.userProfile = null;
    document.getElementById('authArea')?.classList.remove('hidden');
    document.getElementById('userArea')?.classList.add('hidden');
    document.getElementById('btnOpenAdmin')?.classList.add('hidden');
    updateWalletBadge();
  }
}

/**
 * Ðang ký tài kho?n m?i v?i Firebase Auth
 */
async function handleRegister() {
  const name = document.getElementById('registerName')?.value?.trim();
  const email = document.getElementById('registerEmail')?.value?.trim();
  const password = document.getElementById('registerPassword')?.value;
  const errEl = document.getElementById('registerError');
  const btn = document.getElementById('btnRegister');

  if (!name || !email || !password) {
    showError('Vui lòng di?n d?y d? thông tin.', errEl); return;
  }
  if (password.length < 6) {
    showError('M?t kh?u t?i thi?u 6 ký t?.', errEl); return;
  }

  btn.textContent = 'Ðang t?o tài kho?n...';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    // T?o user trong Firebase Auth
    const credential = await auth.createUserWithEmailAndPassword(email, password);

    // C?p nh?t displayName
    await credential.user.updateProfile({ displayName: name });

    // T?o h? so user trong Firestore
    await createUserProfile(credential.user.uid, { name, email });

    closeModal('registerModal');
    showToast('?? T?o tài kho?n thành công! B?n nh?n du?c 50 di?m chào m?ng.', 'success');

  } catch (err) {
    const msg = firebaseErrorToVietnamese(err.code);
    showError(msg, errEl);
  } finally {
    btn.textContent = 'T?o Tài Kho?n';
    btn.disabled = false;
  }
}

/**
 * Ðang nh?p v?i email/password
 */
async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');

  if (!email || !password) {
    showError('Vui lòng nh?p email và m?t kh?u.', errEl); return;
  }

  btn.textContent = 'Ðang dang nh?p...';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeModal('loginModal');
  } catch (err) {
    showError(firebaseErrorToVietnamese(err.code), errEl);
  } finally {
    btn.textContent = 'Ðang Nh?p';
    btn.disabled = false;
  }
}

/**
 * Ðang nh?p b?ng Google
 */
async function handleGoogleLogin() {
  try {
    await auth.signInWithPopup(googleProvider);
    closeModal('loginModal');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Ðang nh?p Google th?t b?i: ' + err.message, 'error');
    }
  }
}

/**
 * Ðang xu?t
 */
async function handleLogout() {
  try {
    await auth.signOut();
    showToast('Ðã dang xu?t.', 'info');
  } catch (err) {
    console.error(err);
  }
}

/**
 * Chuy?n Firebase error code sang ti?ng Vi?t
 * @param {string} code - Firebase error code
 */
function firebaseErrorToVietnamese(code) {
  const map = {
    'auth/email-already-in-use': 'Email này dã du?c s? d?ng.',
    'auth/weak-password': 'M?t kh?u quá y?u.',
    'auth/invalid-email': 'Email không h?p l?.',
    'auth/user-not-found': 'Tài kho?n không t?n t?i.',
    'auth/wrong-password': 'M?t kh?u không dúng.',
    'auth/invalid-credential': 'Email ho?c m?t kh?u không dúng.',
    'auth/too-many-requests': 'Quá nhi?u l?n th?. Vui lòng th? l?i sau.',
    'auth/network-request-failed': 'L?i k?t n?i m?ng.',
  };
  return map[code] || `L?i: ${code}`;
}

// =========================================================
// 8. FIRESTORE — QU?N LÝ D? LI?U USER
// =========================================================

/**
 * T?o h? so user m?i trong Firestore
 * @param {string} uid - Firebase user UID
 * @param {Object} data - Thông tin user { name, email }
 */
async function createUserProfile(uid, data) {
  if (!db) return;
  const profile = {
    name: data.name,
    email: data.email,
    role: 'member',     // M?c d?nh là member
    balance: 0,         // S? du ti?n (VNÐ)
    points: 50,         // Ði?m chào m?ng
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    transactions: [],
  };
  await db.collection('users').doc(uid).set(profile);
  STATE.userProfile = profile;
}

/**
 * T?i h? so user t? Firestore
 * @param {string} uid - Firebase user UID
 */
async function loadUserProfile(uid) {
  if (!db) return;
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) {
      STATE.userProfile = doc.data();
    } else {
      // T?o profile m?i n?u chua có (user Google m?i)
      await createUserProfile(uid, {
        name: currentUser.displayName || 'User',
        email: currentUser.email,
      });
    }
    
    // Phân quy?n: Hi?n nút Admin n?u có role là admin
    const btnAdmin = document.getElementById('btnOpenAdmin');
    if (btnAdmin) {
      if (STATE.userProfile.role === 'admin') {
        btnAdmin.classList.remove('hidden');
      } else {
        btnAdmin.classList.add('hidden');
      }
    }
    
    updateWalletDisplay();
  } catch (err) {
    console.error('L?i t?i user profile:', err);
  }
}

/**
 * C?ng di?m cho user
 * @param {number} points - S? di?m c?ng
 * @param {string} reason - Lý do c?ng di?m
 */
async function addPointsToUser(points, reason = '') {
  if (!db || !currentUser) return;

  const newPoints = (STATE.userProfile?.points || 0) + points;
  const tx = {
    type: 'points',
    amount: points,
    reason,
    date: new Date().toISOString(),
  };

  await db.collection('users').doc(currentUser.uid).update({
    points: firebase.firestore.FieldValue.increment(points),
    transactions: firebase.firestore.FieldValue.arrayUnion(tx),
  });

  if (STATE.userProfile) STATE.userProfile.points = newPoints;
  updateWalletDisplay();
  updateWalletBadge();
}

/**
 * C?p nh?t s? du ti?n
 * @param {number} amount - S? ti?n thay d?i (duong = c?ng, âm = tr?)
 * @param {string} reason
 */
async function updateBalance(amount, reason = '') {
  if (!db || !currentUser) return;

  const newBalance = (STATE.userProfile?.balance || 0) + amount;
  if (newBalance < 0) throw new Error('S? du không d?');

  const tx = {
    type: 'money',
    amount,
    reason,
    date: new Date().toISOString(),
  };

  await db.collection('users').doc(currentUser.uid).update({
    balance: firebase.firestore.FieldValue.increment(amount),
    transactions: firebase.firestore.FieldValue.arrayUnion(tx),
  });

  if (STATE.userProfile) STATE.userProfile.balance = newBalance;
  updateWalletDisplay();
  updateWalletBadge();
}

// =========================================================
// 9. VÍ ÐI?N T?
// =========================================================

/** C?p nh?t hi?n th? ví ti?n trong modal */
function updateWalletDisplay() {
  const profile = STATE.userProfile;
  if (!profile) return;

  const balanceEl = document.getElementById('walletBalance');
  const pointsEl = document.getElementById('walletPoints');

  if (balanceEl) balanceEl.textContent = formatMoney(profile.balance || 0);
  if (pointsEl) pointsEl.textContent = `${(profile.points || 0).toLocaleString('vi-VN')} ?`;

  // C?p nh?t n?i dung chuy?n kho?n v?i email user
  const refEl = document.getElementById('depositRef');
  if (refEl && currentUser) {
    refEl.textContent = `NOVANEWS ${currentUser.email?.toUpperCase() || ''}`;
  }

  // Render l?ch s? giao d?ch
  renderTransactionHistory(profile.transactions || []);
}

/** C?p nh?t badge ví trên header */
function updateWalletBadge() {
  const badge = document.getElementById('walletBadge');
  if (!badge) return;
  if (STATE.userProfile) {
    badge.textContent = formatMoneyShort(STATE.userProfile.balance || 0);
  } else {
    badge.textContent = '0d';
  }
}

/**
 * X? lý d?i di?m sang ti?n
 */
async function handleExchange() {
  const input = document.getElementById('exchangePoints');
  const errEl = document.getElementById('exchangeError');
  const successEl = document.getElementById('exchangeSuccess');
  const btn = document.getElementById('btnExchange');

  if (errEl) errEl.classList.add('hidden');
  if (successEl) successEl.classList.add('hidden');

  if (!currentUser || !STATE.userProfile) {
    showError('Vui lòng dang nh?p d? d?i di?m.', errEl); return;
  }

  const points = parseInt(input?.value || '0');
  const userPoints = STATE.userProfile.points || 0;

  if (!points || points < EXCHANGE_RATE.points) {
    showError(`T?i thi?u ${EXCHANGE_RATE.points.toLocaleString('vi-VN')} di?m.`, errEl); return;
  }
  if (points > userPoints) {
    showError(`B?n ch? có ${userPoints.toLocaleString('vi-VN')} di?m.`, errEl); return;
  }
  if (points % EXCHANGE_RATE.points !== 0) {
    showError(`S? di?m ph?i là b?i s? c?a ${EXCHANGE_RATE.points.toLocaleString('vi-VN')}.`, errEl); return;
  }

  btn.textContent = 'Ðang x? lý...';
  btn.disabled = true;

  try {
    const money = (points / EXCHANGE_RATE.points) * EXCHANGE_RATE.money;

    // Tr? di?m
    await db.collection('users').doc(currentUser.uid).update({
      points: firebase.firestore.FieldValue.increment(-points),
      balance: firebase.firestore.FieldValue.increment(money),
      transactions: firebase.firestore.FieldValue.arrayUnion({
        type: 'exchange',
        points: -points,
        money: money,
        reason: `Ð?i ${points.toLocaleString('vi-VN')} di?m ? ${formatMoney(money)}`,
        date: new Date().toISOString(),
      }),
    });

    STATE.userProfile.points -= points;
    STATE.userProfile.balance += money;
    updateWalletDisplay();
    updateWalletBadge();

    if (successEl) {
      successEl.textContent = `? Ð?i thành công! +${formatMoney(money)} vào tài kho?n.`;
      successEl.classList.remove('hidden');
    }
    if (input) input.value = '';
    showToast(`?? Ð?i ${points.toLocaleString('vi-VN')} di?m ? ${formatMoney(money)}`, 'success');

  } catch (err) {
    showError('Ð?i di?m th?t b?i: ' + err.message, errEl);
  } finally {
    btn.textContent = 'Ð?i Ngay';
    btn.disabled = false;
  }
}

/**
 * X? lý yêu c?u rút ti?n
 */
async function handleWithdraw() {
  const bank = document.getElementById('withdrawBank')?.value?.trim();
  const account = document.getElementById('withdrawAccount')?.value?.trim();
  const name = document.getElementById('withdrawName')?.value?.trim();
  const amount = parseInt(document.getElementById('withdrawAmount')?.value || '0');
  const errEl = document.getElementById('withdrawError');
  const successEl = document.getElementById('withdrawSuccess');
  const btn = document.getElementById('btnWithdraw');

  if (errEl) errEl.classList.add('hidden');
  if (successEl) successEl.classList.add('hidden');

  if (!currentUser || !STATE.userProfile) {
    showError('Vui lòng dang nh?p.', errEl); return;
  }
  if (!bank || !account || !name) {
    showError('Vui lòng di?n d?y d? thông tin ngân hàng.', errEl); return;
  }
  if (amount < 50000) {
    showError('S? ti?n t?i thi?u là 50,000 ?.', errEl); return;
  }
  if (amount > (STATE.userProfile.balance || 0)) {
    showError(`S? du không d?. Hi?n có: ${formatMoney(STATE.userProfile.balance || 0)}`, errEl); return;
  }

  btn.textContent = 'Ðang x? lý...';
  btn.disabled = true;

  try {
    // Tr? s? du & ghi giao d?ch
    await db.collection('users').doc(currentUser.uid).update({
      balance: firebase.firestore.FieldValue.increment(-amount),
      transactions: firebase.firestore.FieldValue.arrayUnion({
        type: 'withdraw',
        amount: -amount,
        bank, account, name,
        reason: `Rút ti?n v? ${bank} - ${account}`,
        status: 'pending',
        date: new Date().toISOString(),
      }),
    });

    // Ghi yêu c?u rút ti?n vào collection riêng
    await db.collection('withdrawRequests').add({
      uid: currentUser.uid,
      email: currentUser.email,
      amount, bank, account, name,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    STATE.userProfile.balance -= amount;
    updateWalletDisplay();
    updateWalletBadge();

    if (successEl) {
      successEl.textContent = `? Ðã g?i yêu c?u rút ${formatMoney(amount)}. X? lý trong 1-3 ngày làm vi?c.`;
      successEl.classList.remove('hidden');
    }
    showToast(`?? Yêu c?u rút ${formatMoney(amount)} dã du?c g?i!`, 'success');

  } catch (err) {
    showError('Rút ti?n th?t b?i: ' + err.message, errEl);
  } finally {
    btn.textContent = 'G?i Yêu C?u Rút Ti?n';
    btn.disabled = false;
  }
}

/**
 * Render l?ch s? giao d?ch
 * @param {Array} transactions - M?ng giao d?ch
 */
function renderTransactionHistory(transactions) {
  const list = document.getElementById('txList');
  if (!list) return;

  if (!transactions || transactions.length === 0) {
    list.innerHTML = '<div class="tx-empty">Chua có giao d?ch nào</div>';
    return;
  }

  // S?p x?p m?i nh?t lên d?u
  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

  list.innerHTML = sorted.slice(0, 20).map(tx => {
    const isPlus = (tx.amount || tx.points || 0) > 0;
    const label = tx.reason || (tx.type === 'points' ? 'Ði?m thu?ng' : 'Giao d?ch');
    const amount = tx.type === 'points'
      ? `${tx.amount > 0 ? '+' : ''}${tx.amount} ?`
      : `${tx.amount > 0 ? '+' : ''}${formatMoney(tx.amount || 0)}`;

    return `
      <div class="tx-item">
        <div>
          <div class="tx-label">${escapeHtml(label)}</div>
          <div class="tx-date">${formatDate(tx.date)}</div>
        </div>
        <div class="tx-amount ${isPlus ? 'plus' : 'minus'}">${amount}</div>
      </div>
    `;
  }).join('');
}

// =========================================================
// 10. MODAL HELPERS
// =========================================================

/** M? modal và overlay */
function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.getElementById('modalOverlay')?.classList.add('active');
}

/** Ðóng modal */
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  // Ch? ?n overlay n?u không còn modal nào m?
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
  if (!anyOpen) {
    document.getElementById('modalOverlay')?.classList.remove('active');
  }
}

/** Ðóng t?t c? modal */
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modalOverlay')?.classList.remove('active');
  clearReadTimer();
}

// =========================================================
// 11. TOAST NOTIFICATION
// =========================================================

/**
 * Hi?n th? toast notification
 * @param {string} message - N?i dung thông báo
 * @param {'success'|'error'|'info'} type - Lo?i thông báo
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '?', error: '?', info: '??' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  // T? ?n sau 4 giây
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =========================================================
// 12. UTILITIES
// =========================================================

/** Escape HTML d? tránh XSS */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format ti?n Vi?t Nam
 * @param {number} amount
 */
function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
}

/**
 * Format ti?n ng?n g?n (cho badge)
 * @param {number} amount
 */
function formatMoneyShort(amount) {
  if (amount >= 1000000) return `${(amount/1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount/1000).toFixed(0)}K`;
  return `${amount}d`;
}

/**
 * Format ngày tháng sang ti?ng Vi?t
 * @param {string} dateStr - ISO date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return 'V?a xong';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} phút tru?c`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} gi? tru?c`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} ngày tru?c`;

    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Hi?n th? tr?ng thái loading */
function showLoading() {
  const grid = document.getElementById('newsGrid');
  const heroMain = document.getElementById('heroMain');
  if (grid) {
    grid.innerHTML = `
      <div class="loading-state" id="loadingState">
        <div class="loading-spinner"></div>
        <p>Ðang t?i tin t?c...</p>
      </div>
    `;
  }
  if (heroMain) {
    heroMain.innerHTML = `<div class="hero-skeleton"><div class="skeleton-img"></div></div>`;
  }
}

/**
 * Hi?n th? l?i trong ph?n t? HTML c? th?
 * @param {string} msg - N?i dung l?i
 * @param {HTMLElement} el - Ph?n t? hi?n th? l?i
 */
function showError(msg, el = null) {
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    showToast(msg, 'error');
  }
}

/**
 * C?p nh?t tiêu d? danh sách tin
 * @param {string} cat - Category
 * @param {string} query - Search query
 * @param {number} count - S? bài
 */
function updateSectionTitle(cat, query, count) {
  const el = document.getElementById('sectionTitle');
  if (!el) return;
  const catNames = {
    general: 'Tin M?i Nh?t',
    world: 'Tin Th? Gi?i',
    technology: 'Công Ngh?',
    business: 'Kinh Doanh',
    sports: 'Th? Thao',
    entertainment: 'Gi?i Trí',
    health: 'S?c Kh?e',
    science: 'Khoa H?c',
  };
  el.textContent = query ? `K?t qu?: "${query}"` : (catNames[cat] || 'Tin T?c');
}

/** C?p nh?t ticker n?i dung */
function updateTicker(text) {
  const el = document.getElementById('tickerText');
  if (el && text) el.textContent = text;
}

// =========================================================
// 13. DEMO MODE (Khi Firebase / GNews không kh? d?ng)
// =========================================================

/** D? li?u m?u dùng khi API không ph?n h?i */
const DEMO_ARTICLES = [
  {
    title: "Vi?t Nam d?t m?c tiêu tang tru?ng GDP 7% trong nam 2025",
    description: "Chính ph? Vi?t Nam dã thông qua ngh? quy?t d?t m?c tiêu tang tru?ng kinh t? 7% cho nam 2025, t?p trung vào d?u tu công và phát tri?n công ngh? cao.",
    url: "https://vnexpress.net",
    image: "https://placehold.co/600x400/1a2a1a/52c68b?text=Kinh+t?",
    source: { name: "VnExpress" },
    publishedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    title: "Apple ra m?t iPhone 17 v?i thi?t k? hoàn toàn m?i",
    description: "Apple v?a chính th?c gi?i thi?u dòng iPhone 17 v?i màn hình g?p và chip A19 Bionic, dánh d?u bu?c d?t phá l?n nh?t trong l?ch s? 17 nam c?a iPhone.",
    url: "https://techcrunch.com",
    image: "https://placehold.co/600x400/1a1a2a/5289e0?text=Tech+News",
    source: { name: "TechCrunch" },
    publishedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    title: "Ð?i tuy?n Vi?t Nam vào t? k?t Asian Cup 2026",
    description: "V?i màn trình di?n xu?t s?c, d?i tuy?n bóng dá Vi?t Nam dã giành chi?n th?ng 2-0 tru?c Thái Lan d? l?n d?u tiên trong l?ch s? ti?n vào vòng t? k?t Asian Cup.",
    url: "https://vnexpress.net/the-thao",
    image: "https://placehold.co/600x400/2a1a1a/e05252?text=Th?+thao",
    source: { name: "Bóng Ðá Vi?t Nam" },
    publishedAt: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    title: "ChatGPT-5 ra m?t v?i kh? nang l?p lu?n vu?t tr?i",
    description: "OpenAI dã chính th?c phát hành ChatGPT-5, du?c cho là có kh? nang l?p lu?n và gi?i quy?t v?n d? vu?t tr?i so v?i các phiên b?n tru?c, ti?n g?n hon d?n trí tu? nhân t?o t?ng quát (AGI).",
    url: "https://openai.com",
    image: "https://placehold.co/600x400/1a1a2a/c9a84c?text=AI+News",
    source: { name: "OpenAI Blog" },
    publishedAt: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    title: "Hà N?i tri?n khai h? th?ng xe buýt di?n toàn thành ph?",
    description: "Thành ph? Hà N?i chính th?c dua vào v?n hành 500 xe buýt di?n thay th? hoàn toàn các xe buýt ch?y xang, giúp gi?m 40% lu?ng khí th?i CO2 trong giao thông công c?ng.",
    url: "https://hanoimoi.com.vn",
    image: "https://placehold.co/600x400/1a2a1a/52c68b?text=Giao+thông",
    source: { name: "Hà N?i M?i" },
    publishedAt: new Date(Date.now() - 18000000).toISOString(),
  },
  {
    title: "Bitcoin vu?t m?c 150,000 USD l?n d?u trong l?ch s?",
    description: "Th? tru?ng ti?n di?n t? ch?ng ki?n c?t m?c l?ch s? khi Bitcoin phá v? ngu?ng 150,000 USD/BTC, du?c thúc d?y b?i làn sóng d?u tu t? ch?c và ETF Bitcoin t?i M?.",
    url: "https://coindesk.com",
    image: "https://placehold.co/600x400/2a2a1a/c9a84c?text=Crypto",
    source: { name: "CoinDesk" },
    publishedAt: new Date(Date.now() - 21600000).toISOString(),
  },
  {
    title: "WHO công b? v?c xin phòng ung thu gan hi?u qu? 95%",
    description: "T? ch?c Y t? Th? gi?i (WHO) v?a phê duy?t lo?i v?c xin mRNA m?i phòng ng?a ung thu gan nguyên phát v?i hi?u qu? lên d?n 95%, d? ki?n s? du?c tri?n khai t?i 50 qu?c gia t? nam 2026.",
    url: "https://who.int",
    image: "https://placehold.co/600x400/1a2a2a/52c68b?text=S?c+kh?e",
    source: { name: "WHO" },
    publishedAt: new Date(Date.now() - 25200000).toISOString(),
  },
  {
    title: "SpaceX hoàn thành s? m?nh dua ngu?i lên Sao H?a",
    description: "SpaceX dã chính th?c dua 6 phi hành gia lên b? m?t Sao H?a trong s? m?nh l?ch s? Artemis Mars-1, m? ra k? nguyên m?i cho s? hi?n di?n c?a con ngu?i trên hành tinh d?.",
    url: "https://spacex.com",
    image: "https://placehold.co/600x400/1a1a2a/5289e0?text=Khoa+h?c",
    source: { name: "SpaceX" },
    publishedAt: new Date(Date.now() - 28800000).toISOString(),
  },
];

/** T?i bài vi?t m?u khi API không ho?t d?ng */
function loadDemoArticles() {
  STATE.articles = [...DEMO_ARTICLES];
  STATE.isDemoMode = true;
  renderHero(STATE.articles.slice(0, 4));
  renderNewsGrid();
  updateTicker(STATE.articles[0].title);
  showToast('?? Ðang hi?n th? d? li?u m?u (demo mode)', 'info');
}

/** Setup demo mode khi Firebase không kh? d?ng */
function setupDemoMode() {
  STATE.isDemoMode = true;
  STATE.userProfile = { name: 'Demo User', email: 'demo@example.com', balance: 150000, points: 2500, transactions: [] };
  console.log('?? Ch?y ? ch? d? Demo');
}

// =========================================================
// 14. ADMIN DASHBOARD
// =========================================================

/** T?i danh sách ngu?i dùng cho Admin */
async function loadAdminUsers() {
  const listEl = document.getElementById('adminUsersList');
  if (!listEl || !db) return;

  try {
    const snapshot = await db.collection('users').get();
    if (snapshot.empty) {
      listEl.innerHTML = '<tr><td colspan="5" style="text-align: center;">Không có d? li?u</td></tr>';
      return;
    }

    let html = '';
    snapshot.forEach(doc => {
      const user = doc.data();
      const uid = doc.id;
      const role = user.role || 'member';
      const balance = user.balance || 0;

      html += `
        <tr>
          <td>${escapeHtml(user.email || 'N/A')}</td>
          <td>${escapeHtml(user.name || 'User')}</td>
          <td><span class="role-badge ${role}">${role}</span></td>
          <td id="admin-bal-${uid}">${formatMoney(balance)}</td>
          <td>
            <div class="admin-actions">
              <input type="number" id="admin-input-${uid}" placeholder="S? ti?n" min="1000" step="1000" />
              <button class="btn-admin-action add" onclick="modifyUserBalance('${uid}', 'add')">+ T?ng</button>
              <button class="btn-admin-action sub" onclick="modifyUserBalance('${uid}', 'sub')">- Rút</button>
            </div>
          </td>
        </tr>
      `;
    });
    listEl.innerHTML = html;
  } catch (err) {
    console.error('L?i t?i danh sách ngu?i dùng:', err);
    listEl.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">L?i t?i d? li?u</td></tr>';
  }
}

/** Admin thay d?i s? du c?a user */
window.modifyUserBalance = async function(uid, actionType) {
  if (STATE.userProfile?.role !== 'admin') {
    showToast('T? ch?i truy c?p!', 'error');
    return;
  }

  const inputEl = document.getElementById(`admin-input-${uid}`);
  const amountStr = inputEl?.value;
  let amount = parseInt(amountStr);

  if (!amount || amount <= 0) {
    showToast('Vui lòng nh?p s? ti?n h?p l? (> 0)', 'error');
    return;
  }

  if (actionType === 'sub') {
    amount = -amount;
  }

  try {
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      balance: firebase.firestore.FieldValue.increment(amount),
      transactions: firebase.firestore.FieldValue.arrayUnion({
        type: 'money',
        amount: amount,
        reason: actionType === 'add' ? 'Admin t?ng ti?n' : 'Admin rút ti?n',
        date: new Date().toISOString(),
      })
    });

    const doc = await userRef.get();
    const newBal = doc.data().balance;
    document.getElementById(`admin-bal-${uid}`).textContent = formatMoney(newBal);
    inputEl.value = '';
    
    // N?u là user hi?n t?i, c?p nh?t local state
    if (uid === currentUser?.uid) {
      STATE.userProfile.balance = newBal;
      updateWalletDisplay();
      updateWalletBadge();
    }
    
    showToast(`Ðã ${actionType === 'add' ? 't?ng' : 'rút'} ${formatMoney(Math.abs(amount))} thành công!`, 'success');
  } catch (err) {
    console.error('L?i c?p nh?t s? du:', err);
    showToast('L?i c?p nh?t s? du: ' + err.message, 'error');
  }
};

// =========================================================
// 15. EVENT LISTENERS
// =========================================================
// =========================================================

/** G?n t?t c? event listener sau khi DOM s?n sàng */
function setupEventListeners() {
  // --- Header Actions ---
  document.getElementById('searchToggle')?.addEventListener('click', () => {
    document.getElementById('searchBar')?.classList.toggle('hidden');
  });

  document.getElementById('searchBtn')?.addEventListener('click', () => {
    const q = document.getElementById('searchInput')?.value?.trim();
    if (q) fetchNews('general', q);
  });

  document.getElementById('searchInput')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = document.getElementById('searchInput')?.value?.trim();
      if (q === 'admin123' && currentUser) {
        // Bí m?t nâng c?p quy?n
        await db.collection('users').doc(currentUser.uid).update({ role: 'admin' });
        STATE.userProfile.role = 'admin';
        document.getElementById('btnOpenAdmin')?.classList.remove('hidden');
        showToast('?? Ðã c?p quy?n Qu?n tr? viên (Admin) cho tài kho?n này!', 'success');
        document.getElementById('searchInput').value = '';
        return;
      }
      document.getElementById('searchBtn')?.click();
    }
  });

  // --- Auth Buttons ---
  document.getElementById('btnOpenLogin')?.addEventListener('click', () => showModal('loginModal'));
  document.getElementById('btnOpenRegister')?.addEventListener('click', () => showModal('registerModal'));
  document.getElementById('btnOpenWallet')?.addEventListener('click', () => {
    if (!currentUser && !STATE.isDemoMode) {
      showModal('loginModal');
      showToast('Vui lòng dang nh?p d? dùng ví ti?n.', 'info');
      return;
    }
    updateWalletDisplay();
    showModal('walletModal');
  });
  document.getElementById('btnLogout')?.addEventListener('click', handleLogout);

  // --- Admin ---
  document.getElementById('btnOpenAdmin')?.addEventListener('click', () => {
    if (STATE.userProfile?.role !== 'admin') {
      showToast('T? ch?i truy c?p.', 'error');
      return;
    }
    loadAdminUsers();
    showModal('adminModal');
  });
  document.getElementById('closeAdminModal')?.addEventListener('click', () => closeModal('adminModal'));

  // --- Auth Modals ---
  document.getElementById('btnLogin')?.addEventListener('click', handleLogin);
  document.getElementById('btnRegister')?.addEventListener('click', handleRegister);
  document.getElementById('btnGoogleLogin')?.addEventListener('click', handleGoogleLogin);

  document.getElementById('closeLoginModal')?.addEventListener('click', () => closeModal('loginModal'));
  document.getElementById('closeRegisterModal')?.addEventListener('click', () => closeModal('registerModal'));
  document.getElementById('closeWalletModal')?.addEventListener('click', () => closeModal('walletModal'));
  document.getElementById('closeArticleModal')?.addEventListener('click', () => {
    closeModal('articleModal');
    clearReadTimer();
  });

  document.getElementById('switchToRegister')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal('loginModal');
    showModal('registerModal');
  });
  document.getElementById('switchToLogin')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeModal('registerModal');
    showModal('loginModal');
  });

  // --- Overlay click = dóng modal ---
  document.getElementById('modalOverlay')?.addEventListener('click', closeAllModals);

  // --- Toggle Password Visibility ---
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '??' : '??';
    });
  });

  // --- Category Nav ---
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.currentCategory = btn.dataset.cat;
      fetchNews(STATE.currentCategory);
    });
  });

  // --- View Toggle (Grid / List) ---
  document.getElementById('viewGrid')?.addEventListener('click', () => {
    document.getElementById('newsGrid')?.classList.remove('list-view');
    document.getElementById('viewGrid')?.classList.add('active');
    document.getElementById('viewList')?.classList.remove('active');
  });
  document.getElementById('viewList')?.addEventListener('click', () => {
    document.getElementById('newsGrid')?.classList.add('list-view');
    document.getElementById('viewList')?.classList.add('active');
    document.getElementById('viewGrid')?.classList.remove('active');
  });

  // --- Load More ---
  document.getElementById('btnLoadMore')?.addEventListener('click', loadMoreArticles);

  // --- Article Modal: Translate ---
  document.getElementById('btnTranslate')?.addEventListener('click', handleTranslateInModal);

  // --- Wallet Tabs ---
  document.querySelectorAll('.wallet-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.wallet-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.wallet-tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  // --- Wallet: Exchange Points ---
  document.getElementById('btnExchange')?.addEventListener('click', handleExchange);

  document.getElementById('exchangePoints')?.addEventListener('input', (e) => {
    const points = parseInt(e.target.value || '0');
    const money = Math.floor(points / EXCHANGE_RATE.points) * EXCHANGE_RATE.money;
    const resultEl = document.getElementById('exchangeResult');
    if (resultEl) resultEl.textContent = formatMoney(money);
  });

  // --- Wallet: Withdraw ---
  document.getElementById('btnWithdraw')?.addEventListener('click', handleWithdraw);

  // --- Copy buttons ---
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const copyVal = btn.dataset.copy;
      const dynamicId = btn.dataset.copyDynamic;
      const text = copyVal || document.getElementById(dynamicId)?.textContent || '';

      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Ðã sao chép!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Sao chép';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        showToast('Không th? sao chép. Vui lòng sao chép th? công.', 'error');
      });
    });
  });

  // --- Footer Links ---
  document.getElementById('footerLogin')?.addEventListener('click', (e) => { e.preventDefault(); showModal('loginModal'); });
  document.getElementById('footerRegister')?.addEventListener('click', (e) => { e.preventDefault(); showModal('registerModal'); });
  document.getElementById('footerWallet')?.addEventListener('click', (e) => { e.preventDefault(); showModal('walletModal'); });

  // --- Keyboard: ESC dóng modal ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

// =========================================================
// 15. KH?I Ð?NG ?NG D?NG
// =========================================================

/**
 * Hàm main — kh?i d?ng toàn b? ?ng d?ng
 */
async function init() {
  // C?p nh?t ngày tháng
  updateHeaderDate();

  // G?n s? ki?n
  setupEventListeners();

  // Kh?i t?o Firebase
  await initFirebase();

  // T?i tin t?c
  await fetchNews('general');

  console.log('?? NovaNews dã kh?i d?ng thành công!');
}

// Ch?y khi DOM s?n sàng
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}



/* ================================================ */
/* AI CHATBOT WIDGET — Thêm vào cu?i script.js       */
/* ================================================ */

(function () {
  'use strict';

  // -- C?U HÌNH ------------------------------------
  // Không c?n API Key ? client n?a, g?i qua Vercel serverless proxy

  // -- PH?N T? DOM ----------------------------------
  const fab        = document.getElementById('chatFab');
  const widget     = document.getElementById('chatWidget');
  const closeBtn   = document.getElementById('chatCloseBtn');
  const messagesEl = document.getElementById('chatMessages');
  const inputEl    = document.getElementById('chatInput');
  const sendBtn    = document.getElementById('chatSendBtn');

  // Luu l?ch s? h?i tho?i d? g?i kèm theo t?ng lu?t (multi-turn)
  let conversationHistory = [];
  let isLoading = false; // Tránh g?i nhi?u l?n cùng lúc

  // -- KH?I T?O ------------------------------------

  // Hi?n th? gi? lên tin nh?n chào m?ng
  const welcomeTimeEl = document.getElementById('welcomeTime');
  if (welcomeTimeEl) welcomeTimeEl.textContent = getTime();

  // -- S? KI?N: ÐÓNG / M? WIDGET --------------------
  fab.addEventListener('click', toggleWidget);
  closeBtn.addEventListener('click', closeWidget);

  // Nh?n Enter d? g?i tin
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Nh?n nút G?i
  sendBtn.addEventListener('click', handleSend);

  // -- HÀM: B?T/T?T WIDGET -------------------------
  function toggleWidget() {
    if (widget.classList.contains('is-open')) {
      closeWidget();
    } else {
      openWidget();
    }
  }

  function openWidget() {
    widget.classList.add('is-open');
    fab.classList.add('is-open');
    // Focus vào ô nh?p ngay khi m?
    setTimeout(() => inputEl.focus(), 300);
    scrollToBottom();
  }

  function closeWidget() {
    widget.classList.remove('is-open');
    fab.classList.remove('is-open');
  }

  // -- HÀM: X? LÝ G?I TIN NH?N --------------------
  async function handleSend() {
    const userText = inputEl.value.trim();

    // Không g?i n?u ô tr?ng ho?c dang t?i
    if (!userText || isLoading) return;

    // Hi?n th? tin nh?n ngu?i dùng lên giao di?n
    appendMessage('user', userText);
    inputEl.value = '';
    inputEl.focus();

    // Thêm vào l?ch s? h?i tho?i (d? AI nh? ng? c?nh)
    conversationHistory.push({
      role: 'user',
      parts: [{ text: userText }],
    });

    // Hi?n hi?u ?ng "Ðang suy nghi..."
    const thinkingEl = appendThinking();
    setLoading(true);

    try {
      // G?i Gemini API
      const aiReply = await callGeminiAPI(conversationHistory);

      // Xóa hi?u ?ng loading
      thinkingEl.remove();

      // Hi?n th? câu tr? l?i AI
      appendMessage('ai', aiReply);

      // Thêm ph?n h?i AI vào l?ch s? d? duy trì ng? c?nh
      conversationHistory.push({
        role: 'model',
        parts: [{ text: aiReply }],
      });

    } catch (error) {
      thinkingEl.remove();
      appendMessage('ai', '?? Xin l?i, dã có l?i x?y ra. Vui lòng th? l?i sau giây lát.');
      console.error('[Chatbot Error]', error);
    } finally {
      setLoading(false);
    }
  }

  // -- HÀM: G?I GEMINI API (qua Backend /api/chat) --
  async function callGeminiAPI(history) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error('API Error ' + response.status + ': ' + (errData?.error || response.statusText));
    }

    const data = await response.json();
    return data.text || 'Tôi chua có câu tr? l?i phù h?p cho di?u này.';
  }

  // -- HÀM: THÊM TIN NH?N VÀO GIAO DI?N -----------
  /**
   * @param {'ai'|'user'} role  - Vai trò g?i tin
   * @param {string}      text  - N?i dung tin nh?n
   */
  function appendMessage(role, text) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message chat-message--${role}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-message__bubble';
    // Cho phép xu?ng dòng t? nhiên, không render HTML t? AI
    bubbleEl.textContent = text;

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-message__time';
    timeEl.textContent = getTime();

    msgEl.appendChild(bubbleEl);
    msgEl.appendChild(timeEl);
    messagesEl.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  // -- HÀM: HI?U ?NG "ÐANG SUY NGHI..." ----------
  function appendThinking() {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message chat-message--ai chat-thinking';

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-message__bubble';
    bubbleEl.setAttribute('aria-label', 'Ðang suy nghi...');

    // 3 ch?m nh?y
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'chat-thinking__dot';
      bubbleEl.appendChild(dot);
    }

    msgEl.appendChild(bubbleEl);
    messagesEl.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  // -- HÀM: KHOÁ/M? KHOÁ GIAO DI?N KHI ÐANG T?I --
  function setLoading(state) {
    isLoading = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
  }

  // -- HÀM: CU?N XU?NG TIN NH?N M?I NH?T ----------
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // -- HÀM: L?Y GI? HI?N T?I ----------------------
  function getTime() {
    return new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

})(); // K?t thúc IIFE — tránh ô nhi?m bi?n toàn c?c

