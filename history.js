const STORAGE_KEY = 'adamzPaymentTransactions';
const STORAGE_API_KEY = 'adamzStorageApiBase';

const storageApiInput = document.getElementById('storageApiInput');
const saveStorageApiBtn = document.getElementById('saveStorageApiBtn');
const clearStorageApiBtn = document.getElementById('clearStorageApiBtn');
const storageApiStatus = document.getElementById('storageApiStatus');
const historyUsername = document.getElementById('historyUsername');
const historyPassword = document.getElementById('historyPassword');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');
const historyPanel = document.getElementById('historyPanel');
const transactionTableBody = document.querySelector('#transactionTable tbody');
const exportHistoryExcelBtn = document.getElementById('exportHistoryExcelBtn');
const historyStorageControls = document.getElementById('historyStorageControls');

storageApiInput.value = String(window.ADAMZ_STORAGE_API || localStorage.getItem(STORAGE_API_KEY) || '').replace(/\/$/, '');

saveStorageApiBtn.addEventListener('click', () => {
  if (historyStorageControls?.hidden) return;
  const base = String(storageApiInput.value || '').trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//i.test(base)) {
    storageApiStatus.textContent = 'Enter a valid Storage API URL.';
    storageApiStatus.className = 'small status-warn';
    return;
  }

  localStorage.setItem(STORAGE_API_KEY, base);
  window.ADAMZ_STORAGE_API = base;
  renderStorageApiStatus();
});

clearStorageApiBtn.addEventListener('click', () => {
  if (historyStorageControls?.hidden) return;
  localStorage.removeItem(STORAGE_API_KEY);
  window.ADAMZ_STORAGE_API = '';
  storageApiInput.value = '';
  renderStorageApiStatus();
});

function renderStorageApiStatus() {
  if (!storageApiStatus || !storageApiInput) return;
  const base = String(storageApiInput.value || '').trim().replace(/\/$/, '');
  if (base) {
    storageApiStatus.textContent = `Current: ${base}`;
    storageApiStatus.className = 'small status-ok';
  } else {
    storageApiStatus.textContent = 'Storage API URL not set.';
    storageApiStatus.className = 'small status-warn';
  }
}

loginBtn.addEventListener('click', async () => {
  const base = String(storageApiInput.value || '').trim().replace(/\/$/, '');
  const username = String(historyUsername.value || '').trim();
  const password = String(historyPassword.value || '').trim();

  if (!base || !/^https?:\/\//i.test(base)) {
    loginStatus.textContent = 'Enter a valid Storage API URL.';
    loginStatus.className = 'small status-warn';
    return;
  }

  if (!username || !password) {
    loginStatus.textContent = 'Enter username and password.';
    loginStatus.className = 'small status-warn';
    return;
  }

  try {
    const token = btoa(`${username}:${password}`);
    const response = await fetch(`${base}/history/auth-check`, {
      method: 'GET',
      headers: { Authorization: `Basic ${token}` }
    });

    if (!response.ok) {
      loginStatus.textContent = 'Authentication failed.';
      loginStatus.className = 'small status-warn';
      return;
    }

    localStorage.setItem(STORAGE_API_KEY, base);
    loginStatus.textContent = 'Authenticated. Loading local transaction history...';
    loginStatus.className = 'small status-ok';
    if (historyStorageControls) historyStorageControls.hidden = false;
    renderStorageApiStatus();
    historyPanel.hidden = false;
    renderTransactionTable();
  } catch (error) {
    loginStatus.textContent = 'Unable to reach Storage API.';
    loginStatus.className = 'small status-warn';
  }
});


exportHistoryExcelBtn.addEventListener('click', () => {
  const transactions = loadTransactions();
  if (!transactions.length) {
    loginStatus.textContent = 'No transaction data to export.';
    loginStatus.className = 'small status-warn';
    return;
  }

  const rows = transactions.map((tx) => ({
    transactionId: tx.id,
    status: tx.status || '',
    storageStatus: tx.storageStatus || '',
    paidAt: tx.paidAt || '',
    uploadedAt: tx.uploadedAt || '',
    fileName: tx.fileName || '',
    originalUrl: tx.artifacts?.originalUrl || '',
    cleanedCsvUrl: tx.artifacts?.cleanedCsvUrl || '',
    cleanedExcelUrl: tx.artifacts?.cleanedExcelUrl || '',
    dashboardPdfUrl: tx.artifacts?.dashboardPdfUrl || ''
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'History');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const fileName = `adamz_history_${stamp}.xlsx`;
  XLSX.writeFile(workbook, fileName);
});

transactionTableBody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const tx = loadTransactions().find((item) => item.id === button.dataset.id);
  if (!tx) return;

  const actions = {
    original: tx.artifacts?.originalUrl,
    csv: tx.artifacts?.cleanedCsvUrl,
    xlsx: tx.artifacts?.cleanedExcelUrl,
    pdf: tx.artifacts?.dashboardPdfUrl
  };

  const url = actions[button.dataset.action];
  if (!url) return;

  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
});

function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map((tx) => ({
      ...tx,
      artifacts: tx.artifacts || { originalUrl: null, cleanedCsvUrl: null, cleanedExcelUrl: null, dashboardPdfUrl: null }
    }));
  } catch {
    return [];
  }
}

function renderTransactionTable() {
  const transactions = loadTransactions();
  if (!transactions.length) {
    transactionTableBody.innerHTML = '<tr><td colspan="5">No transactions yet.</td></tr>';
    return;
  }

  transactionTableBody.innerHTML = transactions.map((tx) => {
    const uploadedLabel = tx.uploadedAt ? formatDateTime(tx.uploadedAt) : 'Pending upload';
    const artifact = tx.artifacts || {};
    const statusLabel = tx.storageStatus === 'stored'
      ? 'Stored in cloud'
      : tx.storageStatus === 'uploading'
        ? 'Uploading…'
        : tx.storageStatus === 'storage_not_configured'
          ? 'Storage API not configured'
          : tx.storageStatus || '—';

    return `<tr>
      <td>${tx.id}<br><span class="small">${statusLabel}</span></td>
      <td>${formatDateTime(tx.paidAt)}</td>
      <td>${uploadedLabel}</td>
      <td>${tx.fileName || '—'}</td>
      <td class="history-actions">
        <button class="btn btn-sm" data-action="original" data-id="${tx.id}" ${artifact.originalUrl ? '' : 'disabled'}>Original</button>
        <button class="btn btn-sm" data-action="csv" data-id="${tx.id}" ${artifact.cleanedCsvUrl ? '' : 'disabled'}>Clean CSV</button>
        <button class="btn btn-sm" data-action="xlsx" data-id="${tx.id}" ${artifact.cleanedExcelUrl ? '' : 'disabled'}>Clean Excel</button>
        <button class="btn btn-sm" data-action="pdf" data-id="${tx.id}" ${artifact.dashboardPdfUrl ? '' : 'disabled'}>Dashboard PDF</button>
      </td>
    </tr>`;
  }).join('');
}

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}
