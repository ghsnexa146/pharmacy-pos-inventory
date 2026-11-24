import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ==================== MASTER CENTRAL ADMIN SERVER CONFIG ==================== */
const MASTER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyA5nFNlBoeSjYp7OA7IeObWuuStfTLhKiA",
  authDomain: "pharmacy-pos-84203.firebaseapp.com",
  projectId: "pharmacy-pos-84203",
  storageBucket: "pharmacy-pos-84203.firebasestorage.app",
  messagingSenderId: "1082478795452",
  appId: "1:1082478795452:web:2ed69b5b55cbe2e2454eb9"
};

const masterApp = initializeApp(MASTER_FIREBASE_CONFIG, "CentralLicenseAuthority");
const masterDb = getFirestore(masterApp);

const DB_KEYS = {
  PROFILE: 'retailer_biz_profile',
  STOCK: 'retailer_stock_list',
  STOCK_LOGS: 'retailer_stock_logs',
  SALES: 'retailer_sales_list',
  ORDERS: 'retailer_purchase_orders',
  STAFF: 'retailer_staff_list',
  INV_SEQ: 'retailer_invoice_seq',
  CLOUD_CFG: 'retailer_ghs_cloud_cfg',
  SESSION: 'retailer_active_session',
  THEME: 'retailer_app_theme',
  LICENSE_APPROVED: 'retailer_central_license_approved',
  LAST_SYNC_TS: 'retailer_last_sync_ts'
};

let cart = [];
let currentStockFilter = 'all';
let currentDashboardPeriod = 'today';
let activeTabName = 'home';
let currentLoginRole = 'admin';
let unsubscribeLicenseListener = null;
let autoSyncIntervalId = null;

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
  protectLicenseOverlayDOM();
});

/* ==================== REAL-TIME AUTO-SYNC ENGINE (EVERY 5 SECONDS) ==================== */
function startRealTimeAutoSync() {
  if (autoSyncIntervalId) clearInterval(autoSyncIntervalId);

  autoSyncIntervalId = setInterval(async () => {
    const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
    const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null');
    if (!cloudCfg.url || !profile || !profile.profileId) return;

    try {
      const baseUrl = normalizeCloudBaseUrl(cloudCfg.url);
      const authParam = cloudCfg.secret ? `?auth=${encodeURIComponent(cloudCfg.secret)}` : '';
      const res = await fetch(`${baseUrl}/stores/${encodeURIComponent(profile.profileId)}.json${authParam}`);
      if (!res.ok) return;
      const remoteData = await res.json();
      if (!remoteData || !remoteData.profile || !remoteData.updatedAt) return;

      const localLastSync = localStorage.getItem(DB_KEYS.LAST_SYNC_TS) || '';
      if (remoteData.updatedAt !== localLastSync) {
        localStorage.setItem(DB_KEYS.LAST_SYNC_TS, remoteData.updatedAt);
        localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(remoteData.profile));
        if (remoteData.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(remoteData.stock));
        if (remoteData.stockLogs) localStorage.setItem(DB_KEYS.STOCK_LOGS, JSON.stringify(remoteData.stockLogs));
        if (remoteData.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(remoteData.sales));
        if (remoteData.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(remoteData.orders));
        if (remoteData.staff) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(remoteData.staff));
        if (remoteData.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, remoteData.invSeq);

        refreshDashboard();
        renderStockList();
        renderOrdersList();
        populateBillingDropdown();
        updateNextInvPreview();
        renderStaffList();

        const pill = document.getElementById('sync-status-pill');
        if (pill) {
          pill.className = 'sync-pill done';
          pill.innerHTML = '<i class="fa-solid fa-bolt"></i> Auto-Synced';
          setTimeout(() => { pill.style.display = 'none'; }, 2200);
        }
      }
    } catch (err) {
      // অফলাইন থাকলে চুপচাপ স্কিপ করবে
    }
  }, 5000);
}

async function manualFullSyncRefresh() {
  const btnIcon = document.querySelector('#manual-sync-btn i');
  if (btnIcon) btnIcon.classList.add('fa-spin');
  showToast('Syncing & refreshing store data...');

  try {
    await pullFromCloud(false);
    await syncWithCloud(false);
    refreshDashboard();
    renderStockList();
    renderOrdersList();
    populateBillingDropdown();
    updateNextInvPreview();
    showToast('All data synced & up-to-date!');
  } finally {
    if (btnIcon) setTimeout(() => btnIcon.classList.remove('fa-spin'), 500);
  }
}

/* ==================== CENTRAL LICENSE APPROVAL & AUTO-CONFIG SYNC ==================== */
async function registerStoreForCentralApproval(profile) {
  try {
    const reqRef = doc(masterDb, "license_requests", profile.profileId);
    const snap = await getDoc(reqRef);

    if (!snap.exists()) {
      await setDoc(reqRef, {
        profileId: profile.profileId,
        bizName: profile.bizName,
        ownerName: profile.ownerName,
        phone: profile.phone,
        whatsapp: profile.whatsapp || profile.phone,
        email: profile.email || "",
        addr1: profile.addr1 || "",
        addr2: profile.addr2 || "",
        city: profile.city || "",
        district: profile.district || "",
        state: profile.state || "Tripura",
        pin: profile.pin || "",
        gst: profile.gst || "",
        dlNo: profile.dlNo || "",
        adminPin: profile.adminPin || "",
        staffList: JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]'),
        cloudUrl: "",
        cloudSecret: "",
        status: "pending",
        requestedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("Central registration sync error:", err);
  }
}

async function syncStoreMetadataToCentral(profile) {
  if (!profile || !profile.profileId) return;
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  const staffList = JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]');
  try {
    await setDoc(doc(masterDb, "license_requests", profile.profileId), {
      bizName: profile.bizName,
      ownerName: profile.ownerName,
      phone: profile.phone,
      whatsapp: profile.whatsapp || profile.phone,
      email: profile.email || "",
      addr1: profile.addr1 || "",
      addr2: profile.addr2 || "",
      city: profile.city || "",
      district: profile.district || "",
      state: profile.state || "Tripura",
      pin: profile.pin || "",
      gst: profile.gst || "",
      dlNo: profile.dlNo || "",
      adminPin: profile.adminPin || "",
      staffList: staffList,
      cloudUrl: cloudCfg.url || "",
      cloudSecret: cloudCfg.secret || ""
    }, { merge: true });
  } catch (err) {
    console.warn("Central metadata update skipped (offline):", err);
  }
}

function attachCentralLicenseWatcher(profile) {
  if (!profile || !profile.profileId) return;

  const cachedStatus = localStorage.getItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`);
  if (cachedStatus !== 'approved') {
    showHardLicenseLock(profile, "PENDING APPROVAL");
  }

  if (unsubscribeLicenseListener) {
    unsubscribeLicenseListener();
  }

  try {
    const reqRef = doc(masterDb, "license_requests", profile.profileId);
    unsubscribeLicenseListener = onSnapshot(reqRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status === "approved") {
          localStorage.setItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`, "approved");
          hideHardLicenseLock();
        } else {
          localStorage.removeItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`);
          const label = data.status === "suspended" ? "LICENSE SUSPENDED" : "INVALID LICENSE KEY • PENDING";
          showHardLicenseLock(profile, label);
        }
      } else {
        registerStoreForCentralApproval(profile);
        localStorage.removeItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`);
        showHardLicenseLock(profile, "INVALID LICENSE KEY • UNREGISTERED");
      }
    }, (error) => {
      console.warn("License listener warning:", error);
    });
  } catch (err) {
    console.error("Watcher setup failed:", err);
  }
}

async function verifyCentralLicenseStatus(isManual = false) {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null');
  if (!profile || !profile.profileId) return;

  const btn = document.getElementById('btn-recheck-license');
  if (btn && isManual) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking Central Server...';
  }

  try {
    const reqRef = doc(masterDb, "license_requests", profile.profileId);
    const snap = await getDoc(reqRef);

    if (snap.exists() && snap.data().status === "approved") {
      localStorage.setItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`, "approved");
      hideHardLicenseLock();
      showToast("License Approved! Welcome to PharmaPOS Pro.");
    } else {
      if (!snap.exists()) {
        await registerStoreForCentralApproval(profile);
      }
      localStorage.removeItem(`${DB_KEYS.LICENSE_APPROVED}_${profile.profileId}`);
      showHardLicenseLock(profile, "INVALID LICENSE KEY • NOT APPROVED");
      if (isManual) showToast("Still pending approval from developer.");
    }
  } catch (err) {
    if (isManual) showToast("Network error. Please check internet connection.");
  } finally {
    if (btn && isManual) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check Approval Status';
    }
  }
}

function showHardLicenseLock(profile, badgeText = "INVALID LICENSE KEY") {
  const overlay = document.getElementById('license-lock-overlay');
  if (!overlay) return;

  document.getElementById('lock-display-store-id').innerText = profile.profileId || 'GHS-000000';
  document.getElementById('lock-display-store-name').innerText = `${profile.bizName || 'Pharmacy'} (${profile.ownerName || ''})`;
  document.getElementById('lock-status-badge').innerText = badgeText;

  const waText = encodeURIComponent(
    `Hello D. Hossain,\nPlease approve my PharmaPOS Store License:\n• Store Name: ${profile.bizName}\n• Store ID: ${profile.profileId}\n• Owner: ${profile.ownerName} (${profile.phone})`
  );
  const waBtn = document.getElementById('lock-wa-btn');
  if (waBtn) waBtn.href = `https://wa.me/916909998882?text=${waText}`;

  overlay.style.display = 'flex';
  overlay.dataset.locked = 'true';
}

function hideHardLicenseLock() {
  const overlay = document.getElementById('license-lock-overlay');
  if (!overlay) return;
  overlay.dataset.locked = 'false';
  overlay.style.display = 'none';
}

function copyLockedStoreId() {
  const idText = document.getElementById('lock-display-store-id').innerText;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(idText);
  }
  showToast(`Store ID ${idText} copied!`);
}

function protectLicenseOverlayDOM() {
  const overlay = document.getElementById('license-lock-overlay');
  if (!overlay) return;
  const observer = new MutationObserver(() => {
    if (overlay.dataset.locked === 'true' && overlay.style.display === 'none') {
      overlay.style.display = 'flex';
    }
  });
  observer.observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
}

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
    const lockOverlay = document.getElementById('license-lock-overlay');
    if (lockOverlay && lockOverlay.dataset.locked === 'true') {
      window.history.pushState({ appState: 'root' }, '');
      return;
    }

    const pickerModal = document.getElementById('med-picker-modal');
    const stockModal = document.getElementById('stock-modal');
    const billsModal = document.getElementById('saved-bills-modal');

    if (pickerModal && pickerModal.classList.contains('active')) {
      closeMedicinePickerModal();
      window.history.pushState({ appState: 'root' }, '');
      return;
    }
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
      roleBadge.innerText = 'Administrator Terminal';
      roleBadge.parentElement.classList.remove('staff');
    }
    if (staffLogoutBtn) staffLogoutBtn.style.display = 'none';
  }
}

function logoutCurrentSession(skipConfirm = false) {
  if (!skipConfirm && !confirm('Logout from this terminal session?')) return;
  if (unsubscribeLicenseListener) {
    unsubscribeLicenseListener();
    unsubscribeLicenseListener = null;
  }
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }
  hideHardLicenseLock();
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
async function addAuthorizedStaff() {
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

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  await syncStoreMetadataToCentral(profile);
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

async function removeStaffMember(idx) {
  if (!confirm('Remove this staff member? They will no longer be able to login.')) return;
  const staffList = JSON.parse(localStorage.getItem(DB_KEYS.STAFF)) || [];
  staffList.splice(idx, 1);
  localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(staffList));
  renderStaffList();

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  await syncStoreMetadataToCentral(profile);
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

/* ==================== COPY STORE ID HELPER ==================== */
function copyProfileCode() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  const idText = profile.profileId || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(idText);
  }
  showToast(`Store ID ${idText} copied!`);
}

/* ==================== CLEAN ZERO-CONFIG MULTI-USER LOGIN ==================== */
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
    switchLoginRoleTab('admin');
  }
}

function switchLoginRoleTab(role) {
  currentLoginRole = role;
  const tabAdmin = document.getElementById('role-tab-admin');
  const tabStaff = document.getElementById('role-tab-staff');
  const hintBox = document.getElementById('login-role-hint');
  const mobileLabel = document.getElementById('login-mobile-label');
  const pinWrapper = document.getElementById('login-pin-wrapper');
  const submitBtn = document.getElementById('btn-verify-login');
  const errEl = document.getElementById('recovery-error-msg');
  if (errEl) errEl.style.display = 'none';

  if (role === 'admin') {
    tabAdmin.classList.add('active');
    tabStaff.classList.remove('active');
    hintBox.innerHTML = `<i class="fa-solid fa-shield-halved"></i><p><strong>Administrator Login:</strong> Enter Store Profile ID, Owner Mobile Number, and 6-Digit Admin PIN. Cloud data syncs automatically.</p>`;
    mobileLabel.innerText = 'Administrator Mobile Number *';
    pinWrapper.style.display = 'block';
    submitBtn.innerHTML = '<i class="fa-solid fa-unlock-keyhole"></i> Verify & Login Administrator';
  } else {
    tabStaff.classList.add('active');
    tabAdmin.classList.remove('active');
    hintBox.innerHTML = `<i class="fa-solid fa-user-nurse"></i><p><strong>Staff Login:</strong> Enter Store Profile ID and your registered Staff Mobile Number. No PIN or Cloud setup required.</p>`;
    mobileLabel.innerText = 'Registered Staff Mobile Number *';
    pinWrapper.style.display = 'none';
    submitBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Verify & Login Staff';
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
  const enteredPin = document.getElementById('login-admin-pin').value.trim();
  const errEl = document.getElementById('recovery-error-msg');
  const btn = document.getElementById('btn-verify-login');

  const showError = (msg) => {
    errEl.innerText = msg;
    errEl.style.display = 'block';
  };
  errEl.style.display = 'none';

  if (!profileId || !mobileNo) {
    return showError('Please enter both Unique Store Profile ID and Mobile Number.');
  }
  if (currentLoginRole === 'admin' && enteredPin.length !== 6) {
    return showError('Please enter your 6-Digit Admin Security PIN.');
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing & Verifying...';

  try {
    const centralSnap = await getDoc(doc(masterDb, "license_requests", profileId));
    let centralData = centralSnap.exists() ? centralSnap.data() : null;

    const localProfile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null');
    const savedCloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');

    const autoCloudUrl = (centralData && centralData.cloudUrl) || savedCloudCfg.url || '';
    const autoCloudSecret = (centralData && centralData.cloudSecret) || savedCloudCfg.secret || '';

    let storeData = null;

    if (autoCloudUrl) {
      try {
        const baseUrl = normalizeCloudBaseUrl(autoCloudUrl);
        const authParam = autoCloudSecret ? `?auth=${encodeURIComponent(autoCloudSecret)}` : '';
        const res = await fetch(`${baseUrl}/stores/${encodeURIComponent(profileId)}.json${authParam}`);
        if (res.ok) {
          const remoteJson = await res.json();
          if (remoteJson && remoteJson.profile) {
            storeData = remoteJson;
          }
        }
      } catch (e) {
        console.warn("Store cloud fetch fallback:", e);
      }
    }

    if (!storeData && centralData) {
      storeData = {
        profile: {
          profileId: centralData.profileId,
          bizName: centralData.bizName,
          ownerName: centralData.ownerName,
          phone: centralData.phone,
          whatsapp: centralData.whatsapp || centralData.phone,
          email: centralData.email || '',
          addr1: centralData.addr1 || '',
          addr2: centralData.addr2 || '',
          city: centralData.city || '',
          district: centralData.district || 'Sepahijala',
          state: centralData.state || 'Tripura',
          pin: centralData.pin || '',
          gst: centralData.gst || '',
          dlNo: centralData.dlNo || '',
          adminPin: centralData.adminPin || ''
        },
        staff: centralData.staffList || JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]')
      };
    } else if (!storeData && localProfile && localProfile.profileId === profileId) {
      storeData = {
        profile: localProfile,
        staff: JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]')
      };
    }

    if (!storeData || !storeData.profile) {
      return showError('Store Profile ID not found! Please check the Store ID.');
    }

    const remoteProfile = storeData.profile;
    const remoteStaff = storeData.staff || (centralData && centralData.staffList) || [];
    let sessionObj = null;

    if (currentLoginRole === 'admin') {
      const isOwnerPhone = (remoteProfile.phone === mobileNo || remoteProfile.whatsapp === mobileNo);
      if (!isOwnerPhone) {
        return showError('Mobile number does not match the Administrator of this Store ID.');
      }
      if (remoteProfile.adminPin && remoteProfile.adminPin !== enteredPin) {
        return showError('Incorrect 6-Digit Admin Security PIN!');
      }
      sessionObj = { role: 'admin', name: remoteProfile.ownerName, phone: mobileNo };
    } else {
      const matchedStaff = remoteStaff.find(s => s.phone === mobileNo);
      if (!matchedStaff) {
        return showError('Access Denied! Mobile number is not registered as Authorized Staff.');
      }
      sessionObj = { role: 'staff', name: matchedStaff.name, phone: matchedStaff.phone };
    }

    if (autoCloudUrl) {
      localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url: autoCloudUrl, secret: autoCloudSecret }));
    }
    localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(remoteProfile));
    if (storeData.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(storeData.stock));
    if (storeData.stockLogs) localStorage.setItem(DB_KEYS.STOCK_LOGS, JSON.stringify(storeData.stockLogs));
    if (storeData.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(storeData.sales));
    if (storeData.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(storeData.orders));
    if (remoteStaff.length > 0) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(remoteStaff));
    if (storeData.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, storeData.invSeq);
    if (storeData.updatedAt) localStorage.setItem(DB_KEYS.LAST_SYNC_TS, storeData.updatedAt);

    localStorage.setItem(DB_KEYS.SESSION, JSON.stringify(sessionObj));
    loadMainApp(remoteProfile);
    showToast(`Welcome ${sessionObj.name}! Terminal synced.`);
  } catch (err) {
    showError('Unable to verify account. Please check your internet connection.');
  } finally {
    btn.disabled = false;
    switchLoginRoleTab(currentLoginRole);
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
async function handleInitialSetup(e) {
  if (e) e.preventDefault();

  const bizName = document.getElementById('reg-biz-name').value.trim();
  const ownerName = document.getElementById('reg-owner-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const whatsapp = document.getElementById('reg-whatsapp').value.trim();
  const adminPin = document.getElementById('reg-admin-pin').value.trim();
  const addr1 = document.getElementById('reg-addr1').value.trim();
  const city = document.getElementById('reg-city').value.trim();
  const district = document.getElementById('reg-district').value;
  const pin = document.getElementById('reg-pin').value.trim();

  if (!bizName || !ownerName || !phone || !addr1 || !city || !district || !pin) {
    alert('Please fill all required (*) fields and select a District.');
    return;
  }

  if (!/^\d{6}$/.test(adminPin)) {
    alert('Please create a valid 6-Digit Admin Security PIN (numbers only).');
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
    adminPin: adminPin,
    addr1: addr1,
    addr2: (document.getElementById('reg-addr2').value || '').trim(),
    city: city,
    district: district,
    state: 'Tripura',
    pin: pin
  };

  localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));
  localStorage.setItem(DB_KEYS.SESSION, JSON.stringify({ role: 'admin', name: ownerName, phone: phone }));
  if (!localStorage.getItem(DB_KEYS.INV_SEQ)) {
    localStorage.setItem(DB_KEYS.INV_SEQ, 1);
  }

  await registerStoreForCentralApproval(profile);
  loadMainApp(profile);
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
  lockCloudEditFields();
  resetAdminPinFlow();

  renderStaffList();
  updateNextInvPreview();
  refreshDashboard();
  renderStockList();
  renderOrdersList();
  renderBillCart();
  populateBillingDropdown();
  applyRolePermissions();

  attachCentralLicenseWatcher(profile);
  startRealTimeAutoSync();
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

/* ==================== STOCK MOVEMENT LOGGER (FOR PERIOD ANALYTICS) ==================== */
function recordStockMovement(medName, packsAdded, unitsAdded, type = 'new') {
  const logs = JSON.parse(localStorage.getItem(DB_KEYS.STOCK_LOGS)) || [];
  logs.unshift({
    id: Date.now(),
    name: medName,
    packs: packsAdded,
    units: unitsAdded,
    type: type,
    timestamp: Date.now(),
    date: new Date().toLocaleDateString('en-IN')
  });
  localStorage.setItem(DB_KEYS.STOCK_LOGS, JSON.stringify(logs));
}

/* ==================== STOCK MANAGEMENT, RESTOCK & FILTERED STOCK PDF ==================== */
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
  const medName = document.getElementById('item-name').value.trim();

  const newItem = {
    id: Date.now(),
    addedAt: Date.now(),
    name: medName,
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
  recordStockMovement(medName, packs, packs * unitPerPack, 'new');

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
  const addedUnits = addPacks * item.unitPerPack;
  const currentUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
  item.totalUnits = currentUnits + addedUnits;
  item.packs = item.totalUnits / item.unitPerPack;
  if (!isNaN(newMrp) && newMrp > 0) item.mrp = newMrp;
  if (!isNaN(newPur) && newPur > 0) item.purchaseRate = newPur;

  stockList[idx] = item;
  localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(stockList));
  recordStockMovement(item.name, addPacks, addedUnits, 'restock');

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

function getFilteredStockItems() {
  const query = (document.getElementById('stock-search')?.value || '').toLowerCase();
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];

  const categorized = stockList.map(item => ({
    ...item,
    status: getExpiryStatus(item.expiry)
  }));

  const priority = { expired: 1, soon: 2, new: 3 };
  categorized.sort((a, b) => priority[a.status] - priority[b.status]);

  return categorized.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(query) ||
                          i.batch.toLowerCase().includes(query) ||
                          (i.mfg && i.mfg.toLowerCase().includes(query));
    const matchesTab = currentStockFilter === 'all' || i.status === currentStockFilter;
    return matchesSearch && matchesTab;
  });
}

function renderStockList() {
  const container = document.getElementById('stock-list-container');
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];

  let countAll = stockList.length, countNew = 0, countSoon = 0, countExpired = 0;

  stockList.forEach(item => {
    const status = getExpiryStatus(item.expiry);
    if (status === 'new') countNew++;
    if (status === 'soon') countSoon++;
    if (status === 'expired') countExpired++;
  });

  document.getElementById('count-all').innerText = countAll;
  document.getElementById('count-new').innerText = countNew;
  document.getElementById('count-soon').innerText = countSoon;
  document.getElementById('count-expired').innerText = countExpired;

  const filtered = getFilteredStockItems();

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

/* ==================== EXPORT FILTERED STOCK LIST AS PDF & SHARE ==================== */
function buildStockReportHTML(stockList, profile, reportTitle = 'COMPLETE STOCK REPORT') {
  const fullAddr = formatFullAddress(profile);
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  let totalStockMRPVal = 0;
  let totalStockPurVal = 0;

  const rowsHtml = stockList.map((item, idx) => {
    const totalUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
    const fullPacks = Math.floor(totalUnits / item.unitPerPack);
    const looseUnits = totalUnits % item.unitPerPack;
    const effectivePacks = totalUnits / item.unitPerPack;

    const itemMrpVal = item.mrp * effectivePacks;
    const itemPurVal = (item.purchaseRate || 0) * effectivePacks;
    totalStockMRPVal += itemMrpVal;
    totalStockPurVal += itemPurVal;

    const st = getExpiryStatus(item.expiry);
    const statusLabel = st === 'expired' ? 'EXPIRED' : (st === 'soon' ? 'EXPIRING SOON' : 'VALID');
    const statusColor = st === 'expired' ? '#dc2626' : (st === 'soon' ? '#d97706' : '#16a34a');

    let qtyDisplay = `${fullPacks} Pack`;
    if (looseUnits > 0) qtyDisplay += ` + ${looseUnits} Pc`;
    if (totalUnits <= 0) qtyDisplay = `OUT OF STOCK`;

    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 6px 5px; font-size: 10px; color: #475569;">${idx + 1}</td>
        <td style="padding: 6px 5px; font-size: 11px; color: #0f172a;">
          <strong>${item.name}</strong>
          <div style="font-size: 9px; color: #64748b;">Mfg: ${item.mfg || '-'} • ${item.unitPerPack} Pcs/Pack</div>
        </td>
        <td style="padding: 6px 5px; font-size: 10px; color: #334155;">${item.batch}</td>
        <td style="padding: 6px 5px; font-size: 10px; text-align: center;">
          <div>${item.expiry}</div>
          <span style="font-size: 8px; font-weight: 800; color: ${statusColor};">${statusLabel}</span>
        </td>
        <td style="padding: 6px 5px; font-size: 11px; text-align: center; font-weight: 700; color: #0f172a;">${qtyDisplay}</td>
        <td style="padding: 6px 5px; font-size: 11px; text-align: right; color: #334155;">₹${(item.purchaseRate || 0).toFixed(2)}</td>
        <td style="padding: 6px 5px; font-size: 11px; text-align: right; color: #0f172a;">₹${item.mrp.toFixed(2)}</td>
        <td style="padding: 6px 5px; font-size: 11px; text-align: right; font-weight: 700; color: #0f172a;">₹${itemMrpVal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 14px 16px; width: 100%; max-width: 195mm; margin: 0 auto; background: #ffffff; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 10px; margin-bottom: 12px;">
        <div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${profile.bizName}</div>
          <div style="font-size: 10px; color: #475569; margin-top: 2px;">${fullAddr}</div>
          <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Phone: ${profile.phone} ${profile.dlNo ? '• DL: ' + profile.dlNo : ''}</div>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; font-size: 15px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.5px;">${reportTitle}</h2>
          <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 3px;">Date: ${dateStr}</div>
          <div style="font-size: 10px; color: #475569;">Listed Items: ${stockList.length}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px;">
        <thead>
          <tr style="background: #f1f5f9; border-top: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8;">
            <th style="padding: 6px 5px; text-align: left; font-size: 9px; font-weight: 800; color: #334155;">#</th>
            <th style="padding: 6px 5px; text-align: left; font-size: 9px; font-weight: 800; color: #334155;">MEDICINE & MFG</th>
            <th style="padding: 6px 5px; text-align: left; font-size: 9px; font-weight: 800; color: #334155;">BATCH</th>
            <th style="padding: 6px 5px; text-align: center; font-size: 9px; font-weight: 800; color: #334155;">EXPIRY</th>
            <th style="padding: 6px 5px; text-align: center; font-size: 9px; font-weight: 800; color: #334155;">AVAIL. STOCK</th>
            <th style="padding: 6px 5px; text-align: right; font-size: 9px; font-weight: 800; color: #334155;">PUR. RATE</th>
            <th style="padding: 6px 5px; text-align: right; font-size: 9px; font-weight: 800; color: #334155;">MRP</th>
            <th style="padding: 6px 5px; text-align: right; font-size: 9px; font-weight: 800; color: #334155;">STOCK VAL.</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 14px;">
        <div style="width: 260px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; color: #475569; margin-bottom: 4px;">
            <span>Total Purchase Value:</span>
            <strong>₹${totalStockPurVal.toFixed(2)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 13px; color: #0f172a; border-top: 1px solid #cbd5e1; padding-top: 6px;">
            <span><strong>Total MRP Stock Value:</strong></span>
            <strong style="color: #1d4ed8;">₹${totalStockMRPVal.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid #cbd5e1; padding-top: 8px; display: flex; justify-content: space-between; font-size: 9px; color: #64748b;">
        <span>Generated by PharmaPOS Pro • Designed by D. Hossain</span>
        <span>Store ID: <strong>${profile.profileId || ''}</strong></span>
      </div>
    </div>
  `;
}

async function exportAllStockPDF() {
  const filteredList = getFilteredStockItems();
  if (filteredList.length === 0) {
    return alert('No medicines found in the selected filter tab to export.');
  }

  const titleMap = {
    all: 'COMPLETE STOCK REPORT',
    new: 'VALID MEDICINES STOCK REPORT',
    soon: 'EXPIRING SOON STOCK REPORT',
    expired: 'EXPIRED MEDICINES REPORT'
  };
  const tagMap = {
    all: 'All_Stock',
    new: 'Valid_Stock',
    soon: 'Expiring_Soon',
    expired: 'Expired_Stock'
  };

  const reportTitle = titleMap[currentStockFilter] || 'STOCK REPORT';
  const filterTag = tagMap[currentStockFilter] || 'Stock';

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || { bizName: 'Pharmacy' };
  const htmlString = buildStockReportHTML(filteredList, profile, reportTitle);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;
  document.body.appendChild(tempDiv);

  const dateTag = new Date().toISOString().slice(0, 10);
  const cleanStoreName = (profile.bizName || 'Store').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${filterTag}_${cleanStoreName}_${dateTag}.pdf`;

  const opt = {
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (typeof html2pdf !== 'undefined') {
      if (window.AndroidBridge && typeof window.AndroidBridge.sharePdfBase64 === 'function') {
        showToast(`Generating ${reportTitle}...`);
        const pdfDataUri = await html2pdf().set(opt).from(tempDiv).outputPdf('datauristring');
        window.AndroidBridge.sharePdfBase64(pdfDataUri, fileName, '');
      } else {
        const pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: `${reportTitle} - ${profile.bizName}`,
            text: `${reportTitle} (${filteredList.length} Items) - ${profile.bizName}`
          });
        } else {
          await html2pdf().set(opt).from(tempDiv).save();
          showToast(`${reportTitle} Downloaded!`);
        }
      }
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Stock PDF Export Error:', err);
    showToast('Unable to generate Stock PDF.');
  } finally {
    document.body.removeChild(tempDiv);
  }
}

/* ==================== ORDERS (MEDICINE REORDER LIST + PDF EXPORT) ==================== */
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

function buildPurchaseOrderHTML(orders, profile) {
  const fullAddr = formatFullAddress(profile);
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const rowsHtml = orders.map((o, idx) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px 6px; font-size: 11px; color: #475569;">${idx + 1}</td>
      <td style="padding: 8px 6px; font-size: 12px; color: #0f172a;"><strong>${o.name}</strong></td>
      <td style="padding: 8px 6px; font-size: 11px; color: #334155;">${o.mfg || 'Any'}</td>
      <td style="padding: 8px 6px; font-size: 11px; color: #334155;">${o.supplier || 'General Agency'}</td>
      <td style="padding: 8px 6px; font-size: 12px; text-align: right; font-weight: 800; color: #1d4ed8;">${o.qty}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 16px 18px; width: 100%; max-width: 190mm; margin: 0 auto; background: #ffffff; box-sizing: border-box;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; margin-bottom: 14px;">
        <div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${profile.bizName}</div>
          <div style="font-size: 10px; color: #475569; margin-top: 2px;">${fullAddr}</div>
          <div style="font-size: 10px; color: #64748b; margin-top: 2px;">Phone: ${profile.phone} ${profile.dlNo ? '• DL: ' + profile.dlNo : ''}</div>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; font-size: 17px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.5px;">PURCHASE ORDER</h2>
          <div style="font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 3px;">Date: ${dateStr}</div>
          <div style="font-size: 10px; color: #475569;">Total Items: ${orders.length}</div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 18px;">
        <thead>
          <tr style="background: #f1f5f9; border-top: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8;">
            <th style="padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 800; color: #334155;">#</th>
            <th style="padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 800; color: #334155;">MEDICINE NAME</th>
            <th style="padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 800; color: #334155;">COMPANY / MFG</th>
            <th style="padding: 8px 6px; text-align: left; font-size: 10px; font-weight: 800; color: #334155;">AGENCY / SUPPLIER</th>
            <th style="padding: 8px 6px; text-align: right; font-size: 10px; font-weight: 800; color: #334155;">ORDER QTY</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="border-top: 1px solid #cbd5e1; padding-top: 10px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b;">
        <span>Please confirm stock availability & billing rate.</span>
        <span>Authorized Order • <strong>${profile.bizName}</strong></span>
      </div>
    </div>
  `;
}

async function exportPurchaseOrderPDF() {
  const orders = JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [];
  if (orders.length === 0) return alert('Order list is empty.');

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || { bizName: 'Pharmacy' };
  const htmlString = buildPurchaseOrderHTML(orders, profile);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;
  document.body.appendChild(tempDiv);

  const dateTag = new Date().toISOString().slice(0, 10);
  const cleanStoreName = (profile.bizName || 'Store').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `Purchase_Order_${cleanStoreName}_${dateTag}.pdf`;

  const opt = {
    margin: 5,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    if (typeof html2pdf !== 'undefined') {
      if (window.AndroidBridge && typeof window.AndroidBridge.sharePdfBase64 === 'function') {
        showToast('Generating Purchase Order PDF...');
        const pdfDataUri = await html2pdf().set(opt).from(tempDiv).outputPdf('datauristring');
        window.AndroidBridge.sharePdfBase64(pdfDataUri, fileName, '');
      } else {
        const pdfBlob = await html2pdf().set(opt).from(tempDiv).outputPdf('blob');
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: `Purchase Order - ${profile.bizName}`,
            text: `Purchase Order (${orders.length} Items) - ${profile.bizName}`
          });
        } else {
          await html2pdf().set(opt).from(tempDiv).save();
          showToast('Purchase Order PDF Downloaded!');
        }
      }
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Order PDF Error:', err);
    showToast('Unable to generate Order PDF.');
  } finally {
    document.body.removeChild(tempDiv);
  }
}

/* ==================== PROFESSIONAL BILLING & LIVE EXPIRY WARNING ==================== */
function adjustBillQty(delta) {
  const input = document.getElementById('bill-qty');
  let val = parseInt(input.value) || 1;
  val = Math.max(1, val + delta);
  input.value = val;
}

function populateBillingDropdown() {
  const hiddenInput = document.getElementById('bill-product-select');
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];

  if (stockList.length === 0) {
    if (hiddenInput) hiddenInput.value = '';
    updateSelectedStockHint();
    return;
  }

  const currentVal = parseInt(hiddenInput.value);
  const exists = stockList.some(i => i.id === currentVal);
  if (!exists) {
    const firstValid = stockList.find(i => getExpiryStatus(i.expiry) !== 'expired' && ((i.totalUnits ?? (i.packs * i.unitPerPack)) > 0));
    hiddenInput.value = firstValid ? firstValid.id : stockList[0].id;
  }
  updateSelectedStockHint();
}

function openMedicinePickerModal() {
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  if (stockList.length === 0) {
    return alert('Inventory is empty! Please add medicine stock first.');
  }
  document.getElementById('med-picker-modal').classList.add('active');
  const searchEl = document.getElementById('med-picker-search');
  if (searchEl) {
    searchEl.value = '';
  }
  renderMedicinePickerList();
}

function closeMedicinePickerModal() {
  document.getElementById('med-picker-modal').classList.remove('active');
}

function renderMedicinePickerList() {
  const container = document.getElementById('med-picker-list');
  const query = (document.getElementById('med-picker-search')?.value || '').toLowerCase();
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const selectedId = parseInt(document.getElementById('bill-product-select').value);

  const filtered = stockList.filter(i =>
    i.name.toLowerCase().includes(query) ||
    i.batch.toLowerCase().includes(query) ||
    (i.mfg && i.mfg.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#64748b; padding:24px;">No matching medicines found.</p>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const totalUnits = item.totalUnits !== undefined ? item.totalUnits : (item.packs * item.unitPerPack);
    const fullPacks = Math.floor(totalUnits / item.unitPerPack);
    const looseUnits = totalUnits % item.unitPerPack;
    const st = getExpiryStatus(item.expiry);

    let badgeHtml = `<span class="status-badge badge-valid" style="margin-top:0;">Valid</span>`;
    if (st === 'soon') badgeHtml = `<span class="status-badge badge-soon" style="margin-top:0;">Expiring Soon</span>`;
    if (st === 'expired') badgeHtml = `<span class="status-badge badge-expired" style="margin-top:0;">Expired</span>`;

    let stockLabel = `${fullPacks} Packs`;
    if (looseUnits > 0) stockLabel += ` + ${looseUnits} Pcs`;
    if (totalUnits <= 0) stockLabel = `Out of Stock`;

    const isSelected = item.id === selectedId;
    const cardClasses = `picker-item-card ${isSelected ? 'selected' : ''} ${st === 'expired' ? 'expired-item' : ''}`;

    return `
      <div class="${cardClasses}" onclick="selectMedicineForBilling(${item.id})">
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <strong style="font-size:14px; color:var(--text);">${item.name}</strong>
            ${badgeHtml}
          </div>
          <div style="font-size:11px; color:var(--muted); margin-top:3px;">
            Mfg: <b>${item.mfg || 'N/A'}</b> • Batch: <b>${item.batch}</b> • Exp: <b>${item.expiry}</b>
          </div>
          <div style="font-size:11px; font-weight:700; color:${totalUnits <= 0 ? 'var(--red)' : 'var(--primary)'}; margin-top:3px;">
            Stock: ${stockLabel} (${totalUnits} Pcs)
          </div>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <strong style="font-size:15px; color:var(--text);">₹${item.mrp.toFixed(2)}</strong>
          <div style="font-size:10px; color:var(--muted);">Per Pack</div>
        </div>
      </div>
    `;
  }).join('');
}

function selectMedicineForBilling(itemId) {
  document.getElementById('bill-product-select').value = itemId;
  closeMedicinePickerModal();
  updateSelectedStockHint();
}

function updateSelectedStockHint() {
  const itemId = parseInt(document.getElementById('bill-product-select').value);
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const p = stockList.find(i => i.id === itemId);

  const hintEl = document.getElementById('selected-stock-hint');
  const displayBox = document.getElementById('picker-selected-display');
  const triggerBtn = document.getElementById('bill-med-picker-btn');
  const expWarnBox = document.getElementById('bill-expired-warning');
  const expWarnText = document.getElementById('bill-expired-warning-text');

  if (!p) {
    hintEl.innerText = '';
    if (displayBox) displayBox.innerHTML = `<span class="picker-placeholder">No stock available. Add medicines first.</span>`;
    if (triggerBtn) triggerBtn.classList.remove('is-expired-selected');
    if (expWarnBox) expWarnBox.style.display = 'none';
    return;
  }

  const totalUnits = p.totalUnits !== undefined ? p.totalUnits : (p.packs * p.unitPerPack);
  const availPacks = Math.floor(totalUnits / p.unitPerPack);
  const unitPrice = (p.mrp / p.unitPerPack).toFixed(2);
  const st = getExpiryStatus(p.expiry);

  let statusPill = `<span class="status-badge badge-valid" style="margin-top:0; font-size:9px; padding:2px 6px;">Exp: ${p.expiry}</span>`;
  if (st === 'soon') {
    statusPill = `<span class="status-badge badge-soon" style="margin-top:0; font-size:9px; padding:2px 6px;">Expiring: ${p.expiry}</span>`;
  } else if (st === 'expired') {
    statusPill = `<span class="status-badge badge-expired" style="margin-top:0; font-size:9px; padding:2px 6px;">EXPIRED (${p.expiry})</span>`;
  }

  if (displayBox) {
    displayBox.innerHTML = `
      <div class="picker-med-title">
        <strong>${p.name}</strong>
        ${statusPill}
      </div>
      <div class="picker-med-sub">
        Batch: <b>${p.batch}</b> • ₹${p.mrp}/Pack • Stock: <b>${availPacks} Packs</b> (${totalUnits} Pcs)
      </div>
    `;
  }

  if (st === 'expired') {
    if (triggerBtn) triggerBtn.classList.add('is-expired-selected');
    if (expWarnBox) {
      expWarnBox.style.display = 'flex';
      expWarnText.innerText = `"${p.name}" (Batch: ${p.batch}) expired on ${p.expiry}! Please check before adding to bill.`;
    }
  } else {
    if (triggerBtn) triggerBtn.classList.remove('is-expired-selected');
    if (expWarnBox) expWarnBox.style.display = 'none';
  }

  hintEl.innerText = `In Stock: ${totalUnits} Pcs (${p.unitPerPack} Pcs/Pack) • Pack MRP: ₹${p.mrp} | 1 Pc: ₹${unitPrice}`;
}

function addToBill() {
  const itemId = parseInt(document.getElementById('bill-product-select').value);
  const qty = parseInt(document.getElementById('bill-qty').value) || 1;
  const unitType = document.getElementById('bill-unit-type').value;

  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];
  const product = stockList.find(i => i.id === itemId);

  if (!product) return alert('Please select a medicine from stock first.');

  const totalUnitsAvail = product.totalUnits !== undefined ? product.totalUnits : (product.packs * product.unitPerPack);
  const unitsNeeded = unitType === 'pack' ? (qty * product.unitPerPack) : qty;

  if (unitsNeeded > totalUnitsAvail) {
    return alert(`Insufficient Stock! Only ${totalUnitsAvail} Pcs available in inventory.`);
  }

  if (getExpiryStatus(product.expiry) === 'expired') {
    const proceed = confirm(`⚠️ EXPIRED MEDICINE WARNING!\n\nMedicine: ${product.name}\nBatch: ${product.batch}\nExpired On: ${product.expiry}\n\nThis medicine batch is EXPIRED. Are you sure you still want to add it to the customer bill?`);
    if (!proceed) return;
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

/* ==================== ANDROID APK + BROWSER PDF SHARE & PRINT ==================== */
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
      if (window.AndroidBridge && typeof window.AndroidBridge.sharePdfBase64 === 'function') {
        showToast('Preparing PDF for WhatsApp...');
        const pdfDataUri = await html2pdf().set(opt).from(tempDiv).outputPdf('datauristring');
        window.AndroidBridge.sharePdfBase64(pdfDataUri, fileName, saleObj.custPhone || '');
      } else {
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
      }
    } else if (window.AndroidBridge && typeof window.AndroidBridge.printPage === 'function') {
      window.AndroidBridge.printPage();
    } else {
      window.print();
    }
  } catch (err) {
    console.error('PDF Share Error:', err);
    showToast('Unable to generate PDF.');
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
  const nowTs = Date.now();
  const dateStr = new Date(nowTs).toLocaleDateString('en-IN');

  const totals = calculateBillTotals();

  const newSale = {
    invNo,
    timestamp: nowTs,
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
    if (window.AndroidBridge && typeof window.AndroidBridge.printPage === 'function') {
      window.AndroidBridge.printPage();
    } else {
      window.print();
    }
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
  if (window.AndroidBridge && typeof window.AndroidBridge.printPage === 'function') {
    window.AndroidBridge.printPage();
  } else {
    window.print();
  }
}

async function shareSavedBillPDF(index) {
  const sales = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE));
  const saleObj = sales[index];
  if (!saleObj) return;
  if (!saleObj.items) saleObj.items = [];
  await shareInvoicePDF(saleObj, profile);
}

/* ==================== DASHBOARD & PERIOD ANALYTICS ENGINE ==================== */
function parseRecordTimestamp(record) {
  if (record && typeof record.timestamp === 'number' && record.timestamp > 0) {
    return record.timestamp;
  }
  if (record && record.date && typeof record.date === 'string') {
    const parts = record.date.split('/');
    if (parts.length === 3) {
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const y = parseInt(parts[2], 10);
      const parsed = new Date(y, m, d, 12, 0, 0).getTime();
      if (!isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function isTimestampInPeriod(ts, period) {
  if (period === 'lifetime') return true;
  if (!ts) return false;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - (24 * 60 * 60 * 1000);

  if (period === 'today') {
    return ts >= startOfToday;
  }
  if (period === 'yesterday') {
    return ts >= startOfYesterday && ts < startOfToday;
  }
  if (period === '7days') {
    const start7Days = startOfToday - (6 * 24 * 60 * 60 * 1000);
    return ts >= start7Days;
  }
  if (period === '30days') {
    const start30Days = startOfToday - (29 * 24 * 60 * 60 * 1000);
    return ts >= start30Days;
  }
  return true;
}

function setDashboardPeriod(period, btnEl) {
  currentDashboardPeriod = period;
  document.querySelectorAll('.time-pill').forEach(btn => btn.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const labelMap = {
    today: 'Today',
    yesterday: 'Yesterday',
    '7days': 'Last 7 Days',
    '30days': 'Last 30 Days',
    lifetime: 'Lifetime'
  };
  const badgeEl = document.getElementById('period-active-badge');
  if (badgeEl) badgeEl.innerText = labelMap[period] || 'Today';

  renderPeriodAnalytics();
}

function renderPeriodAnalytics() {
  const salesList = JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [];
  const stockLogs = JSON.parse(localStorage.getItem(DB_KEYS.STOCK_LOGS)) || [];
  const stockList = JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [];

  let periodSalesTotal = 0;
  let periodBillsCount = 0;
  let periodPacksOut = 0;
  let periodUnitsOut = 0;

  salesList.forEach(sale => {
    const ts = parseRecordTimestamp(sale);
    if (isTimestampInPeriod(ts, currentDashboardPeriod)) {
      periodSalesTotal += (sale.total || 0);
      periodBillsCount++;

      if (Array.isArray(sale.items)) {
        sale.items.forEach(item => {
          const uPerPack = item.unitPerPack || 1;
          const units = item.unitsDeducted !== undefined
            ? item.unitsDeducted
            : (item.unitType === 'pack' ? (item.qty || 1) * uPerPack : (item.qty || 1));
          periodUnitsOut += units;
          periodPacksOut += (units / uPerPack);
        });
      }
    }
  });

  let periodPacksIn = 0;
  let periodStockEntries = 0;

  const sourceLogs = stockLogs.length > 0
    ? stockLogs
    : stockList.map(s => ({
        packs: s.packs || 0,
        units: s.totalUnits || ((s.packs || 0) * (s.unitPerPack || 1)),
        timestamp: s.addedAt || s.id || 0
      }));

  sourceLogs.forEach(log => {
    const ts = parseRecordTimestamp(log);
    if (isTimestampInPeriod(ts, currentDashboardPeriod)) {
      periodPacksIn += (log.packs || 0);
      periodStockEntries++;
    }
  });

  const salesAmtEl = document.getElementById('period-sales-amt');
  const salesBillsEl = document.getElementById('period-sales-bills');
  const stockInEl = document.getElementById('period-stock-in');
  const stockInSubEl = document.getElementById('period-stock-in-sub');
  const stockOutEl = document.getElementById('period-stock-out');
  const stockOutSubEl = document.getElementById('period-stock-out-sub');

  if (salesAmtEl) salesAmtEl.innerText = `₹${periodSalesTotal.toFixed(2)}`;
  if (salesBillsEl) salesBillsEl.innerText = `${periodBillsCount} Bill${periodBillsCount === 1 ? '' : 's'}`;

  const fmtPacksIn = Number.isInteger(periodPacksIn) ? periodPacksIn : periodPacksIn.toFixed(1);
  if (stockInEl) stockInEl.innerText = `${fmtPacksIn} Packs`;
  if (stockInSubEl) stockInSubEl.innerText = `${periodStockEntries} Batch Entry`;

  const fmtPacksOut = Number.isInteger(periodPacksOut) ? periodPacksOut : periodPacksOut.toFixed(1);
  if (stockOutEl) stockOutEl.innerText = `${fmtPacksOut} Packs`;
  if (stockOutSubEl) stockOutSubEl.innerText = `${periodUnitsOut} Pcs Sold`;
}

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

  renderPeriodAnalytics();
}

/* ==================== BUSINESS PROFILE & 2-STEP ADMIN PIN CHANGE ==================== */
async function updateBusinessProfile() {
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

  await syncStoreMetadataToCentral(profile);
  syncWithCloud(false);
}

function verifyOldAdminPinStep() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  const enteredOldPin = (document.getElementById('verify-old-pin-input')?.value || '').trim();
  const errEl = document.getElementById('pin-verify-error');
  errEl.style.display = 'none';

  if (!enteredOldPin) {
    errEl.innerText = 'Please enter your current 6-Digit Admin PIN.';
    errEl.style.display = 'block';
    return;
  }

  if (profile.adminPin && enteredOldPin !== profile.adminPin) {
    errEl.innerText = 'Incorrect current Admin PIN! Please try again.';
    errEl.style.display = 'block';
    return;
  }

  document.getElementById('pin-step-verify').style.display = 'none';
  document.getElementById('pin-step-update').style.display = 'block';
  document.getElementById('new-admin-pin-input').value = '';
  document.getElementById('confirm-admin-pin-input').value = '';
  document.getElementById('new-admin-pin-input').focus();
}

function resetAdminPinFlow() {
  const verifyBox = document.getElementById('pin-step-verify');
  const updateBox = document.getElementById('pin-step-update');
  const oldInput = document.getElementById('verify-old-pin-input');
  const err1 = document.getElementById('pin-verify-error');
  const err2 = document.getElementById('pin-update-error');

  if (verifyBox) verifyBox.style.display = 'block';
  if (updateBox) updateBox.style.display = 'none';
  if (oldInput) oldInput.value = '';
  if (err1) err1.style.display = 'none';
  if (err2) err2.style.display = 'none';
}

async function saveNewAdminPin() {
  const newPin = (document.getElementById('new-admin-pin-input')?.value || '').trim();
  const confirmPin = (document.getElementById('confirm-admin-pin-input')?.value || '').trim();
  const errEl = document.getElementById('pin-update-error');
  errEl.style.display = 'none';

  if (!/^\d{6}$/.test(newPin)) {
    errEl.innerText = 'New Admin PIN must be exactly 6 numeric digits.';
    errEl.style.display = 'block';
    return;
  }
  if (newPin !== confirmPin) {
    errEl.innerText = 'New PIN and Confirm PIN do not match!';
    errEl.style.display = 'block';
    return;
  }

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  profile.adminPin = newPin;
  localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(profile));

  resetAdminPinFlow();
  showToast('Admin Security PIN updated successfully!');

  await syncStoreMetadataToCentral(profile);
  syncWithCloud(false);
}

/* ==================== PASSWORD-PROTECTED STORE GHS CLOUD SYNC ==================== */
function openCloudUnlockPrompt() {
  document.getElementById('cloud-locked-actions').style.display = 'none';
  document.getElementById('cloud-pin-verify-box').style.display = 'block';
  const pinInput = document.getElementById('cloud-unlock-pin-input');
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
  }
}

function cancelCloudUnlock() {
  document.getElementById('cloud-pin-verify-box').style.display = 'none';
  document.getElementById('cloud-locked-actions').style.display = 'grid';
}

function verifyAndUnlockCloudEdit() {
  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  const enteredPin = (document.getElementById('cloud-unlock-pin-input')?.value || '').trim();

  if (profile.adminPin && enteredPin !== profile.adminPin) {
    showToast('Incorrect 6-Digit Admin PIN!');
    return;
  }

  const urlInput = document.getElementById('ghs-cloud-url');
  const secretInput = document.getElementById('ghs-cloud-secret');
  if (urlInput) urlInput.disabled = false;
  if (secretInput) secretInput.disabled = false;

  document.getElementById('cloud-pin-verify-box').style.display = 'none';
  document.getElementById('cloud-locked-actions').style.display = 'none';
  document.getElementById('cloud-unlocked-actions').style.display = 'grid';
  showToast('Database settings unlocked for editing.');
}

function lockCloudEditFields() {
  const urlInput = document.getElementById('ghs-cloud-url');
  const secretInput = document.getElementById('ghs-cloud-secret');
  if (urlInput) urlInput.disabled = true;
  if (secretInput) secretInput.disabled = true;

  const pinBox = document.getElementById('cloud-pin-verify-box');
  const unlockedAct = document.getElementById('cloud-unlocked-actions');
  const lockedAct = document.getElementById('cloud-locked-actions');

  if (pinBox) pinBox.style.display = 'none';
  if (unlockedAct) unlockedAct.style.display = 'none';
  if (lockedAct) lockedAct.style.display = 'grid';
}

async function saveGHSCloudConfig() {
  const url = document.getElementById('ghs-cloud-url').value.trim();
  const secret = document.getElementById('ghs-cloud-secret').value.trim();
  localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify({ url, secret }));

  lockCloudEditFields();

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  await syncStoreMetadataToCentral(profile);

  showToast('GHS Cloud saved & locked!');
  if (url) syncWithCloud(true);
}

/* ==================== OFFLINE JSON EXPORT & ROBUST RESTORE ==================== */
function exportBackupJSON() {
  const backupData = {
    app: 'PharmaPOS_GHS',
    profile: JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null'),
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK) || '[]'),
    stockLogs: JSON.parse(localStorage.getItem(DB_KEYS.STOCK_LOGS) || '[]'),
    sales: JSON.parse(localStorage.getItem(DB_KEYS.SALES) || '[]'),
    orders: JSON.parse(localStorage.getItem(DB_KEYS.ORDERS) || '[]'),
    staff: JSON.parse(localStorage.getItem(DB_KEYS.STAFF) || '[]'),
    invSeq: localStorage.getItem(DB_KEYS.INV_SEQ) || 1,
    cloudCfg: JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}')
  };
  const jsonString = JSON.stringify(backupData, null, 2);
  const fileName = `POS_Backup_${new Date().toISOString().slice(0, 10)}.json`;

  if (window.AndroidBridge && typeof window.AndroidBridge.saveJsonBackup === 'function') {
    window.AndroidBridge.saveJsonBackup(jsonString, fileName);
  } else {
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = dataUri;
    downloadAnchor.download = fileName;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Backup JSON exported!');
  }
}

function triggerRestoreInput() {
  const input = document.getElementById('restore-file-input');
  input.value = '';
  input.click();
}

function handleRestoreJSON(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const fileReader = new FileReader();
  fileReader.onload = async function(e) {
    try {
      let rawText = (e.target.result || '').trim();
      if (rawText.charCodeAt(0) === 0xFEFF) {
        rawText = rawText.slice(1);
      }
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawText = rawText.substring(firstBrace, lastBrace + 1);
      }

      const restored = JSON.parse(rawText);
      if (!restored || typeof restored !== 'object') {
        throw new Error('Invalid JSON object');
      }

      const hasValidKeys = restored.profile || restored.stock || restored.sales || restored.orders || restored.app === 'PharmaPOS_GHS';
      if (!hasValidKeys) {
        throw new Error('Not a PharmaPOS backup file');
      }

      if (restored.profile) {
        if (!restored.profile.profileId) restored.profile.profileId = generateUniqueStoreId();
        localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(restored.profile));
      }
      if (Array.isArray(restored.stock)) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(restored.stock));
      if (Array.isArray(restored.stockLogs)) localStorage.setItem(DB_KEYS.STOCK_LOGS, JSON.stringify(restored.stockLogs));
      if (Array.isArray(restored.sales)) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(restored.sales));
      if (Array.isArray(restored.orders)) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(restored.orders));
      if (Array.isArray(restored.staff)) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(restored.staff));
      if (restored.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, restored.invSeq);
      if (restored.cloudCfg && typeof restored.cloudCfg === 'object') {
        localStorage.setItem(DB_KEYS.CLOUD_CFG, JSON.stringify(restored.cloudCfg));
      }

      const currentProfile = restored.profile || JSON.parse(localStorage.getItem(DB_KEYS.PROFILE) || 'null');
      if (currentProfile && currentProfile.bizName) {
        await syncStoreMetadataToCentral(currentProfile);
        loadMainApp(currentProfile);
      } else {
        refreshDashboard();
        renderStockList();
        renderOrdersList();
        populateBillingDropdown();
      }
      showToast('Database restored successfully!');
    } catch (err) {
      console.error('Restore Error:', err);
      alert('Invalid backup file! Please select a valid PharmaPOS JSON backup file.');
    }
  };
  fileReader.readAsText(file, 'UTF-8');
}

function openScanner() { showToast('Camera Barcode Scanner ready.'); }

/* ==================== STORE GHS CLOUD REAL-TIME SYNC (CLIENT DB) ==================== */
async function syncWithCloud(isManual = false) {
  const cloudCfg = JSON.parse(localStorage.getItem(DB_KEYS.CLOUD_CFG) || '{}');
  if (!cloudCfg.url) {
    if (isManual) showToast('Configure Store GHS Cloud URL in Settings first.');
    return;
  }

  const profile = JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)) || {};
  if (!profile.profileId) return;

  const pill = document.getElementById('sync-status-pill');
  if (pill) {
    pill.className = 'sync-pill syncing';
    pill.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Syncing';
  }

  const nowIso = new Date().toISOString();
  const payload = {
    updatedAt: nowIso,
    profile: profile,
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [],
    stockLogs: JSON.parse(localStorage.getItem(DB_KEYS.STOCK_LOGS)) || [],
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
    localStorage.setItem(DB_KEYS.LAST_SYNC_TS, nowIso);

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
    if (isManual) showToast('Configure Store GHS Cloud URL first.');
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
      if (data.stockLogs) localStorage.setItem(DB_KEYS.STOCK_LOGS, JSON.stringify(data.stockLogs));
      if (data.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(data.sales));
      if (data.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(data.orders));
      if (data.staff) localStorage.setItem(DB_KEYS.STAFF, JSON.stringify(data.staff));
      if (data.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, data.invSeq);
      if (data.updatedAt) localStorage.setItem(DB_KEYS.LAST_SYNC_TS, data.updatedAt);
      loadMainApp(data.profile);
      if (isManual) showToast('Latest cloud data pulled!');
    } else if (isManual) {
      showToast('No cloud backup found for this Store ID yet.');
    }
  } catch (err) {
    if (isManual) showToast('Failed to pull data from GHS Cloud.');
  }
}

/* ==================== EXPOSE FUNCTIONS TO GLOBAL WINDOW FOR HTML ONCLICK ==================== */
window.switchOnboardingMode = switchOnboardingMode;
window.switchLoginRoleTab = switchLoginRoleTab;
window.handleInitialSetup = handleInitialSetup;
window.handleMultiUserLogin = handleMultiUserLogin;
window.verifyCentralLicenseStatus = verifyCentralLicenseStatus;
window.copyLockedStoreId = copyLockedStoreId;
window.logoutCurrentSession = logoutCurrentSession;
window.switchTab = switchTab;
window.openExpiringTab = openExpiringTab;
window.setDashboardPeriod = setDashboardPeriod;
window.toggleAccordion = toggleAccordion;
window.openAddStockModal = openAddStockModal;
window.closeAddStockModal = closeAddStockModal;
window.setStockModalMode = setStockModalMode;
window.showRestockCurrentInfo = showRestockCurrentInfo;
window.setStockFilter = setStockFilter;
window.renderStockList = renderStockList;
window.exportAllStockPDF = exportAllStockPDF;
window.quickAddToOrder = quickAddToOrder;
window.addMedicineOrder = addMedicineOrder;
window.deleteOrderItem = deleteOrderItem;
window.clearAllOrders = clearAllOrders;
window.sharePurchaseOrderWA = sharePurchaseOrderWA;
window.exportPurchaseOrderPDF = exportPurchaseOrderPDF;
window.adjustBillQty = adjustBillQty;
window.openMedicinePickerModal = openMedicinePickerModal;
window.closeMedicinePickerModal = closeMedicinePickerModal;
window.renderMedicinePickerList = renderMedicinePickerList;
window.selectMedicineForBilling = selectMedicineForBilling;
window.updateSelectedStockHint = updateSelectedStockHint;
window.addToBill = addToBill;
window.renderBillCart = renderBillCart;
window.removeCartItem = removeCartItem;
window.clearCart = clearCart;
window.generateAndShareBill = generateAndShareBill;
window.openSavedBillsModal = openSavedBillsModal;
window.closeSavedBillsModal = closeSavedBillsModal;
window.renderSavedBillsList = renderSavedBillsList;
window.reprintSavedBill = reprintSavedBill;
window.shareSavedBillPDF = shareSavedBillPDF;
window.updateBusinessProfile = updateBusinessProfile;
window.verifyOldAdminPinStep = verifyOldAdminPinStep;
window.resetAdminPinFlow = resetAdminPinFlow;
window.saveNewAdminPin = saveNewAdminPin;
window.openCloudUnlockPrompt = openCloudUnlockPrompt;
window.cancelCloudUnlock = cancelCloudUnlock;
window.verifyAndUnlockCloudEdit = verifyAndUnlockCloudEdit;
window.lockCloudEditFields = lockCloudEditFields;
window.addAuthorizedStaff = addAuthorizedStaff;
window.removeStaffMember = removeStaffMember;
window.copyProfileCode = copyProfileCode;
window.saveGHSCloudConfig = saveGHSCloudConfig;
window.exportBackupJSON = exportBackupJSON;
window.triggerRestoreInput = triggerRestoreInput;
window.handleRestoreJSON = handleRestoreJSON;
window.setAppTheme = setAppTheme;
window.openScanner = openScanner;
window.syncWithCloud = syncWithCloud;
window.pullFromCloud = pullFromCloud;
window.manualFullSyncRefresh = manualFullSyncRefresh;
