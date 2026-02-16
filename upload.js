const paymentForm = document.getElementById('paymentForm');
const paymentStatus = document.getElementById('paymentStatus');
const payBtn = document.getElementById('payBtn');
const paymentGateNotice = document.getElementById('paymentGateNotice');
const fileInput = document.getElementById('fileInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const uploadStatus = document.getElementById('uploadStatus');
const uploadQuota = document.getElementById('uploadQuota');
const insightsSection = document.getElementById('insights');
const finalConclusion = document.getElementById('finalConclusion');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadExcelBtn = document.getElementById('downloadExcelBtn');
const downloadDashboardBtn = document.getElementById('downloadDashboardBtn');
const processingOverlay = document.getElementById('processingOverlay');

let isPaid = false;
let remainingAnalyses = 0;
let chartRefs = [];
let lastCleanedRows = [];
let lastUploadedName = 'dataset';
let currentTransactionId = null;

const STORAGE_KEY = 'adamzPaymentTransactions';
const transactions = loadTransactions();
let STORAGE_API_BASE = getStorageApiBase();

updateQuotaLabel();
handleStripeReturnFromCheckout();
initializeDemoDashboardIfRequested().catch(() => {});
setPaymentUiState({ paid: false });

function getStorageApiBase() {
  return String(window.ADAMZ_STORAGE_API || '').trim().replace(/\/$/, '');
}

function getPublicAppUrl() {
  return String(window.ADAMZ_PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
}

function isValidHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getCheckoutReturnBaseUrl() {
  const currentUrl = new URL(window.location.href);
  const isHttpPage = currentUrl.protocol === 'http:' || currentUrl.protocol === 'https:';
  if (isHttpPage) {
    currentUrl.search = '';
    currentUrl.hash = '';
    return currentUrl.toString();
  }

  const configured = getPublicAppUrl();
  if (!configured) {
    throw new Error('Stripe checkout return URL is not configured. Set window.ADAMZ_PUBLIC_APP_URL in app-config.js.');
  }

  if (!isValidHttpUrl(configured)) {
    throw new Error('Public App URL must start with http:// or https://.');
  }

  const configuredUrl = new URL(configured);

  return configuredUrl.toString();
}

function setPaymentUiState({ paid }) {
  if (payBtn) payBtn.disabled = !!paid;
  if (!paymentGateNotice) return;

  if (paid) {
    paymentGateNotice.textContent = 'Payment successful ($5). You can analyze 1 file now. Pay again after this analysis.';
    paymentGateNotice.className = 'small status-ok';
  } else {
    paymentGateNotice.textContent = 'Payment required before analysis.';
    paymentGateNotice.className = 'small status-warn';
  }
}

function setPaymentStatusMessage(message, isSuccess) {
  if (!paymentStatus) return;
  paymentStatus.textContent = message;
  paymentStatus.className = `small ${isSuccess ? 'status-ok' : 'status-warn'}`;
}

function resetToPayRequiredMessage() {
  setPaymentStatusMessage('Payment required before analysis.', false);
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId)
  };
}

function setProcessingState(isProcessing) {
  if (processingOverlay) processingOverlay.classList.toggle('hidden', !isProcessing);
  analyzeBtn.disabled = isProcessing || !(fileInput.files.length && isPaid && remainingAnalyses > 0);
}

fileInput.addEventListener('change', () => {
  analyzeBtn.disabled = !(fileInput.files.length && isPaid && remainingAnalyses > 0);
  uploadStatus.textContent = '';
});

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const agreePay = document.getElementById('agreePay').checked;
  if (!agreePay) {
    paymentStatus.textContent = 'You must confirm the $5 payment.';
    paymentStatus.className = 'small status-warn';
    return;
  }

  if (!STORAGE_API_BASE) {
    setPaymentStatusMessage('Storage/API URL is not configured. Set window.ADAMZ_STORAGE_API in app-config.js.', false);
    return;
  }

  const transactionId = `TX-${Date.now()}`;
  currentTransactionId = transactionId;
  let redirected = false;

  try {
    if (payBtn) payBtn.disabled = true;
    setPaymentStatusMessage('Redirecting to Stripe checkout...', true);

    const baseUrl = getCheckoutReturnBaseUrl();
    const successUrlObj = new URL(baseUrl);
    successUrlObj.searchParams.set('checkout', 'success');
    successUrlObj.searchParams.set('tx', transactionId);
    successUrlObj.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');

    const cancelUrlObj = new URL(baseUrl);
    cancelUrlObj.searchParams.set('checkout', 'cancel');
    cancelUrlObj.searchParams.set('tx', transactionId);

    const successUrl = successUrlObj
      .toString()
      .replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
    const cancelUrl = cancelUrlObj.toString();

    const timeout = createTimeoutSignal(25000);
    let response;
    try {
      response = await fetch(`${STORAGE_API_BASE}/payments/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, successUrl, cancelUrl }),
        signal: timeout.signal,
        cache: 'no-store'
      });
    } finally {
      timeout.clear();
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || `Unable to start Stripe checkout (HTTP ${response.status}).`;
      throw new Error(message);
    }

    const { checkoutUrl } = payload;
    if (!checkoutUrl) throw new Error('Missing checkout URL from API.');
    if (!isValidHttpUrl(checkoutUrl)) throw new Error('Checkout URL returned by API is invalid.');

    redirected = true;
    window.location.assign(checkoutUrl);
  } catch (error) {
    if (error?.name === 'AbortError') {
      setPaymentStatusMessage('Stripe session request timed out. Please retry in a few seconds.', false);
      return;
    }

    if (error?.message === 'Failed to fetch') {
      setPaymentStatusMessage('Unable to reach payment API. Check API URL/CORS and try again.', false);
      return;
    }

    setPaymentStatusMessage(error.message || 'Payment initialization failed. Check STRIPE_SECRET_KEY on the API.', false);
  } finally {
    if (!redirected && payBtn && !isPaid) {
      payBtn.disabled = false;
    }
  }
});


async function handleStripeReturnFromCheckout() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  const transactionId = params.get('tx');
  const sessionId = params.get('session_id');

  if (checkout === 'cancel') {
    setPaymentStatusMessage('Stripe checkout was canceled.', false);
    setPaymentUiState({ paid: false });
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  if (checkout !== 'success' || !transactionId || !sessionId || !STORAGE_API_BASE) return;

  try {
    const response = await fetch(`${STORAGE_API_BASE}/payments/confirm-session?sessionId=${encodeURIComponent(sessionId)}&transactionId=${encodeURIComponent(transactionId)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.error || `Unable to verify payment (HTTP ${response.status}).`;
      throw new Error(message);
    }

    if (!result.paid) throw new Error('Payment is not marked paid yet.');

    isPaid = true;
    remainingAnalyses = 1;
    analyzeBtn.disabled = !fileInput.files.length;
    currentTransactionId = transactionId;

    const alreadyExists = transactions.some((tx) => tx.id === transactionId);
    if (!alreadyExists) {
      transactions.unshift({
        id: transactionId,
        paidAt: new Date().toISOString(),
        uploadedAt: null,
        fileName: null,
        status: 'paid',
        storageStatus: STORAGE_API_BASE ? 'pending upload' : 'storage_not_configured',
        artifacts: { originalUrl: null, cleanedCsvUrl: null, cleanedExcelUrl: null, dashboardPdfUrl: null }
      });
      persistTransactions();
    }

    setPaymentStatusMessage('Payment successful ($5). You can analyze 1 file before paying again.', true);
    setPaymentUiState({ paid: true });
    updateQuotaLabel();
  } catch (error) {
    setPaymentStatusMessage(error.message || 'Unable to verify payment session.', false);
    setPaymentUiState({ paid: false });
  } finally {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

analyzeBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file || !isPaid || remainingAnalyses <= 0) return;

  try {
    setProcessingState(true);
    uploadStatus.textContent = `Processing ${file.name}...`;
    lastUploadedName = file.name.replace(/\.[^.]+$/, '') || 'dataset';

    const rows = await parseFile(file);
    const cleaned = cleanRows(rows);
    if (!cleaned.length) throw new Error('No usable rows found after cleaning.');

    lastCleanedRows = cleaned;
    const insights = computeInsights(cleaned);

    insightsSection.classList.remove('hidden');
    renderInsights(insights);
    renderCharts(insights);
    renderConclusion(insights);
    await waitForChartPaint();

    const cleanedCsvBlob = buildCleanedCsvBlob(cleaned);
    const cleanedExcelBlob = buildCleanedExcelBlob(cleaned);
    const dashboardPdfBlob = await buildDashboardPdfBlob();

    const tx = findTransaction(currentTransactionId);
    if (tx) {
      tx.uploadedAt = new Date().toISOString();
      tx.fileName = file.name;
      tx.status = 'completed';

      if (STORAGE_API_BASE) {
        tx.storageStatus = 'uploading';
        
        tx.artifacts = await uploadArtifactsToStorage({
          transactionId: tx.id,
          originalFile: file,
          cleanedCsvBlob,
          cleanedExcelBlob,
          dashboardPdfBlob,
          baseName: stripExt(file.name)
        });

        tx.storageStatus = 'stored';
      } else {
        tx.storageStatus = 'storage_not_configured';
      }

      persistTransactions();
    }

    remainingAnalyses = 0;
    isPaid = false;
    analyzeBtn.disabled = true;
    setPaymentUiState({ paid: false });
    resetToPayRequiredMessage();
    const agreePay = document.getElementById('agreePay');
    if (agreePay) agreePay.checked = false;

    uploadStatus.textContent = `Done. Loaded ${cleaned.length} rows. You used your paid upload. Please pay again to continue.`;
    uploadStatus.className = 'small status-warn';

    downloadCsvBtn.disabled = false;
    downloadExcelBtn.disabled = false;
    downloadDashboardBtn.disabled = false;
    updateQuotaLabel();
  } catch (error) {
    uploadStatus.textContent = error.message || 'Unable to process file.';
    uploadStatus.className = 'small status-warn';

    const tx = findTransaction(currentTransactionId);
    if (tx && tx.status === 'paid') {
      tx.status = 'failed';
      persistTransactions();
    }
  } finally {
    setProcessingState(false);
  }
});

downloadCsvBtn.addEventListener('click', () => {
  if (!lastCleanedRows.length) return;
  downloadBlob(buildCleanedCsvBlob(lastCleanedRows), `${lastUploadedName}_cleaned.csv`);
});

downloadExcelBtn.addEventListener('click', () => {
  if (!lastCleanedRows.length) return;
  downloadBlob(buildCleanedExcelBlob(lastCleanedRows), `${lastUploadedName}_cleaned.xlsx`);
});

downloadDashboardBtn.addEventListener('click', async () => {
  if (insightsSection.classList.contains('hidden')) return;
  const pdfBlob = await buildDashboardPdfBlob();
  downloadBlob(pdfBlob, `${lastUploadedName}_dashboard.pdf`);
});


async function uploadArtifactsToStorage({ transactionId, originalFile, cleanedCsvBlob, cleanedExcelBlob, dashboardPdfBlob, baseName }) {
  const originalUrl = await uploadArtifactToStorage(transactionId, originalFile, `${baseName}_original${extractExt(originalFile.name)}`);
  const cleanedCsvUrl = await uploadArtifactToStorage(transactionId, cleanedCsvBlob, `${baseName}_cleaned.csv`);
  const cleanedExcelUrl = await uploadArtifactToStorage(transactionId, cleanedExcelBlob, `${baseName}_cleaned.xlsx`);
  const dashboardPdfUrl = await uploadArtifactToStorage(transactionId, dashboardPdfBlob, `${baseName}_dashboard.pdf`);

  return { originalUrl, cleanedCsvUrl, cleanedExcelUrl, dashboardPdfUrl };
}

async function uploadArtifactToStorage(transactionId, blobOrFile, fileName) {
  try {
    const createResponse = await fetch(`${STORAGE_API_BASE}/storage/create-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, fileName, contentType: blobOrFile.type || 'application/octet-stream' })
    });

    if (!createResponse.ok) throw new Error('Storage upload initialization failed.');
    const { uploadUrl, publicUrl } = await createResponse.json();

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blobOrFile.type || 'application/octet-stream' },
      body: blobOrFile
    });

    if (!putResponse.ok) throw new Error(`Upload failed for ${fileName}.`);
    return publicUrl;
  } catch (error) {
    if (error?.message === 'Failed to fetch') {
      throw new Error(
        'Unable to reach Storage API. Check Storage API URL, ensure server is running, and verify CORS ALLOWED_ORIGINS includes this site.'
      );
    }

    throw error;
  }
}

async function initializeDemoDashboardIfRequested() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return;

  const sampleRows = [
    { Date: '2025-01-01', Region: 'North America Enterprise', Sales: 1200, Cost: 760, Units: 40, Status: 'Won' },
    { Date: '2025-02-01', Region: 'North America Enterprise', Sales: 1450, Cost: 840, Units: 45, Status: 'Won' },
    { Date: '2025-03-01', Region: 'Europe Mid-Market', Sales: 1320, Cost: null, Units: 38, Status: 'Lost' },
    { Date: '2025-04-01', Region: 'Asia Pacific Enterprise', Sales: 1725, Cost: 930, Units: 56, Status: 'Won' },
    { Date: '2025-05-01', Region: 'Latin America Emerging', Sales: null, Cost: 905, Units: 49, Status: 'Pending' },
    { Date: '2025-06-01', Region: 'North America Enterprise', Sales: 4580, Cost: 995, Units: 210, Status: 'Won' }
  ];

  isPaid = false;
  remainingAnalyses = 0;
  updateQuotaLabel();

  const insights = computeInsights(sampleRows);
  lastCleanedRows = sampleRows;
  lastUploadedName = 'sample_dashboard_data';
  insightsSection.classList.remove('hidden');
  renderInsights(insights);
  renderCharts(insights);
  renderConclusion(insights);
  await waitForChartPaint();
  analyzeBtn.disabled = true;
  paymentStatus.textContent = 'Demo dashboard loaded. Please complete payment to upload and generate insights with your own file.';
  paymentStatus.className = 'small status-ok';
  uploadStatus.textContent = STORAGE_API_BASE
    ? 'Sample dashboard ready. External storage is configured for deployment.'
    : 'Sample dashboard ready. Set window.ADAMZ_STORAGE_API in deployment to upload files to cloud storage.';
  uploadStatus.className = 'small status-ok';

  downloadCsvBtn.disabled = false;
  downloadExcelBtn.disabled = false;
  downloadDashboardBtn.disabled = false;
}

function updateQuotaLabel() {
  uploadQuota.textContent = `Remaining paid uploads: ${remainingAnalyses}`;
}

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

function persistTransactions() {
  const persistable = transactions.map(({ id, paidAt, uploadedAt, fileName, status, storageStatus, artifacts }) => ({
    id,
    paidAt,
    uploadedAt,
    fileName,
    status,
    storageStatus,
    artifacts
  }));

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // ignore storage errors
  }
}

function findTransaction(id) {
  return transactions.find((tx) => tx.id === id);
}

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function stripExt(fileName) {
  return String(fileName).replace(/\.[^.]+$/, '');
}

function extractExt(fileName) {
  const match = String(fileName).match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildCleanedCsvBlob(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

function buildCleanedExcelBlob(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Cleaned Data');
  const array = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([array], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

async function buildDashboardPdfBlob() {
  await waitForChartPaint();

  const exportSection = insightsSection.cloneNode(true);
  exportSection.classList.remove('hidden');
  exportSection.querySelectorAll('.download-card').forEach((el) => el.remove());
  exportSection.style.width = `${insightsSection.scrollWidth}px`;
  exportSection.style.background = '#ffffff';
  exportSection.style.padding = '8px';

  const sourceCanvases = insightsSection.querySelectorAll('canvas');
  const exportCanvases = exportSection.querySelectorAll('canvas');
  exportCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;

    const image = document.createElement('img');
    image.src = sourceCanvas.toDataURL('image/png');
    image.alt = 'Chart snapshot';
    image.style.display = 'block';
    image.style.width = `${sourceCanvas.clientWidth || sourceCanvas.width}px`;
    image.style.height = `${sourceCanvas.clientHeight || sourceCanvas.height}px`;

    canvas.replaceWith(image);
  });

  const sandbox = document.createElement('div');
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-100000px';
  sandbox.style.top = '0';
  sandbox.style.zIndex = '-1';
  sandbox.appendChild(exportSection);
  document.body.appendChild(sandbox);

  try {
    const canvas = await html2canvas(exportSection, { backgroundColor: '#ffffff', scale: 2 });
    const imageData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 10;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 5;
    pdf.addImage(imageData, 'PNG', 5, position, imgWidth, imgHeight);
    heightLeft -= (pageHeight - 10);

    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 5;
      pdf.addPage();
      pdf.addImage(imageData, 'PNG', 5, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 10);
    }

    return pdf.output('blob');
  } finally {
    sandbox.remove();
  }
}

async function waitForChartPaint() {
  chartRefs.forEach((chart) => chart.update('none'));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function parseFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(file);
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return parseExcel(file);
  throw new Error('Unsupported file type. Upload CSV/XLS/XLSX.');
}

function parseCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const workbook = XLSX.read(String(reader.result || ''), { type: 'string' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: null }));
    };
    reader.onerror = () => reject(new Error('Could not read CSV file.'));
    reader.readAsText(file);
  });
}

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const workbook = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      resolve(XLSX.utils.sheet_to_json(firstSheet, { defval: null }));
    };
    reader.onerror = () => reject(new Error('Could not read Excel file.'));
    reader.readAsArrayBuffer(file);
  });
}

function cleanRows(rows) {
  if (!Array.isArray(rows)) return [];
  const discoveredHeaders = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  const headers = discoveredHeaders.map((h, idx) => String(h || '').trim() || `column_${idx + 1}`);
  return rows
    .map((row) => {
      const next = {};
      headers.forEach((header, i) => {
        next[header] = normalizeValue(row?.[discoveredHeaders[i]]);
      });
      return next;
    })
    .filter((row) => Object.values(row).some((value) => value !== null));
}

function normalizeValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(numeric) && /^-?[\d,.]+$/.test(trimmed) ? numeric : trimmed;
  }
  return value;
}

function computeInsights(rows) {
  const headers = Object.keys(rows[0]);
  const totalRows = rows.length;
  const totalCols = headers.length;

  const missingInfo = headers.map((header) => {
    const missing = rows.filter((row) => row[header] === null).length;
    return { header, missing, percent: ((missing / totalRows) * 100).toFixed(1), completeness: Number((100 - (missing / totalRows) * 100).toFixed(1)) };
  });

  const numericInfo = headers
    .map((header) => {
      const nums = rows.map((row) => row[header]).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (!nums.length) return null;
      const sum = nums.reduce((a, c) => a + c, 0);
      const mean = sum / nums.length;
      const variance = nums.reduce((a, c) => a + (c - mean) ** 2, 0) / nums.length;
      const stdDev = Math.sqrt(variance);
      return { header, count: nums.length, mean: Number(mean.toFixed(2)), min: Math.min(...nums), max: Math.max(...nums), stdDev: Number(stdDev.toFixed(2)), outlierCount: nums.filter((v) => (stdDev ? Math.abs((v - mean) / stdDev) : 0) > 2).length };
    })
    .filter(Boolean)
    .sort((a, b) => b.mean - a.mean);

  const categoryInfo = headers
    .map((header) => {
      const textValues = rows.map((row) => row[header]).filter((v) => typeof v === 'string');
      if (!textValues.length) return null;
      const freq = textValues.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      return { header, top: sorted.slice(0, 3).map(([v, c]) => `${v} (${c})`).join(', '), sorted };
    })
    .filter(Boolean);

  const timeTrend = computeTimeTrend(rows, headers, numericInfo);
  const correlations = computeCorrelations(rows, numericInfo);
  const totalMissing = missingInfo.reduce((a, i) => a + i.missing, 0);
  const dataQualityScore = Math.max(0, 100 - (totalMissing / (totalRows * totalCols || 1)) * 100);
  return { rows, totalRows, totalCols, missingInfo, numericInfo, categoryInfo, timeTrend, correlations, dataQualityScore };
}


function getCorrelationStrength(absValue) {
  if (absValue >= 0.8) return 'Very strong';
  if (absValue >= 0.6) return 'Strong';
  if (absValue >= 0.4) return 'Moderate';
  if (absValue >= 0.2) return 'Weak';
  return 'Very weak';
}

function computeCorrelations(rows, numericInfo) {
  const topNumericHeaders = numericInfo.slice(0, 6).map((item) => item.header);
  const correlations = [];

  for (let i = 0; i < topNumericHeaders.length; i += 1) {
    for (let j = i + 1; j < topNumericHeaders.length; j += 1) {
      const aHeader = topNumericHeaders[i];
      const bHeader = topNumericHeaders[j];
      const pairs = rows
        .map((row) => [row[aHeader], row[bHeader]])
        .filter(([a, b]) => typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b));

      if (pairs.length < 3) continue;

      const aMean = pairs.reduce((acc, [a]) => acc + a, 0) / pairs.length;
      const bMean = pairs.reduce((acc, [, b]) => acc + b, 0) / pairs.length;

      let numerator = 0;
      let aDenominator = 0;
      let bDenominator = 0;
      pairs.forEach(([a, b]) => {
        const aDiff = a - aMean;
        const bDiff = b - bMean;
        numerator += aDiff * bDiff;
        aDenominator += aDiff * aDiff;
        bDenominator += bDiff * bDiff;
      });

      const denominator = Math.sqrt(aDenominator * bDenominator);
      if (!denominator) continue;

      const value = Number((numerator / denominator).toFixed(3));
      correlations.push({
        pair: `${aHeader} ↔ ${bHeader}`,
        value,
        absValue: Math.abs(value),
        strength: getCorrelationStrength(Math.abs(value))
      });
    }
  }

  return correlations.sort((a, b) => b.absValue - a.absValue).slice(0, 8);
}

function computeTimeTrend(rows, headers, numericInfo) {
  const dateHeader = headers.find((header) => {
    const values = rows.map((row) => row[header]).filter((v) => typeof v === 'string' || v instanceof Date);
    if (!values.length) return false;
    return values.filter((v) => !Number.isNaN(new Date(v).getTime())).length / values.length >= 0.7;
  });
  if (!dateHeader || !numericInfo.length) return null;

  const metricHeader = numericInfo[0].header;
  const grouped = {};
  rows.forEach((row) => {
    const date = new Date(row[dateHeader]);
    const metric = row[metricHeader];
    if (Number.isNaN(date.getTime()) || typeof metric !== 'number') return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    grouped[key] = (grouped[key] || 0) + metric;
  });

  const points = Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])).map(([period, value]) => ({ period, value: Number(value.toFixed(2)) }));
  if (points.length < 2) return null;

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const growthPercent = first !== 0 ? Number((((last - first) / Math.abs(first)) * 100).toFixed(1)) : 0;
  return { dateHeader, metricHeader, points, growthPercent };
}

function renderInsights(insights) {
  const { totalRows, totalCols, missingInfo, numericInfo, categoryInfo, correlations, dataQualityScore } = insights;
  renderOverview(totalRows, totalCols, missingInfo, numericInfo, correlations, dataQualityScore);
  renderTable('missingTable', missingInfo, ({ header, missing, percent }) => [header, missing, `${percent}%`]);
  renderTable('numericTable', numericInfo, ({ header, count, mean, min, max, stdDev, outlierCount }) => [header, count, mean, min, max, stdDev, outlierCount], 'No numeric columns found.');
  renderTable('categoryTable', categoryInfo, ({ header, top }) => [header, top], 'No text columns found.');
  renderTable('correlationTable', correlations, ({ pair, value, strength }) => [pair, value, strength], 'Not enough numeric overlap to compute correlation insights.');
}

function renderOverview(totalRows, totalCols, missingInfo, numericInfo, correlations, dataQualityScore) {
  const totalMissing = missingInfo.reduce((a, i) => a + i.missing, 0);
  const totalOutliers = numericInfo.reduce((a, i) => a + i.outlierCount, 0);
  const metrics = [['Rows after cleaning', totalRows], ['Columns', totalCols], ['Total missing cells', totalMissing], ['Numeric columns', numericInfo.length], ['Outlier points detected', totalOutliers], ['Top correlations', correlations.length], ['Data quality score', `${dataQualityScore.toFixed(1)}%`]];
  document.getElementById('overview').innerHTML = metrics.map(([label, value]) => `<div class="metric"><p>${label}</p><h3>${value}</h3><span class="small">Auto-generated</span></div>`).join('');
}

function renderTable(tableId, rows, rowRenderer, emptyMessage = 'No data available.') {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">${emptyMessage}</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((row) => `<tr>${rowRenderer(row).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
}

function truncateLabel(label, max = 14) { return label.length > max ? `${label.slice(0, max - 1)}…` : label; }
function buildLabelMeta(labels, max = 14) { return { full: labels, short: labels.map((l) => truncateLabel(String(l), max)) }; }
function tooltipWithFullLabels(meta) { return { callbacks: { title(items) { return items.length ? (meta.full[items[0].dataIndex] || items[0].label) : ''; } } }; }

function renderCharts(insights) {
  clearCharts();
  const completenessMeta = buildLabelMeta(insights.missingInfo.slice(0, 10).map((i) => i.header));
  const completenessValues = insights.missingInfo.slice(0, 10).map((i) => i.completeness);

  chartRefs.push(new Chart(document.getElementById('completenessChart'), { type: 'radar', data: { labels: completenessMeta.short, datasets: [{ label: 'Completeness %', data: completenessValues, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)', pointBackgroundColor: '#3b82f6' }] }, options: mergeOptions(baseChartOptions('radar'), { plugins: { tooltip: tooltipWithFullLabels(completenessMeta) } }) }));

  const meanMeta = buildLabelMeta(insights.numericInfo.slice(0, 8).map((i) => i.header));
  chartRefs.push(new Chart(document.getElementById('numericMeanChart'), { type: 'bar', data: { labels: meanMeta.short, datasets: [{ label: 'Mean value', data: insights.numericInfo.slice(0, 8).map((i) => i.mean), borderRadius: 8, backgroundColor: ['#2563eb', '#3b82f6', '#60a5fa', '#38bdf8', '#22d3ee', '#14b8a6', '#10b981', '#84cc16'] }] }, options: mergeOptions(baseChartOptions(), { plugins: { tooltip: tooltipWithFullLabels(meanMeta) } }) }));

  const topCategory = insights.categoryInfo[0];
  const categoryEntries = topCategory ? topCategory.sorted.slice(0, 6) : [];
  const categoryMeta = buildLabelMeta(categoryEntries.map(([name]) => name));
  chartRefs.push(new Chart(document.getElementById('categoryChart'), { type: 'doughnut', data: { labels: categoryMeta.short, datasets: [{ data: categoryEntries.map(([, c]) => c), backgroundColor: ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'] }] }, options: mergeOptions(baseChartOptions('doughnut'), { plugins: { tooltip: tooltipWithFullLabels(categoryMeta) } }) }));

  renderTrendChart(insights);
  renderStackedCategoryChart(insights);
  renderOutlierChart(insights);
  renderQualityMixChart(insights);
  renderVolatilityChart(insights);
}

function renderTrendChart(insights) {
  const trendCanvas = document.getElementById('trendLineChart');
  if (!insights.timeTrend) {
    chartRefs.push(new Chart(trendCanvas, { type: 'line', data: { labels: ['No time-series found'], datasets: [{ label: 'N/A', data: [0] }] }, options: baseChartOptions() }));
    return;
  }
  const trendMeta = buildLabelMeta(insights.timeTrend.points.map((p) => p.period), 12);
  chartRefs.push(new Chart(trendCanvas, { type: 'line', data: { labels: trendMeta.short, datasets: [{ label: `${insights.timeTrend.metricHeader} over time`, data: insights.timeTrend.points.map((p) => p.value), fill: true, tension: 0.35, borderColor: '#0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.18)', pointBackgroundColor: '#0284c7' }] }, options: mergeOptions(baseChartOptions(), { plugins: { tooltip: tooltipWithFullLabels(trendMeta) } }) }));
}

function renderStackedCategoryChart(insights) {
  const canvas = document.getElementById('stackedCategoryChart');
  const topCategories = insights.categoryInfo.slice(0, 3);
  if (!topCategories.length) {
    chartRefs.push(new Chart(canvas, { type: 'bar', data: { labels: ['N/A'], datasets: [{ label: 'No category data', data: [0] }] }, options: baseChartOptions() }));
    return;
  }
  const labels = topCategories[0].sorted.slice(0, 6).map(([name]) => name);
  const labelMeta = buildLabelMeta(labels, 12);
  const datasets = topCategories.map((cat, idx) => {
    const map = new Map(cat.sorted);
    return { label: cat.header, data: labels.map((name) => map.get(name) || 0), backgroundColor: ['#2563eb', '#10b981', '#f59e0b'][idx] };
  });
  chartRefs.push(new Chart(canvas, { type: 'bar', data: { labels: labelMeta.short, datasets }, options: mergeOptions(baseChartOptions(), { scales: { x: { stacked: true, ticks: { color: '#334155' }, grid: { color: 'rgba(148, 163, 184, 0.25)' } }, y: { stacked: true, ticks: { color: '#334155' }, grid: { color: 'rgba(148, 163, 184, 0.25)' } } }, plugins: { tooltip: tooltipWithFullLabels(labelMeta) } }) }));
}

function renderOutlierChart(insights) {
  const canvas = document.getElementById('outlierChart');
  const numeric = insights.numericInfo.slice(0, 8);
  if (!numeric.length) {
    chartRefs.push(new Chart(canvas, { type: 'bar', data: { labels: ['N/A'], datasets: [{ label: 'No numeric data', data: [0] }] }, options: baseChartOptions() }));
    return;
  }

  const outlierCounts = numeric.map((item) => item.outlierCount);
  const hasOutliers = outlierCounts.some((count) => count > 0);
  const fallbackRiskScore = numeric.map((item) => Number((item.stdDev / (Math.abs(item.mean) + 1) * 100).toFixed(2)));
  const values = hasOutliers ? outlierCounts : fallbackRiskScore;
  const label = hasOutliers ? 'Outlier count' : 'Volatility risk score';

  const outlierMeta = buildLabelMeta(numeric.map((item) => item.header));
  chartRefs.push(new Chart(canvas, {
    type: 'bar',
    data: {
      labels: outlierMeta.short,
      datasets: [{ label, data: values, borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.75)' }]
    },
    options: mergeOptions(baseChartOptions(), { plugins: { tooltip: tooltipWithFullLabels(outlierMeta) } })
  }));
}


function renderQualityMixChart(insights) {
  const canvas = document.getElementById('qualityMixChart');
  if (!canvas) return;
  const strong = insights.missingInfo.filter((item) => item.completeness >= 90).length;
  const watch = insights.missingInfo.filter((item) => item.completeness >= 70 && item.completeness < 90).length;
  const risk = insights.missingInfo.filter((item) => item.completeness < 70).length;

  chartRefs.push(new Chart(canvas, {
    type: 'pie',
    data: {
      labels: ['High quality columns', 'Watchlist columns', 'At-risk columns'],
      datasets: [{ data: [strong, watch, risk], backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'] }]
    },
    options: mergeOptions(baseChartOptions('doughnut'), {})
  }));
}

function renderVolatilityChart(insights) {
  const canvas = document.getElementById('volatilityChart');
  if (!canvas) return;
  const numeric = insights.numericInfo.slice(0, 8);
  if (!numeric.length) {
    chartRefs.push(new Chart(canvas, { type: 'bar', data: { labels: ['N/A'], datasets: [{ label: 'No numeric data', data: [0] }] }, options: baseChartOptions() }));
    return;
  }

  const volatilityMeta = buildLabelMeta(numeric.map((item) => item.header));
  chartRefs.push(new Chart(canvas, {
    type: 'line',
    data: {
      labels: volatilityMeta.short,
      datasets: [{
        label: 'Std dev (volatility)',
        data: numeric.map((item) => item.stdDev),
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(124, 58, 237, 0.18)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#6d28d9'
      }]
    },
    options: mergeOptions(baseChartOptions(), { plugins: { tooltip: tooltipWithFullLabels(volatilityMeta) } })
  }));
}

function renderConclusion(insights) {
  const topNumeric = insights.numericInfo[0];
  const topOutlier = [...insights.numericInfo].sort((a, b) => b.outlierCount - a.outlierCount)[0];
  const mostComplete = [...insights.missingInfo].sort((a, b) => b.completeness - a.completeness)[0];
  const weakestComplete = [...insights.missingInfo].sort((a, b) => a.completeness - b.completeness)[0];
  const topCategory = insights.categoryInfo[0]?.sorted?.[0];
  const trendNarrative = insights.timeTrend ? `Trend intelligence: ${insights.timeTrend.metricHeader} changed by ${insights.timeTrend.growthPercent}% across ${insights.timeTrend.points.length} time periods (using ${insights.timeTrend.dateHeader}).` : 'Trend intelligence: no reliable date column found, so trend confidence is low until date fields are standardized.';
  const strongestCorrelation = insights.correlations?.[0];
  finalConclusion.textContent = [
    `Executive summary: this dataset achieved a ${insights.dataQualityScore.toFixed(1)}% quality score after cleaning, indicating ${insights.dataQualityScore >= 85 ? 'strong' : insights.dataQualityScore >= 65 ? 'moderate' : 'high-risk'} analytical readiness.`,
    mostComplete ? `Strength: ${mostComplete.header} is the most reliable column at ${mostComplete.completeness}% completeness.` : '',
    weakestComplete ? `Risk hotspot: ${weakestComplete.header} has ${weakestComplete.percent}% missing values and should be prioritized for source-fix workflows.` : '',
    topNumeric ? `Primary KPI signal: ${topNumeric.header} leads numeric impact (mean ${topNumeric.mean}, range ${topNumeric.min}–${topNumeric.max}).` : '',
    topOutlier ? `Anomaly watch: ${topOutlier.header} contains ${topOutlier.outlierCount} potential outliers requiring business review.` : '',
    topCategory ? `Behavioral pattern: '${topCategory[0]}' is the dominant category (${topCategory[1]} records), suggesting concentration around this segment.` : '',
    strongestCorrelation ? `Relationship signal: ${strongestCorrelation.pair} shows a correlation of ${strongestCorrelation.value} (${strongestCorrelation.strength.toLowerCase()} association), helping identify linked performance drivers.` : '',
    trendNarrative,
    'Action plan: (1) remediate the highest-missing columns, (2) validate outliers with domain owners, (3) monitor the time trend KPI weekly, and (4) export the cleaned dataset and dashboard snapshot for reporting.'
  ].filter(Boolean).join(' ');
}

function clearCharts() { chartRefs.forEach((chart) => chart.destroy()); chartRefs = []; }

function mergeOptions(base, extra) {
  return {
    ...base,
    ...extra,
    plugins: { ...(base.plugins || {}), ...(extra.plugins || {}), tooltip: { ...((base.plugins || {}).tooltip || {}), ...((extra.plugins || {}).tooltip || {}) } },
    scales: { ...(base.scales || {}), ...(extra.scales || {}) }
  };
}

function baseChartOptions(kind = 'default') {
  const base = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { ticks: { color: '#334155' }, grid: { color: 'rgba(148, 163, 184, 0.25)' } },
      y: { ticks: { color: '#334155' }, grid: { color: 'rgba(148, 163, 184, 0.25)' } }
    },
    plugins: {
      legend: { labels: { color: '#334155' } },
      tooltip: { backgroundColor: '#ffffff', titleColor: '#0f172a', bodyColor: '#334155', borderColor: '#cbd5e1', borderWidth: 1 }
    }
  };

  if (kind === 'radar') {
    return { ...base, scales: { r: { angleLines: { color: 'rgba(148, 163, 184, 0.28)' }, grid: { color: 'rgba(148, 163, 184, 0.28)' }, pointLabels: { color: '#334155' }, ticks: { color: '#475569', backdropColor: 'transparent' } } } };
  }

  if (kind === 'doughnut') {
    const { scales, ...rest } = base;
    return rest;
  }

  return base;
}
