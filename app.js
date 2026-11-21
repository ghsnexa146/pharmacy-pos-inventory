const DB_KEYS = {
  PROFILE: 'retailer_biz_profile',
  STOCK: 'retailer_stock_list',
  SALES: 'retailer_sales_list',
  ORDERS: 'retailer_purchase_orders',
  INV_SEQ: 'retailer_invoice_seq',
  SHEET_URL: 'retailer_sheet_url',
  PIN: 'retailer_app_pin'
};

let cart = [];
let currentStockFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('current-date-display');
  if (dateEl) {
    dateEl.innerText = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  try {
    const rawProfile = localStorage.getItem(DB_KEYS.PROFILE);
    if (rawProfile) {
      const profile = JSON.parse(rawProfile);
      if (profile && profile.bizName) {
        if (!profile.addr1 && profile.address) profile.addr1 = profile.address;
        if (!profile.district) profile.district = 'Sepahijala';
        if (!profile.state) profile.state = 'Tripura';
        loadMainApp(profile);
      }
    }
  } catch (err) {
    console.error('Profile reset:', err);
    localStorage.removeItem(DB_KEYS.PROFILE);
  }

  setupSmartExpiryValidation();
});

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

/* Guaranteed Registration Handler */
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

  if (!bizName || !ownerName || !phone || !addr1 || !city || !district || !pin) {
    alert('Please fill all required (*) fields and select a District.');
    return;
  }

  const profile = {
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
  if (!localStorage.getItem(DB_KEYS.INV_SEQ)) {
    localStorage.setItem(DB_KEYS.INV_SEQ, 1);
  }

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
  document.getElementById('display-sub-loc').innerText = profile.city ? `${profile.city}, ${profile.district || 'Tripura'}` : 'Terminal Active';

  document.getElementById('banner-biz-name').innerText = profile.bizName;
  document.getElementById('banner-owner-meta').innerText = `${profile.ownerName} • ${profile.phone}`;
  document.getElementById('banner-loc-pill').innerText = `${profile.district || 'Tripura'} (${profile.pin || ''})`;

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
  document.getElementById('sheet-api-url').value = localStorage.getItem(DB_KEYS.SHEET_URL) || '';

  updateNextInvPreview();
  refreshDashboard();
  renderStockList();
  renderOrdersList();
  renderBillCart();
  populateBillingDropdown();
}

function switchTab(tabName) {
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
  syncWithCloud();
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
  alert('Stock quantity increased successfully!');
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
          <div style="font-size:11px; color:#475569; margin-top:2px;">Mfg: <b>${item.mfg || 'N/A'}</b> • 1 Pack = ${item.unitPerPack} Pcs</div>
          <div style="font-size:12px; color:#64748b; margin-top:2px;">Batch: <b>${item.batch}</b> | Exp: <b>${item.expiry}</b> | GST: ${item.gst}%</div>
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
          <strong style="font-size:16px; color:#0f172a;">₹${item.mrp.toFixed(2)}</strong>
          <div style="font-size:10px; color:#64748b;">Per Pack</div>
          <div style="font-size:11px; color:#64748b; margin-top:4px;">Pur: ₹${item.purchaseRate.toFixed(2)}</div>
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
        <div style="font-size:12px; color:#64748b; margin-top:2px;">Mfg: <b>${o.mfg}</b> • Agency: ${o.supplier}</div>
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
}

function clearAllOrders() {
  if (!confirm('Clear all medicine orders?')) return;
  localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify([]));
  renderOrdersList();
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
        <div style="font-size:11px; color:#64748b; margin-top:3px;">Batch: ${c.batch} • Exp: ${c.expiry} • Rate: ₹${c.rateApplied.toFixed(2)}/${c.unitType === 'pack' ? 'Pack' : 'Pc'}</div>
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

function buildInvoiceHTML(saleObj, profile) {
  const fullAddr = formatFullAddress(profile);
  const rowsHtml = saleObj.items.map((c, i) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 11px 8px; color: #475569; font-size: 12px;">${i + 1}</td>
      <td style="padding: 11px 8px; color: #0f172a; font-size: 13px;">
        <strong>${c.name}</strong>
        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Batch: ${c.batch} | Exp: ${c.expiry} | Mfg: ${c.mfg || '-'} | GST: ${c.gst}%</div>
      </td>
      <td style="padding: 11px 8px; text-align: right; color: #334155; font-size: 13px;">₹${(c.rateApplied || c.mrp).toFixed(2)}</td>
      <td style="padding: 11px 8px; text-align: center; color: #0f172a; font-weight: 600; font-size: 13px;">${c.qty} ${c.unitLabel || 'Pack'}</td>
      <td style="padding: 11px 8px; text-align: right; font-weight: 700; color: #0f172a; font-size: 13px;">₹${c.total.toFixed(2)}</td>
    </tr>
  `).join('');

  const subtotal = saleObj.rawSubtotal !== undefined ? saleObj.rawSubtotal : saleObj.total;
  const discAmt = saleObj.discountAmt || 0;
  const taxAmt = saleObj.taxAmt || 0;
  const taxLabel = saleObj.gstMode === 'extra' ? 'EXTRA GST ADDED' : 'GST INCLUDED IN MRP';

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; padding: 34px; max-width: 780px; margin: 0 auto; background: #ffffff;">
      <div style="text-align: right; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 24px;">
        <h1 style="margin: 0 0 10px 0; font-size: 30px; font-weight: 800; letter-spacing: 1px; color: #0f172a;">INVOICE</h1>
        <div style="font-size: 14px; font-weight: 800; color: #0f172a; text-transform: uppercase;">${profile.bizName}</div>
        <div style="font-size: 12px; color: #475569; margin-top: 3px;">${fullAddr}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Phone: ${profile.phone} ${profile.email ? '• ' + profile.email : ''}</div>
        ${profile.gst || profile.dlNo ? `<div style="font-size: 11px; color: #334155; font-weight: 600; margin-top: 3px;">${profile.gst ? 'GSTIN: ' + profile.gst : ''} ${profile.dlNo ? ' | DL No: ' + profile.dlNo : ''}</div>` : ''}
      </div>

      <div style="display: flex; justify-content: space-between; margin-bottom: 28px;">
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.6px; text-transform: uppercase; margin-bottom: 5px;">BILLED TO</div>
          <div style="font-size: 15px; font-weight: 700; color: #0f172a;">${saleObj.custName}</div>
          <div style="font-size: 13px; color: #475569; margin-top: 3px;">Mobile: ${saleObj.custPhone || 'Walk-in Customer'}</div>
        </div>
        <div style="text-align: right;">
          <div style="margin-bottom: 10px;">
            <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.6px; text-transform: uppercase;">INVOICE NUMBER</div>
            <div style="font-size: 15px; font-weight: 800; color: #1d4ed8; margin-top: 2px;">${saleObj.invNo}</div>
          </div>
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 0.6px; text-transform: uppercase;">INVOICE DATE</div>
            <div style="font-size: 13px; color: #334155; margin-top: 2px;">${saleObj.date}</div>
          </div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 22px;">
        <thead>
          <tr style="border-top: 1.5px solid #cbd5e1; border-bottom: 1.5px solid #cbd5e1; background: #f8fafc;">
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">#</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Medicine Description</th>
            <th style="padding: 10px 8px; text-align: right; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Rate</th>
            <th style="padding: 10px 8px; text-align: center; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Qty</th>
            <th style="padding: 10px 8px; text-align: right; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 32px;">
        <div style="width: 280px;">
          <div style="display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #64748b;">
            <span>SUBTOTAL</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          ${discAmt > 0 ? `
          <div style="display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #10b981; font-weight: 600;">
            <span>DISCOUNT (${saleObj.discPct}%)</span>
            <span>- ₹${discAmt.toFixed(2)}</span>
          </div>` : ''}
          <div style="display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #64748b;">
            <span>${taxLabel}</span>
            <span>${saleObj.gstMode === 'extra' ? '+ ' : ''}₹${taxAmt.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 12px 0 0 0; margin-top: 6px; border-top: 1.5px solid #cbd5e1; font-size: 17px; font-weight: 800; color: #0f172a;">
            <span>INVOICE TOTAL</span>
            <span>₹${saleObj.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 11px; color: #64748b;">
        <div>
          <strong style="color: #0f172a; display: block; margin-bottom: 3px;">TERMS AND CONDITIONS</strong>
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
        <div style="font-size:11px; color:#64748b; margin-top:2px;"><b style="color:#1d4ed8;">${s.invNo}</b> • ${s.date}</div>
        <div style="font-size:11px; color:#475569; margin-top:2px;">${s.items ? s.items.length : 1} Item(s) • ${s.custPhone || 'No Phone'}</div>
      </div>
      <div style="text-align:right;">
        <strong style="font-size:15px; color:#0f172a; display:block;">₹${s.total.toFixed(2)}</strong>
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
  alert('Business profile & invoice settings updated!');
}

function saveSheetUrl() {
  const url = document.getElementById('sheet-api-url').value.trim();
  localStorage.setItem(DB_KEYS.SHEET_URL, url);
  alert('Google Sheet API link saved!');
}

function saveSecurityPin() {
  const pin = document.getElementById('app-pin').value.trim();
  localStorage.setItem(DB_KEYS.PIN, pin);
  alert('Security PIN updated!');
}

function exportBackupJSON() {
  const backupData = {
    profile: JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)),
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [],
    sales: JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [],
    orders: JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || [],
    invSeq: localStorage.getItem(DB_KEYS.INV_SEQ) || 1,
    syncUrl: localStorage.getItem(DB_KEYS.SHEET_URL)
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `POS_Backup_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function triggerRestoreInput() {
  document.getElementById('restore-file-input').click();
}

function handleRestoreJSON(event) {
  const fileReader = new FileReader();
  fileReader.onload = function(e) {
    try {
      const restored = JSON.parse(e.target.result);
      if (restored.profile) localStorage.setItem(DB_KEYS.PROFILE, JSON.stringify(restored.profile));
      if (restored.stock) localStorage.setItem(DB_KEYS.STOCK, JSON.stringify(restored.stock));
      if (restored.sales) localStorage.setItem(DB_KEYS.SALES, JSON.stringify(restored.sales));
      if (restored.orders) localStorage.setItem(DB_KEYS.ORDERS, JSON.stringify(restored.orders));
      if (restored.invSeq) localStorage.setItem(DB_KEYS.INV_SEQ, restored.invSeq);
      if (restored.syncUrl) localStorage.setItem(DB_KEYS.SHEET_URL, restored.syncUrl);
      loadMainApp(restored.profile || {});
      alert('Database restored successfully from backup!');
    } catch (err) {
      alert('Invalid backup file format.');
    }
  };
  fileReader.readAsText(event.target.files[0]);
}

function openScanner() { alert('Camera Barcode Scanner ready.'); }

async function syncWithCloud() {
  const url = localStorage.getItem(DB_KEYS.SHEET_URL);
  if (!url) return alert('Please save your Google Sheet Web App URL under More > Google Sheet Cloud Sync.');
  const payload = {
    profile: JSON.parse(localStorage.getItem(DB_KEYS.PROFILE)),
    stock: JSON.parse(localStorage.getItem(DB_KEYS.STOCK)) || [],
    sales: JSON.parse(localStorage.getItem(DB_KEYS.SALES)) || [],
    orders: JSON.parse(localStorage.getItem(DB_KEYS.ORDERS)) || []
  };
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    alert('Synced with Google Sheet!');
  } catch (err) { alert('Sync failed.'); }
}
