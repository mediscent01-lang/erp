(function () {
  'use strict';

  const M = window.MediscentMath;
  if (!M) {
    console.error('[MEDISCENT Tools] business-math.js가 먼저 로드되어야 합니다.');
    return;
  }

  const TOOL_VERSION = '4.0-beta.1';
  const SESSION_ID = `S-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const SESSION_START = Date.now();
  const EVENT_KEY = 'mediscent_tool_ab_events_v1';
  const VARIANT_KEY = 'mediscent_tool_ab_variant_v1';
  let activeTool = 'biz-hub';
  let activeToolStartedAt = Date.now();

  const TOOLS = [
    { id: 'biz-dilution', icon: '🧪', name: '향료 배합·희석', group: 'R&D', desc: '배치량·농도·손실률을 반영한 제조량 계산' },
    { id: 'biz-margin', icon: '₩', name: '원가·마진·공급률', group: '가격', desc: '수수료·부가세·할인을 반영한 공헌이익 계산' },
    { id: 'biz-moq', icon: '📦', name: 'MOQ 손익', group: '가격', desc: '발주 수량별 투자금·손익분기·재고개월 비교' },
    { id: 'biz-export-price', icon: '🌍', name: '환율 적용 수출가', group: '수출', desc: '공급률·환율 버퍼·현지 유통마진 시뮬레이션' },
    { id: 'biz-export-doc', icon: '📄', name: '수출 견적·인보이스', group: '수출', desc: '고객·제품 데이터로 영문 문서 발행 및 저장' },
    { id: 'biz-roas', icon: '📈', name: '인플루언서 ROAS', group: '마케팅', desc: '콘텐츠 비용·도달·구매·LTV 손익분기 분석' },
    { id: 'biz-allergen', icon: '🌿', name: '전성분·알레르겐', group: 'R&D', desc: '원료사 자료 기반 최종제품 알레르겐 함량 계산' },
    { id: 'biz-sku', icon: '▥', name: 'SKU·GTIN', group: '기준정보', desc: '내부 SKU 생성과 정식 GTIN 검증·바코드 출력' },
    { id: 'biz-lot', icon: '🏭', name: '생산 LOT 관리표', group: '생산', desc: '기존 LOT 통합 조회·신규 코드·엑셀 내보내기' },
    { id: 'biz-product-en', icon: 'EN', name: '영문 제품정보서', group: '문서', desc: '제품·전성분·회사정보 기반 영문 원페이지 생성' }
  ];

  const e = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const n = (id, fallback = 0) => M.finite(document.getElementById(id)?.value, fallback);
  const v = (id) => document.getElementById(id)?.value || '';
  const checked = (id) => Boolean(document.getElementById(id)?.checked);
  const won = (value) => `${Math.round(M.finite(value)).toLocaleString('ko-KR')}원`;
  const money = (value, currency = '') => `${currency ? `${currency} ` : ''}${M.finite(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const pct = (value) => `${M.finite(value).toFixed(1)}%`;
  const resultClass = (value) => M.finite(value) >= 0 ? 'bt-positive' : 'bt-negative';
  const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  function products() { return window.db?.master?.M_PRODUCT || []; }
  function customers() { return window.db?.master?.M_CUSTOMER || []; }
  function raws() { return window.db?.master?.M_RAW || []; }
  function productById(id) { return products().find((item) => String(item.productId) === String(id)); }
  function rawById(id) { return raws().find((item) => String(item.rawId) === String(id)); }
  function productCost(product) {
    if (!product) return 0;
    if (typeof window.calcProductStdCost === 'function') return M.finite(window.calcProductStdCost(product));
    const fillWeight = M.finite(product.fillWeight);
    return (product.bom || []).reduce((sum, row) => {
      const master = row.type === 'RAW' ? rawById(row.itemId) : (window.db?.master?.M_PACK || []).find((item) => String(item.packId) === String(row.itemId));
      const unit = M.finite(master?.stdCost);
      return sum + (row.type === 'RAW' && fillWeight > 0 ? M.finite(row.qty) / 100 * fillWeight * unit : M.finite(row.qty) * unit);
    }, 0);
  }

  function optionList(items, valueKey, label) {
    return items.map((item) => `<option value="${e(item[valueKey])}">${e(label(item))}</option>`).join('');
  }

  function metric(label, value, tone = '') {
    return `<div class="bt-metric ${tone}"><span>${e(label)}</span><strong>${value}</strong></div>`;
  }

  function showError(targetId, error) {
    const host = document.getElementById(targetId);
    if (host) host.innerHTML = `<div class="bt-alert bt-alert-red"><b>확인 필요</b><span>${e(error.message || error)}</span></div>`;
    track('error', activeTool, { message: String(error.message || error).slice(0, 120) });
  }

  function notify(message, type = 'success') {
    if (typeof window.toast === 'function') window.toast(message, type);
  }

  function persist(reason) {
    if (!window.db) return;
    window.db.tools = window.db.tools || {};
    window.db.meta = window.db.meta || {};
    window.db.meta.businessToolsVersion = TOOL_VERSION;
    if (typeof window.logEvent === 'function') window.logEvent(reason);
    if (typeof window.saveDB === 'function') window.saveDB();
  }

  function getVariant() {
    const forced = new URLSearchParams(location.search).get('ab');
    if (forced === 'A' || forced === 'B') return forced;
    let assigned = localStorage.getItem(VARIANT_KEY);
    if (assigned !== 'A' && assigned !== 'B') {
      assigned = Math.random() < 0.5 ? 'A' : 'B';
      localStorage.setItem(VARIANT_KEY, assigned);
    }
    return assigned;
  }

  function getEvents() {
    try { return JSON.parse(localStorage.getItem(EVENT_KEY) || '[]'); } catch (_) { return []; }
  }

  function track(event, tool, detail = {}) {
    const events = getEvents();
    events.push({
      at: new Date().toISOString(), session: SESSION_ID, variant: getVariant(), event, tool,
      elapsedMs: Date.now() - SESSION_START, ...detail
    });
    localStorage.setItem(EVENT_KEY, JSON.stringify(events.slice(-1500)));
  }

  function markComplete(tool, detail = {}) {
    track('complete', tool, { taskMs: Date.now() - activeToolStartedAt, ...detail });
    updateAbPanel();
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'mediscent-business-tools-style';
    style.textContent = `
      .bt-shell{font-size:14px;color:#0f172a}.bt-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.bt-title h2{font-size:20px;font-weight:900;letter-spacing:-.02em}.bt-title p{font-size:13px;color:#64748b;margin-top:4px}.bt-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.88fr);gap:18px}.bt-card{background:#fff;border:1px solid #dbe4ee;border-radius:14px;box-shadow:0 2px 8px rgba(15,23,42,.05);padding:18px}.bt-card h3{font-size:15px;font-weight:900;color:#0f172a;margin-bottom:12px}.bt-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.bt-field label{display:block;font-size:12px;font-weight:800;color:#475569;margin-bottom:5px}.bt-field small{display:block;font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4}.bt-input,.bt-select,.bt-textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:9px 10px;font:inherit;color:#0f172a}.bt-input:focus,.bt-select:focus,.bt-textarea:focus{outline:none;border-color:#0d9488;box-shadow:0 0 0 3px rgba(13,148,136,.12)}.bt-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.bt-btn{border:0;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer;background:#0d9488;color:#fff}.bt-btn:hover{background:#0f766e}.bt-btn-secondary{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}.bt-btn-secondary:hover{background:#e2e8f0}.bt-btn-danger{background:#fff1f2;color:#be123c;border:1px solid #fecdd3}.bt-result{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.bt-metric{border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:12px}.bt-metric span{display:block;font-size:11px;font-weight:700;color:#64748b}.bt-metric strong{display:block;font-size:19px;font-weight:900;margin-top:4px;font-variant-numeric:tabular-nums}.bt-positive strong{color:#047857}.bt-negative strong{color:#dc2626}.bt-accent{background:#f0fdfa;border-color:#99f6e4}.bt-accent strong{color:#0f766e}.bt-alert{display:flex;flex-direction:column;gap:3px;border-radius:10px;padding:12px 14px;font-size:12px;margin-top:12px}.bt-alert b{font-size:12px}.bt-alert-amber{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.bt-alert-red{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239}.bt-alert-blue{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}.bt-table-wrap{overflow:auto;border:1px solid #e2e8f0;border-radius:10px}.bt-table{min-width:720px}.bt-table th{font-size:11px;padding:9px;background:#f8fafc}.bt-table td{font-size:12px;padding:9px}.bt-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bt-toolbar .bt-input,.bt-toolbar .bt-select{width:auto;min-width:140px}.bt-hub-hero{background:linear-gradient(135deg,#0f172a 0%,#134e4a 60%,#0d9488 130%);color:#fff;border-radius:18px;padding:22px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.bt-hub-hero h2{font-size:23px;font-weight:900}.bt-hub-hero p{font-size:13px;color:#cbd5e1;margin-top:6px;max-width:640px}.bt-variant{border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.1);border-radius:999px;padding:6px 10px;font-size:11px;font-weight:800;white-space:nowrap}.bt-tool-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.bt-tool-card{border:1px solid #dbe4ee;border-radius:13px;background:#fff;padding:15px;cursor:pointer;transition:.15s;min-height:124px}.bt-tool-card:hover{transform:translateY(-2px);border-color:#5eead4;box-shadow:0 8px 18px rgba(15,118,110,.12)}.bt-tool-card i{font-style:normal;font-size:20px}.bt-tool-card b{display:block;font-size:14px;margin-top:10px}.bt-tool-card span{display:block;font-size:11.5px;color:#64748b;line-height:1.45;margin-top:4px}.bt-tool-card em{font-style:normal;font-size:10px;color:#0f766e;font-weight:800}.bt-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.bt-flow-step{position:relative;border:1px solid #dbe4ee;border-radius:13px;background:#fff;padding:15px;cursor:pointer}.bt-flow-step small{font-size:10px;font-weight:900;color:#0d9488}.bt-flow-step b{display:block;font-size:14px;margin:7px 0 4px}.bt-flow-step span{font-size:11px;line-height:1.4;color:#64748b}.bt-doc-page{width:210mm;min-height:297mm;background:#fff;border:1px solid #cbd5e1;box-shadow:0 12px 28px rgba(15,23,42,.1);padding:15mm;margin:0 auto;font-size:11px}.bt-doc-page h1{text-align:center;font-size:26px;font-weight:900;letter-spacing:.12em;margin:10px 0 20px}.bt-doc-page table{font-size:10px}.bt-doc-page th,.bt-doc-page td{border:1px solid #94a3b8;padding:7px}.bt-doc-stage{background:#e9eef4;border-radius:14px;padding:18px;overflow:auto}.bt-row{display:grid;grid-template-columns:minmax(160px,1fr) 90px 110px 34px;gap:7px;align-items:center;margin-bottom:7px}.bt-row-allergen{grid-template-columns:minmax(150px,1fr) minmax(150px,1fr) 110px 34px}.bt-code{font-family:'IBM Plex Mono',monospace;background:#0f172a;color:#5eead4;border-radius:9px;padding:12px;font-size:14px;font-weight:700;word-break:break-all}.bt-ab-bars{display:grid;gap:8px}.bt-ab-row{display:grid;grid-template-columns:28px 1fr 70px;gap:8px;align-items:center;font-size:12px}.bt-ab-track{height:9px;background:#e2e8f0;border-radius:99px;overflow:hidden}.bt-ab-fill{height:100%;background:#0d9488}.bt-check{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#475569}.bt-divider{height:1px;background:#e2e8f0;margin:16px 0}.bt-note{font-size:11px;line-height:1.5;color:#64748b}.bt-inline-kpi{display:flex;gap:12px;flex-wrap:wrap}.bt-inline-kpi span{font-size:11px;background:#f1f5f9;border-radius:999px;padding:5px 9px;color:#475569}.bt-sticky{position:sticky;top:0;align-self:start}.bt-variant-b .bt-tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bt-variant-b .bt-tool-card{border-left:4px solid #0d9488}.bt-variant-b .bt-tool-card span{font-size:12px}.bt-hidden{display:none!important}
      @media(max-width:1100px){.bt-grid{grid-template-columns:1fr}.bt-sticky{position:static}.bt-tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bt-flow{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:700px){.bt-shell{font-size:14px}.bt-card{padding:14px}.bt-fields,.bt-result,.bt-tool-grid,.bt-variant-b .bt-tool-grid,.bt-flow{grid-template-columns:1fr}.bt-hub-hero{flex-direction:column}.bt-row,.bt-row-allergen{grid-template-columns:1fr 78px 96px 32px}.bt-doc-page{width:100%;min-height:auto;padding:18px}.bt-toolbar .bt-input,.bt-toolbar .bt-select{width:100%}}
      @media print{body.bt-printing aside,body.bt-printing header,body.bt-printing #toast-container,body.bt-printing .no-print{display:none!important}body.bt-printing main,body.bt-printing #main-content{overflow:visible!important;height:auto!important;padding:0!important}.bt-doc-stage{padding:0;background:#fff}.bt-doc-page{box-shadow:none;border:0;width:auto;min-height:auto;margin:0;padding:0}}
    `;
    document.head.appendChild(style);
  }

  function navItem(tool) {
    return `<div onclick="goPage('${tool.id}')" id="nav-${tool.id}" class="nav-item"><span style="width:16px;text-align:center;font-size:12px">${tool.icon}</span>${e(tool.name)}</div>`;
  }

  function injectNavigation() {
    const nav = document.querySelector('aside nav');
    if (!nav || document.getElementById('nav-biz-hub')) return;
    const group = document.createElement('div');
    group.id = 'business-tools-nav-group';
    group.innerHTML = `<div class="nav-label">10 · 경영 / 수출 도구</div>
      <div onclick="goPage('biz-hub')" id="nav-biz-hub" class="nav-item"><span style="width:16px;text-align:center">✦</span>업무도구 홈 <span class="badge-teal" style="margin-left:auto">BETA</span></div>
      ${TOOLS.map(navItem).join('')}`;
    nav.appendChild(group);
  }

  function pageShell(id, title, subtitle, body) {
    return `<section id="page-${id}" class="page-section bt-shell space-y-4">
      <div class="bt-title"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="bt-btn bt-btn-secondary no-print" onclick="goPage('biz-hub')">업무도구 홈</button></div>${body}</section>`;
  }

  function injectPages() {
    const main = document.getElementById('main-content');
    if (!main || document.getElementById('page-biz-hub')) return;
    const holder = document.createElement('div');
    holder.id = 'business-tools-pages';
    holder.innerHTML = [
      hubPage(), dilutionPage(), marginPage(), moqPage(), exportPricePage(), exportDocPage(),
      roasPage(), allergenPage(), skuPage(), lotPage(), productEnglishPage()
    ].join('');
    while (holder.firstChild) main.appendChild(holder.firstChild);
  }

  function hubPage() {
    return `<section id="page-biz-hub" class="page-section bt-shell space-y-4">
      <div class="bt-hub-hero"><div><h2>MEDISCENT Business Tools</h2><p>ERP에 등록된 제품·원가·처방·고객·LOT을 다시 입력하지 않고 가격 결정부터 수출 문서까지 연결합니다.</p></div><span class="bt-variant">실험안 <b id="bt-current-variant">${getVariant()}</b> · ${TOOL_VERSION}</span></div>
      <div id="bt-hub-layout"></div>
      <div class="bt-grid">
        <div class="bt-card"><h3>A/B 사용성 측정</h3><div id="bt-ab-results"></div><div class="bt-actions no-print"><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.switchVariant()">A/B 화면 전환</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.exportAbCsv()">결과 CSV</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveAbSummary()">ERP에 요약 저장</button><button class="bt-btn bt-btn-danger" onclick="MediscentTools.resetAb()">측정 초기화</button></div></div>
        <div class="bt-card"><h3>측정 기준</h3><div class="bt-note">A안은 기능을 한눈에 찾는 카드형, B안은 실제 업무 순서 중심 화면입니다. 도구 선택률·완료율·완료시간·오류를 기록합니다. 같은 기기에서만 원시 데이터가 보존되며, ‘ERP에 요약 저장’을 눌렀을 때 집계값만 클라우드 데이터에 포함됩니다.</div><div class="bt-alert bt-alert-amber"><b>통계 해석 주의</b><span>내부 사용자 수가 적으면 전환율 차이만으로 승자를 정하면 안 됩니다. 최소 20회 이상의 실제 업무 완료와 사용자 인터뷰를 함께 보세요.</span></div></div>
      </div>
    </section>`;
  }

  function productSelect(id, onchange = '') {
    return `<select id="${id}" class="bt-select" ${onchange ? `onchange="${onchange}"` : ''}><option value="">직접 입력</option>${optionList(products(), 'productId', (p) => `${p.name || '-'} · ${p.spec || ''}`)}</select>`;
  }

  function dilutionPage() {
    return pageShell('biz-dilution', '향료 배합비·희석률 계산기', '원액 농도와 제조 손실을 반영해 실제 투입량을 계산합니다.', `
      <div class="bt-grid"><div class="bt-card"><h3>제조 조건</h3><div class="bt-fields">
        <div class="bt-field"><label>ERP 제품 불러오기</label>${productSelect('bt-dil-product', 'MediscentTools.loadDilutionProduct()')}</div>
        <div class="bt-field"><label>계산 단위</label><select id="bt-dil-unit" class="bt-select"><option value="g">g</option><option value="ml">ml</option><option value="kg">kg</option></select></div>
        <div class="bt-field"><label>최종 필요량</label><input id="bt-dil-final" class="bt-input" type="number" step="0.01" value="1000"></div>
        <div class="bt-field"><label>목표 향료 농도 (%)</label><input id="bt-dil-target" class="bt-input" type="number" step="0.01" value="20"></div>
        <div class="bt-field"><label>보유 원액 농도 (%)</label><input id="bt-dil-stock" class="bt-input" type="number" step="0.01" value="100"><small>희석 향료를 쓰는 경우 실제 농도 입력</small></div>
        <div class="bt-field"><label>제조 손실·여유율 (%)</label><input id="bt-dil-loss" class="bt-input" type="number" step="0.01" value="2"></div>
        <div class="bt-field"><label>1개 충진량</label><input id="bt-dil-fill" class="bt-input" type="number" step="0.01" value="50"></div>
        <div class="bt-field"><label>비중 (ml→g 환산)</label><input id="bt-dil-density" class="bt-input" type="number" step="0.001" value="0.87"></div>
      </div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.calcDilution()">계산하기</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.addCompositionRow()">세부 배합 추가</button></div>
      <div class="bt-divider"></div><h3>세부 배합비 <span class="bt-note">합계 100%</span></h3><div id="bt-composition-rows"></div></div>
      <div class="bt-card bt-sticky"><h3>계산 결과</h3><div id="bt-dil-result" class="bt-result"></div><div id="bt-composition-result" style="margin-top:12px"></div><div class="bt-alert bt-alert-blue"><b>계산 기준</b><span>최종 필요량은 손실 후 확보하려는 순량입니다. 실제 제조 전 비중·온도·원료 COA와 작업표준서를 확인하세요.</span></div></div></div>`);
  }

  function marginPage() {
    return pageShell('biz-margin', '원가·마진·도매 공급률 계산기', '부가세·할인·판매수수료·물류비까지 반영한 실제 공헌이익을 계산합니다.', `
      <div class="bt-grid"><div class="bt-card"><h3>판매 조건</h3><div class="bt-fields">
        <div class="bt-field"><label>ERP 제품 불러오기</label>${productSelect('bt-margin-product', 'MediscentTools.loadMarginProduct()')}</div>
        <div class="bt-field"><label>제조원가</label><input id="bt-margin-cogs" class="bt-input" type="number" value="18000"></div>
        <div class="bt-field"><label>소비자가 (VAT 포함)</label><input id="bt-margin-retail" class="bt-input" type="number" value="90000"></div>
        <div class="bt-field"><label>공급률 (%)</label><input id="bt-margin-supply" class="bt-input" type="number" step="0.1" value="100"><small>자사몰 100, 도매 40 등</small></div>
        <div class="bt-field"><label>소비자 할인율 (%)</label><input id="bt-margin-discount" class="bt-input" type="number" step="0.1" value="0"></div>
        <div class="bt-field"><label>판매수수료 (%)</label><input id="bt-margin-platform" class="bt-input" type="number" step="0.1" value="30"></div>
        <div class="bt-field"><label>결제수수료 (%)</label><input id="bt-margin-payment" class="bt-input" type="number" step="0.1" value="0"></div>
        <div class="bt-field"><label>출고·택배비</label><input id="bt-margin-fulfillment" class="bt-input" type="number" value="3000"></div>
        <div class="bt-field"><label>기타 변동비</label><input id="bt-margin-other" class="bt-input" type="number" value="0"></div>
        <div class="bt-field"><label>부가세율 (%)</label><input id="bt-margin-vat" class="bt-input" type="number" value="10"></div>
      </div><label class="bt-check" style="margin-top:12px"><input id="bt-margin-vat-included" type="checkbox" checked> 입력 판매가는 부가세 포함</label><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.calcMargin()">실제 마진 계산</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveMarginToProduct()">제품에 공급조건 저장</button></div></div>
      <div class="bt-card bt-sticky"><h3>채널 손익</h3><div id="bt-margin-result" class="bt-result"></div><div id="bt-margin-guide"></div></div></div>`);
  }

  function moqPage() {
    return pageShell('biz-moq', 'MOQ별 손익 시뮬레이터', '수량별 단가·고정비·불량률·월 판매량을 비교해 현금회수 위험을 봅니다.', `
      <div class="bt-card"><div class="bt-toolbar"><label class="bt-note">ERP 제품</label>${productSelect('bt-moq-product', 'MediscentTools.loadMoqProduct()')}<label class="bt-note">판매단가</label><input id="bt-moq-price" class="bt-input" type="number" value="27000"><label class="bt-note">판매변동비/개</label><input id="bt-moq-variable" class="bt-input" type="number" value="2000"><label class="bt-note">월 예상판매</label><input id="bt-moq-monthly" class="bt-input" type="number" value="100"><label class="bt-note">불량률 %</label><input id="bt-moq-defect" class="bt-input" type="number" step="0.1" value="2"><button class="bt-btn" onclick="MediscentTools.calcMoq()">비교 계산</button></div></div>
      <div class="bt-card"><div class="bt-title"><div><h3>MOQ 시나리오</h3><p>업체 견적 단가와 금형·디자인·시험비 등 고정비를 입력하세요.</p></div><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.addMoqRow()">+ 시나리오</button></div><div id="bt-moq-rows" style="margin-top:12px"></div><div id="bt-moq-result" style="margin-top:14px"></div></div>`);
  }

  function exportPricePage() {
    return pageShell('biz-export-price', '환율 적용 수출가 계산기', '한국 소비자가 공급률과 원가 하한을 함께 보고 현지 예상 소비자가까지 계산합니다.', `
      <div class="bt-grid"><div class="bt-card"><h3>수출 조건</h3><div class="bt-fields">
        <div class="bt-field"><label>ERP 제품 불러오기</label>${productSelect('bt-exp-product', 'MediscentTools.loadExportProduct()')}</div>
        <div class="bt-field"><label>통화</label><select id="bt-exp-currency" class="bt-select" onchange="MediscentTools.applySavedRate()"><option>USD</option><option>EUR</option><option>JPY</option><option>GBP</option><option>TRY</option><option>THB</option><option>CNY</option></select></div>
        <div class="bt-field"><label>한국 소비자가 (원)</label><input id="bt-exp-retail" class="bt-input" type="number" value="90000"></div>
        <div class="bt-field"><label>제조원가 (원)</label><input id="bt-exp-cogs" class="bt-input" type="number" value="15000"></div>
        <div class="bt-field"><label>수출 공급률 (%)</label><input id="bt-exp-supply" class="bt-input" type="number" step="0.1" value="27"></div>
        <div class="bt-field"><label>외화 1단위당 원화</label><input id="bt-exp-rate" class="bt-input" type="number" step="0.01" value="1350"><small>견적에 적용할 고정 환율</small></div>
        <div class="bt-field"><label>환율 안전버퍼 (%)</label><input id="bt-exp-buffer" class="bt-input" type="number" step="0.1" value="3"></div>
        <div class="bt-field"><label>단위당 국제물류비 (원)</label><input id="bt-exp-logistics" class="bt-input" type="number" value="2000"></div>
        <div class="bt-field"><label>관세·통관비율 (%)</label><input id="bt-exp-duty" class="bt-input" type="number" step="0.1" value="6.5"></div>
        <div class="bt-field"><label>수입사 마진율 (%)</label><input id="bt-exp-importer" class="bt-input" type="number" value="35"></div>
        <div class="bt-field"><label>현지 리테일러 마진율 (%)</label><input id="bt-exp-retailer" class="bt-input" type="number" value="50"></div>
        <div class="bt-field"><label>현지 VAT (%)</label><input id="bt-exp-vat" class="bt-input" type="number" value="20"></div>
      </div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.calcExportPrice()">수출가 계산</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveExchangeRate()">환율 저장</button></div></div>
      <div class="bt-card bt-sticky"><h3>가격 사다리</h3><div id="bt-exp-result" class="bt-result"></div><div id="bt-exp-guide"></div><div class="bt-alert bt-alert-amber"><b>견적 기준</b><span>실시간 환율이 아니라 계약에 사용할 고정 환율과 버퍼를 입력합니다. 관세·VAT·현지 마진은 국가와 계약조건별로 다시 확인해야 합니다.</span></div></div></div>`);
  }

  function exportDocPage() {
    return pageShell('biz-export-doc', '수출 견적서·인보이스 생성기', 'ERP 고객·제품을 불러와 Quotation 또는 Proforma Invoice를 영문으로 발행합니다.', `
      <div class="bt-grid"><div class="bt-card no-print"><h3>문서 정보</h3><div class="bt-fields">
        <div class="bt-field"><label>문서 유형</label><select id="bt-doc-type" class="bt-select"><option value="QUOTATION">QUOTATION</option><option value="PROFORMA INVOICE">PROFORMA INVOICE</option><option value="COMMERCIAL INVOICE">COMMERCIAL INVOICE</option></select></div>
        <div class="bt-field"><label>문서번호</label><input id="bt-doc-no" class="bt-input"></div>
        <div class="bt-field"><label>고객사</label><select id="bt-doc-customer" class="bt-select" onchange="MediscentTools.loadExportCustomer()"><option value="">직접 입력</option>${optionList(customers(), 'customerId', (c) => c.name || '-')}</select></div>
        <div class="bt-field"><label>고객 국가</label><input id="bt-doc-country" class="bt-input" placeholder="Türkiye"></div>
        <div class="bt-field"><label>Buyer / Consignee</label><input id="bt-doc-buyer-name" class="bt-input" placeholder="Buyer company name"></div>
        <div class="bt-field"><label>Buyer Email</label><input id="bt-doc-buyer-email" class="bt-input" type="email"></div>
        <div class="bt-field"><label>통화</label><select id="bt-doc-currency" class="bt-select"><option>USD</option><option>EUR</option><option>JPY</option><option>GBP</option><option>TRY</option><option>THB</option><option>CNY</option></select></div>
        <div class="bt-field"><label>Incoterms</label><select id="bt-doc-incoterm" class="bt-select"><option>EXW</option><option>FCA</option><option>FOB</option><option>CIF</option><option>DAP</option><option>DDP</option></select></div>
        <div class="bt-field"><label>발행일</label><input id="bt-doc-date" class="bt-input" type="date" value="${today()}"></div>
        <div class="bt-field"><label>유효기간 (일)</label><input id="bt-doc-valid" class="bt-input" type="number" value="30"></div>
        <div class="bt-field"><label>결제조건</label><input id="bt-doc-payment" class="bt-input" value="50% T/T deposit, 50% before shipment"></div>
        <div class="bt-field"><label>리드타임</label><input id="bt-doc-lead" class="bt-input" value="Within 30 days after deposit"></div>
      </div><div class="bt-field" style="margin-top:12px"><label>Buyer Address</label><textarea id="bt-doc-buyer-address" class="bt-textarea" rows="2"></textarea></div><div class="bt-divider"></div><div class="bt-title"><h3>품목</h3><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.addExportDocRow()">+ 품목</button></div><div id="bt-doc-rows"></div><div class="bt-fields"><div class="bt-field"><label>운임</label><input id="bt-doc-freight" class="bt-input" type="number" value="0"></div><div class="bt-field"><label>할인</label><input id="bt-doc-discount" class="bt-input" type="number" value="0"></div></div><div class="bt-field" style="margin-top:12px"><label>Bank Details</label><textarea id="bt-doc-bank" class="bt-textarea" rows="3" placeholder="Bank / Account No. / SWIFT"></textarea></div><div class="bt-field" style="margin-top:12px"><label>비고</label><textarea id="bt-doc-note" class="bt-textarea" rows="3">Prices do not include destination duties and taxes unless otherwise stated.</textarea></div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.renderExportDoc()">미리보기</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveExportDoc()">ERP에 저장</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.printDocument()">PDF/인쇄</button></div></div>
      <div id="bt-doc-preview" class="bt-doc-stage"></div></div>`);
  }

  function roasPage() {
    return pageShell('biz-roas', '인플루언서 ROAS 계산기', '조회수 중심의 허수 ROAS가 아니라 제품 원가와 사용권 비용을 포함한 이익 기준을 계산합니다.', `
      <div class="bt-grid"><div class="bt-card"><h3>캠페인 비용·성과</h3><div class="bt-fields">
        <div class="bt-field"><label>콘텐츠 지급액</label><input id="bt-roas-fee" class="bt-input" type="number" value="2800"></div>
        <div class="bt-field"><label>통화 표시</label><input id="bt-roas-currency" class="bt-input" value="USD"></div>
        <div class="bt-field"><label>제공 제품 원가</label><input id="bt-roas-gift" class="bt-input" type="number" value="100"></div>
        <div class="bt-field"><label>배송·통관비</label><input id="bt-roas-ship" class="bt-input" type="number" value="80"></div>
        <div class="bt-field"><label>별도 제작비</label><input id="bt-roas-production" class="bt-input" type="number" value="0"></div>
        <div class="bt-field"><label>광고 사용권 비용</label><input id="bt-roas-rights" class="bt-input" type="number" value="0"></div>
        <div class="bt-field"><label>조회수</label><input id="bt-roas-views" class="bt-input" type="number" value="100000"></div>
        <div class="bt-field"><label>링크 클릭</label><input id="bt-roas-clicks" class="bt-input" type="number" value="1500"></div>
        <div class="bt-field"><label>구매건수</label><input id="bt-roas-orders" class="bt-input" type="number" value="60"></div>
        <div class="bt-field"><label>추적 매출액</label><input id="bt-roas-revenue" class="bt-input" type="number" value="6000"></div>
        <div class="bt-field"><label>매출총이익률 (%)</label><input id="bt-roas-gm" class="bt-input" type="number" value="70"></div>
        <div class="bt-field"><label>LTV 배수</label><input id="bt-roas-ltv" class="bt-input" type="number" step="0.1" value="1"></div>
      </div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.calcRoas()">성과 계산</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveRoasScenario()">시나리오 저장</button></div></div>
      <div class="bt-card bt-sticky"><h3>캠페인 판정</h3><div id="bt-roas-result" class="bt-result"></div><div id="bt-roas-guide"></div></div></div>`);
  }

  function allergenPage() {
    return pageShell('biz-allergen', '화장품 전성분·알레르겐 정리', '향료사 Allergen Declaration의 원료 내 함량을 입력해 최종제품 농도로 환산합니다.', `
      <div class="bt-card"><div class="bt-toolbar"><label class="bt-note">제품</label>${productSelect('bt-alg-product', 'MediscentTools.loadAllergenProduct()')}<label class="bt-note">제품 유형</label><select id="bt-alg-type" class="bt-select"><option value="leave-on">Leave-on · 0.001%</option><option value="rinse-off">Rinse-off · 0.01%</option></select><button class="bt-btn" onclick="MediscentTools.calcAllergens()">최종 함량 계산</button></div></div>
      <div class="bt-grid"><div class="bt-card"><h3>향료별 알레르겐 자료 입력</h3><div class="bt-fields"><div class="bt-field"><label>제품 내 향료/원료</label><select id="bt-alg-raw" class="bt-select"></select></div><div class="bt-field"><label>제품 내 해당 원료 함량 (%)</label><input id="bt-alg-ingredient-pct" class="bt-input" type="number" step="0.0001"></div></div><div class="bt-divider"></div><div class="bt-title"><h3>원료사 성분표</h3><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.addAllergenRow()">+ 성분</button></div><div id="bt-alg-rows"></div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.saveRawAllergens()">원료 마스터에 저장</button></div><div class="bt-alert bt-alert-amber"><b>규제용 입력 원칙</b><span>향료 이름만으로 알레르겐 함량을 추정하지 않습니다. 공급사가 발행한 최신 Allergen Declaration의 수치를 그대로 입력하세요.</span></div></div>
      <div class="bt-card bt-sticky"><h3>최종제품 표시 검토</h3><div id="bt-alg-result"></div></div></div>`);
  }

  function skuPage() {
    return pageShell('biz-sku', '바코드·SKU 생성기', '내부관리용 SKU와 GS1에서 발급받은 GTIN을 분리해 관리합니다.', `
      <div class="bt-grid"><div class="bt-card"><h3>제품 식별정보</h3><div class="bt-fields">
        <div class="bt-field"><label>ERP 제품 불러오기</label>${productSelect('bt-sku-product', 'MediscentTools.loadSkuProduct()')}</div>
        <div class="bt-field"><label>브랜드</label><input id="bt-sku-brand" class="bt-input" value="SHIFTI"></div>
        <div class="bt-field"><label>라인</label><input id="bt-sku-line" class="bt-input" value="STATE"></div>
        <div class="bt-field"><label>제품·향 코드</label><input id="bt-sku-item" class="bt-input" value="ANNE"></div>
        <div class="bt-field"><label>용량</label><input id="bt-sku-size" class="bt-input" value="50ML"></div>
        <div class="bt-field"><label>국가/버전</label><input id="bt-sku-market" class="bt-input" value="KR"></div>
        <div class="bt-field"><label>GS1 발급 12자리</label><input id="bt-gtin-base" class="bt-input" inputmode="numeric" maxlength="12" placeholder="체크디지트 제외 12자리"></div>
        <div class="bt-field"><label>또는 완성 GTIN-13</label><input id="bt-gtin-full" class="bt-input" inputmode="numeric" maxlength="13"></div>
      </div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.generateSku()">SKU·바코드 생성</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveSkuToProduct()">제품에 저장</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.downloadBarcode()">SVG 다운로드</button></div></div>
      <div class="bt-card bt-sticky"><h3>생성 결과</h3><div class="bt-note">내부 SKU</div><div id="bt-sku-code" class="bt-code">-</div><div class="bt-divider"></div><svg id="bt-barcode" style="max-width:100%;min-height:90px"></svg><div id="bt-gtin-status" class="bt-note"></div><div class="bt-alert bt-alert-blue"><b>중요</b><span>이 기능은 GTIN을 임의 발급하지 않습니다. GS1 Korea에서 배정받은 번호의 체크디지트 검증과 바코드 이미지 생성만 수행합니다.</span></div></div></div>`);
  }

  function lotPage() {
    return pageShell('biz-lot', '생산 LOT 관리표 생성기', '현재 ERP의 원료·포장재·벌크·완제품 LOT을 한 표에서 조회하고 작업용 엑셀로 내보냅니다.', `
      <div class="bt-card"><div class="bt-fields">
        <div class="bt-field"><label>LOT 유형</label><select id="bt-lot-type" class="bt-select" onchange="MediscentTools.renderLots()"><option value="ALL">전체</option><option value="RAW">원료</option><option value="PACK">포장재</option><option value="BULK">벌크</option><option value="FGT">완제품</option></select></div>
        <div class="bt-field"><label>상태</label><select id="bt-lot-status" class="bt-select" onchange="MediscentTools.renderLots()"><option value="ALL">전체</option><option>OK</option><option>HOLD</option><option>FAIL</option><option>EXPIRED</option></select></div>
        <div class="bt-field"><label>신규 LOT 제품</label>${productSelect('bt-lot-product')}</div>
        <div class="bt-field"><label>제조일</label><input id="bt-lot-date" class="bt-input" type="date" value="${today()}"></div>
        <div class="bt-field"><label>순번</label><input id="bt-lot-seq" class="bt-input" type="number" value="1"></div>
        <div class="bt-field"><label>검색</label><input id="bt-lot-search" class="bt-input" placeholder="LOT·제품명" oninput="MediscentTools.renderLots()"></div>
      </div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.generateLotCode()">신규 LOT 코드</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.exportLotsXlsx()">엑셀 내보내기</button></div><div id="bt-lot-generated" class="bt-code" style="margin-top:12px">-</div></div>
      <div class="bt-card"><div id="bt-lot-summary" class="bt-inline-kpi"></div><div id="bt-lot-table" style="margin-top:12px"></div></div>`);
  }

  function productEnglishPage() {
    return pageShell('biz-product-en', '영문 제품정보서 생성기', 'ERP 제품·전성분·회사정보를 불러와 바이어 전달용 영문 원페이지를 생성합니다.', `
      <div class="bt-grid"><div class="bt-card no-print"><h3>영문 정보</h3><div class="bt-fields">
        <div class="bt-field"><label>ERP 제품</label>${productSelect('bt-en-product', 'MediscentTools.loadEnglishProduct()')}</div>
        <div class="bt-field"><label>Brand</label><input id="bt-en-brand" class="bt-input" value="SHIFTI"></div>
        <div class="bt-field"><label>Product Name</label><input id="bt-en-name" class="bt-input"></div>
        <div class="bt-field"><label>Category</label><input id="bt-en-category" class="bt-input" value="Eau de Parfum"></div>
        <div class="bt-field"><label>Net Content</label><input id="bt-en-net" class="bt-input" value="50 mL / 1.69 fl. oz."></div>
        <div class="bt-field"><label>Country of Origin</label><input id="bt-en-origin" class="bt-input" value="Republic of Korea"></div>
        <div class="bt-field"><label>HS Code</label><input id="bt-en-hs" class="bt-input" placeholder="3303.00"></div>
      </div><div class="bt-field" style="margin-top:12px"><label>Product Description</label><textarea id="bt-en-description" class="bt-textarea" rows="3"></textarea></div><div class="bt-field" style="margin-top:12px"><label>Directions</label><textarea id="bt-en-directions" class="bt-textarea" rows="2">Spray onto pulse points from a distance of 15–20 cm. Avoid rubbing after application.</textarea></div><div class="bt-field" style="margin-top:12px"><label>Warnings</label><textarea id="bt-en-warnings" class="bt-textarea" rows="3">For external use only. Avoid contact with eyes. Keep out of reach of children. Flammable. Keep away from heat and flame.</textarea></div><div class="bt-field" style="margin-top:12px"><label>Ingredients (INCI)</label><textarea id="bt-en-inci" class="bt-textarea" rows="4"></textarea></div><div class="bt-field" style="margin-top:12px"><label>Responsible Company / Manufacturer</label><textarea id="bt-en-company" class="bt-textarea" rows="3"></textarea></div><div class="bt-actions"><button class="bt-btn" onclick="MediscentTools.renderEnglishProduct()">미리보기</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.saveEnglishProduct()">제품에 저장</button><button class="bt-btn bt-btn-secondary" onclick="MediscentTools.printDocument()">PDF/인쇄</button></div></div>
      <div id="bt-en-preview" class="bt-doc-stage"></div></div>`);
  }

  function renderHub() {
    const host = document.getElementById('bt-hub-layout');
    if (!host) return;
    const variant = getVariant();
    document.getElementById('page-biz-hub')?.classList.toggle('bt-variant-b', variant === 'B');
    document.getElementById('bt-current-variant').textContent = variant;
    if (variant === 'A') {
      host.innerHTML = `<div class="bt-tool-grid">${TOOLS.map((tool) => `<div class="bt-tool-card" onclick="goPage('${tool.id}')"><i>${tool.icon}</i><em>${e(tool.group)}</em><b>${e(tool.name)}</b><span>${e(tool.desc)}</span></div>`).join('')}</div>`;
    } else {
      const flow = [
        ['1', '제품 설계', 'biz-dilution', '배합·전성분·SKU'],
        ['2', '가격 결정', 'biz-margin', '원가·MOQ·수출가'],
        ['3', '판매 준비', 'biz-export-doc', '견적·인보이스·제품정보'],
        ['4', '성과 검토', 'biz-roas', 'ROAS·LOT·실적']
      ];
      host.innerHTML = `<div class="bt-flow">${flow.map((step) => `<div class="bt-flow-step" onclick="goPage('${step[2]}')"><small>STEP ${step[0]}</small><b>${step[1]}</b><span>${step[3]}</span></div>`).join('')}</div><div class="bt-tool-grid" style="margin-top:12px">${TOOLS.map((tool) => `<div class="bt-tool-card" onclick="goPage('${tool.id}')"><em>${e(tool.group)}</em><b>${tool.icon} ${e(tool.name)}</b><span>${e(tool.desc)}</span></div>`).join('')}</div>`;
    }
    updateAbPanel();
  }

  function updateAbPanel() {
    const host = document.getElementById('bt-ab-results');
    if (!host) return;
    const events = getEvents();
    const stats = ['A', 'B'].map((variant) => {
      const rows = events.filter((event) => event.variant === variant);
      const sessions = new Set(rows.map((row) => row.session)).size;
      const opens = rows.filter((row) => row.event === 'tool_open').length;
      const completes = rows.filter((row) => row.event === 'complete');
      const errors = rows.filter((row) => row.event === 'error').length;
      const avgMs = completes.length ? completes.reduce((sum, row) => sum + M.finite(row.taskMs), 0) / completes.length : 0;
      return { variant, sessions, opens, completes: completes.length, errors, avgMs, rate: opens ? completes.length / opens * 100 : 0 };
    });
    const maxRate = Math.max(1, ...stats.map((item) => item.rate));
    host.innerHTML = `<div class="bt-ab-bars">${stats.map((item) => `<div class="bt-ab-row"><b>${item.variant}</b><div class="bt-ab-track"><div class="bt-ab-fill" style="width:${item.rate / maxRate * 100}%"></div></div><strong>${item.rate.toFixed(1)}%</strong></div>`).join('')}</div>
      <div class="bt-table-wrap" style="margin-top:12px"><table class="bt-table" style="min-width:520px"><thead><tr><th>안</th><th>세션</th><th>도구 열기</th><th>완료</th><th>오류</th><th>평균 완료시간</th></tr></thead><tbody>${stats.map((item) => `<tr><td><b>${item.variant}</b></td><td>${item.sessions}</td><td>${item.opens}</td><td>${item.completes}</td><td>${item.errors}</td><td>${item.avgMs ? `${(item.avgMs / 1000).toFixed(1)}초` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function switchVariant() {
    const next = getVariant() === 'A' ? 'B' : 'A';
    localStorage.setItem(VARIANT_KEY, next);
    track('variant_switch', 'biz-hub', { to: next });
    renderHub();
  }

  function resetAb() {
    if (!confirm('이 기기에 저장된 A/B 측정 기록만 초기화할까요? ERP 업무 데이터는 삭제되지 않습니다.')) return;
    localStorage.removeItem(EVENT_KEY);
    updateAbPanel();
    notify('A/B 측정 기록을 초기화했습니다.');
  }

  function exportAbCsv() {
    const events = getEvents();
    const headers = ['at', 'session', 'variant', 'event', 'tool', 'elapsedMs', 'taskMs'];
    const csv = [headers.join(','), ...events.map((row) => headers.map((key) => JSON.stringify(row[key] == null ? '' : row[key])).join(','))].join('\n');
    downloadBlob(csv, `mediscent-ab-${today()}.csv`, 'text/csv;charset=utf-8');
    track('export', 'biz-hub', { format: 'csv' });
  }

  function saveAbSummary() {
    if (!window.db) return;
    window.db.tools = window.db.tools || {};
    const events = getEvents();
    window.db.tools.abSummary = {
      savedAt: new Date().toISOString(),
      deviceEvents: events.length,
      byVariant: ['A', 'B'].map((variant) => ({
        variant,
        opens: events.filter((x) => x.variant === variant && x.event === 'tool_open').length,
        completes: events.filter((x) => x.variant === variant && x.event === 'complete').length,
        errors: events.filter((x) => x.variant === variant && x.event === 'error').length
      }))
    };
    persist('업무도구 A/B 측정 요약 저장');
    notify('A/B 요약을 ERP에 저장했습니다.');
  }

  function downloadBlob(content, name, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function initializeRows() {
    if (!document.querySelector('#bt-composition-rows .bt-row')) {
      addCompositionRow({ name: '향료 원액', percent: 20 });
      addCompositionRow({ name: '에탄올', percent: 78 });
      addCompositionRow({ name: '정제수/용제', percent: 2 });
    }
    if (!document.querySelector('#bt-moq-rows .bt-row')) {
      addMoqRow({ moq: 500, unitCost: 15000, fixedCost: 1500000 });
      addMoqRow({ moq: 1000, unitCost: 13000, fixedCost: 1500000 });
      addMoqRow({ moq: 3000, unitCost: 10500, fixedCost: 1500000 });
    }
    if (!document.querySelector('#bt-doc-rows .bt-row')) addExportDocRow();
    if (!document.querySelector('#bt-alg-rows .bt-row')) addAllergenRow();
    document.getElementById('bt-doc-no').value ||= `QT-${today().replace(/-/g, '')}-001`;
  }

  function wrapNavigation() {
    const original = window.goPage;
    if (!original || original._businessToolsWrapped) return;
    const wrapped = function (id) {
      const previous = activeTool;
      original(id);
      if (id === 'biz-hub' || TOOLS.some((tool) => tool.id === id)) {
        activeTool = id;
        activeToolStartedAt = Date.now();
        track(id === 'biz-hub' ? 'hub_view' : 'tool_open', id, { from: previous });
        refreshPage(id);
        document.getElementById('main-content')?.scrollTo?.({ top: 0, behavior: 'instant' });
      }
    };
    wrapped._businessToolsWrapped = true;
    window.goPage = wrapped;
  }

  function refreshPage(id) {
    refreshDataOptions();
    if (id === 'biz-hub') renderHub();
    if (id === 'biz-lot') renderLots();
    if (id === 'biz-export-doc') renderExportDoc();
    if (id === 'biz-sku') generateSku();
    if (id === 'biz-product-en') renderEnglishProduct();
  }

  function refreshDataOptions() {
    const productIds = ['bt-dil-product', 'bt-margin-product', 'bt-moq-product', 'bt-exp-product', 'bt-alg-product', 'bt-sku-product', 'bt-lot-product', 'bt-en-product'];
    productIds.forEach((id) => {
      const select = document.getElementById(id); if (!select) return;
      const current = select.value;
      select.innerHTML = `<option value="">${id === 'bt-lot-product' ? '제품 선택' : '직접 입력'}</option>${optionList(products(), 'productId', (p) => `${p.name || '-'} · ${p.spec || ''}`)}`;
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    });
    const customer = document.getElementById('bt-doc-customer');
    if (customer) {
      const current = customer.value;
      customer.innerHTML = `<option value="">직접 입력</option>${optionList(customers(), 'customerId', (c) => c.name || '-')}`;
      if ([...customer.options].some((option) => option.value === current)) customer.value = current;
    }
    document.querySelectorAll('.bt-doc-product').forEach((select) => {
      const current = select.value;
      select.innerHTML = `<option value="">제품 선택</option>${optionList(products(), 'productId', (p) => `${p.name || '-'} · ${p.spec || ''}`)}`;
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    });
  }

  function addCompositionRow(data = {}) {
    const host = document.getElementById('bt-composition-rows');
    if (!host) return;
    const row = document.createElement('div');
    row.className = 'bt-row bt-composition-row';
    row.innerHTML = `<input class="bt-input bt-comp-name" placeholder="성분명" value="${e(data.name || '')}"><input class="bt-input bt-comp-pct" type="number" step="0.001" placeholder="%" value="${e(data.percent ?? '')}"><span class="bt-note bt-comp-amount">-</span><button class="bt-btn bt-btn-danger" type="button" onclick="this.parentElement.remove()">×</button>`;
    host.appendChild(row);
  }

  function loadDilutionProduct() {
    const product = productById(v('bt-dil-product'));
    if (!product) return;
    const fill = M.finite(product.fillWeight) || parseFloat(String(product.spec || '').match(/[\d.]+/)?.[0]) || 50;
    document.getElementById('bt-dil-fill').value = fill;
    const rawBom = (product.bom || []).filter((row) => row.type === 'RAW');
    const total = rawBom.reduce((sum, row) => sum + M.finite(row.qty), 0);
    if (total > 0) {
      const target = rawBom.filter((row) => !/alcohol|ethanol|water|aqua|정제수|에탄올/i.test(`${rawById(row.itemId)?.name || ''} ${rawById(row.itemId)?.inci || ''}`)).reduce((sum, row) => sum + M.finite(row.qty), 0);
      document.getElementById('bt-dil-target').value = target || total;
      const host = document.getElementById('bt-composition-rows'); host.innerHTML = '';
      rawBom.forEach((row) => addCompositionRow({ name: rawById(row.itemId)?.name || `원료 ${row.itemId}`, percent: row.qty }));
    }
    calcDilution();
  }

  function calcDilution() {
    try {
      const result = M.dilution({ finalAmount: n('bt-dil-final'), targetPercent: n('bt-dil-target'), stockPercent: n('bt-dil-stock', 100), lossPercent: n('bt-dil-loss') });
      const unit = v('bt-dil-unit') || 'g';
      const fill = n('bt-dil-fill');
      const density = n('bt-dil-density', 1);
      const finalInUnit = n('bt-dil-final');
      const finalWeight = unit === 'ml' ? finalInUnit * density : unit === 'kg' ? finalInUnit * 1000 : finalInUnit;
      const fillWeight = unit === 'ml' ? fill * density : unit === 'kg' ? fill * 1000 : fill;
      const units = fillWeight > 0 ? Math.floor(finalWeight / fillWeight) : 0;
      document.getElementById('bt-dil-result').innerHTML = [
        metric('손실 포함 총 제조량', money(result.grossAmount, unit), 'bt-accent'),
        metric('향료 원액 투입량', money(result.stockAmount, unit)),
        metric('희석제 투입량', money(result.diluentAmount, unit)),
        metric('예상 제조 손실', money(result.expectedLoss, unit)),
        metric('순수 향 성분량', money(result.pureAromaticAmount, unit)),
        metric('예상 충진 가능 수량', `${units.toLocaleString()}개`)
      ].join('');
      const rows = Array.from(document.querySelectorAll('.bt-composition-row')).map((row) => ({ name: row.querySelector('.bt-comp-name').value || '성분', percent: M.finite(row.querySelector('.bt-comp-pct').value), element: row }));
      if (rows.length) {
        const batch = M.batchComposition({ finalAmount: n('bt-dil-final'), lossPercent: n('bt-dil-loss'), components: rows });
        batch.components.forEach((item, index) => { rows[index].element.querySelector('.bt-comp-amount').textContent = `${item.amount.toLocaleString()} ${unit}`; });
        document.getElementById('bt-composition-result').innerHTML = `<div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>성분</th><th class="text-right">배합비</th><th class="text-right">실제 투입량</th></tr></thead><tbody>${batch.components.map((item) => `<tr><td><b>${e(item.name)}</b></td><td class="text-right">${item.percent.toFixed(3)}%</td><td class="text-right">${item.amount.toLocaleString()} ${e(unit)}</td></tr>`).join('')}</tbody></table></div>`;
      }
      markComplete('biz-dilution', { finalAmount: n('bt-dil-final') });
    } catch (error) { showError('bt-dil-result', error); }
  }

  function loadMarginProduct() {
    const product = productById(v('bt-margin-product'));
    if (!product) return;
    document.getElementById('bt-margin-cogs').value = Math.round(productCost(product));
    document.getElementById('bt-margin-retail').value = M.finite(product.salePrice || product.price);
    if (product.channelTerms) {
      document.getElementById('bt-margin-supply').value = M.finite(product.channelTerms.supplyRate, 100);
      document.getElementById('bt-margin-platform').value = M.finite(product.channelTerms.platformFeeRate);
      document.getElementById('bt-margin-fulfillment').value = M.finite(product.channelTerms.fulfillment);
    }
    calcMargin();
  }

  function calcMargin() {
    try {
      const result = M.costMargin({
        retailPrice: n('bt-margin-retail'), cogs: n('bt-margin-cogs'), fulfillment: n('bt-margin-fulfillment'),
        otherVariable: n('bt-margin-other'), discountRate: n('bt-margin-discount'), wholesaleRate: n('bt-margin-supply', 100),
        platformFeeRate: n('bt-margin-platform'), paymentFeeRate: n('bt-margin-payment'), vatRate: n('bt-margin-vat', 10),
        vatIncluded: checked('bt-margin-vat-included')
      });
      document.getElementById('bt-margin-result').innerHTML = [
        metric('채널 판매금액', won(result.channelRevenue), 'bt-accent'), metric('VAT 제외 매출', won(result.netRevenue)),
        metric('판매·결제 수수료', won(result.fees)), metric('원가·물류·기타비', won(result.variableCost)),
        metric('개당 공헌이익', won(result.contribution), resultClass(result.contribution)),
        metric('공헌이익률', pct(result.marginRate), resultClass(result.marginRate)),
        metric('원가 대비 마크업', pct(result.markupRate)), metric('손익분기 소비자가', won(result.breakEvenRetail))
      ].join('');
      const risk = result.marginRate < 10 ? ['bt-alert-red', '위험', '가격 인하나 추가 수수료가 발생하면 손실 가능성이 높습니다.'] : result.marginRate < 25 ? ['bt-alert-amber', '주의', '판촉·반품·환차손을 감안한 안전마진이 충분한지 확인하세요.'] : ['bt-alert-blue', '양호', '현재 입력 기준 공헌이익은 확보됩니다. 고정비와 광고비는 별도입니다.'];
      document.getElementById('bt-margin-guide').innerHTML = `<div class="bt-alert ${risk[0]}"><b>${risk[1]}</b><span>${risk[2]}</span></div>`;
      markComplete('biz-margin', { marginRate: result.marginRate });
      return result;
    } catch (error) { showError('bt-margin-result', error); return null; }
  }

  function saveMarginToProduct() {
    const product = productById(v('bt-margin-product'));
    if (!product) { notify('저장할 ERP 제품을 선택하세요.', 'error'); return; }
    product.channelTerms = {
      supplyRate: n('bt-margin-supply', 100), platformFeeRate: n('bt-margin-platform'), paymentFeeRate: n('bt-margin-payment'),
      fulfillment: n('bt-margin-fulfillment'), otherVariable: n('bt-margin-other'), updatedAt: new Date().toISOString()
    };
    persist(`제품 공급조건 저장: ${product.name || product.productId}`);
    notify('제품 공급조건을 저장했습니다.');
  }

  function addMoqRow(data = {}) {
    const host = document.getElementById('bt-moq-rows'); if (!host) return;
    const row = document.createElement('div'); row.className = 'bt-row bt-moq-row';
    row.innerHTML = `<input class="bt-input bt-moq-qty" type="number" placeholder="MOQ" value="${e(data.moq ?? '')}"><input class="bt-input bt-moq-cost" type="number" placeholder="단가" value="${e(data.unitCost ?? '')}"><input class="bt-input bt-moq-fixed" type="number" placeholder="고정비" value="${e(data.fixedCost ?? '')}"><button class="bt-btn bt-btn-danger" onclick="this.parentElement.remove()">×</button>`;
    host.appendChild(row);
  }

  function loadMoqProduct() {
    const product = productById(v('bt-moq-product')); if (!product) return;
    document.getElementById('bt-moq-price').value = M.finite(product.salePrice || product.price);
    const cost = Math.round(productCost(product));
    document.querySelectorAll('.bt-moq-cost').forEach((input, index) => { if (!M.finite(input.value) || index === 0) input.value = Math.round(cost * [1, .9, .78][index] || cost); });
    calcMoq();
  }

  function calcMoq() {
    try {
      const scenarios = Array.from(document.querySelectorAll('.bt-moq-row')).map((row) => M.moqScenario({
        moq: M.finite(row.querySelector('.bt-moq-qty').value), unitCost: M.finite(row.querySelector('.bt-moq-cost').value),
        fixedCost: M.finite(row.querySelector('.bt-moq-fixed').value), sellingPrice: n('bt-moq-price'),
        variableSellingCost: n('bt-moq-variable'), defectRate: n('bt-moq-defect'), monthlySales: n('bt-moq-monthly')
      }));
      const viable = scenarios.filter((item) => Number.isFinite(item.cashRecoveryMonths));
      const best = viable.slice().sort((a, b) => a.cashRecoveryMonths - b.cashRecoveryMonths || b.projectedProfit - a.projectedProfit)[0];
      document.getElementById('bt-moq-result').innerHTML = `<div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>MOQ</th><th>판매가능</th><th class="text-right">초기 투자금</th><th class="text-right">예상 이익</th><th class="text-right">ROI</th><th class="text-right">손익분기 수량</th><th class="text-right">현금회수</th><th>판정</th></tr></thead><tbody>${scenarios.map((item) => `<tr><td><b>${item.moq.toLocaleString()}</b></td><td>${item.saleableUnits.toLocaleString()}</td><td class="text-right">${won(item.investment)}</td><td class="text-right ${resultClass(item.projectedProfit)}">${won(item.projectedProfit)}</td><td class="text-right">${pct(item.roi)}</td><td class="text-right">${Number.isFinite(item.breakEvenUnits) ? item.breakEvenUnits.toLocaleString() : '불가'}</td><td class="text-right">${Number.isFinite(item.cashRecoveryMonths) ? `${item.cashRecoveryMonths.toFixed(1)}개월` : '불가'}</td><td>${best === item ? '<span class="badge-teal">회수속도 우수</span>' : item.projectedProfit < 0 ? '<span class="status-badge status-fail">손실</span>' : '-'}</td></tr>`).join('')}</tbody></table></div><div class="bt-alert bt-alert-amber"><b>판단 기준</b><span>회수속도가 가장 빠른 MOQ가 반드시 최적 이익은 아닙니다. 보관 공간·유통기한·현금 여력을 함께 판단하세요.</span></div>`;
      markComplete('biz-moq', { scenarios: scenarios.length, bestMoq: best?.moq || 0 });
    } catch (error) { showError('bt-moq-result', error); }
  }

  function loadExportProduct() {
    const product = productById(v('bt-exp-product')); if (!product) return;
    document.getElementById('bt-exp-retail').value = M.finite(product.salePrice || product.price);
    document.getElementById('bt-exp-cogs').value = Math.round(productCost(product));
    document.getElementById('bt-exp-supply').value = M.finite(product.exportTerms?.supplyRate, 27);
    calcExportPrice();
  }

  function applySavedRate() {
    const currency = v('bt-exp-currency');
    const saved = window.db?.tools?.exchangeRates?.[currency];
    if (saved?.rate) document.getElementById('bt-exp-rate').value = saved.rate;
    calcExportPrice();
  }

  function calcExportPrice() {
    try {
      const currency = v('bt-exp-currency') || 'USD';
      const result = M.exportPrice({
        koreanRetail: n('bt-exp-retail'), supplyRate: n('bt-exp-supply'), cogs: n('bt-exp-cogs'), logisticsKrw: n('bt-exp-logistics'),
        krwPerCurrency: n('bt-exp-rate'), fxBuffer: n('bt-exp-buffer'), dutyRate: n('bt-exp-duty'), importerMargin: n('bt-exp-importer'),
        retailerMargin: n('bt-exp-retailer'), localVatRate: n('bt-exp-vat')
      });
      document.getElementById('bt-exp-result').innerHTML = [
        metric('수출 공급가(원)', won(result.wholesaleKrw), 'bt-accent'), metric('바이어 단가', money(result.exportUnitPrice, currency), 'bt-accent'),
        metric('물류·관세 포함 원가', money(result.landedCurrency, currency)), metric('수입사 공급가', money(result.importerSell, currency)),
        metric('현지 소비자가(VAT 전)', money(result.localRetailExVat, currency)), metric('현지 소비자가(VAT 포함)', money(result.localRetailIncVat, currency)),
        metric('메디센츠 공헌이익', won(result.contributionKrw), resultClass(result.contributionKrw)), metric('공헌이익률', pct(result.contributionRate), resultClass(result.contributionRate))
      ].join('');
      const belowCost = result.exportUnitPrice < result.costFloorCurrency;
      document.getElementById('bt-exp-guide').innerHTML = `<div class="bt-alert ${belowCost ? 'bt-alert-red' : result.contributionRate < 20 ? 'bt-alert-amber' : 'bt-alert-blue'}"><b>${belowCost ? '원가 미달' : '가격 검토'}</b><span>원가 하한은 약 ${money(result.costFloorCurrency, currency)}입니다. 현재 공급률은 한국 소비자가 대비 ${n('bt-exp-supply').toFixed(1)}%이며 환율 버퍼 ${n('bt-exp-buffer').toFixed(1)}%가 적용됐습니다.</span></div>`;
      markComplete('biz-export-price', { currency, unitPrice: result.exportUnitPrice });
      return result;
    } catch (error) { showError('bt-exp-result', error); return null; }
  }

  function saveExchangeRate() {
    window.db.tools = window.db.tools || {};
    window.db.tools.exchangeRates = window.db.tools.exchangeRates || {};
    window.db.tools.exchangeRates[v('bt-exp-currency')] = { rate: n('bt-exp-rate'), effectiveDate: today(), savedAt: new Date().toISOString() };
    const product = productById(v('bt-exp-product'));
    if (product) product.exportTerms = { ...(product.exportTerms || {}), supplyRate: n('bt-exp-supply') };
    persist(`수출 환율 저장: ${v('bt-exp-currency')} ${n('bt-exp-rate')}`);
    notify('견적 환율과 공급률을 저장했습니다.');
  }

  function addExportDocRow(data = {}) {
    const host = document.getElementById('bt-doc-rows'); if (!host) return;
    const row = document.createElement('div'); row.className = 'bt-row bt-doc-row';
    row.innerHTML = `<select class="bt-select bt-doc-product"><option value="">제품 선택</option>${optionList(products(), 'productId', (p) => `${p.name || '-'} · ${p.spec || ''}`)}</select><input class="bt-input bt-doc-qty" type="number" placeholder="Qty" value="${e(data.qty ?? 1)}"><input class="bt-input bt-doc-price" type="number" step="0.01" placeholder="Unit price" value="${e(data.price ?? '')}"><button class="bt-btn bt-btn-danger" onclick="this.parentElement.remove();MediscentTools.renderExportDoc()">×</button>`;
    host.appendChild(row);
    if (data.productId) row.querySelector('.bt-doc-product').value = data.productId;
    row.querySelector('.bt-doc-product').addEventListener('change', function () {
      const product = productById(this.value);
      const currency = v('bt-doc-currency') || 'USD';
      const rate = window.db?.tools?.exchangeRates?.[currency]?.rate || (currency === 'USD' ? 1350 : 1);
      const supply = M.finite(product?.exportTerms?.supplyRate, 27);
      row.querySelector('.bt-doc-price').value = product ? M.round(M.finite(product.salePrice || product.price) * supply / 100 / rate, 2) : '';
      renderExportDoc();
    });
    row.querySelectorAll('input,select').forEach((input) => input.addEventListener('input', renderExportDoc));
  }

  function loadExportCustomer() {
    const customer = customers().find((item) => String(item.customerId) === String(v('bt-doc-customer')));
    if (!customer) return;
    document.getElementById('bt-doc-buyer-name').value = customer.name || '';
    document.getElementById('bt-doc-buyer-email').value = customer.email || '';
    document.getElementById('bt-doc-buyer-address').value = customer.addr || customer.address || '';
    document.getElementById('bt-doc-country').value = customer.country || '';
    renderExportDoc();
  }

  function exportDocData() {
    const customer = customers().find((item) => String(item.customerId) === String(v('bt-doc-customer')));
    const items = Array.from(document.querySelectorAll('.bt-doc-row')).map((row) => {
      const product = productById(row.querySelector('.bt-doc-product').value);
      const qty = M.finite(row.querySelector('.bt-doc-qty').value);
      const price = M.finite(row.querySelector('.bt-doc-price').value);
      return product && qty > 0 ? { productId: product.productId, sku: product.code || '', name: product.name || '', spec: product.spec || '', hsCode: product.exportInfo?.hsCode || product.hsCode || '', qty, price, amount: qty * price } : null;
    }).filter(Boolean);
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const freight = n('bt-doc-freight'); const discount = n('bt-doc-discount');
    return {
      id: v('bt-doc-no'), type: v('bt-doc-type'), date: v('bt-doc-date'), validDays: n('bt-doc-valid'),
      customerId: customer?.customerId || null, customerName: v('bt-doc-buyer-name') || customer?.name || '', customerCountry: v('bt-doc-country'),
      customerEmail: v('bt-doc-buyer-email') || customer?.email || '', customerAddress: v('bt-doc-buyer-address') || customer?.addr || customer?.address || '', currency: v('bt-doc-currency'),
      incoterm: v('bt-doc-incoterm'), payment: v('bt-doc-payment'), leadTime: v('bt-doc-lead'), bank: v('bt-doc-bank'), note: v('bt-doc-note'),
      items, subtotal: M.round(subtotal, 2), freight, discount, total: M.round(subtotal + freight - discount, 2), updatedAt: new Date().toISOString()
    };
  }

  function companyData() {
    const c = window.db?.company || window.db?.config?.company || {};
    const doc = (() => { try { return JSON.parse(localStorage.getItem('shifti_doc_cfg') || '{}'); } catch (_) { return {}; } })();
    return {
      name: c.name || doc.company || 'MEDISCENTS Co., Ltd.', ceo: c.ceo || doc.manager || '',
      address: c.addr || c.address || doc.addr || '', email: c.email || '', tel: c.tel || '', bizNo: c.bizNo || c.bizno || ''
    };
  }

  function renderExportDoc() {
    const host = document.getElementById('bt-doc-preview'); if (!host) return;
    const doc = exportDocData(); const company = companyData();
    const rows = doc.items.map((item, index) => `<tr><td>${index + 1}</td><td><b>${e(item.name)}</b><br><span style="color:#64748b">${e(item.sku)}</span></td><td>${e(item.spec)}${item.hsCode ? `<br><span style="color:#64748b">HS ${e(item.hsCode)}</span>` : ''}</td><td style="text-align:right">${item.qty.toLocaleString()}</td><td style="text-align:right">${money(item.price)}</td><td style="text-align:right"><b>${money(item.amount)}</b></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Add products to this document.</td></tr>';
    host.innerHTML = `<div class="bt-doc-page"><div style="display:flex;justify-content:space-between;gap:24px;align-items:flex-start"><div><b style="font-size:18px;color:#0f766e">${e(company.name)}</b><div style="color:#64748b;margin-top:6px;line-height:1.55">${e(company.address)}<br>${e(company.tel)} ${company.email ? `· ${e(company.email)}` : ''}</div></div><div style="text-align:right"><b>No. ${e(doc.id || '-')}</b><br>Date ${e(doc.date)}<br>Valid ${e(doc.validDays)} days</div></div><h1>${e(doc.type)}</h1><table style="margin-bottom:14px"><tbody><tr><th style="width:16%">BILL TO</th><td style="width:34%"><b>${e(doc.customerName || 'Buyer')}</b><br>${e(doc.customerCountry)}<br>${e(doc.customerAddress)}<br>${e(doc.customerEmail)}</td><th style="width:16%">TERMS</th><td>${e(doc.incoterm)}<br>${e(doc.payment)}<br>${e(doc.leadTime)}</td></tr></tbody></table><table><thead><tr><th>No.</th><th>Product</th><th>Specification</th><th>Qty</th><th>Unit Price</th><th>Amount (${e(doc.currency)})</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5" style="text-align:right">Subtotal</td><td style="text-align:right">${money(doc.subtotal)}</td></tr><tr><td colspan="5" style="text-align:right">Freight</td><td style="text-align:right">${money(doc.freight)}</td></tr><tr><td colspan="5" style="text-align:right">Discount</td><td style="text-align:right">-${money(doc.discount)}</td></tr><tr><td colspan="5" style="text-align:right;font-size:13px"><b>TOTAL</b></td><td style="text-align:right;font-size:13px;color:#0f766e"><b>${e(doc.currency)} ${money(doc.total)}</b></td></tr></tfoot></table>${doc.bank ? `<div style="margin-top:18px;line-height:1.65"><b>Bank Details</b><br>${e(doc.bank).replace(/\n/g, '<br>')}</div>` : ''}<div style="margin-top:18px;line-height:1.65"><b>Notes</b><br>${e(doc.note).replace(/\n/g, '<br>')}</div><div style="display:flex;justify-content:space-between;margin-top:42px;padding-top:12px;border-top:1px solid #cbd5e1"><span>Authorized by ${e(company.name)}</span><span>Signature ____________________</span></div></div>`;
  }

  function saveExportDoc() {
    const doc = exportDocData();
    if (!doc.id || !doc.items.length) { notify('문서번호와 품목을 확인하세요.', 'error'); return; }
    window.db.txn = window.db.txn || {}; window.db.txn.T_EXPORT_DOC = window.db.txn.T_EXPORT_DOC || [];
    const index = window.db.txn.T_EXPORT_DOC.findIndex((item) => item.id === doc.id);
    if (index >= 0) window.db.txn.T_EXPORT_DOC[index] = doc; else window.db.txn.T_EXPORT_DOC.push(doc);
    persist(`수출문서 저장: ${doc.type} ${doc.id}`); markComplete('biz-export-doc', { type: doc.type, items: doc.items.length });
    notify('수출 문서를 ERP에 저장했습니다.');
  }

  function printDocument() {
    document.body.classList.add('bt-printing');
    window.print();
    setTimeout(() => document.body.classList.remove('bt-printing'), 500);
    track('export', activeTool, { format: 'print' });
  }

  function calcRoas() {
    try {
      const currency = v('bt-roas-currency') || 'USD';
      const result = M.influencerRoas({
        fee: n('bt-roas-fee'), giftedCogs: n('bt-roas-gift'), shipping: n('bt-roas-ship'), production: n('bt-roas-production'),
        usageRights: n('bt-roas-rights'), views: n('bt-roas-views'), clicks: n('bt-roas-clicks'), orders: n('bt-roas-orders'),
        revenue: n('bt-roas-revenue'), grossMarginRate: n('bt-roas-gm'), ltvMultiplier: n('bt-roas-ltv', 1)
      });
      document.getElementById('bt-roas-result').innerHTML = [
        metric('총 캠페인 원가', money(result.totalCost, currency)), metric('매출 ROAS', `${result.roas.toFixed(2)}x`, 'bt-accent'),
        metric('이익기준 ROAS', `${result.profitRoas.toFixed(2)}x`, resultClass(result.profitRoas - 1)), metric('공헌이익-캠페인비', money(result.netReturn, currency), resultClass(result.netReturn)),
        metric('CPM', money(result.cpm, currency)), metric('CPC', money(result.cpc, currency)), metric('CPA', money(result.cpa, currency)),
        metric('CTR', `${result.ctr.toFixed(2)}%`), metric('클릭→구매', `${result.conversionRate.toFixed(2)}%`),
        metric('손익분기 구매', Number.isFinite(result.breakEvenOrders) ? `${result.breakEvenOrders.toLocaleString()}건` : '계산 불가')
      ].join('');
      const profitable = result.netReturn >= 0;
      document.getElementById('bt-roas-guide').innerHTML = `<div class="bt-alert ${profitable ? 'bt-alert-blue' : 'bt-alert-red'}"><b>${profitable ? '이익 기준 흑자' : '이익 기준 적자'}</b><span>${Number.isFinite(result.breakEvenOrders) ? `현재 조건의 손익분기 구매건수는 ${result.breakEvenOrders}건입니다.` : '평균 주문액 또는 구매건수를 입력해야 손익분기를 계산할 수 있습니다.'} 30일 사용권 이후 광고 집행비는 별도로 더해야 합니다.</span></div>`;
      markComplete('biz-roas', { roas: result.roas, netReturn: result.netReturn });
      return result;
    } catch (error) { showError('bt-roas-result', error); return null; }
  }

  function saveRoasScenario() {
    const result = calcRoas(); if (!result) return;
    window.db.tools = window.db.tools || {}; window.db.tools.influencerScenarios = window.db.tools.influencerScenarios || [];
    window.db.tools.influencerScenarios.push({ id: `INF-${Date.now().toString(36).toUpperCase()}`, savedAt: new Date().toISOString(), currency: v('bt-roas-currency'), result });
    persist('인플루언서 ROAS 시나리오 저장'); notify('ROAS 시나리오를 저장했습니다.');
  }

  function addAllergenRow(data = {}) {
    const host = document.getElementById('bt-alg-rows'); if (!host) return;
    const row = document.createElement('div'); row.className = 'bt-row bt-row-allergen bt-alg-row';
    row.innerHTML = `<input class="bt-input bt-alg-name" placeholder="성분명 (예: Limonene)" value="${e(data.name || '')}"><input class="bt-input bt-alg-inci" placeholder="INCI / CAS" value="${e(data.inci || '')}"><input class="bt-input bt-alg-pct" type="number" step="0.000001" placeholder="원료 내 %" value="${e(data.percent ?? '')}"><button class="bt-btn bt-btn-danger" onclick="this.parentElement.remove()">×</button>`;
    host.appendChild(row);
  }

  function loadAllergenProduct() {
    const product = productById(v('bt-alg-product'));
    const select = document.getElementById('bt-alg-raw'); if (!select) return;
    const rawBom = (product?.bom || []).filter((row) => row.type === 'RAW');
    select.innerHTML = '<option value="">원료 선택</option>' + rawBom.map((row) => `<option value="${e(row.itemId)}" data-pct="${e(row.qty)}">${e(rawById(row.itemId)?.name || row.itemId)} · ${e(row.qty)}%</option>`).join('');
    select.onchange = () => {
      const option = select.selectedOptions[0]; document.getElementById('bt-alg-ingredient-pct').value = option?.dataset?.pct || '';
      const raw = rawById(select.value); const host = document.getElementById('bt-alg-rows'); host.innerHTML = '';
      (raw?.allergens || []).forEach(addAllergenRow); if (!(raw?.allergens || []).length) addAllergenRow();
    };
    calcAllergens();
  }

  function saveRawAllergens() {
    const raw = rawById(v('bt-alg-raw')); if (!raw) { notify('저장할 향료/원료를 선택하세요.', 'error'); return; }
    raw.allergens = Array.from(document.querySelectorAll('.bt-alg-row')).map((row) => ({
      name: row.querySelector('.bt-alg-name').value.trim(), inci: row.querySelector('.bt-alg-inci').value.trim(), percent: M.finite(row.querySelector('.bt-alg-pct').value)
    })).filter((item) => item.name && item.percent >= 0);
    raw.allergen = raw.allergens.length > 0;
    persist(`원료 알레르겐 상세 저장: ${raw.name || raw.rawId}`); calcAllergens(); notify('원료사 알레르겐 자료를 저장했습니다.');
  }

  function calcAllergens() {
    try {
      const product = productById(v('bt-alg-product')); const host = document.getElementById('bt-alg-result');
      if (!product) { host.innerHTML = '<div class="bt-alert bt-alert-amber"><b>제품 선택</b><span>ERP 제품을 선택하면 BOM 기준으로 계산합니다.</span></div>'; return; }
      const type = v('bt-alg-type') || 'leave-on'; const rows = [];
      (product.bom || []).filter((row) => row.type === 'RAW').forEach((bom) => {
        const raw = rawById(bom.itemId); (raw?.allergens || []).forEach((alg) => {
          const concentration = M.allergenConcentration({ ingredientPercent: bom.qty, allergenPercentInIngredient: alg.percent });
          const status = M.allergenStatus({ concentration, productType: type });
          rows.push({ raw: raw?.name || '', name: alg.name, inci: alg.inci, ingredientPercent: M.finite(bom.qty), sourcePercent: M.finite(alg.percent), concentration, ...status });
        });
      });
      const merged = Object.values(rows.reduce((map, row) => {
        const key = (row.name || row.inci).toLowerCase();
        if (!map[key]) map[key] = { ...row, concentration: 0, sources: [] };
        map[key].concentration += row.concentration; map[key].sources.push(row.raw); map[key].mustLabel = map[key].concentration > row.threshold;
        return map;
      }, {})).sort((a, b) => b.concentration - a.concentration);
      host.innerHTML = merged.length ? `<div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>알레르겐</th><th>원료</th><th class="text-right">최종제품 %</th><th class="text-right">기준 %</th><th>검토</th></tr></thead><tbody>${merged.map((row) => `<tr><td><b>${e(row.name)}</b><br><span class="bt-note">${e(row.inci)}</span></td><td>${e([...new Set(row.sources)].join(', '))}</td><td class="text-right">${row.concentration.toFixed(6)}%</td><td class="text-right">${row.threshold}%</td><td>${row.mustLabel ? '<span class="status-badge status-fail">표시 검토</span>' : '<span class="status-badge status-ok">기준 이하</span>'}</td></tr>`).join('')}</tbody></table></div><div class="bt-alert bt-alert-blue"><b>표시 후보</b><span>${e(merged.filter((row) => row.mustLabel).map((row) => row.name).join(', ') || '없음')}</span></div>` : '<div class="bt-alert bt-alert-amber"><b>원료 자료 없음</b><span>선택 제품의 원료에 알레르겐 상세 함량이 저장되어 있지 않습니다.</span></div>';
      markComplete('biz-allergen', { ingredients: merged.length, labelCandidates: merged.filter((row) => row.mustLabel).length });
    } catch (error) { showError('bt-alg-result', error); }
  }

  function ensureJsBarcode() {
    if (window.JsBarcode) return Promise.resolve(window.JsBarcode);
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('bt-jsbarcode');
      if (existing) { existing.addEventListener('load', () => resolve(window.JsBarcode)); existing.addEventListener('error', reject); return; }
      const script = document.createElement('script'); script.id = 'bt-jsbarcode';
      script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
      script.onload = () => resolve(window.JsBarcode); script.onerror = () => reject(new Error('바코드 라이브러리를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    });
  }

  function loadSkuProduct() {
    const product = productById(v('bt-sku-product')); if (!product) return;
    document.getElementById('bt-sku-item').value = product.code || product.name || '';
    document.getElementById('bt-sku-size').value = String(product.spec || '').match(/[\d.]+\s*(?:ml|g|kg|l)/i)?.[0]?.replace(/\s/g, '') || '';
    document.getElementById('bt-gtin-full').value = product.gtin || '';
    generateSku();
  }

  async function generateSku() {
    try {
      const sku = M.normalizeSku([v('bt-sku-brand'), v('bt-sku-line'), v('bt-sku-item'), v('bt-sku-size'), v('bt-sku-market')]);
      document.getElementById('bt-sku-code').textContent = sku || '-';
      const base = v('bt-gtin-base').replace(/\D/g, ''); let gtin = v('bt-gtin-full').replace(/\D/g, '');
      if (base.length === 12) { gtin = base + M.gtin13CheckDigit(base); document.getElementById('bt-gtin-full').value = gtin; }
      const status = document.getElementById('bt-gtin-status'); const svg = document.getElementById('bt-barcode');
      if (!gtin) { status.textContent = 'GS1에서 배정받은 12자리 또는 완성 GTIN-13을 입력하세요.'; svg.innerHTML = ''; return { sku, gtin: '' }; }
      if (!M.validateGtin13(gtin)) { status.innerHTML = '<span class="bt-negative"><strong>GTIN-13 체크디지트가 맞지 않습니다.</strong></span>'; svg.innerHTML = ''; return { sku, gtin: '' }; }
      status.innerHTML = `<span class="bt-positive"><strong>유효한 GTIN-13 형식 · ${e(gtin)}</strong></span>`;
      try { const JsBarcode = await ensureJsBarcode(); JsBarcode(svg, gtin, { format: 'EAN13', displayValue: true, height: 56, margin: 10, fontSize: 14 }); } catch (error) { status.innerHTML += `<br>${e(error.message)}`; }
      markComplete('biz-sku', { validGtin: true });
      return { sku, gtin };
    } catch (error) { showError('bt-gtin-status', error); return null; }
  }

  async function saveSkuToProduct() {
    const product = productById(v('bt-sku-product')); if (!product) { notify('저장할 ERP 제품을 선택하세요.', 'error'); return; }
    const result = await generateSku(); if (!result?.sku) return;
    if (result.gtin && products().some((item) => item !== product && item.gtin === result.gtin)) { notify('다른 제품에 이미 등록된 GTIN입니다.', 'error'); return; }
    product.code = result.sku; if (result.gtin) product.gtin = result.gtin;
    persist(`제품 식별정보 저장: ${product.name || product.productId}`); notify('SKU와 GTIN을 제품에 저장했습니다.');
  }

  function downloadBarcode() {
    const svg = document.getElementById('bt-barcode');
    if (!svg?.innerHTML) { notify('유효한 GTIN 바코드를 먼저 생성하세요.', 'error'); return; }
    const source = new XMLSerializer().serializeToString(svg);
    downloadBlob(source, `${v('bt-gtin-full') || 'barcode'}.svg`, 'image/svg+xml;charset=utf-8');
    track('export', 'biz-sku', { format: 'svg' });
  }

  function getAllLots() {
    const stock = window.db?.stock || {};
    const map = [
      ['RAW', stock.RAW_LOT || []], ['PACK', stock.PACK_LOT || []], ['BULK', stock.BULK_LOT || []], ['FGT', stock.FGT_LOT || []]
    ];
    return map.flatMap(([type, list]) => list.map((lot) => {
      const item = type === 'RAW' ? rawById(lot.rawId) : type === 'PACK' ? (window.db?.master?.M_PACK || []).find((x) => String(x.packId) === String(lot.packId)) : productById(lot.productId);
      return {
        type, id: lot.id, lotNo: lot.lotNo || '', itemName: item?.name || '-', itemCode: item?.code || '', qty: M.finite(lot.qty),
        remaining: M.finite(lot.remaining), unitCost: M.finite(lot.unitCost), amount: M.finite(lot.remaining) * M.finite(lot.unitCost),
        dateIn: lot.dateIn || lot.mfgDate || lot.date || '', expDate: lot.expDate || lot.matureUntil || '', status: lot.status || 'OK', note: lot.note || ''
      };
    }));
  }

  function filteredLots() {
    const type = v('bt-lot-type') || 'ALL'; const status = v('bt-lot-status') || 'ALL'; const query = v('bt-lot-search').toLowerCase();
    return getAllLots().filter((lot) => (type === 'ALL' || lot.type === type) && (status === 'ALL' || lot.status === status) && (!query || `${lot.lotNo} ${lot.itemName} ${lot.itemCode}`.toLowerCase().includes(query)));
  }

  function renderLots() {
    const host = document.getElementById('bt-lot-table'); if (!host) return;
    const lots = filteredLots();
    const value = lots.reduce((sum, lot) => sum + lot.amount, 0); const hold = lots.filter((lot) => lot.status === 'HOLD').length;
    document.getElementById('bt-lot-summary').innerHTML = `<span>조회 ${lots.length.toLocaleString()} LOT</span><span>평가금액 ${won(value)}</span><span>HOLD ${hold.toLocaleString()}건</span>`;
    host.innerHTML = `<div class="bt-table-wrap"><table class="bt-table"><thead><tr><th>유형</th><th>LOT</th><th>품목</th><th>입고/제조일</th><th>유통/숙성일</th><th>상태</th><th class="text-right">잔량</th><th class="text-right">단가</th><th class="text-right">평가금액</th></tr></thead><tbody>${lots.map((lot) => `<tr><td><span class="badge-soft">${e(lot.type)}</span></td><td class="mono"><b>${e(lot.lotNo)}</b></td><td>${e(lot.itemName)}</td><td>${e(lot.dateIn || '-')}</td><td>${e(lot.expDate || '-')}</td><td>${typeof window.statusBadge === 'function' ? window.statusBadge(lot.status) : e(lot.status)}</td><td class="text-right">${lot.remaining.toLocaleString()}</td><td class="text-right">${won(lot.unitCost)}</td><td class="text-right">${won(lot.amount)}</td></tr>`).join('') || '<tr><td colspan="9" class="text-center text-slate-400">조건에 맞는 LOT가 없습니다.</td></tr>'}</tbody></table></div>`;
  }

  function generateLotCode() {
    try {
      const product = productById(v('bt-lot-product'));
      if (!product) throw new Error('신규 LOT 제품을 선택하세요.');
      const code = M.lotCode({ prefix: 'FGT', productCode: product.code || product.name, date: v('bt-lot-date'), sequence: n('bt-lot-seq', 1) });
      const duplicate = getAllLots().some((lot) => lot.lotNo === code);
      document.getElementById('bt-lot-generated').innerHTML = `${e(code)} ${duplicate ? '<span style="color:#fda4af">· 이미 존재</span>' : ''}`;
      if (duplicate) notify('이미 존재하는 LOT 코드입니다.', 'error'); else markComplete('biz-lot', { generated: true });
      return code;
    } catch (error) { showError('bt-lot-generated', error); return ''; }
  }

  function exportLotsXlsx() {
    const lots = filteredLots(); if (!lots.length) { notify('내보낼 LOT가 없습니다.', 'error'); return; }
    const rows = lots.map((lot) => ({
      유형: lot.type, LOT번호: lot.lotNo, 품목코드: lot.itemCode, 품목명: lot.itemName, 입고제조일: lot.dateIn,
      유통숙성일: lot.expDate, 상태: lot.status, 최초수량: lot.qty, 잔량: lot.remaining, 단가: lot.unitCost, 평가금액: lot.amount, 비고: lot.note
    }));
    if (window.XLSX) {
      const book = XLSX.utils.book_new(); const sheet = XLSX.utils.json_to_sheet(rows); sheet['!cols'] = [8, 24, 18, 28, 14, 14, 10, 12, 12, 14, 16, 30].map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(book, sheet, 'LOT관리표'); XLSX.writeFile(book, `MEDISCENT_LOT_${today()}.xlsx`);
    } else {
      const headers = Object.keys(rows[0]); const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => JSON.stringify(row[key])).join(','))].join('\n');
      downloadBlob(csv, `MEDISCENT_LOT_${today()}.csv`, 'text/csv;charset=utf-8');
    }
    track('export', 'biz-lot', { format: window.XLSX ? 'xlsx' : 'csv', rows: lots.length }); markComplete('biz-lot', { exported: lots.length });
  }

  function productInci(product) {
    const rawBom = (product?.bom || []).filter((row) => row.type === 'RAW').slice().sort((a, b) => M.finite(b.qty) - M.finite(a.qty));
    const base = rawBom.map((row) => rawById(row.itemId)?.inci || rawById(row.itemId)?.name).filter(Boolean);
    const allergens = [];
    rawBom.forEach((row) => (rawById(row.itemId)?.allergens || []).forEach((alg) => {
      const concentration = M.allergenConcentration({ ingredientPercent: row.qty, allergenPercentInIngredient: alg.percent });
      if (M.allergenStatus({ concentration, productType: 'leave-on' }).mustLabel) allergens.push(alg.inci || alg.name);
    }));
    return [...new Set([...base, ...allergens])].join(', ');
  }

  function loadEnglishProduct() {
    const product = productById(v('bt-en-product')); if (!product) return;
    document.getElementById('bt-en-name').value = product.exportInfo?.name || product.name || '';
    document.getElementById('bt-en-category').value = product.exportInfo?.category || (/perfume|edp|향수/i.test(`${product.name} ${product.spec}`) ? 'Eau de Parfum' : 'Cosmetic Product');
    const size = String(product.spec || '').match(/[\d.]+\s*(?:ml|g|kg|l)/i)?.[0]; if (size) document.getElementById('bt-en-net').value = size.replace(/ml/i, 'mL');
    document.getElementById('bt-en-description').value = product.exportInfo?.description || product.descriptionEn || '';
    document.getElementById('bt-en-hs').value = product.exportInfo?.hsCode || product.hsCode || '';
    document.getElementById('bt-en-inci').value = product.exportInfo?.inci || productInci(product);
    const company = companyData(); document.getElementById('bt-en-company').value = product.exportInfo?.company || `${company.name}\n${company.address}\n${company.email} ${company.tel}`.trim();
    renderEnglishProduct();
    setTimeout(refreshDataOptions, 1800);
    setTimeout(refreshDataOptions, 4500);
  }

  function renderEnglishProduct() {
    const host = document.getElementById('bt-en-preview'); if (!host) return;
    const product = productById(v('bt-en-product'));
    const sku = product?.code || ''; const gtin = product?.gtin || '';
    const fields = [
      ['Brand', v('bt-en-brand')], ['Product Name', v('bt-en-name') || 'Product Name'], ['Category', v('bt-en-category')],
      ['Net Content', v('bt-en-net')], ['Country of Origin', v('bt-en-origin')], ['HS Code', v('bt-en-hs') || '-'], ['SKU / GTIN', [sku, gtin].filter(Boolean).join(' / ') || '-']
    ];
    host.innerHTML = `<div class="bt-doc-page"><div style="border-bottom:3px solid #0f766e;padding-bottom:12px"><div style="font-size:10px;letter-spacing:.18em;color:#0f766e;font-weight:900">PRODUCT INFORMATION SHEET</div><div style="font-size:25px;font-weight:900;margin-top:6px">${e(v('bt-en-brand'))} · ${e(v('bt-en-name') || 'Product')}</div></div><table style="margin-top:16px"><tbody>${fields.map(([label, value]) => `<tr><th style="width:25%;text-align:left">${e(label)}</th><td>${e(value)}</td></tr>`).join('')}</tbody></table><h3 style="font-size:12px;margin:18px 0 7px">PRODUCT DESCRIPTION</h3><div style="line-height:1.7">${e(v('bt-en-description') || '-').replace(/\n/g, '<br>')}</div><h3 style="font-size:12px;margin:18px 0 7px">DIRECTIONS</h3><div style="line-height:1.7">${e(v('bt-en-directions')).replace(/\n/g, '<br>')}</div><h3 style="font-size:12px;margin:18px 0 7px">INGREDIENTS (INCI)</h3><div style="line-height:1.7;border:1px solid #cbd5e1;padding:10px">${e(v('bt-en-inci') || '-')}</div><h3 style="font-size:12px;margin:18px 0 7px">WARNINGS</h3><div style="line-height:1.7">${e(v('bt-en-warnings')).replace(/\n/g, '<br>')}</div><h3 style="font-size:12px;margin:18px 0 7px">RESPONSIBLE COMPANY / MANUFACTURER</h3><div style="line-height:1.7">${e(v('bt-en-company') || '-').replace(/\n/g, '<br>')}</div><div style="margin-top:30px;padding-top:10px;border-top:1px solid #cbd5e1;color:#64748b">Generated from MEDISCENT ERP · ${e(today())}</div></div>`;
  }

  function saveEnglishProduct() {
    const product = productById(v('bt-en-product')); if (!product) { notify('저장할 ERP 제품을 선택하세요.', 'error'); return; }
    product.exportInfo = {
      brand: v('bt-en-brand'), name: v('bt-en-name'), category: v('bt-en-category'), netContent: v('bt-en-net'), origin: v('bt-en-origin'), hsCode: v('bt-en-hs'),
      description: v('bt-en-description'), directions: v('bt-en-directions'), warnings: v('bt-en-warnings'), inci: v('bt-en-inci'), company: v('bt-en-company'), updatedAt: new Date().toISOString()
    };
    persist(`영문 제품정보 저장: ${product.name || product.productId}`); markComplete('biz-product-en', { saved: true }); notify('영문 제품정보를 저장했습니다.');
  }

  function boot() {
    if (document.getElementById('page-biz-hub')) return;
    injectStyles();
    injectNavigation();
    injectPages();
    initializeRows();
    wrapNavigation();
    renderHub();
    renderLots();
    calcDilution();
    calcMargin();
    calcMoq();
    calcExportPrice();
    calcRoas();
    generateSku();
    renderExportDoc();
    renderEnglishProduct();
    const version = document.querySelector('#brand-logo + div span');
    if (version) version.textContent = 'v4.0 BETA';
  }

  if (document.readyState === 'loading') window.addEventListener('load', () => setTimeout(boot, 500));
  else setTimeout(boot, 500);

  window.MediscentTools = {
    switchVariant, resetAb, exportAbCsv, saveAbSummary,
    addCompositionRow, loadDilutionProduct, calcDilution,
    loadMarginProduct, calcMargin, saveMarginToProduct,
    addMoqRow, loadMoqProduct, calcMoq,
    loadExportProduct, applySavedRate, calcExportPrice, saveExchangeRate,
    addExportDocRow, loadExportCustomer, renderExportDoc, saveExportDoc, printDocument,
    calcRoas, saveRoasScenario,
    addAllergenRow, loadAllergenProduct, saveRawAllergens, calcAllergens,
    loadSkuProduct, generateSku, saveSkuToProduct, downloadBarcode,
    renderLots, generateLotCode, exportLotsXlsx,
    loadEnglishProduct, renderEnglishProduct, saveEnglishProduct
  };
})();
