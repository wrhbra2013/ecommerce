/* ============================================================
   Monitor de Preços VTEX — 100% estático, sem backend
   ============================================================ */

const STORAGE_PREFIX = 'vtex_snapshot_';

/* ---------- DOM refs ---------- */
const form = document.getElementById('searchForm');
const domainInput = document.getElementById('domain');
const queryInput = document.getElementById('query');
const limitInput = document.getElementById('limit');
const btnBuscar = document.getElementById('btnBuscar');
const btnLimpar = document.getElementById('btnLimpar');
const statusDiv = document.getElementById('status');
const summaryDiv = document.getElementById('summary');
const totalSpan = document.getElementById('totalProdutos');
const alteradosSpan = document.getElementById('alterados');
const primeiraSpan = document.getElementById('primeiraVez');
const resultsDiv = document.getElementById('results');

/* ---------- UI helpers ---------- */
function setStatus(msg, type = 'info') {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = msg;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.style.display = 'none';
}

/* ---------- Snapshot (localStorage) ---------- */
function getSnapshotKey(domain, query) {
  return STORAGE_PREFIX + btoa(`${domain}|${query}`);
}

function loadSnapshot(domain, query) {
  try {
    const raw = localStorage.getItem(getSnapshotKey(domain, query));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSnapshot(domain, query, data) {
  localStorage.setItem(getSnapshotKey(domain, query), JSON.stringify(data));
}

function clearSnapshot() {
  const domain = domainInput.value.trim();
  const query = queryInput.value.trim();
  if (domain && query) {
    localStorage.removeItem(getSnapshotKey(domain, query));
  }
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_PREFIX))
    .forEach(k => localStorage.removeItem(k));
}

/* ---------- API (CORS proxy) ---------- */
const IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";

async function fetchProducts(domain, query, limit) {
  const params = new URLSearchParams({ ft: query, _from: "0", _to: String(limit - 1) });
  let url, headers;
  if (IS_LOCAL) {
    url = `/api/catalog_system/pub/products/search?${params}`;
    headers = { "X-Vtex-Domain": domain };
  } else {
    const apiUrl = `https://${domain}/api/catalog_system/pub/products/search?${params}`;
    url = `https://corsproxy.io/?url=${encodeURIComponent(apiUrl)}`;
    headers = {};
  }
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

function extractProduct(p) {
  const item = (p.items || [])[0] || {};
  const sellers = item.sellers || [];
  const offers = sellers
    .map(s => s.commertialOffer)
    .filter(o => o && o.Price > 0);
  const best = offers.length ? offers.reduce((a, b) => a.Price < b.Price ? a : b) : null;
  const price = best ? best.Price : null;

  let seller = '';
  if (best && sellers.length) {
    const idx = sellers.findIndex(s => s.commertialOffer === best);
    if (idx >= 0) seller = sellers[idx].sellerName || '';
  }

  const image = (item.images || [])[0]?.imageUrl || '';

  return {
    productId: p.productId || p.productReference || '',
    name: p.productName || '',
    brand: p.brand || '',
    link: p.link || '',
    imageUrl: image,
    seller,
    price,
  };
}

/* ---------- Comparação ---------- */
function compare(current, previous, key) {
  const results = [];
  const snapshot = {};

  for (const prod of current) {
    const pid = prod.productId;
    const curr = prod.price;
    const prev = previous[`${key}|${pid}`] ?? null;

    let delta = null, deltaPct = null, changed = false;
    if (curr !== null && prev !== null) {
      delta = Math.round((curr - prev) * 100) / 100;
      deltaPct = prev !== 0 ? Math.round((delta / prev) * 10000) / 100 : null;
      changed = Math.abs(delta) > 0.001;
    }

    snapshot[`${key}|${pid}`] = curr;

    results.push({ ...prod, currentPrice: curr, previousPrice: prev, delta, deltaPct, priceChanged: changed });
  }

  return { results, snapshot };
}

/* ---------- Render ---------- */
function render(results, isFirstRun) {
  const changed = results.filter(r => r.priceChanged);

  totalSpan.textContent = `${results.length} produto(s) encontrado(s)`;
  alteradosSpan.textContent = `${changed.length} alteração(ões)`;
  alteradosSpan.style.display = changed.length ? '' : 'none';
  primeiraSpan.textContent = 'Primeira execução — snapshot salvo. Nenhum histórico ainda.';
  primeiraSpan.style.display = isFirstRun ? '' : 'none';
  summaryDiv.hidden = false;

  resultsDiv.innerHTML = results.map(prod => {
    let priceHtml;
    if (prod.currentPrice !== null) {
      const currStr = fmtBRL(prod.currentPrice);
      let deltaHtml = '';
      if (prod.priceChanged && prod.delta !== null) {
        const cls = prod.delta > 0 ? 'delta-up' : 'delta-down';
        const icon = prod.delta > 0 ? '▲' : '▼';
        const sinal = prod.delta > 0 ? '+' : '';
        const badgeCls = prod.delta > 0 ? 'subiu' : 'desceu';
        const label = prod.delta > 0 ? 'Subiu' : 'Desceu';
        deltaHtml = `
          <div class="card-delta ${cls}">${icon} ${sinal}${fmtBRL(prod.delta)} (${prod.deltaPct}%)</div>
          <span class="changed-badge ${badgeCls}">${label}</span>
        `;
      } else if (!prod.priceChanged && prod.previousPrice !== null) {
        deltaHtml = '<div class="card-delta delta-zero">● Estável</div>';
      }
      const prevStr = prod.previousPrice !== null ? fmtBRL(prod.previousPrice) : '';
      priceHtml = `
        <div>
          <span class="card-price">${currStr}</span>
          ${prevStr ? `<span class="card-price-anterior">${prevStr}</span>` : ''}
        </div>
        ${deltaHtml}
      `;
    } else {
      priceHtml = '<div class="card-sem-preco">Preço indisponível</div>';
    }

    const img = prod.imageUrl || 'https://via.placeholder.com/280x180?text=Sem+Imagem';

    return `
      <div class="card">
        <img class="card-img" src="${img}" alt="${escHtml(prod.name)}" loading="lazy"
             onerror="this.src='https://via.placeholder.com/280x180?text=Sem+Imagem'">
        <div class="card-body">
          <div class="card-brand">${escHtml(prod.brand || prod.seller || '—')}</div>
          <div class="card-name">${escHtml(prod.name)}</div>
          ${priceHtml}
          <a class="card-link" href="${escHtml(prod.link)}" target="_blank">Ver na loja</a>
        </div>
      </div>
    `;
  }).join('\n');
}

function fmtBRL(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ---------- Main ---------- */
async function buscar() {
  const domain = domainInput.value.trim();
  const query = queryInput.value.trim();
  const limit = Math.min(Math.max(parseInt(limitInput.value) || 20, 1), 200);

  if (!domain || !query) {
    setStatus('Preencha o domínio e o termo de busca.', 'erro');
    return;
  }

  btnBuscar.disabled = true;
  hideStatus();
  summaryDiv.hidden = true;
  resultsDiv.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">Buscando produtos...</p>';

  try {
    setStatus(`Consultando ${domain}…`, 'info');
    const raw = await fetchProducts(domain, query, limit);
    const current = raw.map(extractProduct);
    setStatus(`${current.length} produto(s) encontrado(s). Comparando com snapshot anterior…`, 'ok');

    const key = getSnapshotKey(domain, query);
    const previous = loadSnapshot(domain, query);
    const isFirstRun = Object.keys(previous).length === 0;

    const { results, snapshot } = compare(current, previous, key);
    saveSnapshot(domain, query, snapshot);

    render(results, isFirstRun);
    hideStatus();

  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      setStatus('Tempo limite excedido. Verifique o domínio e tente novamente.', 'erro');
    } else if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      setStatus('Erro de rede. Verifique sua conexão com a internet.', 'erro');
    } else {
      setStatus(`Erro: ${err.message}`, 'erro');
    }
    resultsDiv.innerHTML = '';
  } finally {
    btnBuscar.disabled = false;
  }
}

/* ---------- Eventos ---------- */
form.addEventListener('submit', e => { e.preventDefault(); buscar(); });
btnLimpar.addEventListener('click', () => {
  clearSnapshot();
  setStatus('Histórico de preços limpo.', 'ok');
  summaryDiv.hidden = true;
  resultsDiv.innerHTML = '';
});
