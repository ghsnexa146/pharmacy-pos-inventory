const DB_KEYS = {
  PROFILE: 'retailer_biz_profile',
  STOCK: 'retailer_stock_list',
  SALES: 'retailer_sales_list',
  ORDERS: 'retailer_purchase_orders',
  STAFF: 'retailer_staff_list',
  INV_SEQ: 'retailer_invoice_seq',
  CLOUD_CFG: 'retailer_ghs_cloud_cfg',
  SESSION: 'retailer_active_session',
  THEME: 'retailer_app_theme'
};

let cart = [];
let currentStockFilter = 'all';
let activeTabName = 'home';

document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem(DB_KEYS.THEME) || 'colorful';
  setAppTheme(savedTheme, false);

  const dateEl = document.getElementById('current-date-display');
  if (dateEl) {
    dateEl.innerText = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  let hasValidProfile = false;
  try {
    const rawProfile = localStorage.getItem(DB_KEYS.PROFILE);
    if (rawProfile) {
      const profile = JSON.parse(rawProfile);
      if (profile && profile.bizName) {
        if (!profile.profileId) {
          profile.profileId = generateUniqueStoreId();
          localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));
        }
        if (!profile.addr1 && profile.address) profile.addr1 = profile.address;
        if (!profile.district) profile.district = 'Sepahijala';
        if (!profile.state) profile.state = 'Tripura';

        loadMainApp(profile);
        hasValidProfile = true;
      }
    }
  } catch (err) {
    console.error('Profile reset:', err);
    localStorage.removeItem(DB_KEYS.PROFILE);
  }

  if (!hasValidProfile) {
    document.getElementById('setup-screen').classList.add('active');
  }

  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 480);
    }
  }, 1100);

  setupSmartExpiryValidation();
  setupBackNavigationHandler();
});

/* ==================== UNIQUE STORE ID GENERATOR ==================== */
function generateUniqueStoreId() {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `GHS-${rand}`;
}

/* ==================== TOAST HELPER ==================== */
function showToast(msg) {
  const toast = document.getElementById('toast-msg');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ==================== ANDROID BACK BUTTON HANDLER ==================== */
function setupBackNavigationHandler() {
  window.history.pushState({ appState: 'root' }, '');

  window.addEventListener('popstate', () => {
    const stockModal = document.getElementById('stock-modal');
    const billsModal = document.getElementById('saved-bills-modal');

    if (stockModal && stockModal.classList.contains('active')) {
      closeAddStockModal();
      window.history.pushState({ appState: 'root' }, '');
      return;
    }
    if (billsModal && billsModal.classList.contains('active')) {
      closeSavedBillsModal();
      window.history.pushState({ appState: 'root' }, '');
      return;
    }

    const session = getActiveSession();
    if (session.role === 'admin' && activeTabName !== 'home') {
      switchTab('home');
      window.history.pushState({ appState: 'root' }, '');
      return;
    }
  });
}

/* ==================== ROLE & SESSION MANAGEMENT ==================== */
function getActiveSession() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEYS.SESSION)) || { role: 'admin', name: 'Owner', phone: '' };
  } catch {
    return { role: 'admin', name: 'Owner', phone: '' };
  }
}

function applyRolePermissions() {
  const session = getActiveSession();
  const roleBadge = document.getElementById('display-role-badge');
  const staffLogoutBtn = document.getElementById('staff-logout-btn');

  if (session.role === 'staff') {
    document.body.classList.add('staff-mode');
    if (roleBadge) {
      roleBadge.innerText = `Staff Billing (${session.name})`;
      roleBadge.parentElement.classList.add('staff');
    }
    if (staffLogoutBtn) staffLogoutBtn.style.display = 'inline-flex';
    switchTab('billing');
  } else {
    document.body.classList.remove('staff-mode');
    if (roleBadge) {
      roleBadge.innerText = 'Admin Terminal';
      roleBadge.parentElement.classList.remove('staff');
    }
    if (staffLogoutBtn) staffLogoutBtn.style.display = 'none';
  }
}

function logoutCurrentSession() {
  if (!confirm('Logout from this terminal session?')) return;
  localStorage.removeItem(DB_KEYS.SESSION);
  localStorage.removeItem(DB_KEYS.PROFILE);
  document.body.classList.remove('staff-mode');
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('main-app').classList.remove('active');
  document.getElementById('setup-screen').style.display = 'flex';
  document.getElementById('setup-screen').classList.add('active');
  switchOnboardingMode('restore');
}

/* ==================== STAFF MANAGEMENT (ADMIN) ==================== */
function addAuthorizedStaff() {
  const name = document.getElementById('new-staff-name').value.trim();
  const phone = document.getElementById('new-staff-phone').value.trim();

  if (!name || phone.length < 10) {
    alert('Enter valid Staff Name and 10-digit Mobile Number.');
    return;
  }

  const staffList = JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [];
  if (staffList.some(s => s.phone === phone)) {
    alert('This mobile number is already registered as staff.');
    return;
  }

  staffList.push({
    id: Date.now(),
    name,
    phone,
    addedAt: new Date().toLocaleDateString('en-IN')
  });

  localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(staffList));
  document.getElementById('new-staff-name').value = '';
  document.getElementById('new-staff-phone').value = '';
  renderStaffList();
  showToast('Authorized staff added!');
  syncWithCloud(false);
}

function renderStaffList() {
  const container = document.getElementById('staff-list-container');
  if (!container) return;
  const staffList = JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [];

  if (staffList.length === 0) {
    container.innerHTML = `<p style="font-size:12px; color:var(--muted); text-align:center; padding:10px;">No staff members added yet.</p>`;
    return;
  }

  container.innerHTML = staffList.map((st, idx) => `
    <div class="item-card" style="padding:10px 12px;">
      <div>
        <strong style="font-size:14px;">${st.name}</strong>
        <div style="font-size:12px; color:var(--muted);">+91 ${st.phone} • <span style="color:var(--green); font-weight:700;">Billing Only</span></div>
      </div>
      <button onclick="removeStaffMember(${idx})" style="background:#fee2e2; color:#ef4444; border:none; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">Remove</button>
    </div>
  `).join('');
}

function removeStaffMember(idx) {
  if (!confirm('Remove this staff member? They will no longer be able to login.')) return;
  const staffList = JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [];
  staffList.splice(idx, 1);
  localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(staffList));
  renderStaffList();
  syncWithCloud(false);
}

/* ==================== THEME SWITCHER ==================== */
function setAppTheme(themeName, notify = true) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem(DB_KEYS.THEME, themeName);

  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === themeName);
  });

  if (notify) showToast(`Theme changed to ${themeName.toUpperCase()}`);
}

/* ==================== COMPACT SETUP SYNC KEY & CLEAN QR ==================== */
function buildCompactSyncPayload(profile) {
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG)) || {};
  const fields = [
    profile.profileId || generateUniqueStoreId(),
    profile.bizName || '',
    profile.ownerName || '',
    profile.gst || '',
    profile.dlNo || '',
    profile.phone || '',
    profile.whatsapp || profile.phone || '',
    profile.email || '',
    profile.addr1 || '',
    profile.addr2 || '',
    profile.city || '',
    profile.district || 'Sepahijala',
    profile.pin || '',
    cloudCfg.url || '',
    cloudCfg.secret || ''
  ];
  const packed = fields.join('|');
  return 'GHS1:' + btoa(unescape(encodeURIComponent(packed)));
}

function renderProfileQR(profile) {
  const qrBox = document.getElementById('profile-qr-container');
  if (!qrBox) return;

  qrBox.innerHTML = '';
  const syncKey = buildCompactSyncPayload(profile);
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrBox, {
      text: syncKey,
      width: 148,
      height: 148,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
  }
}

function copyProfileCode() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  const syncKey = buildCompactSyncPayload(profile);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(syncKey);
  } else {
    const temp = document.createElement('textarea');
    temp.value = syncKey;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
  }
  showToast('Setup Sync Key copied!');
}

function shareProfileCodeWA() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG)) || {};
  const syncKey = buildCompactSyncPayload(profile);
  const msg = encodeURIComponent(
    `*${profile.bizName} - Multi-Device & Staff Login*\n\n` +
    `• *Store Profile ID:* ${profile.profileId}\n` +
    `• *Owner Mobile:* ${profile.phone}\n` +
    (cloudCfg.url ? `• *GHS Cloud URL:* ${cloudCfg.url}\n\n` : '\n') +
    `Or paste this Quick Setup Key:\n${syncKey}`
  );
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

/* ==================== MULTI-USER LOGIN (OWNER / STAFF) ==================== */
function switchOnboardingMode(mode) {
  const newForm = document.getElementById('setup-form');
  const restoreBox = document.getElementById('restore-code-box');
  const btnNew = document.getElementById('onb-btn-new');
  const btnRes = document.getElementById('onb-btn-restore');
  const errEl = document.getElementById('recovery-error-msg');
  if (errEl) errEl.style.display = 'none';

  if (mode === 'new') {
    newForm.style.display = 'block';
    restoreBox.style.display = 'none';
    btnNew.classList.add('active');
    btnRes.classList.remove('active');
  } else {
    newForm.style.display = 'none';
    restoreBox.style.display = 'block';
    btnNew.classList.remove('active');
    btnRes.classList.add('active');
  }
}

function normalizeCloudBaseUrl(rawUrl) {
  let clean = rawUrl.trim();
  if (clean.endsWith('/')) clean = clean.slice(0, -1);
  if (clean.endsWith('.json')) clean = clean.slice(0, -5);
  return clean;
}

async function handleMultiUserLogin() {
  const profileId = document.getElementById('login-profile-id').value.trim().toUpperCase();
  const mobileNo = document.getElementById('login-mobile-no').value.trim();
  const cloudUrlInput = document.getElementById('login-cloud-url').value.trim();
  const setupKeyInput = document.getElementById('recover-profile-code').value.trim();
  const errEl = document.getElementById('recovery-error-msg');
  const btn = document.getElementById('btn-verify-login');

  const showError = (msg) => {
    errEl.innerText = msg;
    errEl.style.display = 'block';
  };
  errEl.style.display = 'none';

  // Option 1: Quick Setup Key Shortcut
  if (setupKeyInput) {
    if (!setupKeyInput.startsWith('GHS1:')) {
      return showError('Invalid Setup Sync Key! Must start with GHS1:');
    }
    try {
      const base64Part = setupKeyInput.substring(5).trim();
      const parts = decodeURIComponent(escape(atob(base64Part))).split('|');
      if (parts.length < 13 || !parts[1]) throw new Error('Invalid key');

      const profile = {
        profileId: parts[0],
        bizName: parts[1],
        ownerName: parts[2],
        gst: parts[3] || '',
        dlNo: parts[4] || '',
        phone: parts[5] || '',
        whatsapp: parts[6] || parts[5] || '',
        email: parts[7] || '',
        addr1: parts[8] || '',
        addr2: parts[9] || '',
        city: parts[10] || '',
        district: parts[11] || 'Sepahijala',
        state: 'Tripura',
        pin: parts[12] || ''
      };

      const finalUrl = cloudUrlInput || parts[13] || '';
      const finalSecret = parts[14] || '';
      if (finalUrl) {
        localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url: finalUrl, secret: finalSecret }));
      }
      localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));
      localStorage.setItem(DB_KEYS.SESSION, JSON.stringify({ role: 'admin', name: profile.ownerName, phone: profile.phone }));
      if (!localStorage.getItem(DB_KEYS.INV_SEQ)) localStorage.setItem(DB_KEYS.INV_SEQ, 1);

      if (finalUrl) await pullFromCloud(false, profile.profileId, finalUrl, finalSecret);
      loadMainApp(profile);
      showToast('Admin profile restored & synced!');
      return;
    } catch {
      return showError('Corrupted Setup Sync Key. Please verify and try again.');
    }
  }

  // Option 2: Unique Store ID + Owner/Staff Mobile Number
  if (!profileId || !mobileNo) {
    return showError('Please enter both Unique Store Profile ID and Mobile Number.');
  }

  // Check if local profile already matches
  const localProfile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null');
  const savedCloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  const targetUrl = cloudUrlInput || savedCloudCfg.url || '';

  if (!targetUrl && (!localProfile || localProfile.profileId !== profileId)) {
    return showError('Please provide the GHS Cloud Database URL to fetch this store profile from the cloud.');
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying Account...';

  try {
    let storeData = null;

    if (targetUrl) {
      const baseUrl = normalizeCloudBaseUrl(targetUrl);
      const authParam = savedCloudCfg.secret ? `?auth=${encodeURIComponent(savedCloudCfg.secret)}` : '';
      const res = await fetch(`${baseUrl}/stores/${encodeURIComponent(profileId)}.json${authParam}`);
      if (!res.ok) throw new Error('Network error');
      storeData = await res.json();
    } else if (localProfile && localProfile.profileId === profileId) {
      storeData = {
        profile: localProfile,
        staff: JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]')
      };
    }

    if (!storeData || !storeData.profile) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Verify & Login Terminal';
      return showError('Store Profile ID not found! Please check the ID or create a New Store.');
    }

    const remoteProfile = storeData.profile;
    const remoteStaff = storeData.staff || [];

    // Verify Owner vs Staff
    let sessionObj = null;
    if (remoteProfile.phone === mobileNo || remoteProfile.whatsapp === mobileNo) {
      sessionObj = { role: 'admin', name: remoteProfile.ownerName, phone: mobileNo };
    } else {
      const matchedStaff = remoteStaff.find(s => s.phone === mobileNo);
      if (matchedStaff) {
        sessionObj = { role: 'staff', name: matchedStaff.name, phone: matchedStaff.phone };
      }
    }

    if (!sessionObj) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Verify & Login Terminal';
      return showError('Access Denied! Mobile number is not registered as Owner or Authorized Staff for this Store ID.');
    }

    // Save cloud data locally and launch
    if (targetUrl) {
      localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url: targetUrl, secret: savedCloudCfg.secret || '' }));
    }
    localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(remoteProfile));
    if (storeData.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(storeData.stock));
    if (storeData.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(storeData.sales));
    if (storeData.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(storeData.orders));
    if (storeData.staff) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(storeData.staff));
    if (storeData.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, storeData.invSeq);

    localStorage.setItem(DB_KEYS.SESSION, JSON.stringify(sessionObj));
    loadMainApp(remoteProfile);
    showToast(`Logged in as ${sessionObj.role.toUpperCase()} (${sessionObj.name})`);
  } catch (err) {
    showError('Unable to connect to GHS Cloud. Please verify your Cloud URL and internet connection.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Verify & Login Terminal';
  }
}

function toggleAccordion(button) {
  button.parentElement.classList.toggle('active');
}

function getExpiryStatus(expiryStr) {
  if (!expiryStr || !expiryStr.includes('/')) return 'new';
  const [mm, yy] = expiryStr.split('/').map(Number);
  if (!mm || !yy) return 'new';

  const now = new Date();
  const expDate = new Date(2000 + yy, mm, 0);
  const diffDays = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays <= 90) return 'soon';
  return 'new';
}

/* Sequential Invoice Number Helper */
function getNextInvoiceNumber() {
  let seq = parseInt(localStorage.getItem(DB_KEYS.INV_SEQ)) || 1;
  return 'INV-' + String(seq).padStart(4, '0');
}

function incrementInvoiceSequence() {
  let seq = parseInt(localStorage.getItem(DB_KEYS.INV_SEQ)) || 1;
  localStorage.setItem(DB_KEYS.INV_SEQ, seq + 1);
  updateNextInvPreview();
}

function updateNextInvPreview() {
  const el = document.getElementById('next-inv-preview');
  if (el) el.innerText = getNextInvoiceNumber();
  const editEl = document.getElementById('edit-next-inv');
  if (editEl) editEl.value = parseInt(localStorage.getItem(DB_KEYS.INV_SEQ)) || 1;
}

/* New Store Registration Handler */
function handleInitialSetup(e) {
  if (e) e.preventDefault();

  const bizName = document.getElementById('reg-biz-name').value.trim();
  const ownerName = document.getElementById('reg-owner-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const whatsapp = document.getElementById('reg-whatsapp').value.trim();
  const addr1 = document.getElementById('reg-addr1').value.trim();
  const city = document.getElementById('reg-city').value.trim();
  const district = document.getElementById('reg-district').value;
  const pin = document.getElementById('reg-pin').value.trim();
  const cloudUrl = (document.getElementById('reg-cloud-url').value || '').trim();

  if (!bizName || !ownerName || !phone || !addr1 || !city || !district || !pin) {
    alert('Please fill all required (*) fields and select a District.');
    return;
  }

  const profile = {
    profileId: generateUniqueStoreId(),
    bizName: bizName,
    ownerName: ownerName,
    gst: (document.getElementById('reg-gst').value || '').trim().toUpperCase(),
    dlNo: (document.getElementById('reg-dl').value || '').trim().toUpperCase(),
    phone: phone,
    whatsapp: whatsapp || phone,
    email: (document.getElementById('reg-email').value || '').trim(),
    addr1: addr1,
    addr2: (document.getElementById('reg-addr2').value || '').trim(),
    city: city,
    district: district,
    state: 'Tripura',
    pin: pin
  };

  localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));
  localStorage.setItem(DB_KEYS.SESSION, JSON.stringify({ role: 'admin', name: ownerName, phone: phone }));
  if (cloudUrl) {
    localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url: cloudUrl, secret: '' }));
  }
  if (!localStorage.getItem(DB_KEYS.INV_SEQ)) {
    localStorage.setItem(DB_KEYS.INV_SEQ, 1);
  }

  loadMainApp(profile);
  if (cloudUrl) syncWithCloud(false);
}

function formatFullAddress(p) {
  const parts = [p.addr1, p.addr2, p.city, p.district ? `${p.district}, Tripura` : 'Tripura', p.pin ? `- ${p.pin}` : ''].filter(Boolean);
  return parts.join(', ').replace(', -', ' -');
}

function loadMainApp(profile) {
  const setupEl = document.getElementById('setup-screen');
  const mainEl = document.getElementById('main-app');
  if (setupEl) {
    setupEl.style.display = 'none';
    setupEl.classList.remove('active');
  }
  if (mainEl) {
    mainEl.style.display = 'block';
    mainEl.classList.add('active');
  }

  document.getElementById('display-biz-name').innerText = profile.bizName;
  document.getElementById('display-owner-sub').innerText = profile.ownerName;

  document.getElementById('banner-biz-name').innerText = profile.bizName;
  document.getElementById('banner-owner-meta').innerText = `${profile.ownerName} • ${profile.phone}`;
  if (document.getElementById('banner-profile-id')) {
    document.getElementById('banner-profile-id').innerText = profile.profileId || 'GHS-000000';
  }
  if (document.getElementById('display-unique-profile-id')) {
    document.getElementById('display-unique-profile-id').innerText = profile.profileId || 'GHS-000000';
  }

  document.getElementById('edit-biz-name').value = profile.bizName || '';
  document.getElementById('edit-owner-name').value = profile.ownerName || '';
  document.getElementById('edit-gst').value = profile.gst || '';
  document.getElementById('edit-dl').value = profile.dlNo || '';
  document.getElementById('edit-phone').value = profile.phone || '';
  document.getElementById('edit-whatsapp').value = profile.whatsapp || profile.phone || '';
  document.getElementById('edit-email').value = profile.email || '';
  document.getElementById('edit-addr1').value = profile.addr1 || profile.address || '';
  document.getElementById('edit-addr2').value = profile.addr2 || '';
  document.getElementById('edit-city').value = profile.city || '';
  if (profile.district) document.getElementById('edit-district').value = profile.district;
  document.getElementById('edit-pin').value = profile.pin || '';

  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  if (document.getElementById('ghs-cloud-url')) document.getElementById('ghs-cloud-url').value = cloudCfg.url || '';
  if (document.getElementById('ghs-cloud-secret')) document.getElementById('ghs-cloud-secret').value = cloudCfg.secret || '';

  renderProfileQR(profile);
  renderStaffList();
  updateNextInvPreview();
  refreshDashboard();
  renderStockList();
  renderOrdersList();
  renderBillCart();
  populateBillingDropdown();
  applyRolePermissions();
}

function switchTab(tabName) {
  const session = getActiveSession();
  if (session.role === 'staff' && tabName !== 'billing') {
    showToast('Staff access is restricted to POS Billing only.');
    tabName = 'billing';
  }

  activeTabName = tabName;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('.center-fab').classList.remove('active');

  document.getElementById(`tab-${tabName}`).classList.add('active');

  if (tabName === 'billing') {
    document.querySelector('.center-fab').classList.add('active');
    populateBillingDropdown();
    updateNextInvPreview();
  } else {
    const navBtn = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
    if (navBtn) navBtn.classList.add('active');
  }

  if (tabName === 'stock') renderStockList();
  if (tabName === 'orders') renderOrdersList();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function openExpiringTab() {
  switchTab('stock');
  const soonBtn = document.querySelector('.pill[data-filter="soon"]');
  if (soonBtn) setStockFilter('soon', soonBtn);
}

function setupSmartExpiryValidation() {
  const expInput = document.getElementById('item-expiry');
  if (!expInput) return;
  expInput.addEventListener('input', () => {
    let val = expInput.value.replace(/\D/g, '');
    if (val.length === 1) {
      if (parseInt(val) >= 2 && parseInt(val) <= 9) val = '0' + val + '/';
    } else if (val.length >= 2) {
      let month = parseInt(val.substring(0, 2));
      if (month === 0) month = 1;
      if (month > 12) {
        val = '0' + val[0] + '/' + val.substring(1, 3);
      } else {
        let mStr = month < 10 ? '0' + month : '' + month;
        val = mStr + '/' + val.substring(2, 4);
      }
    }
    expInput.value = val;
  });
}

/* ==================== STOCK MANAGEMENT & RESTOCK ==================== */
function openAddStockModal(mode = 'new', preselectId = null) {
  document.getElementById('stock-modal').classList.add('active');
  setStockModalMode(mode);
  if (mode === 'restock' && preselectId) {
    document.getElementById('restock-select').value = preselectId;
    showRestockCurrentInfo();
  }
}

function closeAddStockModal() {
  document.getElementById('stock-modal').classList.remove('active');
}

function setStockModalMode(mode) {
  const formNew = document.getElementById('add-stock-form');
  const formRestock = document.getElementById('restock-form');
  const btnNew = document.getElementById('mode-btn-new');
  const btnRestock = document.getElementById('mode-btn-restock');

  if (mode === 'new') {
    formNew.style.display = 'block';
    formRestock.style.display = 'none';
    btnNew.classList.add('active');
    btnRestock.classList.remove('active');
  } else {
    formNew.style.display = 'none';
    formRestock.style.display = 'block';
    btnNew.classList.remove('active');
    btnRestock.classList.add('active');
    populateRestockDropdown();
  }
}

function populateRestockDropdown() {
  const select = document.getElementById('restock-select');
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  select.innerHTML = stockList.length
    ? stockList.map(i => {
        const totalUnits = i.totalUnits !== undefined ? i.totalUnits : (i.packs * i.unitPerPack);
        const availPacks = (totalUnits / i.unitPerPack).toFixed(1).replace(/\.0$/, '');
        return `<option value="${i.id}">${i.name} (Batch: ${i.batch} | Current: ${availPacks} Packs)</option>`;
      }).join('')
    : `<option value="">No existing medicines found</option>`;
  showRestockCurrentInfo();
}

function showRestockCurrentInfo() {
  const id = parseInt(document.getElementById('restock-select').value);
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const item = stockList.find(i => i.id === id);
  const infoEl = document.getElementById('restock-current-info');
  if (item) {
    const totalUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
    const availPacks = (totalUnits / item.unitPerPack).toFixed(1).replace(/\.0$/, '');
    infoEl.innerText = `Current Stock: ${availPacks} Packs (${totalUnits} Pcs) • MRP: ₹${item.mrp}`;
  } else {
    infoEl.innerText = '';
  }
}

document.getElementById('add-stock-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const unitPerPack = parseInt(document.getElementById('item-unit-pack').value) || 1;
  const packs = parseInt(document.getElementById('item-packs').value) || 1;

  const newItem = {
    id: Date.now(),
    name: document.getElementById('item-name').value.trim(),
    mfg: document.getElementById('item-mfg').value.trim(),
    batch: document.getElementById('item-batch').value.trim(),
    expiry: document.getElementById('item-expiry').value.trim(),
    hsn: document.getElementById('item-hsn').value.trim(),
    gst: parseFloat(document.getElementById('item-gst').value),
    mrp: parseFloat(document.getElementById('item-mrp').value),
    purchaseRate: parseFloat(document.getElementById('item-purchase').value),
    unitPerPack: unitPerPack,
    packs: packs,
    totalUnits: packs * unitPerPack
  };

  stockList.push(newItem);
  localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(stockList));

  e.target.reset();
  closeAddStockModal();
  renderStockList();
  refreshDashboard();
  populateBillingDropdown();
  showToast('New medicine batch added!');
  syncWithCloud(false);
});

document.getElementById('restock-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parseInt(document.getElementById('restock-select').value);
  const addPacks = parseInt(document.getElementById('restock-add-packs').value) || 0;
  const newMrp = parseFloat(document.getElementById('restock-new-mrp').value);
  const newPur = parseFloat(document.getElementById('restock-new-pur').value);

  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const idx = stockList.findIndex(i => i.id === id);
  if (idx === -1) return alert('Select a valid medicine batch.');

  const item = stockList[idx];
  const currentUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
  item.totalUnits = currentUnits + (addPacks * item.unitPerPack);
  item.packs = item.totalUnits / item.unitPerPack;
  if (!isNaN(newMrp) && newMrp > 0) item.mrp = newMrp;
  if (!isNaN(newPur) && newPur > 0) item.purchaseRate = newPur;

  stockList[idx] = item;
  localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(stockList));

  e.target.reset();
  closeAddStockModal();
  renderStockList();
  refreshDashboard();
  populateBillingDropdown();
  showToast('Stock quantity increased!');
  syncWithCloud(false);
});

function setStockFilter(filter, btnEl) {
  currentStockFilter = filter;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btnEl.classList.add('active');
  renderStockList();
}

function renderStockList() {
  const container = document.getElementById('stock-list-container');
  const query = (document.getElementById('stock-search').value || '').toLowerCase();
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];

  let countAll = stockList.length, countNew = 0, countSoon = 0, countExpired = 0;

  const categorized = stockList.map(item => {
    const status = getExpiryStatus(item.expiry);
    if (status === 'new') countNew++;
    if (status === 'soon') countSoon++;
    if (status === 'expired') countExpired++;
    return { ...item, status };
  });

  const priority = { expired: 1, soon: 2, new: 3 };
  categorized.sort((a, b) => priority[a.status] - priority[b.status]);

  document.getElementById('count-all').innerText = countAll;
  document.getElementById('count-new').innerText = countNew;
  document.getElementById('count-soon').innerText = countSoon;
  document.getElementById('count-expired').innerText = countExpired;

  const filtered = categorized.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(query) ||
                          i.batch.toLowerCase().includes(query) ||
                          (i.mfg && i.mfg.toLowerCase().includes(query));
    const matchesTab = currentStockFilter === 'all' || i.status === currentStockFilter;
    return matchesSearch && matchesTab;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; padding:30px;">No medicines found in this category.</p>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const totalUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
    const fullPacks = Math.floor(totalUnits / item.unitPerPack);
    const looseUnits = totalUnits % item.unitPerPack;

    let qtyText = `${fullPacks} Packs`;
    if (looseUnits > 0) qtyText += ` + ${looseUnits} Pcs`;
    if (totalUnits <= 0) qtyText = `Out of Stock (0)`;

    let badgeHtml = `<span class="status-badge badge-valid">Valid</span>`;
    if (item.status === 'soon') badgeHtml = `<span class="status-badge badge-soon">Expiring Soon</span>`;
    if (item.status === 'expired') badgeHtml = `<span class="status-badge badge-expired">Expired</span>`;

    return `
      <div class="item-card">
        <div>
          <strong style="font-size:15px;">${item.name}</strong>
          <div style="font-size:11px; color:var(--muted); margin-top:2px;">Mfg: <b>${item.mfg || 'N/A'}</b> • 1 Pack = ${item.unitPerPack} Pcs</div>
          <div style="font-size:12px; color:var(--muted); margin-top:2px;">Batch: <b>${item.batch}</b> | Exp: <b>${item.expiry}</b> | GST: ${item.gst}%</div>
          <div>
            <span class="qty-pill-clear ${totalUnits <= 0 ? 'out' : ''}">
              <i class="fa-solid fa-box"></i> Available: ${qtyText}
            </span>
          </div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap;">
            ${badgeHtml}
            <button onclick="openAddStockModal('restock', ${item.id})" style="background:#dcfce7; color:#15803d; border:none; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer; margin-top:6px;">+ Add Qty</button>
            <button onclick="quickAddToOrder('${item.name.replace(/'/g, "\\'")}', '${(item.mfg || '').replace(/'/g, "\\'")}')" style="background:#eff6ff; color:#1d4ed8; border:none; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; cursor:pointer; margin-top:6px;">+ Order</button>
          </div>
        </div>
        <div style="text-align:right;">
          <strong style="font-size:16px;">₹${item.mrp.toFixed(2)}</strong>
          <div style="font-size:10px; color:var(--muted);">Per Pack</div>
          <div style="font-size:11px; color:var(--muted); margin-top:4px;">Pur: ₹${item.purchaseRate.toFixed(2)}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ==================== ORDERS (MEDICINE REORDER LIST) ==================== */
function quickAddToOrder(medName, mfgName) {
  switchTab('orders');
  document.getElementById('order-med-name').value = medName;
  document.getElementById('order-med-mfg').value = mfgName;
  document.getElementById('order-med-qty').focus();
}

function addMedicineOrder() {
  const name = document.getElementById('order-med-name').value.trim();
  const mfg = document.getElementById('order-med-mfg').value.trim();
  const qty = document.getElementById('order-med-qty').value.trim();
  const supplier = document.getElementById('order-supplier').value.trim();

  if (!name || !qty) return alert('Please enter Medicine Name and Order Quantity.');

  const orders = JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [];
  orders.unshift({
    id: Date.now(),
    name,
    mfg: mfg || 'Any',
    qty,
    supplier: supplier || 'General Agency',
    date: new Date().toLocaleDateString('en-IN')
  });

  localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(orders));
  document.getElementById('order-med-name').value = '';
  document.getElementById('order-med-mfg').value = '';
  document.getElementById('order-med-qty').value = '';
  renderOrdersList();
  showToast('Added to purchase order list');
  syncWithCloud(false);
}

function renderOrdersList() {
  const container = document.getElementById('orders-list-container');
  const orders = JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [];
  document.getElementById('order-total-count').innerText = orders.length;

  if (orders.length === 0) {
    container.innerHTML = `<div class="receipt-empty"><i class="fa-solid fa-truck-medical" style="font-size:24px; margin-bottom:8px; display:block; color:#94a3b8;"></i>No medicines in purchase order list.<br/>Add items above that need to be ordered.</div>`;
    return;
  }

  container.innerHTML = orders.map((o, idx) => `
    <div class="item-card">
      <div>
        <strong style="font-size:15px;">${o.name}</strong>
        <div style="font-size:12px; color:var(--muted); margin-top:2px;">Mfg: <b>${o.mfg}</b> • Agency: ${o.supplier}</div>
        <span class="status-badge badge-soon">Order Qty: ${o.qty}</span>
      </div>
      <button onclick="deleteOrderItem(${idx})" style="background:#fee2e2; color:#ef4444; border:none; width:32px; height:32px; border-radius:10px; cursor:pointer;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

function deleteOrderItem(idx) {
  const orders = JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [];
  orders.splice(idx, 1);
  localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(orders));
  renderOrdersList();
  syncWithCloud(false);
}

function clearAllOrders() {
  if (!confirm('Clear all medicine orders?')) return;
  localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify([]));
  renderOrdersList();
  syncWithCloud(false);
}

function sharePurchaseOrderWA() {
  const orders = JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [];
  if (orders.length === 0) return alert('Order list is empty.');
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE));

  let lines = orders.map((o, i) => `${i + 1}. *${o.name}* (${o.mfg}) — Qty: *${o.qty}*`).join('\n');
  const msg = encodeURIComponent(`*PURCHASE ORDER - ${profile.bizName}*\nDate: ${new Date().toLocaleDateString('en-IN')}\n\n${lines}\n\nPlease confirm availability.`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

/* ==================== ACCURATE PHARMACY BILLING ==================== */
function adjustBillQty(delta) {
  const input = document.getElementById('bill-qty');
  let val = parseInt(input.value) || 1;
  val = Math.max(1, val + delta);
  input.value = val;
}

function populateBillingDropdown() {
  const select = document.getElementById('bill-product-select');
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  select.innerHTML = stockList.length
    ? stockList.map(i => {
        const totalUnits = i.totalUnits !== undefined ? i.totalUnits : (i.packs * i.unitPerPack);
        const availPacks = Math.floor(totalUnits / i.unitPerPack);
        const st = getExpiryStatus(i.expiry);
        const tag = st === 'expired' ? ' [EXPIRED]' : (totalUnits <= 0 ? ' [OUT OF STOCK]' : '');
        return `<option value="${i.id}">${i.name} (${i.batch} | ₹${i.mrp}/Pack | Stock: ${availPacks}P)${tag}</option>`;
      }).join('')
    : `<option value="">No Stock Available</option>`;
  updateSelectedStockHint();
}

function updateSelectedStockHint() {
  const itemId = parseInt(document.getElementById('bill-product-select').value);
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const p = stockList.find(i => i.id === itemId);
  const hintEl = document.getElementById('selected-stock-hint');
  if (!p) {
    hintEl.innerText = '';
    return;
  }
  const totalUnits = p.totalUnits !== undefined ? p.totalUnits : (p.packs * p.unitPerPack);
  const unitPrice = (p.mrp / p.unitPerPack).toFixed(2);
  hintEl.innerText = `In Stock: ${totalUnits} Pcs (${p.unitPerPack} Pcs/Pack) • Pack MRP: ₹${p.mrp} | 1 Pc: ₹${unitPrice}`;
}

function addToBill() {
  const itemId = parseInt(document.getElementById('bill-product-select').value);
  const qty = parseInt(document.getElementById('bill-qty').value) || 1;
  const unitType = document.getElementById('bill-unit-type').value;

  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const product = stockList.find(i => i.id === itemId);

  if (!product) return alert('Please add stock first.');

  const totalUnitsAvail = product.totalUnits !== undefined ? product.totalUnits : (product.packs * product.unitPerPack);
  const unitsNeeded = unitType === 'pack' ? (qty * product.unitPerPack) : qty;

  if (unitsNeeded > totalUnitsAvail) {
    return alert(`Insufficient Stock! Only ${totalUnitsAvail} Pcs available in inventory.`);
  }

  if (getExpiryStatus(product.expiry) === 'expired') {
    if (!confirm('Warning: This medicine batch is EXPIRED. Still add to bill?')) return;
  }

  const rateApplied = unitType === 'pack' ? product.mrp : (product.mrp / product.unitPerPack);
  const lineTotal = rateApplied * qty;
  const unitLabel = unitType === 'pack' ? (qty > 1 ? 'Packs' : 'Pack') : (qty > 1 ? 'Pcs' : 'Pc');

  cart.push({
    ...product,
    qty,
    unitType,
    unitLabel,
    unitsDeducted: unitsNeeded,
    rateApplied,
    total: lineTotal
  });

  document.getElementById('bill-qty').value = 1;
  renderBillCart();
}

function calculateBillTotals() {
  const rawSubtotal = cart.reduce((sum, item) => sum + item.total, 0);
  const discPct = parseFloat(document.getElementById('bill-discount-pct').value) || 0;
  const gstMode = document.getElementById('bill-gst-mode').value;

  const discountAmt = (rawSubtotal * discPct) / 100;
  const afterDisc = Math.max(0, rawSubtotal - discountAmt);

  let taxAmt = 0;
  let finalPayable = afterDisc;

  if (gstMode === 'extra') {
    cart.forEach(item => {
      const itemAfterDisc = item.total * (1 - discPct / 100);
      taxAmt += (itemAfterDisc * (item.gst || 0)) / 100;
    });
    finalPayable = afterDisc + taxAmt;
  } else {
    cart.forEach(item => {
      const itemAfterDisc = item.total * (1 - discPct / 100);
      const gstRate = item.gst || 0;
      const base = itemAfterDisc / (1 + gstRate / 100);
      taxAmt += (itemAfterDisc - base);
    });
    finalPayable = afterDisc;
  }

  return { rawSubtotal, discPct, discountAmt, gstMode, taxAmt, finalPayable };
}

function renderBillCart() {
  const list = document.getElementById('bill-items-list');

  if (cart.length === 0) {
    list.innerHTML = `<div class="receipt-empty"><i class="fa-solid fa-receipt" style="font-size:24px; margin-bottom:8px; display:block; color:#94a3b8;"></i>No medicines added to current bill.<br/>Select a medicine, unit type & quantity above.</div>`;
    document.getElementById('bill-grand-total').innerText = '₹0.00';
    document.getElementById('bill-breakdown-label').innerText = 'Payable (0 Items)';
    return;
  }

  list.innerHTML = cart.map((c, idx) => `
    <div class="receipt-row-card">
      <div>
        <strong style="font-size:14px;">${c.name}</strong>
        <span style="background:#dbeafe; color:#1d4ed8; font-weight:700; font-size:11px; padding:2px 7px; border-radius:6px; margin-left:4px;">${c.qty} ${c.unitLabel}</span>
        <div style="font-size:11px; color:var(--muted); margin-top:3px;">Batch: ${c.batch} • Exp: ${c.expiry} • Rate: ₹${c.rateApplied.toFixed(2)}/${c.unitType === 'pack' ? 'Pack' : 'Pc'}</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <strong style="font-size:15px;">₹${c.total.toFixed(2)}</strong>
        <button onclick="removeCartItem(${idx})" style="background:#fee2e2; color:#ef4444; border:none; width:28px; height:28px; border-radius:8px; cursor:pointer;">&times;</button>
      </div>
    </div>
  `).join('');

  const totals = calculateBillTotals();
  document.getElementById('bill-grand-total').innerText = `₹${totals.finalPayable.toFixed(2)}`;
  const gstTag = totals.gstMode === 'extra' ? `+GST ₹${totals.taxAmt.toFixed(0)}` : 'Incl. GST';
  const discTag = totals.discPct > 0 ? ` • -${totals.discPct}% Disc` : '';
  document.getElementById('bill-breakdown-label').innerText = `${cart.length} Item(s) (${gstTag}${discTag})`;
}

function removeCartItem(index) { cart.splice(index, 1); renderBillCart(); }
function clearCart() { cart = []; renderBillCart(); }

function deductSoldStock(soldItems) {
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  soldItems.forEach(sold => {
    const idx = stockList.findIndex(s => s.id === sold.id);
    if (idx !== -1) {
      const currentUnits = stockList[idx].totalUnits !== undefined
        ? stockList[idx].totalUnits
        : (stockList[idx].packs * stockList[idx].unitPerPack);
      const updatedUnits = Math.max(0, currentUnits - sold.unitsDeducted);
      stockList[idx].totalUnits = updatedUnits;
      stockList[idx].packs = updatedUnits / stockList[idx].unitPerPack;
    }
  });
  localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(stockList));
}

/* ==================== COMPACT SINGLE-PAGE A4 INVOICE TEMPLATE ==================== */
function buildInvoiceHTML(saleObj, profile) {
  const fullAddr = formatFullAddress(profile);
  const rowsHtml = saleObj.items.map((c, i) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 7px 6px; color: #475569; font-size: 11px;">${i + 1}</td>
      <td style="padding: 7px 6px; color: #0f172a; font-size: 12px;">
        <strong>${c.name}</strong>
        <div style="font-size: 10px; color: #64748b;">Batch: ${c.batch} | Exp: ${c.expiry} | Mfg: ${c.mfg || '-'} | GST: ${c.gst}%</div>
      </td>
      <td style="padding: 7px 6px; text-align: right; color: #334155; font-size: 12px;">₹${(c.rateApplied || c.mrp).toFixed(2)}</td>
      <td style="padding: 7px 6px; text-align: center; color: #0f172a; font-weight: 600; font-size: 12px;">${c.qty} ${c.unitLabel || 'Pack'}</td>
      <td style="padding: 7px 6px; text-align: right; font-weight: 700; color: #0f172a; font-size: 12px;">₹${c.total.toFixed(2)}</td>
    </tr>
  `).join('');

  const subtotal = saleObj.rawSubtotal !== undefined ? saleObj.rawSubtotal : saleObj.total;
  const discAmt = saleObj.discountAmt || 0;
  const taxAmt = saleObj.taxAmt || 0;
  const taxLabel = saleObj.gstMode === 'extra' ? 'EXTRA GST ADDED' : 'GST INCLUDED IN MRP';

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 14px 18px; width: 100%; max-width: 190mm; margin: 0 auto; background: #ffffff; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 12px; margin-bottom: 14px;">
        <div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${profile.bizName}</div>
          <div style="font-size: 11px; color: #475569; margin-top: 2px;">${fullAddr}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Phone: ${profile.phone} ${profile.email ? '• ' + profile.email : ''}</div>
          ${profile.gst || profile.dlNo ? `<div style="font-size: 10px; color: #334155; font-weight: 600; margin-top: 2px;">${profile.gst ? 'GSTIN: ' + profile.gst : ''} ${profile.dlNo ? ' | DL No: ' + profile.dlNo : ''}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #1d4ed8;">TAX INVOICE</h1>
          <div style="font-size: 12px; font-weight: 700; color: #0f172a; margin-top: 3px;">${saleObj.invNo}</div>
          <div style="font-size: 11px; color: #475569;">Date: ${saleObj.date}</div>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; display: flex; justify-content: space-between;">
        <div>
          <span style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">BILLED TO: </span>
          <strong style="font-size: 13px; color: #0f172a;">${saleObj.custName}</strong>
        </div>
        <div style="font-size: 12px; color: #475569;">
          Mobile: <strong>${saleObj.custPhone || 'Walk-in Customer'}</strong>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <thead>
          <tr style="border-top: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8; background: #f1f5f9;">
            <th style="padding: 7px 6px; text-align: left; font-size: 10px; font-weight: 700; color: #334155; text-transform: uppercase;">#</th>
            <th style="padding: 7px 6px; text-align: left; font-size: 10px; font-weight: 700; color: #334155; text-transform: uppercase;">Medicine Description</th>
            <th style="padding: 7px 6px; text-align: right; font-size: 10px; font-weight: 700; color: #334155; text-transform: uppercase;">Rate</th>
            <th style="padding: 7px 6px; text-align: center; font-size: 10px; font-weight: 700; color: #334155; text-transform: uppercase;">Qty</th>
            <th style="padding: 7px 6px; text-align: right; font-size: 10px; font-weight: 700; color: #334155; text-transform: uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 18px;">
        <div style="width: 240px;">
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; color: #64748b;">
            <span>SUBTOTAL</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          ${discAmt > 0 ? `
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; color: #10b981; font-weight: 600;">
            <span>DISCOUNT (${saleObj.discPct}%)</span>
            <span>- ₹${discAmt.toFixed(2)}</span>
          </div>` : ''}
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; color: #64748b;">
            <span>${taxLabel}</span>
            <span>${saleObj.gstMode === 'extra' ? '+ ' : ''}₹${taxAmt.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 8px 0 0 0; margin-top: 5px; border-top: 1.5px solid #94a3b8; font-size: 15px; font-weight: 800; color: #0f172a;">
            <span>INVOICE TOTAL</span>
            <span>₹${saleObj.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #64748b;">
        <div>
          <strong style="color: #0f172a; display: block; margin-bottom: 2px;">TERMS AND CONDITIONS</strong>
          <span>Goods once sold will not be taken back without original invoice.</span>
        </div>
        <div style="text-align: right;">
          <span>Authorized Signatory • <strong>${profile.bizName}</strong></span>
        </div>
      </div>
    </div>
  `;
}

async function shareInvoicePDF(saleObj, profile) {
  const htmlString = buildInvoiceHTML(saleObj, profile);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;
  document.body.appendChild(tempDiv);

  const fileName = `${saleObj.invNo}_${saleObj.custName.replace(/\s+/g, '_')}.pdf`;
  const opt = {
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (typeof html2pdf !== 'undefined') {
      const pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
      const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          files: [pdfFile],
          title: `Invoice ${saleObj.invNo}`,
          text: `Invoice ${saleObj.invNo} from ${profile.bizName} - Total: ₹${saleObj.total.toFixed(2)}`
        });
      } else {
        await html2pdf().set(opt).from(tempDiv).save();
        const msg = encodeURIComponent(`*${profile.bizName}*\nInvoice: ${saleObj.invNo}\nDate: ${saleObj.date}\nCustomer: ${saleObj.custName}\nTotal: ₹${saleObj.total.toFixed(2)}`);
        const waUrl = saleObj.custPhone ? `https://wa.me/91${saleObj.custPhone}?text=${msg}` : `https://wa.me/?text=${msg}`;
        window.open(waUrl, '_blank');
      }
    } else {
      window.print();
    }
  } catch (err) {
    console.error('PDF Share Error:', err);
  } finally {
    document.body.removeChild(tempDiv);
  }
}

async function generateAndShareBill(mode) {
  if (cart.length === 0) return alert('Add items to bill first.');

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE));
  const session = getActiveSession();
  const custName = document.getElementById('cust-name').value.trim() || 'Walk-in Customer';
  const custPhone = document.getElementById('cust-phone').value.trim();
  const invNo = getNextInvoiceNumber();
  const dateStr = new Date().toLocaleDateString('en-IN');

  const totals = calculateBillTotals();

  const newSale = {
    invNo,
    date: dateStr,
    custName,
    custPhone,
    billedBy: session.name || 'Admin',
    rawSubtotal: totals.rawSubtotal,
    discPct: totals.discPct,
    discountAmt: totals.discountAmt,
    gstMode: totals.gstMode,
    taxAmt: totals.taxAmt,
    total: totals.finalPayable,
    items: [...cart]
  };

  deductSoldStock(cart);
  incrementInvoiceSequence();

  const sales = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];
  sales.unshift(newSale);
  localStorage.setItem(DB_KEYS.SALES, JSON.stringify(sales));

  refreshDashboard();
  renderStockList();
  populateBillingDropdown();
  syncWithCloud(false);

  document.getElementById('a4-invoice-area').innerHTML = buildInvoiceHTML(newSale, profile);

  if (mode === 'print') {
    window.print();
  } else if (mode === 'whatsapp') {
    await shareInvoicePDF(newSale, profile);
  }

  clearCart();
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-phone').value = '';
  document.getElementById('bill-discount-pct').value = '0';
}

function openSavedBillsModal() {
  document.getElementById('saved-bills-modal').classList.add('active');
  renderSavedBillsList();
}
function closeSavedBillsModal() {
  document.getElementById('saved-bills-modal').classList.remove('active');
}

function renderSavedBillsList() {
  const container = document.getElementById('saved-bills-container');
  const query = (document.getElementById('saved-bill-search').value || '').toLowerCase();
  const sales = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];

  const filtered = sales.filter(s =>
    s.custName.toLowerCase().includes(query) || s.invNo.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; padding:24px;">No saved customer bills found.</p>`;
    return;
  }

  container.innerHTML = filtered.map((s, idx) => `
    <div class="item-card">
      <div>
        <strong style="font-size:14px;">${s.custName}</strong>
        <div style="font-size:11px; color:var(--muted); margin-top:2px;"><b style="color:var(--primary);">${s.invNo}</b> • ${s.date}</div>
        <div style="font-size:11px; color:var(--muted); margin-top:2px;">${s.items ? s.items.length : 1} Item(s) • By: ${s.billedBy || 'Admin'}</div>
      </div>
      <div style="text-align:right;">
        <strong style="font-size:15px; display:block;">₹${s.total.toFixed(2)}</strong>
        <div style="display:flex; gap:6px; margin-top:6px; justify-content:flex-end;">
          <button onclick="reprintSavedBill(${idx})" class="btn-secondary sm" title="Print"><i class="fa-solid fa-print"></i></button>
          <button onclick="shareSavedBillPDF(${idx})" class="btn-whatsapp sm" style="padding:7px 10px;" title="Share PDF"><i class="fa-brands fa-whatsapp"></i></button>
        </div>
      </div>
    </div>
  `).join('');
}

function reprintSavedBill(index) {
  const sales = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE));
  const saleObj = sales[index];
  if (!saleObj) return;
  if (!saleObj.items) saleObj.items = [];
  document.getElementById('a4-invoice-area').innerHTML = buildInvoiceHTML(saleObj, profile);
  window.print();
}

async function shareSavedBillPDF(index) {
  const sales = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE));
  const saleObj = sales[index];
  if (!saleObj) return;
  if (!saleObj.items) saleObj.items = [];
  await shareInvoicePDF(saleObj, profile);
}

/* ==================== DASHBOARD & SETTINGS ==================== */
function refreshDashboard() {
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const salesList = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];

  let stockVal = 0, expiredCount = 0, soonCount = 0;

  stockList.forEach(i => {
    const totalUnits = i.totalUnits !== undefined ? i.totalUnits : (i.packs * i.unitPerPack);
    const effectivePacks = totalUnits / i.unitPerPack;
    stockVal += i.mrp * effectivePacks;

    const st = getExpiryStatus(i.expiry);
    if (st === 'expired') expiredCount++;
    if (st === 'soon') soonCount++;
  });

  let totalSales = salesList.reduce((acc, s) => acc + s.total, 0);

  document.getElementById('dash-stock-val').innerText = `₹${stockVal.toFixed(2)}`;
  document.getElementById('dash-total-items').innerText = stockList.length;
  document.getElementById('dash-net-sales').innerText = `₹${totalSales.toFixed(2)}`;
  document.getElementById('dash-expiring-count').innerText = soonCount + expiredCount;

  const alertStrip = document.getElementById('expiry-alert-bar');
  const alertDesc = document.getElementById('alert-summary-desc');
  const alertTitle = document.getElementById('alert-summary-title');

  if (expiredCount > 0 || soonCount > 0) {
    alertStrip.style.display = 'flex';
    alertTitle.innerText = `Stock Expiry Alert`;
    alertDesc.innerText = `${expiredCount} Expired • ${soonCount} Expiring Soon (Tap to inspect)`;
  } else {
    alertStrip.style.display = 'none';
  }
}

function updateBusinessProfile() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  profile.bizName = document.getElementById('edit-biz-name').value.trim();
  profile.ownerName = document.getElementById('edit-owner-name').value.trim();
  profile.gst = document.getElementById('edit-gst').value.trim().toUpperCase();
  profile.dlNo = document.getElementById('edit-dl').value.trim().toUpperCase();
  profile.phone = document.getElementById('edit-phone').value.trim();
  profile.whatsapp = document.getElementById('edit-whatsapp').value.trim();
  profile.email = document.getElementById('edit-email').value.trim();
  profile.addr1 = document.getElementById('edit-addr1').value.trim();
  profile.addr2 = document.getElementById('edit-addr2').value.trim();
  profile.city = document.getElementById('edit-city').value.trim();
  profile.district = document.getElementById('edit-district').value;
  profile.state = 'Tripura';
  profile.pin = document.getElementById('edit-pin').value.trim();

  const customNextInv = parseInt(document.getElementById('edit-next-inv').value);
  if (!isNaN(customNextInv) && customNextInv >= 1) {
    localStorage.setItem(DB_KEYS.INV_SEQ, customNextInv);
  }

  localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));
  loadMainApp(profile);
  showToast('Business profile updated!');
  syncWithCloud(false);
}

function saveGHSCloudConfig() {
  const url = document.getElementById('ghs-cloud-url').value.trim();
  const secret = document.getElementById('ghs-cloud-secret').value.trim();
  localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url, secret }));
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  renderProfileQR(profile);
  showToast('GHS Cloud configuration saved!');
  if (url) syncWithCloud(true);
}

/* ==================== FIXED OFFLINE JSON EXPORT & RESTORE ==================== */
function exportBackupJSON() {
  const backupData = {
    app: 'PharmaPOS_GHS',
    profile: JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)),
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [],
    sales: JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [],
    orders: JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [],
    staff: JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [],
    invSeq: localStorage.getItem(DB_KEYS.INV_SEQ) || 1,
    cloudCfg: JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}')
  };
  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = `POS_Backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup JSON exported!');
}

function triggerRestoreInput() {
  const input = document.getElementById('restore-file-input');
  input.value = ''; // Allow re-selecting same file
  input.click();
}

function handleRestoreJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const fileReader = new FileReader();
  fileReader.onload = function(e) {
    try {
      const restored = JSON.parse(e.target.result);
      if (!restored || typeof restored !== 'object' || (!restored.profile && !restored.stock)) {
        throw new Error('Invalid backup structure');
      }
      if (restored.profile) {
        if (!restored.profile.profileId) restored.profile.profileId = generateUniqueStoreId();
        localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(restored.profile));
      }
      if (restored.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(restored.stock));
      if (restored.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(restored.sales));
      if (restored.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(restored.orders));
      if (restored.staff) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(restored.staff));
      if (restored.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, restored.invSeq);
      if (restored.cloudCfg) localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify(restored.cloudCfg));

      const currentProfile = restored.profile || JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
      loadMainApp(currentProfile);
      showToast('Database restored successfully!');
    } catch (err) {
      alert('Invalid backup file! Please select a valid POS_Backup JSON file.');
    }
  };
  fileReader.readAsText(file);
}

function openScanner() { showToast('Camera Barcode Scanner ready.'); }

/* ==================== GHS CLOUD REAL-TIME SYNC (REST API) ==================== */
async function syncWithCloud(isManual = false) {
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  if (!cloudCfg.url) {
    if (isManual) showToast('Configure GHS Cloud URL in Settings first.');
    return;
  }

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  if (!profile.profileId) return;

  const pill = document.getElementById('sync-status-pill');
  if (pill) {
    pill.className = 'sync-pill syncing';
    pill.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Syncing';
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    profile: profile,
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [],
    sales: JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [],
    orders: JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [],
    staff: JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [],
    invSeq: parseInt(localStorage.getItem(DB_KEYS.INV_SEQ)) || 1
  };

  try {
    const baseUrl = normalizeCloudBaseUrl(cloudCfg.url);
    const authParam = cloudCfg.secret ? `?auth=${encodeURIComponent(cloudCfg.secret)}` : '';
    const res = await fetch(`${baseUrl}/stores/${encodeURIComponent(profile.profileId)}.json${authParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Cloud write rejected');

    if (pill) {
      pill.className = 'sync-pill done';
      pill.innerHTML = '<i class="fa-solid fa-check"></i> Synced';
      setTimeout(() => { pill.style.display = 'none'; }, 2500);
    }
    if (isManual) showToast('Store data synced to GHS Cloud!');
  } catch (err) {
    console.error('GHS Cloud Sync Error:', err);
    if (pill) pill.style.display = 'none';
    if (isManual) showToast('Sync failed. Check GHS Cloud URL & rules.');
  }
}

async function pullFromCloud(isManual = false, overrideId = null, overrideUrl = null, overrideSecret = null) {
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};

  const targetUrl = overrideUrl || cloudCfg.url;
  const targetSecret = overrideSecret !== null ? overrideSecret : (cloudCfg.secret || '');
  const targetId = overrideId || profile.profileId;

  if (!targetUrl || !targetId) {
    if (isManual) showToast('Configure GHS Cloud URL first.');
    return;
  }

  try {
    const baseUrl = normalizeCloudBaseUrl(targetUrl);
    const authParam = targetSecret ? `?auth=${encodeURIComponent(targetSecret)}` : '';
    const res = await fetch(`${baseUrl}/stores/${encodeURIComponent(targetId)}.json${authParam}`);
    if (!res.ok) throw new Error('Pull failed');
    const data = await res.json();

    if (data && data.profile) {
      localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(data.profile));
      if (data.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(data.stock));
      if (data.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(data.sales));
      if (data.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(data.orders));
      if (data.staff) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(data.staff));
      if (data.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, data.invSeq);
      loadMainApp(data.profile);
      if (isManual) showToast('Latest cloud data pulled!');
    } else if (isManual) {
      showToast('No cloud backup found for this Store ID yet.');
    }
  } catch (err) {
    if (isManual) showToast('Failed to pull data from GHS Cloud.');
  }
}
