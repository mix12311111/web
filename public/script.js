/**
 * =========================================================
 * NovaNews — script.js
 * Toàn bộ logic: GNews API, Firebase Auth & Firestore,
 * Google AI Dịch thuật, Ví điện tử, Tích điểm
 * =========================================================
 */

// =========================================================
// 1. CẤU HÌNH & KHỞI TẠO
// =========================================================

/** GNews API Configuration */
const GNEWS_CONFIG = {
  baseUrl: '/api/news', // Dùng API proxy qua Vercel Serverless Function
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



/** Tỉ lệ đổi điểm */
const EXCHANGE_RATE = { points: 1000, money: 10000 }; // 1000đ = 10,000 VNĐ
/** Điểm thưởng mỗi bài đọc đủ thời gian */
const POINTS_PER_ARTICLE = 5;
/** Thời gian đọc tối thiểu để nhận điểm (giây) */
const READ_THRESHOLD = 20;

// =========================================================
// 2. KHỞI TẠO FIREBASE
// =========================================================

/** Import Firebase modules từ CDN (dùng compat version cho dễ) */
let auth, db, googleProvider;
let currentUser = null;

/**
 * Khởi tạo Firebase và các services
 * Sử dụng Firebase compat (global) qua CDN script
 */
async function initFirebase() {
  try {
    // Load Firebase scripts động
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');

    // Khởi tạo app
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();
    googleProvider = new firebase.auth.GoogleAuthProvider();

    // Lắng nghe trạng thái đăng nhập
    auth.onAuthStateChanged(handleAuthStateChange);

    console.log('✅ Firebase khởi tạo thành công');
  } catch (err) {
    console.warn('⚠️ Firebase không khả dụng (demo mode):', err.message);
    // Chạy ở chế độ demo nếu Firebase không load được
    setupDemoMode();
  }
}

/**
 * Tải script động và trả về Promise
 * @param {string} src - URL của script
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
// 3. QUẢN LÝ TRẠNG THÁI UI
// =========================================================

/** State toàn cục */
const STATE = {
  articles: [],          // Tất cả bài viết đã tải
  filteredArticles: [],  // Bài viết sau khi lọc
  currentPage: 0,        // Trang hiện tại
  articlesPerPage: 12,   // Số bài mỗi trang
  currentCategory: 'general',
  currentArticle: null,  // Bài viết đang xem
  readTimer: null,       // Timer đọc bài
  readSeconds: 0,        // Số giây đã đọc
  pointAwarded: false,   // Đã trao điểm chưa
  userProfile: null,     // Dữ liệu user từ Firestore
  isDemoMode: false,     // Chế độ demo (không có Firebase)
};

/** Cập nhật ngày tháng trên header */
function updateHeaderDate() {
  const el = document.getElementById('headerDate');
  if (!el) return;
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  el.textContent = now.toLocaleDateString('vi-VN', options);
}

// =========================================================
// 4. GNEWS API — TẢI TIN TỨC
// =========================================================

/**
 * Tải bài viết từ GNews API
 * @param {string} category - Chuyên mục tin tức
 * @param {string} query - Từ khóa tìm kiếm (tùy chọn)
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
    if (!res.ok) throw new Error(`GNews API lỗi: ${res.status}`);

    const data = await res.json();
    STATE.articles = data.articles || [];

    // Cập nhật tiêu đề danh sách
    updateSectionTitle(category, query, STATE.articles.length);

    // Render bài viết
    renderNewsGrid();

    // Hiển thị hero (featured)
    if (STATE.articles.length > 0) {
      renderHero(STATE.articles.slice(0, 4));
      updateTicker(STATE.articles[0].title);
    }

  } catch (err) {
    console.error('GNews fetch error:', err);
    showError('Không thể tải tin tức. Đang dùng dữ liệu mẫu.');
    loadDemoArticles(); // Fallback dữ liệu mẫu
  }
}

/**
 * Tải thêm bài viết (pagination)
 */
async function loadMoreArticles() {
  STATE.currentPage++;
  const start = STATE.currentPage * STATE.articlesPerPage;
  const end = start + STATE.articlesPerPage;
  const batch = STATE.filteredArticles.slice(start, end);

  if (batch.length === 0) {
    document.getElementById('btnLoadMore').textContent = 'Đã hết bài viết';
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
      <span class="hero-category">${main.source?.name || 'Tin tức'}</span>
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

/** Render lưới bài viết */
function renderNewsGrid() {
  const grid = document.getElementById('newsGrid');
  if (!grid) return;

  STATE.filteredArticles = STATE.articles;
  const firstBatch = STATE.filteredArticles.slice(1, STATE.articlesPerPage + 1);

  grid.innerHTML = '';
  renderArticleCards(firstBatch, false);

  // Cập nhật count
  const countEl = document.getElementById('articleCount');
  if (countEl) countEl.textContent = `${STATE.articles.length} bài viết`;

  // Load more button
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (loadMoreWrap) {
    loadMoreWrap.style.display = STATE.filteredArticles.length > STATE.articlesPerPage + 1 ? 'block' : 'none';
  }
}

/**
 * Render các thẻ bài viết vào grid
 * @param {Array} articles - Danh sách bài viết
 * @param {boolean} append - Có append vào grid không hay clear trước
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
 * Tạo thẻ HTML cho một bài báo
 * @param {Object} article - Đối tượng bài báo từ GNews
 * @returns {HTMLElement}
 */
function createArticleCard(article) {
  const div = document.createElement('div');
  div.className = 'article-card';

  div.innerHTML = `
    <div class="card-img-wrap">
      ${article.image
        ? `<img class="card-img" src="${article.image}" alt="${escapeHtml(article.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=card-img-placeholder>📰</div>'" />`
        : `<div class="card-img-placeholder">📰</div>`
      }
    </div>
    <div class="card-body">
      <div class="card-source">
        <span class="card-source-name">${escapeHtml(article.source?.name || 'Tin tức')}</span>
      </div>
      <h3 class="card-title">${escapeHtml(article.title)}</h3>
      <p class="card-desc">${escapeHtml(article.description || '')}</p>
      <div class="card-footer">
        <span class="card-date">${formatDate(article.publishedAt)}</span>
        <div class="card-actions">
          <button class="card-btn translate-btn" title="Dịch sang tiếng Việt">🌐 Dịch</button>
          <button class="card-btn">Đọc →</button>
        </div>
      </div>
    </div>
  `;

  // Click card body = mở modal
  div.querySelector('.card-body').addEventListener('click', (e) => {
    if (!e.target.closest('.card-btn')) {
      openArticleModal(article);
    }
  });

  // Click ảnh = mở modal
  div.querySelector('.card-img-wrap').addEventListener('click', () => openArticleModal(article));

  // Nút Đọc
  const btnRead = div.querySelectorAll('.card-btn')[1];
  if (btnRead) btnRead.addEventListener('click', () => openArticleModal(article));

  // Nút Dịch
  const btnTranslate = div.querySelector('.translate-btn');
  if (btnTranslate) {
    btnTranslate.addEventListener('click', async (e) => {
      e.stopPropagation();
      btnTranslate.textContent = '⏳ Đang dịch...';
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
        btnTranslate.textContent = '✓ Đã dịch';
      } else {
        btnTranslate.textContent = '❌ Lỗi dịch';
      }
    });
  }

  return div;
}

// =========================================================
// 5. MODAL BÀI BÁO CHI TIẾT & TÍCH ĐIỂM
// =========================================================

/**
 * Mở modal xem bài báo chi tiết + bắt đầu timer tích điểm
 * @param {Object} article - Đối tượng bài báo
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
    <div class="article-modal-source">${escapeHtml(article.source?.name || 'Tin tức')}</div>
    <h1 class="article-modal-title">${escapeHtml(article.title)}</h1>
    <div class="article-modal-meta">
      🕐 ${formatDate(article.publishedAt)}
    </div>
    <div class="article-modal-desc" id="articleDesc">
      ${escapeHtml(article.description || article.content || 'Nhấn "Đọc bài đầy đủ" để xem chi tiết.')}
    </div>
  `;

  // Cập nhật link bài gốc
  const linkBtn = document.getElementById('btnReadFull');
  if (linkBtn) linkBtn.href = article.url || '#';

  // Ẩn điểm cũ
  const pointEl = document.getElementById('pointEarned');
  if (pointEl) pointEl.classList.add('hidden');

  // Reset timer hiển thị
  const timerEl = document.getElementById('timerCount');
  if (timerEl) timerEl.textContent = '0';

  // Hiện modal
  showModal('articleModal');

  // Bắt đầu timer tích điểm
  startReadTimer();
}

/**
 * Bắt đầu đếm thời gian đọc bài và trao điểm khi đủ thời gian
 */
function startReadTimer() {
  clearReadTimer();
  STATE.readSeconds = 0;

  STATE.readTimer = setInterval(() => {
    STATE.readSeconds++;

    const timerEl = document.getElementById('timerCount');
    if (timerEl) timerEl.textContent = STATE.readSeconds;

    // Trao điểm khi đọc đủ thời gian
    if (STATE.readSeconds >= READ_THRESHOLD && !STATE.pointAwarded) {
      STATE.pointAwarded = true;
      awardReadingPoints();
    }
  }, 1000);
}

/** Dừng timer đọc bài */
function clearReadTimer() {
  if (STATE.readTimer) {
    clearInterval(STATE.readTimer);
    STATE.readTimer = null;
  }
}

/**
 * Trao điểm thưởng cho người dùng sau khi đọc xong bài
 */
async function awardReadingPoints() {
  if (!currentUser) {
    // Chưa đăng nhập - hiển thị thông báo
    showToast('💡 Đăng nhập để tích điểm khi đọc báo!', 'info');
    return;
  }

  const pointEl = document.getElementById('pointEarned');
  const pointCount = document.getElementById('pointsEarnedCount');

  if (pointCount) pointCount.textContent = POINTS_PER_ARTICLE;
  if (pointEl) pointEl.classList.remove('hidden');

  // Cập nhật điểm trong Firestore
  try {
    await addPointsToUser(POINTS_PER_ARTICLE, `Đọc bài: ${STATE.currentArticle?.title?.slice(0, 50) || 'bài báo'}`);
    showToast(`⭐ +${POINTS_PER_ARTICLE} điểm thưởng!`, 'success');
  } catch (err) {
    console.error('Lỗi cộng điểm:', err);
  }
}

// =========================================================
// 6. GOOGLE AI — DỊCH THUẬT
// =========================================================

/**
 * Dịch văn bản từ tiếng Anh sang tiếng Việt qua Gemini API
 * @param {string} text - Văn bản cần dịch
 * @returns {Promise<string|null>} - Văn bản đã dịch
 */
async function translateText(text) {
  if (!text || text.trim().length === 0) return null;

  try {
    const prompt = `Dịch đoạn văn sau từ tiếng Anh sang tiếng Việt một cách tự nhiên và chính xác. Chỉ trả lại bản dịch, không có giải thích thêm:\n\n${text}`;

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
    console.error('Lỗi dịch thuật:', err);
    return null;
  }
}

/**
 * Xử lý sự kiện nhấn nút "Dịch" trong modal bài báo
 */
async function handleTranslateInModal() {
  const btn = document.getElementById('btnTranslate');
  if (!btn || !STATE.currentArticle) return;

  const textToTranslate = [
    STATE.currentArticle.title,
    STATE.currentArticle.description || STATE.currentArticle.content || ''
  ].filter(Boolean).join('\n\n');

  btn.textContent = '⏳ Đang dịch...';
  btn.classList.add('loading');

  const translated = await translateText(textToTranslate);

  btn.classList.remove('loading');

  if (translated) {
    // Hiển thị bản dịch
    const descEl = document.getElementById('articleDesc');
    if (descEl) {
      // Kiểm tra đã có vùng dịch chưa
      let translatedBox = document.getElementById('translatedBox');
      if (!translatedBox) {
        translatedBox = document.createElement('div');
        translatedBox.id = 'translatedBox';
        translatedBox.className = 'article-modal-translated';
        descEl.parentNode.insertBefore(translatedBox, descEl.nextSibling);
      }
      translatedBox.innerHTML = `
        <div class="translated-label">🇻🇳 BẢN DỊCH TIẾNG VIỆT</div>
        <div class="translated-text">${escapeHtml(translated)}</div>
      `;
    }

    btn.innerHTML = `✓ Đã dịch`;
    showToast('✅ Đã dịch thành công!', 'success');
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg> Dịch sang Tiếng Việt`;
    showToast('❌ Lỗi dịch thuật. Thử lại sau.', 'error');
  }
}

// =========================================================
// 7. FIREBASE AUTH — ĐĂNG KÝ / ĐĂNG NHẬP
// =========================================================

/**
 * Xử lý thay đổi trạng thái đăng nhập
 * @param {Object|null} user - Firebase user object
 */
async function handleAuthStateChange(user) {
  currentUser = user;

  if (user) {
    // Đã đăng nhập
    document.getElementById('authArea')?.classList.add('hidden');
    document.getElementById('userArea')?.classList.remove('hidden');

    // Hiển thị tên rút gọn
    const displayName = user.displayName || user.email.split('@')[0];
    const nameEl = document.getElementById('userNameShort');
    const avatarEl = document.getElementById('userAvatarInitial');
    if (nameEl) nameEl.textContent = displayName.slice(0, 10);
    if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();

    // Tải dữ liệu user từ Firestore
    await loadUserProfile(user.uid);
    updateWalletBadge();

    showToast(`👋 Chào mừng, ${displayName}!`, 'success');
  } else {
    // Chưa đăng nhập
    currentUser = null;
    STATE.userProfile = null;
    document.getElementById('authArea')?.classList.remove('hidden');
    document.getElementById('userArea')?.classList.add('hidden');
    document.getElementById('btnOpenAdmin')?.classList.add('hidden');
    updateWalletBadge();
  }
}

/**
 * Đăng ký tài khoản mới với Firebase Auth
 */
async function handleRegister() {
  const name = document.getElementById('registerName')?.value?.trim();
  const email = document.getElementById('registerEmail')?.value?.trim();
  const password = document.getElementById('registerPassword')?.value;
  const errEl = document.getElementById('registerError');
  const btn = document.getElementById('btnRegister');

  if (!name || !email || !password) {
    showError('Vui lòng điền đầy đủ thông tin.', errEl); return;
  }
  if (password.length < 6) {
    showError('Mật khẩu tối thiểu 6 ký tự.', errEl); return;
  }

  btn.textContent = 'Đang tạo tài khoản...';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    // Tạo user trong Firebase Auth
    const credential = await auth.createUserWithEmailAndPassword(email, password);

    // Cập nhật displayName
    await credential.user.updateProfile({ displayName: name });

    // Tạo hồ sơ user trong Firestore
    await createUserProfile(credential.user.uid, { name, email });

    closeModal('registerModal');
    showToast('🎉 Tạo tài khoản thành công! Bạn nhận được 50 điểm chào mừng.', 'success');

  } catch (err) {
    const msg = firebaseErrorToVietnamese(err.code);
    showError(msg, errEl);
  } finally {
    btn.textContent = 'Tạo Tài Khoản';
    btn.disabled = false;
  }
}

/**
 * Đăng nhập với email/password
 */
async function handleLogin() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');

  if (!email || !password) {
    showError('Vui lòng nhập email và mật khẩu.', errEl); return;
  }

  btn.textContent = 'Đang đăng nhập...';
  btn.disabled = true;
  if (errEl) errEl.classList.add('hidden');

  try {
    await auth.signInWithEmailAndPassword(email, password);
    closeModal('loginModal');
  } catch (err) {
    showError(firebaseErrorToVietnamese(err.code), errEl);
  } finally {
    btn.textContent = 'Đăng Nhập';
    btn.disabled = false;
  }
}

/**
 * Đăng nhập bằng Google
 */
async function handleGoogleLogin() {
  try {
    await auth.signInWithPopup(googleProvider);
    closeModal('loginModal');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Đăng nhập Google thất bại: ' + err.message, 'error');
    }
  }
}

/**
 * Đăng xuất
 */
async function handleLogout() {
  try {
    await auth.signOut();
    showToast('Đã đăng xuất.', 'info');
  } catch (err) {
    console.error(err);
  }
}

/**
 * Chuyển Firebase error code sang tiếng Việt
 * @param {string} code - Firebase error code
 */
function firebaseErrorToVietnamese(code) {
  const map = {
    'auth/email-already-in-use': 'Email này đã được sử dụng.',
    'auth/weak-password': 'Mật khẩu quá yếu.',
    'auth/invalid-email': 'Email không hợp lệ.',
    'auth/user-not-found': 'Tài khoản không tồn tại.',
    'auth/wrong-password': 'Mật khẩu không đúng.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau.',
    'auth/network-request-failed': 'Lỗi kết nối mạng.',
  };
  return map[code] || `Lỗi: ${code}`;
}

// =========================================================
// 8. FIRESTORE — QUẢN LÝ DỮ LIỆU USER
// =========================================================

/**
 * Tạo hồ sơ user mới trong Firestore
 * @param {string} uid - Firebase user UID
 * @param {Object} data - Thông tin user { name, email }
 */
async function createUserProfile(uid, data) {
  if (!db) return;
  const profile = {
    name: data.name,
    email: data.email,
    role: 'member',     // Mặc định là member
    balance: 0,         // Số dư tiền (VNĐ)
    points: 50,         // Điểm chào mừng
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    transactions: [],
  };
  await db.collection('users').doc(uid).set(profile);
  STATE.userProfile = profile;
}

/**
 * Tải hồ sơ user từ Firestore
 * @param {string} uid - Firebase user UID
 */
async function loadUserProfile(uid) {
  if (!db) return;
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) {
      STATE.userProfile = doc.data();
    } else {
      // Tạo profile mới nếu chưa có (user Google mới)
      await createUserProfile(uid, {
        name: currentUser.displayName || 'User',
        email: currentUser.email,
      });
    }
    
    // Phân quyền: Hiện nút Admin nếu có role là admin
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
    console.error('Lỗi tải user profile:', err);
  }
}

/**
 * Cộng điểm cho user
 * @param {number} points - Số điểm cộng
 * @param {string} reason - Lý do cộng điểm
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
 * Cập nhật số dư tiền
 * @param {number} amount - Số tiền thay đổi (dương = cộng, âm = trừ)
 * @param {string} reason
 */
async function updateBalance(amount, reason = '') {
  if (!db || !currentUser) return;

  const newBalance = (STATE.userProfile?.balance || 0) + amount;
  if (newBalance < 0) throw new Error('Số dư không đủ');

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
// 9. VÍ ĐIỆN TỬ
// =========================================================

/** Cập nhật hiển thị ví tiền trong modal */
function updateWalletDisplay() {
  const profile = STATE.userProfile;
  if (!profile) return;

  const balanceEl = document.getElementById('walletBalance');
  const pointsEl = document.getElementById('walletPoints');

  if (balanceEl) balanceEl.textContent = formatMoney(profile.balance || 0);
  if (pointsEl) pointsEl.textContent = `${(profile.points || 0).toLocaleString('vi-VN')} ✦`;

  // Cập nhật nội dung chuyển khoản với email user
  const refEl = document.getElementById('depositRef');
  if (refEl && currentUser) {
    refEl.textContent = `NOVANEWS ${currentUser.email?.toUpperCase() || ''}`;
  }

  // Render lịch sử giao dịch
  renderTransactionHistory(profile.transactions || []);
}

/** Cập nhật badge ví trên header */
function updateWalletBadge() {
  const badge = document.getElementById('walletBadge');
  if (!badge) return;
  if (STATE.userProfile) {
    badge.textContent = formatMoneyShort(STATE.userProfile.balance || 0);
  } else {
    badge.textContent = '0đ';
  }
}

/**
 * Xử lý đổi điểm sang tiền
 */
async function handleExchange() {
  const input = document.getElementById('exchangePoints');
  const errEl = document.getElementById('exchangeError');
  const successEl = document.getElementById('exchangeSuccess');
  const btn = document.getElementById('btnExchange');

  if (errEl) errEl.classList.add('hidden');
  if (successEl) successEl.classList.add('hidden');

  if (!currentUser || !STATE.userProfile) {
    showError('Vui lòng đăng nhập để đổi điểm.', errEl); return;
  }

  const points = parseInt(input?.value || '0');
  const userPoints = STATE.userProfile.points || 0;

  if (!points || points < EXCHANGE_RATE.points) {
    showError(`Tối thiểu ${EXCHANGE_RATE.points.toLocaleString('vi-VN')} điểm.`, errEl); return;
  }
  if (points > userPoints) {
    showError(`Bạn chỉ có ${userPoints.toLocaleString('vi-VN')} điểm.`, errEl); return;
  }
  if (points % EXCHANGE_RATE.points !== 0) {
    showError(`Số điểm phải là bội số của ${EXCHANGE_RATE.points.toLocaleString('vi-VN')}.`, errEl); return;
  }

  btn.textContent = 'Đang xử lý...';
  btn.disabled = true;

  try {
    const money = (points / EXCHANGE_RATE.points) * EXCHANGE_RATE.money;

    // Trừ điểm
    await db.collection('users').doc(currentUser.uid).update({
      points: firebase.firestore.FieldValue.increment(-points),
      balance: firebase.firestore.FieldValue.increment(money),
      transactions: firebase.firestore.FieldValue.arrayUnion({
        type: 'exchange',
        points: -points,
        money: money,
        reason: `Đổi ${points.toLocaleString('vi-VN')} điểm → ${formatMoney(money)}`,
        date: new Date().toISOString(),
      }),
    });

    STATE.userProfile.points -= points;
    STATE.userProfile.balance += money;
    updateWalletDisplay();
    updateWalletBadge();

    if (successEl) {
      successEl.textContent = `✅ Đổi thành công! +${formatMoney(money)} vào tài khoản.`;
      successEl.classList.remove('hidden');
    }
    if (input) input.value = '';
    showToast(`💰 Đổi ${points.toLocaleString('vi-VN')} điểm → ${formatMoney(money)}`, 'success');

  } catch (err) {
    showError('Đổi điểm thất bại: ' + err.message, errEl);
  } finally {
    btn.textContent = 'Đổi Ngay';
    btn.disabled = false;
  }
}

/**
 * Xử lý yêu cầu rút tiền
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
    showError('Vui lòng đăng nhập.', errEl); return;
  }
  if (!bank || !account || !name) {
    showError('Vui lòng điền đầy đủ thông tin ngân hàng.', errEl); return;
  }
  if (amount < 50000) {
    showError('Số tiền tối thiểu là 50,000 ₫.', errEl); return;
  }
  if (amount > (STATE.userProfile.balance || 0)) {
    showError(`Số dư không đủ. Hiện có: ${formatMoney(STATE.userProfile.balance || 0)}`, errEl); return;
  }

  btn.textContent = 'Đang xử lý...';
  btn.disabled = true;

  try {
    // Trừ số dư & ghi giao dịch
    await db.collection('users').doc(currentUser.uid).update({
      balance: firebase.firestore.FieldValue.increment(-amount),
      transactions: firebase.firestore.FieldValue.arrayUnion({
        type: 'withdraw',
        amount: -amount,
        bank, account, name,
        reason: `Rút tiền về ${bank} - ${account}`,
        status: 'pending',
        date: new Date().toISOString(),
      }),
    });

    // Ghi yêu cầu rút tiền vào collection riêng
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
      successEl.textContent = `✅ Đã gửi yêu cầu rút ${formatMoney(amount)}. Xử lý trong 1-3 ngày làm việc.`;
      successEl.classList.remove('hidden');
    }
    showToast(`📤 Yêu cầu rút ${formatMoney(amount)} đã được gửi!`, 'success');

  } catch (err) {
    showError('Rút tiền thất bại: ' + err.message, errEl);
  } finally {
    btn.textContent = 'Gửi Yêu Cầu Rút Tiền';
    btn.disabled = false;
  }
}

/**
 * Render lịch sử giao dịch
 * @param {Array} transactions - Mảng giao dịch
 */
function renderTransactionHistory(transactions) {
  const list = document.getElementById('txList');
  if (!list) return;

  if (!transactions || transactions.length === 0) {
    list.innerHTML = '<div class="tx-empty">Chưa có giao dịch nào</div>';
    return;
  }

  // Sắp xếp mới nhất lên đầu
  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

  list.innerHTML = sorted.slice(0, 20).map(tx => {
    const isPlus = (tx.amount || tx.points || 0) > 0;
    const label = tx.reason || (tx.type === 'points' ? 'Điểm thưởng' : 'Giao dịch');
    const amount = tx.type === 'points'
      ? `${tx.amount > 0 ? '+' : ''}${tx.amount} ✦`
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

/** Mở modal và overlay */
function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.getElementById('modalOverlay')?.classList.add('active');
}

/** Đóng modal */
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
  // Chỉ ẩn overlay nếu không còn modal nào mở
  const anyOpen = document.querySelectorAll('.modal:not(.hidden)').length > 0;
  if (!anyOpen) {
    document.getElementById('modalOverlay')?.classList.remove('active');
  }
}

/** Đóng tất cả modal */
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  document.getElementById('modalOverlay')?.classList.remove('active');
  clearReadTimer();
}

// =========================================================
// 11. TOAST NOTIFICATION
// =========================================================

/**
 * Hiển thị toast notification
 * @param {string} message - Nội dung thông báo
 * @param {'success'|'error'|'info'} type - Loại thông báo
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: '💡' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  // Tự ẩn sau 4 giây
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// =========================================================
// 12. UTILITIES
// =========================================================

/** Escape HTML để tránh XSS */
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
 * Format tiền Việt Nam
 * @param {number} amount
 */
function formatMoney(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount || 0);
}

/**
 * Format tiền ngắn gọn (cho badge)
 * @param {number} amount
 */
function formatMoneyShort(amount) {
  if (amount >= 1000000) return `${(amount/1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount/1000).toFixed(0)}K`;
  return `${amount}đ`;
}

/**
 * Format ngày tháng sang tiếng Việt
 * @param {string} dateStr - ISO date string
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return 'Vừa xong';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} phút trước`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} giờ trước`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} ngày trước`;

    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/** Hiển thị trạng thái loading */
function showLoading() {
  const grid = document.getElementById('newsGrid');
  const heroMain = document.getElementById('heroMain');
  if (grid) {
    grid.innerHTML = `
      <div class="loading-state" id="loadingState">
        <div class="loading-spinner"></div>
        <p>Đang tải tin tức...</p>
      </div>
    `;
  }
  if (heroMain) {
    heroMain.innerHTML = `<div class="hero-skeleton"><div class="skeleton-img"></div></div>`;
  }
}

/**
 * Hiển thị lỗi trong phần tử HTML cụ thể
 * @param {string} msg - Nội dung lỗi
 * @param {HTMLElement} el - Phần tử hiển thị lỗi
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
 * Cập nhật tiêu đề danh sách tin
 * @param {string} cat - Category
 * @param {string} query - Search query
 * @param {number} count - Số bài
 */
function updateSectionTitle(cat, query, count) {
  const el = document.getElementById('sectionTitle');
  if (!el) return;
  const catNames = {
    general: 'Tin Mới Nhất',
    world: 'Tin Thế Giới',
    technology: 'Công Nghệ',
    business: 'Kinh Doanh',
    sports: 'Thể Thao',
    entertainment: 'Giải Trí',
    health: 'Sức Khỏe',
    science: 'Khoa Học',
  };
  el.textContent = query ? `Kết quả: "${query}"` : (catNames[cat] || 'Tin Tức');
}

/** Cập nhật ticker nội dung */
function updateTicker(text) {
  const el = document.getElementById('tickerText');
  if (el && text) el.textContent = text;
}

// =========================================================
// 13. DEMO MODE (Khi Firebase / GNews không khả dụng)
// =========================================================

/** Dữ liệu mẫu dùng khi API không phản hồi */
const DEMO_ARTICLES = [
  {
    title: "Việt Nam đặt mục tiêu tăng trưởng GDP 7% trong năm 2025",
    description: "Chính phủ Việt Nam đã thông qua nghị quyết đặt mục tiêu tăng trưởng kinh tế 7% cho năm 2025, tập trung vào đầu tư công và phát triển công nghệ cao.",
    url: "https://vnexpress.net",
    image: "https://placehold.co/600x400/1a2a1a/52c68b?text=Kinh+tế",
    source: { name: "VnExpress" },
    publishedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    title: "Apple ra mắt iPhone 17 với thiết kế hoàn toàn mới",
    description: "Apple vừa chính thức giới thiệu dòng iPhone 17 với màn hình gập và chip A19 Bionic, đánh dấu bước đột phá lớn nhất trong lịch sử 17 năm của iPhone.",
    url: "https://techcrunch.com",
    image: "https://placehold.co/600x400/1a1a2a/5289e0?text=Tech+News",
    source: { name: "TechCrunch" },
    publishedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    title: "Đội tuyển Việt Nam vào tứ kết Asian Cup 2026",
    description: "Với màn trình diễn xuất sắc, đội tuyển bóng đá Việt Nam đã giành chiến thắng 2-0 trước Thái Lan để lần đầu tiên trong lịch sử tiến vào vòng tứ kết Asian Cup.",
    url: "https://vnexpress.net/the-thao",
    image: "https://placehold.co/600x400/2a1a1a/e05252?text=Thể+thao",
    source: { name: "Bóng Đá Việt Nam" },
    publishedAt: new Date(Date.now() - 10800000).toISOString(),
  },
  {
    title: "ChatGPT-5 ra mắt với khả năng lập luận vượt trội",
    description: "OpenAI đã chính thức phát hành ChatGPT-5, được cho là có khả năng lập luận và giải quyết vấn đề vượt trội so với các phiên bản trước, tiến gần hơn đến trí tuệ nhân tạo tổng quát (AGI).",
    url: "https://openai.com",
    image: "https://placehold.co/600x400/1a1a2a/c9a84c?text=AI+News",
    source: { name: "OpenAI Blog" },
    publishedAt: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    title: "Hà Nội triển khai hệ thống xe buýt điện toàn thành phố",
    description: "Thành phố Hà Nội chính thức đưa vào vận hành 500 xe buýt điện thay thế hoàn toàn các xe buýt chạy xăng, giúp giảm 40% lượng khí thải CO2 trong giao thông công cộng.",
    url: "https://hanoimoi.com.vn",
    image: "https://placehold.co/600x400/1a2a1a/52c68b?text=Giao+thông",
    source: { name: "Hà Nội Mới" },
    publishedAt: new Date(Date.now() - 18000000).toISOString(),
  },
  {
    title: "Bitcoin vượt mốc 150,000 USD lần đầu trong lịch sử",
    description: "Thị trường tiền điện tử chứng kiến cột mốc lịch sử khi Bitcoin phá vỡ ngưỡng 150,000 USD/BTC, được thúc đẩy bởi làn sóng đầu tư tổ chức và ETF Bitcoin tại Mỹ.",
    url: "https://coindesk.com",
    image: "https://placehold.co/600x400/2a2a1a/c9a84c?text=Crypto",
    source: { name: "CoinDesk" },
    publishedAt: new Date(Date.now() - 21600000).toISOString(),
  },
  {
    title: "WHO công bố vắc xin phòng ung thư gan hiệu quả 95%",
    description: "Tổ chức Y tế Thế giới (WHO) vừa phê duyệt loại vắc xin mRNA mới phòng ngừa ung thư gan nguyên phát với hiệu quả lên đến 95%, dự kiến sẽ được triển khai tại 50 quốc gia từ năm 2026.",
    url: "https://who.int",
    image: "https://placehold.co/600x400/1a2a2a/52c68b?text=Sức+khỏe",
    source: { name: "WHO" },
    publishedAt: new Date(Date.now() - 25200000).toISOString(),
  },
  {
    title: "SpaceX hoàn thành sứ mệnh đưa người lên Sao Hỏa",
    description: "SpaceX đã chính thức đưa 6 phi hành gia lên bề mặt Sao Hỏa trong sứ mệnh lịch sử Artemis Mars-1, mở ra kỷ nguyên mới cho sự hiện diện của con người trên hành tinh đỏ.",
    url: "https://spacex.com",
    image: "https://placehold.co/600x400/1a1a2a/5289e0?text=Khoa+học",
    source: { name: "SpaceX" },
    publishedAt: new Date(Date.now() - 28800000).toISOString(),
  },
];

/** Tải bài viết mẫu khi API không hoạt động */
function loadDemoArticles() {
  STATE.articles = [...DEMO_ARTICLES];
  STATE.isDemoMode = true;
  renderHero(STATE.articles.slice(0, 4));
  renderNewsGrid();
  updateTicker(STATE.articles[0].title);
  showToast('⚠️ Đang hiển thị dữ liệu mẫu (demo mode)', 'info');
}

/** Setup demo mode khi Firebase không khả dụng */
function setupDemoMode() {
  STATE.isDemoMode = true;
  STATE.userProfile = { name: 'Demo User', email: 'demo@example.com', balance: 150000, points: 2500, transactions: [] };
  console.log('🔧 Chạy ở chế độ Demo');
}

// =========================================================
// 14. ADMIN DASHBOARD
// =========================================================

/** Tải danh sách người dùng cho Admin */
async function loadAdminUsers() {
  const listEl = document.getElementById('adminUsersList');
  if (!listEl || !db) return;

  try {
    const snapshot = await db.collection('users').get();
    if (snapshot.empty) {
      listEl.innerHTML = '<tr><td colspan="5" style="text-align: center;">Không có dữ liệu</td></tr>';
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
              <input type="number" id="admin-input-${uid}" placeholder="Số tiền" min="1000" step="1000" />
              <button class="btn-admin-action add" onclick="modifyUserBalance('${uid}', 'add')">+ Tặng</button>
              <button class="btn-admin-action sub" onclick="modifyUserBalance('${uid}', 'sub')">- Rút</button>
            </div>
          </td>
        </tr>
      `;
    });
    listEl.innerHTML = html;
  } catch (err) {
    console.error('Lỗi tải danh sách người dùng:', err);
    listEl.innerHTML = '<tr><td colspan="5" style="text-align: center; color: red;">Lỗi tải dữ liệu</td></tr>';
  }
}

/** Admin thay đổi số dư của user */
window.modifyUserBalance = async function(uid, actionType) {
  if (STATE.userProfile?.role !== 'admin') {
    showToast('Từ chối truy cập!', 'error');
    return;
  }

  const inputEl = document.getElementById(`admin-input-${uid}`);
  const amountStr = inputEl?.value;
  let amount = parseInt(amountStr);

  if (!amount || amount <= 0) {
    showToast('Vui lòng nhập số tiền hợp lệ (> 0)', 'error');
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
        reason: actionType === 'add' ? 'Admin tặng tiền' : 'Admin rút tiền',
        date: new Date().toISOString(),
      })
    });

    const doc = await userRef.get();
    const newBal = doc.data().balance;
    document.getElementById(`admin-bal-${uid}`).textContent = formatMoney(newBal);
    inputEl.value = '';
    
    // Nếu là user hiện tại, cập nhật local state
    if (uid === currentUser?.uid) {
      STATE.userProfile.balance = newBal;
      updateWalletDisplay();
      updateWalletBadge();
    }
    
    showToast(`Đã ${actionType === 'add' ? 'tặng' : 'rút'} ${formatMoney(Math.abs(amount))} thành công!`, 'success');
  } catch (err) {
    console.error('Lỗi cập nhật số dư:', err);
    showToast('Lỗi cập nhật số dư: ' + err.message, 'error');
  }
};

// =========================================================
// 15. EVENT LISTENERS
// =========================================================
// =========================================================

/** Gắn tất cả event listener sau khi DOM sẵn sàng */
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
        // Bí mật nâng cấp quyền
        await db.collection('users').doc(currentUser.uid).update({ role: 'admin' });
        STATE.userProfile.role = 'admin';
        document.getElementById('btnOpenAdmin')?.classList.remove('hidden');
        showToast('🔑 Đã cấp quyền Quản trị viên (Admin) cho tài khoản này!', 'success');
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
      showToast('Vui lòng đăng nhập để dùng ví tiền.', 'info');
      return;
    }
    updateWalletDisplay();
    showModal('walletModal');
  });
  document.getElementById('btnLogout')?.addEventListener('click', handleLogout);

  // --- Admin ---
  document.getElementById('btnOpenAdmin')?.addEventListener('click', () => {
    if (STATE.userProfile?.role !== 'admin') {
      showToast('Từ chối truy cập.', 'error');
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

  // --- Overlay click = đóng modal ---
  document.getElementById('modalOverlay')?.addEventListener('click', closeAllModals);

  // --- Toggle Password Visibility ---
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
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
        btn.textContent = 'Đã sao chép!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Sao chép';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        showToast('Không thể sao chép. Vui lòng sao chép thủ công.', 'error');
      });
    });
  });

  // --- Footer Links ---
  document.getElementById('footerLogin')?.addEventListener('click', (e) => { e.preventDefault(); showModal('loginModal'); });
  document.getElementById('footerRegister')?.addEventListener('click', (e) => { e.preventDefault(); showModal('registerModal'); });
  document.getElementById('footerWallet')?.addEventListener('click', (e) => { e.preventDefault(); showModal('walletModal'); });

  // --- Keyboard: ESC đóng modal ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}

// =========================================================
// 15. KHỞI ĐỘNG ỨNG DỤNG
// =========================================================

/**
 * Hàm main — khởi động toàn bộ ứng dụng
 */
async function init() {
  // Cập nhật ngày tháng
  updateHeaderDate();

  // Gắn sự kiện
  setupEventListeners();

  // Khởi tạo Firebase
  await initFirebase();

  // Tải tin tức
  await fetchNews('general');

  console.log('🚀 NovaNews đã khởi động thành công!');
}

// Chạy khi DOM sẵn sàng
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}



/* ================================================ */
/* AI CHATBOT WIDGET — Thêm vào cuối script.js       */
/* ================================================ */

(function () {
  'use strict';

  // ── CẤU HÌNH ────────────────────────────────────
  // Không cần API Key ở client nữa, gọi qua Vercel serverless proxy

  // ── PHẦN TỬ DOM ──────────────────────────────────
  const fab        = document.getElementById('chatFab');
  const widget     = document.getElementById('chatWidget');
  const closeBtn   = document.getElementById('chatCloseBtn');
  const messagesEl = document.getElementById('chatMessages');
  const inputEl    = document.getElementById('chatInput');
  const sendBtn    = document.getElementById('chatSendBtn');

  // Lưu lịch sử hội thoại để gửi kèm theo từng lượt (multi-turn)
  let conversationHistory = [];
  let isLoading = false; // Tránh gửi nhiều lần cùng lúc

  // ── KHỞI TẠO ────────────────────────────────────

  // Hiển thị giờ lên tin nhắn chào mừng
  const welcomeTimeEl = document.getElementById('welcomeTime');
  if (welcomeTimeEl) welcomeTimeEl.textContent = getTime();

  // ── SỰ KIỆN: ĐÓNG / MỞ WIDGET ────────────────────
  fab.addEventListener('click', toggleWidget);
  closeBtn.addEventListener('click', closeWidget);

  // Nhấn Enter để gửi tin
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Nhấn nút Gửi
  sendBtn.addEventListener('click', handleSend);

  // ── HÀM: BẬT/TẮT WIDGET ─────────────────────────
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
    // Focus vào ô nhập ngay khi mở
    setTimeout(() => inputEl.focus(), 300);
    scrollToBottom();
  }

  function closeWidget() {
    widget.classList.remove('is-open');
    fab.classList.remove('is-open');
  }

  // ── HÀM: XỬ LÝ GỬI TIN NHẮN ────────────────────
  async function handleSend() {
    const userText = inputEl.value.trim();

    // Không gửi nếu ô trống hoặc đang tải
    if (!userText || isLoading) return;

    // Hiển thị tin nhắn người dùng lên giao diện
    appendMessage('user', userText);
    inputEl.value = '';
    inputEl.focus();

    // Thêm vào lịch sử hội thoại (để AI nhớ ngữ cảnh)
    conversationHistory.push({
      role: 'user',
      parts: [{ text: userText }],
    });

    // Hiện hiệu ứng "Đang suy nghĩ..."
    const thinkingEl = appendThinking();
    setLoading(true);

    try {
      // Gọi Gemini API
      const aiReply = await callGeminiAPI(conversationHistory);

      // Xóa hiệu ứng loading
      thinkingEl.remove();

      // Hiển thị câu trả lời AI
      appendMessage('ai', aiReply);

      // Thêm phản hồi AI vào lịch sử để duy trì ngữ cảnh
      conversationHistory.push({
        role: 'model',
        parts: [{ text: aiReply }],
      });

    } catch (error) {
      thinkingEl.remove();
      appendMessage('ai', '⚠️ Xin lỗi, đã có lỗi xảy ra. Vui lòng thử lại sau giây lát.');
      console.error('[Chatbot Error]', error);
    } finally {
      setLoading(false);
    }
  }

  // ── HÀM: GỌI GEMINI API (qua Backend /api/chat) ──
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
    return data.text || 'Tôi chưa có câu trả lời phù hợp cho điều này.';
  }

  // ── HÀM: THÊM TIN NHẮN VÀO GIAO DIỆN ───────────
  /**
   * @param {'ai'|'user'} role  - Vai trò gửi tin
   * @param {string}      text  - Nội dung tin nhắn
   */
  function appendMessage(role, text) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message chat-message--${role}`;

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-message__bubble';
    // Cho phép xuống dòng tự nhiên, không render HTML từ AI
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

  // ── HÀM: HIỆU ỨNG "ĐANG SUY NGHĨ..." ──────────
  function appendThinking() {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message chat-message--ai chat-thinking';

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'chat-message__bubble';
    bubbleEl.setAttribute('aria-label', 'Đang suy nghĩ...');

    // 3 chấm nhảy
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

  // ── HÀM: KHOÁ/MỞ KHOÁ GIAO DIỆN KHI ĐANG TẢI ──
  function setLoading(state) {
    isLoading = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
  }

  // ── HÀM: CUỘN XUỐNG TIN NHẮN MỚI NHẤT ──────────
  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ── HÀM: LẤY GIỜ HIỆN TẠI ──────────────────────
  function getTime() {
    return new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

})(); // Kết thúc IIFE — tránh ô nhiễm biến toàn cục
