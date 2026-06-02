/**
 * SHIFTI ERP Patch v3.2-fixed
 * 
 * 적용 방법: index.html 의 </body> 태그 바로 앞에 아래 한 줄을 추가하세요.
 * <script src="erp-patch.js"></script>
 * 
 * 수정 내역:
 * 1. loadDB() 데이터 초기화 버그 수정 (Critical)
 * 2. saveDB() Supabase sync 복원 (Critical)
 * 3. 세션 만료 후 로컬 폴백 강화
 * 4. renderAll 안전 실행 래퍼
 * 5. channel-sales 섹션 → 매출 업로드 모듈 통합
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────
   * PATCH 1: loadDB — 완전 재작성
   *   · 로컬 데이터 먼저 적용 → 즉시 UI 사용 가능
   *   · Supabase는 8초 타임아웃 적용
   *   · 빈 응답·실패·타임아웃 어떤 경우에도
   *     _hideLoader() 반드시 호출 (finally 보장)
   *   · window.db 가 null/undefined 일 때 방어
   * ───────────────────────────────────────────── */
  window.loadDB = async function () {
    /* 헬퍼 — 원본 함수 없어도 안전하게 동작 */
    const _show = function (m) {
      try { (window._showLoader || function(){})(m); } catch(e) {}
    };
    const _hide = function () {
      try {
        /* 원본 _hideLoader 우선, 없으면 직접 DOM 제거 */
        if (typeof window._hideLoader === 'function') {
          window._hideLoader();
        } else {
          const el = document.getElementById('_sbL');
          if (el) el.remove();
        }
      } catch(e) {
        try { const el = document.getElementById('_sbL'); if(el) el.remove(); } catch(_) {}
      }
    };
    const _cs = function (icon, txt) {
      try { (window._setCS || function(){})(icon, txt); } catch(e) {}
    };

    const STORAGE_KEY = window.STORAGE_KEY || 'shifti_erp_v2';
    const SB_URL = window.SB_URL;
    const SB_KEY = window.SB_KEY;
    const SB_ROW = window.SB_ROW || 'shifti_erp_main';

    _show('☁️ 클라우드에서 불러오는 중…');

    /* ── Step 1: 로컬 데이터 먼저 적용 (즉시) ── */
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try { window.db = JSON.parse(local); } catch(e) { window.db = null; }
    }
    /* db 가 null/undefined 이면 빈 구조로 초기화 */
    if (!window.db || typeof window.db !== 'object') {
      window.db = { meta: { version: '3.2-fixed' } };
    }

    /* ── Step 2: Supabase 조회 (8초 타임아웃) ── */
    try {
      if (!SB_URL || !SB_KEY) throw new Error('Supabase 설정 없음');

      /* AbortController 로 타임아웃 구현 */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const r = await fetch(
        SB_URL + '/rest/v1/erp_data?id=eq.' + SB_ROW + '&select=data',
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': SB_KEY,
            'Authorization': 'Bearer ' + SB_KEY
          },
          signal: controller.signal
        }
      );
      clearTimeout(timer);

      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const rem = d && d.length ? d[0].data : null;

      /* ★ 핵심: 실제 마스터 데이터가 있을 때만 덮어씀 */
      const remHasData = rem && rem.master && (
        (rem.master.M_RAW      || []).length > 0 ||
        (rem.master.M_PACK     || []).length > 0 ||
        (rem.master.M_PRODUCT  || []).length > 0 ||
        (rem.master.M_CUSTOMER || []).length > 0
      );

      if (remHasData) {
        const rAt = new Date(rem.meta?.updatedAt || 0);
        const lAt = window.db?.meta?.updatedAt
          ? new Date(window.db.meta.updatedAt) : new Date(0);
        if (rAt >= lAt) {
          window.db = rem;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(window.db));
        }
      }
      _cs('☁️', '연결됨');

    } catch (e) {
      const msg = e.name === 'AbortError' ? '응답 시간 초과 (로컬 데이터 사용)' : e.message;
      console.warn('[SB] load:', msg);
      _cs('⚠️', '오프라인 (로컬 데이터)');
      /* 로컬도 없으면 여기서 빈 구조 재보장 */
      if (!window.db || typeof window.db !== 'object') {
        window.db = { meta: { version: '3.2-fixed' } };
      }
    } finally {
      /* ★ 어떤 경우에도 반드시 로더 숨김 */
      _hide();
    }

    /* ── Step 3: DB 구조 보정 ── */
    const db = window.db;
    if (!db.master)      db.master = {};
    if (!db.stock)       db.stock  = {};
    if (!db.txn)         db.txn    = {};
    if (!db.logs)        db.logs   = [];
    if (!db.costHistory) db.costHistory = [];

    /* master 하위 */
    ['M_RAW','M_PACK','M_PRODUCT','M_CUSTOMER',
     'M_FORMULA','M_MATURATION','M_SAFETY_STOCK','M_SUPPLIER'].forEach(k => {
      if (!Array.isArray(db.master[k])) db.master[k] = [];
    });
    if (!db.master.M_CHANNEL_TAGS || typeof db.master.M_CHANNEL_TAGS !== 'object') {
      db.master.M_CHANNEL_TAGS = {};
    }

    /* stock 하위 */
    ['RAW_LOT','PACK_LOT','BULK_LOT','FGT_LOT'].forEach(k => {
      if (!Array.isArray(db.stock[k])) db.stock[k] = [];
    });

    /* txn 하위 */
    ['T_GOODS_IN','T_BULK','T_BATCH','T_FILL','T_SALE','T_QC','T_ADJ',
     'T_PO','T_SO','T_RETURN','T_CLAIM','T_NCR','T_CAPA',
     'T_PROD_PLAN','T_WORK_ORDER','T_QC_PROD','T_DEV_NOTE'].forEach(k => {
      if (!Array.isArray(db.txn[k])) db.txn[k] = [];
    });

    try { if (typeof window.autoExpireLots  === 'function') window.autoExpireLots(); }  catch(e) {}
    try { if (typeof window.ensureNewTables === 'function') window.ensureNewTables(); } catch(e) {}
  };

  /* ─────────────────────────────────────────────
   * PATCH 2: saveDB - Supabase sync 복원
   *          (2번째 IIFE의 덮어쓰기 문제 수정)
   * ───────────────────────────────────────────── */
  window.saveDB = async function () {
    const STORAGE_KEY = window.STORAGE_KEY || 'shifti_erp_v2';
    const SB_URL = window.SB_URL;
    const SB_KEY = window.SB_KEY;
    const SB_ROW = window.SB_ROW || 'shifti_erp_main';
    const db = window.db;

    /* meta 갱신 */
    if (!db.meta) db.meta = { version: '3.2-fixed' };
    db.meta.updatedAt = new Date().toISOString();

    /* 로컬 저장 */
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

    /* UI 갱신 */
    try { if (typeof window.renderAll === 'function') window.renderAll(); } catch (e) {}

    /* Supabase 저장 */
    try {
      const r = await fetch(SB_URL + '/rest/v1/erp_data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ id: SB_ROW, data: db, updated_at: db.meta.updatedAt })
      });
      if (!r.ok) throw new Error('SET ' + r.status);
      const t = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      if (typeof window._setCS === 'function') window._setCS('☁️', '저장됨 ' + t);
    } catch (e) {
      console.warn('[SB] save fail:', e.message);
      if (typeof window._setCS === 'function') window._setCS('⚠️', '저장 실패 (로컬만)');
    }
  };

  /* ─────────────────────────────────────────────
   * PATCH 3: resetDB - 안전 초기화
   * ───────────────────────────────────────────── */
  window.resetDB = async function () {
    if (!confirm('⚠️ 클라우드 포함 모든 데이터를 삭제합니다. 계속하시겠습니까?')) return;
    const STORAGE_KEY = window.STORAGE_KEY || 'shifti_erp_v2';
    localStorage.removeItem(STORAGE_KEY);
    try {
      const SB_URL = window.SB_URL, SB_KEY = window.SB_KEY, SB_ROW = window.SB_ROW || 'shifti_erp_main';
      await fetch(SB_URL + '/rest/v1/erp_data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({ id: SB_ROW, data: { meta: { version: '3.2-fixed' } }, updated_at: new Date().toISOString() })
      });
      if (typeof window.toast === 'function') window.toast('초기화 완료', 'success');
    } catch (e) {
      if (typeof window.toast === 'function') window.toast('클라우드 초기화 실패 (로컬만)', 'error');
    }
    location.reload();
  };

  /* ─────────────────────────────────────────────
   * PATCH 4: channel-sales 섹션 → 매출 업로드 모듈
   * ───────────────────────────────────────────── */

  function buildSalesUploadSection() {
    const sec = document.getElementById('page-channel-sales');
    if (!sec) return;

    sec.innerHTML = `
<div class="space-y-5">
  <!-- 헤더 -->
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-black text-slate-800">매출 업로드 &amp; 채널별 분석</h2>
    <span class="badge-teal">온라인 · 오프라인 통합</span>
  </div>

  <!-- 업로드 탭 카드 -->
  <div class="card p-5">
    <div class="flex gap-0 border-b border-slate-200 mb-5">
      <button id="su-tab-excel" class="tab-btn active" onclick="suTab('excel')">📊 엑셀 업로드</button>
      <button id="su-tab-image" class="tab-btn" onclick="suTab('image')">📷 이미지 OCR</button>
      <button id="su-tab-manual" class="tab-btn" onclick="suTab('manual')">✏️ 직접 입력</button>
    </div>

    <!-- 엑셀 탭 -->
    <div id="su-panel-excel" class="space-y-4">
      <div class="grid grid-cols-2 gap-3 mb-2">
        <div id="su-ch-online" onclick="suToggleCh(this,'online')"
          class="border rounded-lg p-3 cursor-pointer border-teal-400 bg-teal-50 transition">
          <div class="flex items-center gap-2">
            <span class="text-lg">🌐</span>
            <div><div class="text-xs font-black">온라인</div><div class="text-[10px] text-slate-500">스마트스토어·쿠팡·자사몰</div></div>
            <span class="ml-auto text-teal-500 font-black text-xs">✓</span>
          </div>
        </div>
        <div id="su-ch-offline" onclick="suToggleCh(this,'offline')"
          class="border rounded-lg p-3 cursor-pointer border-slate-200 transition hover:border-slate-400">
          <div class="flex items-center gap-2">
            <span class="text-lg">🏪</span>
            <div><div class="text-xs font-black">오프라인</div><div class="text-[10px] text-slate-500">팝업·백화점·매장</div></div>
            <span class="ml-auto text-slate-300 text-xs">✓</span>
          </div>
        </div>
      </div>
      <div id="su-drop-excel"
        class="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition"
        onclick="document.getElementById('su-file-excel').click()"
        ondragover="event.preventDefault();this.classList.add('border-teal-400','bg-teal-50')"
        ondragleave="this.classList.remove('border-teal-400','bg-teal-50')"
        ondrop="suHandleExcelDrop(event)">
        <div class="text-3xl mb-2">📊</div>
        <div class="font-black text-sm text-slate-700">엑셀 파일을 드래그하거나 클릭해서 선택</div>
        <div class="text-xs text-slate-400 mt-1">날짜·채널·제품명·수량·단가·총액 열 자동 매핑</div>
        <div class="flex justify-center gap-2 mt-3">
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.xlsx</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.xls</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.csv</span>
        </div>
      </div>
      <input type="file" id="su-file-excel" accept=".xlsx,.xls,.csv" class="hidden" onchange="suHandleExcelFile(this)">
      <div id="su-excel-preview" class="hidden space-y-3">
        <div class="flex items-center gap-2">
          <span id="su-fname" class="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 font-mono"></span>
          <button onclick="suResetExcel()" class="btn btn-secondary btn-sm">초기화</button>
        </div>
        <div id="su-col-map" class="space-y-1"></div>
        <div class="border rounded-lg overflow-hidden">
          <div class="bg-slate-50 px-3 py-2 text-[10.5px] font-bold text-slate-500 flex justify-between">
            <span>미리보기 (상위 5행)</span><span id="su-row-count" class="badge-soft">0행</span>
          </div>
          <div class="overflow-x-auto"><table id="su-preview-tbl" class="w-full text-xs"></table></div>
        </div>
        <div id="su-summary-grid" class="grid grid-cols-3 gap-3"></div>
        <div id="su-status-list" class="space-y-1"></div>
        <div class="flex justify-end gap-2">
          <button id="su-excel-confirm" onclick="suConfirmExcel()" class="btn btn-primary hidden">
            📥 ERP 매출 반영
          </button>
        </div>
      </div>
    </div>

    <!-- 이미지 탭 -->
    <div id="su-panel-image" class="hidden space-y-4">
      <div id="su-drop-img"
        class="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition"
        onclick="document.getElementById('su-file-img').click()"
        ondragover="event.preventDefault();this.classList.add('border-teal-400','bg-teal-50')"
        ondragleave="this.classList.remove('border-teal-400','bg-teal-50')"
        ondrop="suHandleImgDrop(event)">
        <div class="text-3xl mb-2">📷</div>
        <div class="font-black text-sm text-slate-700">영수증·주문내역 이미지 업로드</div>
        <div class="text-xs text-slate-400 mt-1">스마트스토어 캡처, POS 영수증, 판매 스크린샷 등</div>
        <div class="flex justify-center gap-2 mt-3">
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.jpg</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.png</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.webp</span>
        </div>
      </div>
      <input type="file" id="su-file-img" accept="image/*" class="hidden" onchange="suHandleImgFile(this)">
      <div id="su-img-preview" class="hidden space-y-3">
        <img id="su-img-thumb" class="max-h-48 rounded-lg border border-slate-200 mx-auto block" src="" alt="업로드 이미지">
        <div class="flex gap-2">
          <button onclick="suRunOCR()" class="btn btn-primary">🔍 AI 분석</button>
          <button onclick="suResetImg()" class="btn btn-secondary">다시 선택</button>
        </div>
      </div>
      <div id="su-ocr-section" class="hidden space-y-3">
        <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 min-h-14" id="su-ocr-result">
          <div class="flex items-center gap-2 text-slate-400 text-xs">
            <div class="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin"></div>
            AI 분석 중…
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">판매일자</label><input type="date" id="su-ocr-date" class="input-field"></div>
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">채널</label>
            <select id="su-ocr-ch" class="input-field">
              <option>스마트스토어</option><option>쿠팡</option><option>자사몰</option>
              <option>팝업스토어</option><option>현대백화점</option><option>기타</option>
            </select>
          </div>
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">제품명</label><input id="su-ocr-product" class="input-field" placeholder="제품명"></div>
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">수량</label><input type="number" id="su-ocr-qty" class="input-field" placeholder="0" oninput="suCalcOcrTotal()"></div>
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">단가 (원)</label><input type="number" id="su-ocr-price" class="input-field" placeholder="0" oninput="suCalcOcrTotal()"></div>
          <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">총액 (원)</label><input id="su-ocr-total" class="input-field bg-slate-50" readonly placeholder="자동 계산"></div>
        </div>
        <div class="flex justify-end gap-2">
          <button onclick="suResetImg()" class="btn btn-secondary">다시 업로드</button>
          <button onclick="suConfirmOCR()" class="btn btn-primary">📥 ERP 매출 반영</button>
        </div>
      </div>
    </div>

    <!-- 직접 입력 탭 -->
    <div id="su-panel-manual" class="hidden space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">판매일자</label><input type="date" id="su-m-date" class="input-field"></div>
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">채널</label>
          <select id="su-m-ch" class="input-field">
            <option value="스마트스토어">스마트스토어</option><option value="쿠팡">쿠팡</option>
            <option value="자사몰">자사몰 (SHIFTI)</option><option value="팝업스토어">팝업스토어</option>
            <option value="현대백화점">현대백화점</option><option value="스타필드">스타필드</option>
            <option value="도매/B2B">도매/B2B</option><option value="기타">기타</option>
          </select>
        </div>
      </div>
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">제품 선택</label>
        <select id="su-m-product" class="input-field"></select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">수량</label><input type="number" id="su-m-qty" class="input-field" placeholder="0" oninput="suCalcManual()"></div>
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">단가 (원)</label><input type="number" id="su-m-price" class="input-field" placeholder="0" oninput="suCalcManual()"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">할인 (원)</label><input type="number" id="su-m-disc" class="input-field" placeholder="0" oninput="suCalcManual()"></div>
        <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">순매출 (원)</label><input id="su-m-net" class="input-field bg-slate-50" readonly placeholder="자동 계산"></div>
      </div>
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">비고</label><input id="su-m-note" class="input-field" placeholder="주문번호, 고객명 등 (선택)"></div>
      <div class="flex justify-end gap-2">
        <button onclick="suClearManual()" class="btn btn-secondary">초기화</button>
        <button onclick="suConfirmManual()" class="btn btn-primary">📥 ERP 매출 반영</button>
      </div>
    </div>
  </div>

  <!-- 채널별 분석 -->
  <div class="card">
    <div class="card-header">
      <h3 class="font-bold text-slate-700 text-sm">채널별 매출 분석</h3>
      <button onclick="suRenderChannelAnalysis()" class="btn btn-secondary btn-sm">🔄 새로고침</button>
    </div>

    <!-- 기간 필터 -->
    <div class="px-4 pt-3 pb-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
      <span class="text-[10.5px] font-bold text-slate-500">기간</span>
      <input type="date" id="su-filter-from" class="input-field w-36 text-xs">
      <span class="text-slate-300 text-xs">~</span>
      <input type="date" id="su-filter-to" class="input-field w-36 text-xs">
      <div class="flex gap-1 ml-1">
        <button onclick="suSetPeriod(7)"   class="btn btn-secondary btn-sm text-[10.5px]">7일</button>
        <button onclick="suSetPeriod(30)"  class="btn btn-secondary btn-sm text-[10.5px]">30일</button>
        <button onclick="suSetPeriod(90)"  class="btn btn-secondary btn-sm text-[10.5px]">90일</button>
        <button onclick="suSetPeriod(365)" class="btn btn-secondary btn-sm text-[10.5px]">1년</button>
        <button onclick="suSetPeriod(0)"   class="btn btn-secondary btn-sm text-[10.5px]">전체</button>
      </div>
      <button onclick="suRenderChannelAnalysis()" class="btn btn-primary btn-sm ml-auto">조회</button>
    </div>

    <!-- KPI -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 p-4" id="su-channel-kpis"></div>

    <!-- 분석 탭 -->
    <div class="flex gap-0 border-b border-slate-200 px-4">
      <button id="su-atab-ch"  class="tab-btn active text-xs" onclick="suAnalysisTab('ch')">채널별</button>
      <button id="su-atab-prd" class="tab-btn text-xs"        onclick="suAnalysisTab('prd')">제품별</button>
      <button id="su-atab-mon" class="tab-btn text-xs"        onclick="suAnalysisTab('mon')">월별 추이</button>
    </div>

    <!-- 채널별 테이블 -->
    <div id="su-apanel-ch" class="overflow-x-auto">
      <table><thead><tr>
        <th class="pl-4">채널</th><th>고객수</th>
        <th class="text-right">출고건수</th><th class="text-right">출고수량</th>
        <th class="text-right">매출합계</th><th class="text-right">평균단가</th>
        <th class="text-right pr-4">비중</th>
      </tr></thead><tbody id="tbl-channel-sales2"></tbody></table>
    </div>

    <!-- 제품별 테이블 -->
    <div id="su-apanel-prd" class="hidden overflow-x-auto">
      <table><thead><tr>
        <th class="pl-4">제품</th>
        <th class="text-right">출고건수</th><th class="text-right">출고수량</th>
        <th class="text-right">매출합계</th><th class="text-right">평균단가</th>
        <th class="text-right pr-4">비중</th>
      </tr></thead><tbody id="tbl-product-sales2"></tbody></table>
    </div>

    <!-- 월별 추이 -->
    <div id="su-apanel-mon" class="hidden p-4">
      <div style="height:240px;position:relative"><canvas id="su-monthly-chart"></canvas></div>
      <div class="mt-4 overflow-x-auto">
        <table><thead><tr>
          <th class="pl-4">월</th>
          <th class="text-right">출고건수</th><th class="text-right">출고수량</th>
          <th class="text-right pr-4">매출합계</th>
        </tr></thead><tbody id="tbl-monthly-sales2"></tbody></table>
      </div>
    </div>
  </div>

  <!-- 매출 등록 이력 -->
  <div class="card">
    <div class="card-header">
      <h3 class="font-bold text-slate-700 text-sm">매출 등록 이력 (전체)</h3>
      <span class="badge-soft" id="su-sale-count">0</span>
    </div>
    <div class="scroll-card-lg">
      <table><thead><tr>
        <th class="pl-4">일자</th><th>채널</th><th>고객</th><th>제품</th><th>LOT</th>
        <th class="text-right">수량</th><th class="text-right">매출</th>
        <th class="text-center pr-4">관리</th>
      </tr></thead><tbody id="tbl-all-sales"></tbody></table>
    </div>
  </div>
</div>

<!-- 매출 수정 모달 -->
<div id="su-edit-modal" style="display:none;position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);align-items:center;justify-content:center;">
  <div class="card p-5 space-y-3" style="width:420px;max-width:95vw;">
    <div class="flex items-center justify-between border-b border-slate-100 pb-2">
      <h3 class="font-bold text-slate-800 text-sm">매출 수정</h3>
      <button onclick="suCloseEditModal()" class="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
    </div>
    <input type="hidden" id="su-edit-id">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">판매일자</label>
        <input type="date" id="su-edit-date" class="input-field"></div>
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">채널</label>
        <select id="su-edit-ch" class="input-field">
          <option>D2C</option><option>리테일</option><option>POPUP</option><option>B2B</option>
          <option>스마트스토어</option><option>쿠팡</option><option>자사몰</option>
          <option>팝업스토어</option><option>현대백화점</option><option>스타필드</option>
          <option>도매/B2B</option><option>기타</option>
        </select></div>
    </div>
    <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">제품</label>
      <select id="su-edit-product" class="input-field"></select></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">수량</label>
        <input type="number" id="su-edit-qty" class="input-field" oninput="suCalcEditTotal()"></div>
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">단가 (원)</label>
        <input type="number" id="su-edit-price" class="input-field" oninput="suCalcEditTotal()"></div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">LOT</label>
        <input id="su-edit-lot" class="input-field font-mono" placeholder="LOT번호 (선택)"></div>
      <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">총액 (원)</label>
        <input type="number" id="su-edit-amount" class="input-field"></div>
    </div>
    <div><label class="block text-[10.5px] font-bold text-slate-500 mb-1">비고</label>
      <input id="su-edit-note" class="input-field" placeholder="메모"></div>
    <div class="flex justify-end gap-2 pt-1">
      <button onclick="suCloseEditModal()" class="btn btn-secondary">취소</button>
      <button onclick="suSaveEdit()" class="btn btn-primary">저장</button>
    </div>
  </div>
</div>`;

    /* 날짜 기본값 */
    const today = (typeof window.todayISO === 'function') ? window.todayISO() : new Date().toISOString().split('T')[0];
    ['su-ocr-date', 'su-m-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = today;
    });

    /* 기간 필터 기본값 — 최근 30일 */
    const fromEl = document.getElementById('su-filter-from');
    const toEl   = document.getElementById('su-filter-to');
    if (fromEl && !fromEl.value) {
      const d = new Date(today); d.setDate(d.getDate() - 30);
      fromEl.value = d.toISOString().split('T')[0];
    }
    if (toEl && !toEl.value) toEl.value = today;

    /* 제품 선택 채우기 */
    suFillProductSelect();
    suRenderChannelAnalysis();
    suRenderAllSales();
  }

  /* ───── 탭 전환 ───── */
  window.suTab = function (t) {
    ['excel','image','manual'].forEach(k => {
      document.getElementById('su-panel-' + k)?.classList.toggle('hidden', k !== t);
      document.getElementById('su-tab-' + k)?.classList.toggle('active', k === t);
    });
  };

  /* ───── 채널 토글 ───── */
  window.suToggleCh = function (el) { el.classList.toggle('border-teal-400'); el.classList.toggle('bg-teal-50'); };

  /* ───── 제품 셀렉트 ───── */
  function suFillProductSelect() {
    const el = document.getElementById('su-m-product');
    if (!el) return;
    el.innerHTML = '<option value="">제품 선택</option>' +
      (window.db?.master?.M_PRODUCT || []).map(p =>
        `<option value="${p.productId}">${p.name}</option>`
      ).join('');
  }

  /* ─────────────────────────────────────────────
   * EXCEL 업로드
   * ───────────────────────────────────────────── */
  const SU_COL_MAP = {
    '날짜':  ['date','날짜','일자','판매일','판매일자','order date'],
    '채널':  ['channel','채널','판매채널','플랫폼'],
    '제품명': ['product','제품명','상품명','item','품목'],
    '수량':  ['qty','수량','quantity','판매수량'],
    '단가':  ['price','단가','unit price','판매가'],
    '총액':  ['total','총액','합계','결제금액','주문금액']
  };
  function suDetectCol(headers, candidates) {
    return headers.find(h => candidates.some(c =>
      h.toLowerCase().replace(/\s/g,'').includes(c.toLowerCase().replace(/\s/g,''))
    )) || null;
  }

  window.suHandleExcelDrop = function (e) {
    e.preventDefault();
    document.getElementById('su-drop-excel')?.classList.remove('border-teal-400','bg-teal-50');
    const f = e.dataTransfer.files[0];
    if (f) suProcessExcel(f);
  };
  window.suHandleExcelFile = function (inp) {
    if (inp.files[0]) suProcessExcel(inp.files[0]);
  };

  function suProcessExcel(file) {
    document.getElementById('su-fname').textContent = file.name;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        suRenderExcelPreview(json);
        window.__suExcelData = json;
      } catch (err) {
        if (typeof window.toast === 'function') window.toast('파일 읽기 실패: ' + err.message, 'error');
      }
    };
    reader.readAsBinaryString(file);
  }

  function suRenderExcelPreview(data) {
    if (!data.length) { if (typeof window.toast === 'function') window.toast('데이터가 없습니다', 'error'); return; }
    const headers = Object.keys(data[0]);

    /* 열 매핑 */
    let mapHtml = '<div class="grid grid-cols-1 gap-1.5">';
    for (const [label, candidates] of Object.entries(SU_COL_MAP)) {
      const detected = suDetectCol(headers, candidates);
      const opts = '<option value="">— 선택 —</option>' + headers.map(h =>
        `<option${h === detected ? ' selected' : ''}>${h}</option>`
      ).join('');
      mapHtml += `<div class="flex items-center gap-2 text-xs">
        <span class="w-20 text-slate-500 font-bold shrink-0">${label}</span>
        <span class="text-slate-300">→</span>
        <select data-label="${label}" class="input-field flex-1 text-xs">${opts}</select>
      </div>`;
    }
    mapHtml += '</div>';
    document.getElementById('su-col-map').innerHTML = mapHtml;

    /* 미리보기 테이블 */
    const tbl = document.getElementById('su-preview-tbl');
    const head = '<thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    const rows = data.slice(0,5).map(r =>
      '<tr>' + headers.map(h => `<td>${r[h]}</td>`).join('') + '</tr>'
    ).join('');
    tbl.innerHTML = head + '<tbody>' + rows + '</tbody>';
    document.getElementById('su-row-count').textContent = data.length + '행';

    /* 요약 */
    const totalCol = suDetectCol(headers, SU_COL_MAP['총액']);
    const qtyCol   = suDetectCol(headers, SU_COL_MAP['수량']);
    const totalSales = totalCol ? data.reduce((s,r) => s + (parseFloat(String(r[totalCol]).replace(/[^0-9.]/g,'')) || 0), 0) : 0;
    const totalQty   = qtyCol   ? data.reduce((s,r) => s + (parseFloat(r[qtyCol]) || 0), 0) : 0;
    document.getElementById('su-summary-grid').innerHTML = `
      <div class="card p-3"><div class="text-[10px] text-slate-400 uppercase font-bold">총 행수</div><div class="text-xl font-black mt-1">${data.length}<span class="text-xs font-normal text-slate-400 ml-1">건</span></div></div>
      <div class="card p-3"><div class="text-[10px] text-slate-400 uppercase font-bold">총 수량</div><div class="text-xl font-black mt-1">${totalQty.toLocaleString()}<span class="text-xs font-normal text-slate-400 ml-1">ea</span></div></div>
      <div class="card p-3"><div class="text-[10px] text-slate-400 uppercase font-bold">총 매출</div><div class="text-xl font-black mt-1">${totalSales ? Math.round(totalSales/10000).toLocaleString() : '—'}<span class="text-xs font-normal text-slate-400 ml-1">${totalSales?'만원':''}</span></div></div>`;

    /* 상태 */
    const missing = Object.entries(SU_COL_MAP)
      .filter(([l,c]) => !suDetectCol(headers, c)).map(([l]) => l);
    let statusHtml = '';
    if (!missing.length) {
      statusHtml += `<div class="flex items-center gap-2 text-xs text-emerald-600"><span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>모든 필수 열이 자동 감지되었습니다</div>`;
    } else {
      statusHtml += `<div class="flex items-center gap-2 text-xs text-amber-600"><span class="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>자동 감지 실패: <strong>${missing.join(', ')}</strong> — 위 매핑에서 직접 선택해주세요</div>`;
    }
    statusHtml += `<div class="flex items-center gap-2 text-xs text-blue-600"><span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>${data.length}건 중 상위 5행이 미리보기에 표시됩니다</div>`;
    document.getElementById('su-status-list').innerHTML = statusHtml;

    document.getElementById('su-excel-preview').classList.remove('hidden');
    document.getElementById('su-excel-confirm').classList.remove('hidden');
  }

  window.suResetExcel = function () {
    document.getElementById('su-excel-preview').classList.add('hidden');
    document.getElementById('su-excel-confirm').classList.add('hidden');
    document.getElementById('su-file-excel').value = '';
    window.__suExcelData = null;
  };

  window.suConfirmExcel = function () {
    const data = window.__suExcelData;
    if (!data || !data.length) { if (typeof window.toast === 'function') window.toast('업로드된 데이터가 없습니다', 'error'); return; }

    /* 채널 매핑 셀렉트 값 수집 */
    const colMap = {};
    document.querySelectorAll('#su-col-map select[data-label]').forEach(sel => {
      colMap[sel.dataset.label] = sel.value;
    });

    /* T_SALE에 삽입 */
    let added = 0;
    data.forEach(row => {
      const date    = row[colMap['날짜']]  || window.todayISO?.() || new Date().toISOString().split('T')[0];
      const channel = row[colMap['채널']]  || '기타';
      const product = row[colMap['제품명']] || '';
      const qty     = parseFloat(row[colMap['수량']] ) || 0;
      const price   = parseFloat(row[colMap['단가']] ) || 0;
      const total   = parseFloat(String(row[colMap['총액']] || '').replace(/[^0-9.]/g,'')) || (qty * price);
      if (!qty && !total) return;

      /* 제품 매핑 시도 */
      const prd = (window.db.master.M_PRODUCT || []).find(p =>
        p.name && product && (p.name.toLowerCase().includes(product.toLowerCase()) || product.toLowerCase().includes(p.name.toLowerCase()))
      );
      const uid = 'SALE-UP-' + Date.now() + '-' + added;
      window.db.txn.T_SALE.push({
        id: uid, date: String(date).slice(0,10), customerId: null,
        productId: prd?.productId || null, lotNo: '',
        qty, unitPrice: price, amount: total,
        note: '[업로드] 채널: ' + channel + (product ? ' / ' + product : '')
      });
      added++;
    });

    if (typeof window.logEvent === 'function') window.logEvent('매출 엑셀 업로드: ' + added + '건');
    if (typeof window.saveDB  === 'function') window.saveDB();
    if (typeof window.toast   === 'function') window.toast('✓ ' + added + '건 ERP 매출에 반영되었습니다', 'success');
    suRenderChannelAnalysis();
    suRenderAllSales();
    window.suResetExcel();
  };

  /* ─────────────────────────────────────────────
   * 이미지 OCR
   * ───────────────────────────────────────────── */
  window.suHandleImgDrop = function (e) {
    e.preventDefault();
    document.getElementById('su-drop-img')?.classList.remove('border-teal-400','bg-teal-50');
    const f = e.dataTransfer.files[0];
    if (f) suProcessImg(f);
  };
  window.suHandleImgFile = function (inp) { if (inp.files[0]) suProcessImg(inp.files[0]); };

  function suProcessImg(file) {
    window.__suImgFile = file;
    const reader = new FileReader();
    reader.onload = function (e) {
      window.__suImgBase64 = e.target.result;
      document.getElementById('su-img-thumb').src = e.target.result;
      document.getElementById('su-img-preview').classList.remove('hidden');
      document.getElementById('su-drop-img').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  window.suResetImg = function () {
    window.__suImgFile = null; window.__suImgBase64 = null;
    document.getElementById('su-file-img').value = '';
    document.getElementById('su-img-preview').classList.add('hidden');
    document.getElementById('su-ocr-section').classList.add('hidden');
    document.getElementById('su-drop-img').classList.remove('hidden');
  };

  window.suRunOCR = async function () {
    document.getElementById('su-ocr-section').classList.remove('hidden');
    document.getElementById('su-ocr-result').innerHTML =
      '<div class="flex items-center gap-2 text-slate-400 text-xs"><div class="w-3 h-3 border-2 border-slate-300 border-t-teal-500 rounded-full animate-spin"></div>AI가 이미지를 분석 중…</div>';
    ['su-ocr-date','su-ocr-ch','su-ocr-product','su-ocr-qty','su-ocr-price','su-ocr-total'].forEach(id => {
      const el = document.getElementById(id); if (el && el.tagName === 'INPUT') el.value = '';
    });

    if (!window.__suImgBase64) { if (typeof window.toast === 'function') window.toast('이미지를 먼저 선택해주세요', 'error'); return; }

    try {
      const base64data  = window.__suImgBase64.split(',')[1];
      const mediaType   = window.__suImgFile?.type || 'image/jpeg';

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 800,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64data } },
              { type: 'text', text: '이 이미지는 판매 영수증 또는 주문 내역입니다. JSON만 출력하세요 (설명 없이):\n{"date":"YYYY-MM-DD","channel":"채널명","product":"제품명","qty":수량숫자,"price":단가숫자,"total":총액숫자}\n숫자는 쉼표 없이. 없는 항목은 null.' }
            ]
          }]
        })
      });

      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      let parsed = {};
      try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch (e) {}

      document.getElementById('su-ocr-result').innerHTML =
        '<div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">' +
        Object.entries(parsed).filter(([,v]) => v !== null).map(([k,v]) =>
          `<div class="text-slate-400">${k}</div><div class="font-bold">${v}</div>`
        ).join('') + '</div>';

      const today = window.todayISO?.() || new Date().toISOString().split('T')[0];
      if (parsed.date)    document.getElementById('su-ocr-date').value    = parsed.date;
      else                document.getElementById('su-ocr-date').value    = today;
      if (parsed.channel) document.getElementById('su-ocr-ch').value      = parsed.channel;
      if (parsed.product) document.getElementById('su-ocr-product').value = parsed.product;
      if (parsed.qty)     document.getElementById('su-ocr-qty').value     = parsed.qty;
      if (parsed.price)   document.getElementById('su-ocr-price').value   = parsed.price;
      const tot = parsed.total || ((parsed.qty||0) * (parsed.price||0));
      if (tot) document.getElementById('su-ocr-total').value = Number(tot).toLocaleString() + '원';

    } catch (err) {
      document.getElementById('su-ocr-result').innerHTML =
        `<span class="text-red-500 text-xs">분석 오류: ${err.message}</span>`;
    }
  };

  window.suCalcOcrTotal = function () {
    const q = parseFloat(document.getElementById('su-ocr-qty')?.value) || 0;
    const p = parseFloat(document.getElementById('su-ocr-price')?.value) || 0;
    if (q && p) document.getElementById('su-ocr-total').value = (q * p).toLocaleString() + '원';
  };

  window.suConfirmOCR = function () {
    const prod    = document.getElementById('su-ocr-product')?.value;
    const qty     = parseFloat(document.getElementById('su-ocr-qty')?.value) || 0;
    const price   = parseFloat(document.getElementById('su-ocr-price')?.value) || 0;
    const date    = document.getElementById('su-ocr-date')?.value || window.todayISO?.() || new Date().toISOString().split('T')[0];
    const channel = document.getElementById('su-ocr-ch')?.value || '기타';
    if (!qty) { if (typeof window.toast === 'function') window.toast('수량을 확인해주세요', 'error'); return; }
    const prd = (window.db.master.M_PRODUCT || []).find(p =>
      p.name && prod && (p.name.toLowerCase().includes(prod.toLowerCase()) || prod.toLowerCase().includes(p.name.toLowerCase()))
    );
    const total = qty * price;
    window.db.txn.T_SALE.push({
      id: 'SALE-OCR-' + Date.now(), date, customerId: null,
      productId: prd?.productId || null, lotNo: '',
      qty, unitPrice: price, amount: total,
      note: '[OCR] 채널: ' + channel + (prod ? ' / ' + prod : '')
    });
    if (typeof window.logEvent === 'function') window.logEvent('매출 OCR 등록: ' + channel + ' / ' + (prod||'') + ' / ' + qty + 'ea');
    if (typeof window.saveDB  === 'function') window.saveDB();
    if (typeof window.toast   === 'function') window.toast('✓ OCR 매출 반영 완료', 'success');
    suRenderChannelAnalysis();
    suRenderAllSales();
    window.suResetImg();
  };

  /* ─────────────────────────────────────────────
   * 직접 입력
   * ───────────────────────────────────────────── */
  window.suCalcManual = function () {
    const q = parseFloat(document.getElementById('su-m-qty')?.value) || 0;
    const p = parseFloat(document.getElementById('su-m-price')?.value) || 0;
    const d = parseFloat(document.getElementById('su-m-disc')?.value) || 0;
    const net = q * p - d;
    const el = document.getElementById('su-m-net');
    if (el) el.value = net > 0 ? net.toLocaleString() + '원' : '';
  };
  window.suClearManual = function () {
    ['su-m-qty','su-m-price','su-m-disc','su-m-net','su-m-note'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  };
  window.suConfirmManual = function () {
    const qty     = parseFloat(document.getElementById('su-m-qty')?.value) || 0;
    const price   = parseFloat(document.getElementById('su-m-price')?.value) || 0;
    const disc    = parseFloat(document.getElementById('su-m-disc')?.value) || 0;
    const date    = document.getElementById('su-m-date')?.value || window.todayISO?.() || new Date().toISOString().split('T')[0];
    const channel = document.getElementById('su-m-ch')?.value || '기타';
    const prodId  = document.getElementById('su-m-product')?.value;
    const note    = document.getElementById('su-m-note')?.value?.trim() || '';
    if (!qty) { if (typeof window.toast === 'function') window.toast('수량을 입력해주세요', 'error'); return; }
    const net = qty * price - disc;
    window.db.txn.T_SALE.push({
      id: 'SALE-M-' + Date.now(), date, customerId: null,
      productId: prodId ? Number(prodId) : null, lotNo: '',
      qty, unitPrice: price, amount: net,
      note: '[직접입력] 채널: ' + channel + (note ? ' / ' + note : '')
    });
    const prd = window.db.master.M_PRODUCT?.find(p => String(p.productId) === String(prodId));
    if (typeof window.logEvent === 'function') window.logEvent('매출 직접입력: ' + channel + ' / ' + (prd?.name||'') + ' / ' + qty + 'ea');
    if (typeof window.saveDB  === 'function') window.saveDB();
    if (typeof window.toast   === 'function') window.toast('✓ 매출 반영 완료', 'success');
    suRenderChannelAnalysis();
    suRenderAllSales();
    window.suClearManual();
  };

  /* ─────────────────────────────────────────────
   * 채널별 분석 — 기간 필터 + 탭(채널/제품/월별)
   * ───────────────────────────────────────────── */

  /* 현재 활성 분석 탭 상태 */
  let _suActiveTab = 'ch';
  let _suMonthlyChart = null;

  /* 기간 단축 버튼 */
  window.suSetPeriod = function (days) {
    const today = (typeof window.todayISO === 'function') ? window.todayISO() : new Date().toISOString().split('T')[0];
    const toEl   = document.getElementById('su-filter-to');
    const fromEl = document.getElementById('su-filter-from');
    if (toEl)   toEl.value = today;
    if (fromEl) {
      if (days === 0) { fromEl.value = '2000-01-01'; }
      else {
        const d = new Date(today); d.setDate(d.getDate() - days);
        fromEl.value = d.toISOString().split('T')[0];
      }
    }
    suRenderChannelAnalysis();
  };

  /* 분석 탭 전환 */
  window.suAnalysisTab = function (t) {
    _suActiveTab = t;
    ['ch','prd','mon'].forEach(k => {
      document.getElementById('su-apanel-' + k)?.classList.toggle('hidden', k !== t);
      document.getElementById('su-atab-'   + k)?.classList.toggle('active', k === t);
    });
    if (t === 'mon') suRenderMonthlyChart();
  };

  /* 필터링된 매출 배열 반환 */
  function suFilteredSales () {
    const from = document.getElementById('su-filter-from')?.value || '';
    const to   = document.getElementById('su-filter-to')?.value   || '9999-12-31';
    return (window.db?.txn?.T_SALE || []).filter(r => {
      const d = r.date || '';
      return (!from || d >= from) && d <= to;
    });
  }

  /* 채널 추출 헬퍼 */
  function suGetChannel (r) {
    const cust = (window.db?.master?.M_CUSTOMER || []).find(c => String(c.customerId) === String(r.customerId));
    if (cust?.channel) return cust.channel;
    if (r.note) { const m = r.note.match(/채널:\s*([^\s/,]+)/); if (m) return m[1]; }
    return '기타';
  }

  window.suRenderChannelAnalysis = function () {
    const sales = suFilteredSales();
    const totalRevenue = sales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalQty     = sales.reduce((s, r) => s + (Number(r.qty)    || 0), 0);

    /* KPI */
    const kpiEl = document.getElementById('su-channel-kpis');
    if (kpiEl) {
      const avgOrder = sales.length ? Math.round(totalRevenue / sales.length) : 0;
      const chSet = new Set(sales.map(r => suGetChannel(r)));
      kpiEl.innerHTML = `
        <div class="card p-3"><div class="text-[10px] uppercase font-bold text-slate-400">총 매출</div>
          <div class="text-xl font-black mt-1">${Math.round(totalRevenue/10000).toLocaleString()}<span class="text-xs font-normal text-slate-400 ml-1">만원</span></div></div>
        <div class="card p-3"><div class="text-[10px] uppercase font-bold text-slate-400">출고건수</div>
          <div class="text-xl font-black mt-1">${sales.length}<span class="text-xs font-normal text-slate-400 ml-1">건</span></div></div>
        <div class="card p-3"><div class="text-[10px] uppercase font-bold text-slate-400">총 출고수량</div>
          <div class="text-xl font-black mt-1">${totalQty.toLocaleString()}<span class="text-xs font-normal text-slate-400 ml-1">ea</span></div></div>
        <div class="card p-3"><div class="text-[10px] uppercase font-bold text-slate-400">평균 주문금액</div>
          <div class="text-xl font-black mt-1">${avgOrder.toLocaleString()}<span class="text-xs font-normal text-slate-400 ml-1">원</span></div></div>`;
    }

    /* ── 채널별 테이블 ── */
    const chMap = {};
    sales.forEach(r => {
      const ch = suGetChannel(r);
      if (!chMap[ch]) chMap[ch] = { ch, custSet: new Set(), cnt: 0, qty: 0, amount: 0 };
      if (r.customerId) chMap[ch].custSet.add(r.customerId);
      chMap[ch].cnt++;
      chMap[ch].qty    += Number(r.qty)    || 0;
      chMap[ch].amount += Number(r.amount) || 0;
    });
    const tbody = document.getElementById('tbl-channel-sales2');
    if (tbody) {
      tbody.innerHTML = Object.values(chMap).sort((a,b) => b.amount - a.amount).map(r => {
        const pct = totalRevenue > 0 ? (r.amount / totalRevenue * 100).toFixed(1) : '0';
        const avg = r.cnt > 0 ? Math.round(r.amount / r.cnt) : 0;
        return `<tr>
          <td class="pl-4 font-bold">${r.ch}</td>
          <td class="text-xs">${r.custSet.size}명</td>
          <td class="text-right">${r.cnt}건</td>
          <td class="text-right">${r.qty.toLocaleString()}</td>
          <td class="text-right font-bold">${Math.round(r.amount).toLocaleString()}원</td>
          <td class="text-right text-slate-500">${avg.toLocaleString()}원</td>
          <td class="text-right pr-4">
            <div class="flex items-center justify-end gap-2">
              <div class="bg-teal-100 rounded-full h-1.5 w-16 overflow-hidden">
                <div class="bg-teal-500 h-full rounded-full" style="width:${pct}%"></div>
              </div>
              <span class="text-xs font-bold text-slate-600">${pct}%</span>
            </div>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="text-center py-5 text-slate-400">출고 데이터가 없습니다</td></tr>';
    }

    /* ── 제품별 테이블 ── */
    const prdMap = {};
    sales.forEach(r => {
      const prd = (window.db?.master?.M_PRODUCT || []).find(p => String(p.productId) === String(r.productId));
      const key = prd?.name || (r.note?.match(/\/\s*(.+)/)?.[1]?.trim() || '기타');
      if (!prdMap[key]) prdMap[key] = { name: key, cnt: 0, qty: 0, amount: 0 };
      prdMap[key].cnt++;
      prdMap[key].qty    += Number(r.qty)    || 0;
      prdMap[key].amount += Number(r.amount) || 0;
    });
    const prdBody = document.getElementById('tbl-product-sales2');
    if (prdBody) {
      prdBody.innerHTML = Object.values(prdMap).sort((a,b) => b.amount - a.amount).map(r => {
        const pct = totalRevenue > 0 ? (r.amount / totalRevenue * 100).toFixed(1) : '0';
        const avg = r.qty > 0 ? Math.round(r.amount / r.qty) : 0;
        return `<tr>
          <td class="pl-4 font-bold text-xs">${r.name}</td>
          <td class="text-right">${r.cnt}건</td>
          <td class="text-right">${r.qty.toLocaleString()}</td>
          <td class="text-right font-bold">${Math.round(r.amount).toLocaleString()}원</td>
          <td class="text-right text-slate-500">${avg.toLocaleString()}원</td>
          <td class="text-right pr-4">
            <div class="flex items-center justify-end gap-2">
              <div class="bg-violet-100 rounded-full h-1.5 w-16 overflow-hidden">
                <div class="bg-violet-400 h-full rounded-full" style="width:${pct}%"></div>
              </div>
              <span class="text-xs font-bold text-slate-600">${pct}%</span>
            </div>
          </td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="text-center py-5 text-slate-400">출고 데이터가 없습니다</td></tr>';
    }

    /* 현재 탭이 월별이면 차트도 갱신 */
    if (_suActiveTab === 'mon') suRenderMonthlyChart();
  };

  /* ── 월별 추이 차트 + 테이블 ── */
  function suRenderMonthlyChart () {
    const sales = suFilteredSales();

    /* 월별 집계 */
    const monMap = {};
    sales.forEach(r => {
      const ym = (r.date || '').slice(0, 7);
      if (!ym) return;
      if (!monMap[ym]) monMap[ym] = { ym, cnt: 0, qty: 0, amount: 0 };
      monMap[ym].cnt++;
      monMap[ym].qty    += Number(r.qty)    || 0;
      monMap[ym].amount += Number(r.amount) || 0;
    });
    const rows = Object.values(monMap).sort((a, b) => a.ym.localeCompare(b.ym));

    /* 테이블 */
    const tbody = document.getElementById('tbl-monthly-sales2');
    if (tbody) {
      tbody.innerHTML = rows.map(r =>
        `<tr>
          <td class="pl-4 font-bold mono text-xs">${r.ym}</td>
          <td class="text-right">${r.cnt}건</td>
          <td class="text-right">${r.qty.toLocaleString()}</td>
          <td class="text-right font-bold pr-4">${Math.round(r.amount).toLocaleString()}원</td>
        </tr>`
      ).join('') || '<tr><td colspan="4" class="text-center py-5 text-slate-400">데이터 없음</td></tr>';
    }

    /* 차트 */
    const canvas = document.getElementById('su-monthly-chart');
    if (!canvas || !window.Chart) return;
    if (_suMonthlyChart) { try { _suMonthlyChart.destroy(); } catch(e) {} }
    try {
      _suMonthlyChart = new window.Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: rows.map(r => r.ym),
          datasets: [
            {
              label: '매출 (원)',
              data: rows.map(r => r.amount),
              backgroundColor: 'rgba(13,148,136,.75)',
              borderRadius: 4,
              yAxisID: 'yAmt'
            },
            {
              label: '수량',
              data: rows.map(r => r.qty),
              type: 'line',
              borderColor: '#f59e0b',
              backgroundColor: 'transparent',
              tension: 0.3,
              pointRadius: 4,
              yAxisID: 'yQty'
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
          scales: {
            yAmt: { position: 'left',  beginAtZero: true, ticks: { callback: v => (v/10000).toFixed(0)+'만', font: { size: 10 } } },
            yQty: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } }
          }
        }
      });
    } catch(e) { console.warn('chart error', e); }
  }

  /* ─────────────────────────────────────────────
   * 매출 등록 이력 — 수정/삭제 버튼 포함
   * ───────────────────────────────────────────── */
  window.suRenderAllSales = function () {
    const tbody = document.getElementById('tbl-all-sales');
    const cntEl = document.getElementById('su-sale-count');
    if (!tbody) return;
    const sales = [...(window.db?.txn?.T_SALE || [])].reverse();
    if (cntEl) cntEl.textContent = sales.length;
    tbody.innerHTML = sales.map(r => {
      const prd  = (window.db?.master?.M_PRODUCT || []).find(p => String(p.productId) === String(r.productId));
      const cust = (window.db?.master?.M_CUSTOMER || []).find(c => String(c.customerId) === String(r.customerId));
      const ch   = suGetChannel(r);
      const safeId = String(r.id).replace(/'/g, "\\'");
      return `<tr>
        <td class="pl-4 text-xs">${r.date || '-'}</td>
        <td class="text-xs"><span class="badge-soft">${ch}</span></td>
        <td class="text-xs">${cust?.name || '-'}</td>
        <td class="text-xs font-bold">${prd?.name || (r.note?.split('/')[1]?.trim() || '-')}</td>
        <td><span class="lot-badge fgt text-[9px]">${r.lotNo || '-'}</span></td>
        <td class="text-right">${r.qty || 0}</td>
        <td class="text-right font-bold">${Math.round(r.amount || 0).toLocaleString()}원</td>
        <td class="text-center pr-4">
          <div class="flex justify-center gap-1">
            <button onclick="suOpenEditModal('${safeId}')"
              class="btn btn-secondary btn-sm">수정</button>
            <button onclick="suDeleteSale('${safeId}')"
              class="btn btn-danger btn-sm">삭제</button>
          </div>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="text-center py-5 text-slate-400">매출 이력이 없습니다</td></tr>';
  };

  /* ─────────────────────────────────────────────
   * 수정 모달
   * ───────────────────────────────────────────── */
  window.suOpenEditModal = function (saleId) {
    const r = (window.db?.txn?.T_SALE || []).find(x => String(x.id) === String(saleId));
    if (!r) return;

    /* 제품 셀렉트 채우기 */
    const prdSel = document.getElementById('su-edit-product');
    if (prdSel) {
      prdSel.innerHTML = '<option value="">제품 선택</option>' +
        (window.db?.master?.M_PRODUCT || []).map(p =>
          `<option value="${p.productId}">${p.name}</option>`
        ).join('');
    }

    /* 값 세팅 */
    document.getElementById('su-edit-id').value      = r.id;
    document.getElementById('su-edit-date').value    = r.date  || '';
    document.getElementById('su-edit-qty').value     = r.qty   || '';
    document.getElementById('su-edit-price').value   = r.unitPrice || '';
    document.getElementById('su-edit-amount').value  = r.amount || '';
    document.getElementById('su-edit-lot').value     = r.lotNo || '';
    document.getElementById('su-edit-note').value    = r.note  || '';
    if (prdSel) prdSel.value = r.productId || '';

    /* 채널 세팅 */
    const chSel = document.getElementById('su-edit-ch');
    if (chSel) chSel.value = suGetChannel(r);

    /* 모달 표시 */
    const modal = document.getElementById('su-edit-modal');
    if (modal) modal.style.display = 'flex';
  };

  window.suCloseEditModal = function () {
    const modal = document.getElementById('su-edit-modal');
    if (modal) modal.style.display = 'none';
  };

  window.suCalcEditTotal = function () {
    const q = parseFloat(document.getElementById('su-edit-qty')?.value) || 0;
    const p = parseFloat(document.getElementById('su-edit-price')?.value) || 0;
    if (q && p) document.getElementById('su-edit-amount').value = q * p;
  };

  window.suSaveEdit = function () {
    const saleId = document.getElementById('su-edit-id')?.value;
    const idx = (window.db?.txn?.T_SALE || []).findIndex(x => String(x.id) === String(saleId));
    if (idx < 0) { if (typeof window.toast === 'function') window.toast('데이터를 찾을 수 없습니다', 'error'); return; }

    const r = window.db.txn.T_SALE[idx];
    const ch      = document.getElementById('su-edit-ch')?.value      || '';
    const prodId  = document.getElementById('su-edit-product')?.value || null;
    const qty     = parseFloat(document.getElementById('su-edit-qty')?.value)    || r.qty;
    const price   = parseFloat(document.getElementById('su-edit-price')?.value)  || r.unitPrice;
    const amount  = parseFloat(document.getElementById('su-edit-amount')?.value) || (qty * price);

    /* note에서 채널 부분 업데이트 */
    let note = document.getElementById('su-edit-note')?.value || r.note || '';
    note = note.replace(/채널:\s*[^\s/,]+/, '채널: ' + ch);
    if (!note.includes('채널:')) note = '[수정] 채널: ' + ch + (note ? ' / ' + note : '');

    window.db.txn.T_SALE[idx] = {
      ...r,
      date:       document.getElementById('su-edit-date')?.value || r.date,
      productId:  prodId ? Number(prodId) : r.productId,
      qty, unitPrice: price, amount,
      lotNo:      document.getElementById('su-edit-lot')?.value  || r.lotNo,
      note
    };

    if (typeof window.logEvent === 'function') window.logEvent('매출 수정: ' + saleId);
    if (typeof window.saveDB   === 'function') window.saveDB();
    if (typeof window.toast    === 'function') window.toast('✓ 수정 완료', 'success');
    window.suCloseEditModal();
    suRenderChannelAnalysis();
    suRenderAllSales();
  };

  /* ── 삭제 ── */
  window.suDeleteSale = function (saleId) {
    const r = (window.db?.txn?.T_SALE || []).find(x => String(x.id) === String(saleId));
    if (!r) return;
    const prd  = (window.db?.master?.M_PRODUCT || []).find(p => String(p.productId) === String(r.productId));
    const label = (prd?.name || '') + ' ' + (r.qty || '') + 'ea ' + (r.date || '');
    if (!confirm(`매출 [${label.trim()}] 을 삭제하시겠습니까?`)) return;
    window.db.txn.T_SALE = window.db.txn.T_SALE.filter(x => String(x.id) !== String(saleId));
    if (typeof window.logEvent === 'function') window.logEvent('매출 삭제: ' + saleId);
    if (typeof window.saveDB   === 'function') window.saveDB();
    if (typeof window.toast    === 'function') window.toast('삭제 완료', 'success');
    suRenderChannelAnalysis();
    suRenderAllSales();
  };

  /* 모달 바깥 클릭 시 닫기 */
  document.addEventListener('click', function (e) {
    const modal = document.getElementById('su-edit-modal');
    if (modal && modal.style.display === 'flex' && e.target === modal) {
      window.suCloseEditModal();
    }
  });

  /* ─────────────────────────────────────────────
   * PATCH 5: initNewPage 확장 - channel-sales 라우팅
   * ───────────────────────────────────────────── */
  const __patchInitNewPage = window.initNewPage;
  window.initNewPage = function (pageId) {
    try { if (typeof __patchInitNewPage === 'function') __patchInitNewPage(pageId); } catch (e) { console.error(e); }
    if (pageId === 'channel-sales') {
      buildSalesUploadSection();
    }
  };

  /* ─────────────────────────────────────────────
   * PATCH 6: goPage 확장 - channel-sales 라우팅
   * ───────────────────────────────────────────── */
  const __patchGoPage = window.goPage;
  window.goPage = function (id) {
    const r = typeof __patchGoPage === 'function' ? __patchGoPage.apply(this, arguments) : undefined;
    if (id === 'channel-sales') {
      setTimeout(() => {
        buildSalesUploadSection();
      }, 50);
    }
    return r;
  };

  /* ─────────────────────────────────────────────
   * PATCH 7: 다른 탭 실시간 동기화 안전 처리
   *          (storage 이벤트에서 빈 데이터 덮어쓰기 방지)
   * ───────────────────────────────────────────── */
  window.addEventListener('storage', function (ev) {
    const STORAGE_KEY = window.STORAGE_KEY || 'shifti_erp_v2';
    if (ev.key === STORAGE_KEY && ev.newValue) {
      try {
        const incoming = JSON.parse(ev.newValue);
        /* 빈 데이터면 무시 */
        const hasData = incoming?.master && (
          (incoming.master.M_RAW     || []).length > 0 ||
          (incoming.master.M_PRODUCT || []).length > 0
        );
        if (!hasData) return;
        const inAt = new Date(incoming?.meta?.updatedAt || 0);
        const curAt = new Date(window.db?.meta?.updatedAt || 0);
        if (inAt > curAt) {
          window.db = incoming;
          try { if (typeof window.renderAll === 'function') window.renderAll(); } catch (e) {}
          if (typeof window._setCS === 'function') window._setCS('🔄', '다른 기기에서 동기화됨');
        }
      } catch (e) {}
    }
  });

  /* ─────────────────────────────────────────────
   * 초기화: 페이지 로드 후 적용
   * ───────────────────────────────────────────── */
  window.addEventListener('load', function () {
    setTimeout(() => {
      /* 현재 활성 섹션이 channel-sales라면 바로 빌드 */
      const active = document.querySelector('.page-section.active');
      if (active && active.id === 'page-channel-sales') {
        buildSalesUploadSection();
      }
      /* 매출 분석 메뉴 클릭 시 바로 빌드되도록 nav 이벤트 보강 */
      const navBtn = document.getElementById('nav-channel-sales');
      if (navBtn) {
        navBtn.addEventListener('click', function () {
          setTimeout(buildSalesUploadSection, 60);
        });
      }
    }, 300);
  });

  /* ═══════════════════════════════════════════════════════
   * ALLERGEN → ERP 원료 업로드 CSV 변환기
   * 원료마스터 페이지에 변환 도구 패널 삽입
   * ═══════════════════════════════════════════════════════ */

  function buildAllergenConverter () {
    /* 이미 삽입됐으면 스킵 */
    if (document.getElementById('allergen-converter-panel')) return;

    const sec = document.getElementById('page-master-raw');
    if (!sec) return;

    const panel = document.createElement('div');
    panel.id = 'allergen-converter-panel';
    panel.className = 'card p-4 space-y-3';
    panel.style.borderLeft = '4px solid #0d9488';
    panel.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-bold text-slate-700 text-sm">알레르겐 성분표 → 원료 CSV 변환기</h3>
          <p class="text-[10.5px] text-slate-400 mt-0.5">㈜한빛향료 등 공급사의 ALLERGEN 26 엑셀 파일을 ERP 원료 업로드 양식으로 자동 변환합니다</p>
        </div>
        <span class="badge-teal text-[10px]">XLS → CSV</span>
      </div>

      <!-- 드롭존 -->
      <div id="ac-drop"
        class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50 transition"
        onclick="document.getElementById('ac-file').click()"
        ondragover="event.preventDefault();this.classList.add('border-teal-400','bg-teal-50')"
        ondragleave="this.classList.remove('border-teal-400','bg-teal-50')"
        ondrop="acHandleDrop(event)">
        <div class="text-3xl mb-2">🧪</div>
        <div class="font-black text-sm text-slate-700">알레르겐 파일을 드래그하거나 클릭</div>
        <div class="text-xs text-slate-400 mt-1">ALLERGEN_26_*.xls / *.xlsx 형식</div>
        <div class="flex justify-center gap-2 mt-2">
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.xls</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500">.xlsx</span>
        </div>
      </div>
      <input type="file" id="ac-file" accept=".xls,.xlsx" class="hidden" onchange="acHandleFile(this)">

      <!-- 변환 결과 -->
      <div id="ac-result" class="hidden space-y-3">
        <!-- 향료 정보 요약 -->
        <div id="ac-info" class="bg-teal-50 border border-teal-200 rounded-lg p-3 text-xs space-y-1"></div>

        <!-- 변환 옵션 -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[10.5px] font-bold text-slate-500 mb-1">변환 모드</label>
            <select id="ac-mode" class="input-field text-xs" onchange="acRenderPreview()">
              <option value="fragrance">향료 원료 1개로 등록 (추천)</option>
              <option value="components">알레르겐 성분 개별 등록</option>
              <option value="both">향료 + 성분 모두 등록</option>
            </select>
          </div>
          <div>
            <label class="block text-[10.5px] font-bold text-slate-500 mb-1">표준단가 (원/kg)</label>
            <input type="number" id="ac-stdcost" class="input-field text-xs" placeholder="0" value="0" oninput="acRenderPreview()">
          </div>
        </div>

        <!-- 미리보기 테이블 -->
        <div class="border rounded-lg overflow-hidden">
          <div class="bg-slate-50 px-3 py-2 text-[10.5px] font-bold text-slate-500 flex justify-between items-center">
            <span>변환 미리보기</span>
            <span id="ac-row-count" class="badge-soft">0행</span>
          </div>
          <div class="overflow-x-auto max-h-56">
            <table id="ac-preview-tbl" class="w-full text-xs"></table>
          </div>
        </div>

        <!-- 알레르겐 플래그 요약 -->
        <div id="ac-allergen-summary" class="text-[10.5px] text-slate-500 bg-amber-50 border border-amber-200 rounded p-2"></div>

        <!-- 버튼 -->
        <div class="flex gap-2 justify-end">
          <button onclick="acReset()" class="btn btn-secondary btn-sm">초기화</button>
          <button onclick="acDownloadCSV()" class="btn btn-secondary btn-sm">📥 CSV 다운로드</button>
          <button onclick="acImportDirect()" class="btn btn-primary btn-sm">⚡ ERP 직접 반영</button>
        </div>
      </div>
    `;

    /* 페이지 상단 h2 다음에 삽입 */
    const h2 = sec.querySelector('h2');
    if (h2 && h2.nextSibling) {
      sec.insertBefore(panel, h2.nextSibling);
    } else {
      sec.prepend(panel);
    }
  }

  /* ── 드롭/파일 핸들러 ── */
  window.acHandleDrop = function (e) {
    e.preventDefault();
    document.getElementById('ac-drop')?.classList.remove('border-teal-400','bg-teal-50');
    const f = e.dataTransfer.files[0];
    if (f) acProcessFile(f);
  };
  window.acHandleFile = function (inp) {
    if (inp.files[0]) acProcessFile(inp.files[0]);
  };

  /* ── 파일 파싱 ── */
  function acProcessFile (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        if (!window.XLSX) throw new Error('SheetJS 미로드');
        const wb   = XLSX.read(e.target.result, { type: 'binary' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        /* 메타 추출 */
        let fragName = '', vendor = '', customer = '';
        data.forEach(row => {
          const r = row.map(c => String(c).trim());
          if (r[0] === 'Fragrance Name:') fragName  = r[1] || '';
          if (r[0] === 'Vendor:')          vendor    = r[1] || '';
          if (r[0] === 'Customer Name:')   customer  = r[1] || '';
        });

        /* 헤더 행 찾기 */
        let headerIdx = -1;
        data.forEach((row, i) => {
          if (String(row[0]).trim() === 'INGREDIENT NAME') headerIdx = i;
        });
        if (headerIdx < 0) throw new Error('INGREDIENT NAME 헤더를 찾을 수 없습니다');

        /* 성분 파싱 */
        const components = [];
        for (let i = headerIdx + 1; i < data.length; i++) {
          const row  = data[i];
          const name = String(row[0] || '').trim().replace(/\n/g, ' ');
          const cas  = String(row[1] || '').trim();
          const pct  = parseFloat(row[2]) || 0;
          if (!name || !cas || name.startsWith('Title') || name.startsWith('Name') || name.startsWith('Signature')) continue;
          components.push({ name, cas, pct, isAllergen: true });
        }

        /* EU 26 알레르겐 중 함량 > 0 인 것 */
        const active = components.filter(c => c.pct > 0);

        window.__acData = { fragName, vendor, customer, components, active, fileName: file.name };
        acRenderInfo();
        acRenderPreview();
        document.getElementById('ac-result').classList.remove('hidden');
        document.getElementById('ac-drop').classList.add('hidden');

      } catch (err) {
        if (typeof window.toast === 'function') window.toast('파일 파싱 실패: ' + err.message, 'error');
        console.error(err);
      }
    };
    reader.readAsBinaryString(file);
  }

  /* ── 정보 요약 ── */
  function acRenderInfo () {
    const d = window.__acData; if (!d) return;
    const el = document.getElementById('ac-info'); if (!el) return;
    el.innerHTML = `
      <div class="grid grid-cols-2 gap-x-6 gap-y-0.5">
        <div><span class="text-slate-400">향료명</span> <strong>${d.fragName || '-'}</strong></div>
        <div><span class="text-slate-400">공급사</span> <strong>${d.vendor || '-'}</strong></div>
        <div><span class="text-slate-400">고객사</span> <strong>${d.customer || '-'}</strong></div>
        <div><span class="text-slate-400">전체 성분</span> <strong>${d.components.length}종</strong>
          · 함량 있음 <strong class="text-amber-600">${d.active.length}종</strong></div>
      </div>`;
  }

  /* ── 변환 로우 생성 ── */
  function acBuildRows () {
    const d    = window.__acData; if (!d) return [];
    const mode = document.getElementById('ac-mode')?.value || 'fragrance';
    const cost = document.getElementById('ac-stdcost')?.value || '0';
    const rows = [];

    /* 향료 원료 1행 */
    const fragranceRow = {
      code:        'RM-FRG-' + (d.fragName.replace(/[^A-Z0-9]/gi,'').toUpperCase().slice(0,12) || 'UNKNOWN'),
      name:        d.fragName,
      inci:        'Fragrance',
      unit:        'kg',
      supplier:    d.vendor,
      shelf_days:  '730',
      std_cost:    cost,
      storage:     '실온',
      ifra_category: '4',
      ifra_limit:  '25',
      is_allergen: d.active.length > 0 ? '1' : '0',
      cas:         '',
      allergen_pct:'',
      note:        'EU26 알레르겐 함유: ' + d.active.map(c => c.name + '(' + c.pct + '%)').join(', ')
    };

    /* 알레르겐 개별 성분 행 */
    const componentRows = d.active.map((c, i) => ({
      code:         'RM-ALC-' + c.cas.replace(/[^0-9]/g,''),
      name:         c.name,
      inci:         c.name,
      unit:         'kg',
      supplier:     d.vendor,
      shelf_days:   '730',
      std_cost:     '0',
      storage:      '실온',
      ifra_category:'',
      ifra_limit:   '',
      is_allergen:  '1',
      cas:          c.cas,
      allergen_pct: String(c.pct),
      note:         '알레르겐 / 향료: ' + d.fragName + ' 내 ' + c.pct + '%'
    }));

    if (mode === 'fragrance') rows.push(fragranceRow);
    else if (mode === 'components') rows.push(...componentRows);
    else { rows.push(fragranceRow); rows.push(...componentRows); }

    return rows;
  }

  /* ── 미리보기 ── */
  window.acRenderPreview = function () {
    const rows = acBuildRows();
    const tbl  = document.getElementById('ac-preview-tbl'); if (!tbl) return;
    const cntEl = document.getElementById('ac-row-count');
    if (cntEl) cntEl.textContent = rows.length + '행';

    const COLS = ['code','name','inci','unit','supplier','std_cost','is_allergen','cas','allergen_pct'];
    const HEAD = ['코드','원료명','INCI명','단위','공급사','표준단가','알레르겐','CAS #','알레르겐 함량(%)'];

    tbl.innerHTML =
      '<thead><tr>' + HEAD.map(h => `<th>${h}</th>`).join('') + '</tr></thead>' +
      '<tbody>' + rows.map(r =>
        '<tr>' + COLS.map(c => `<td>${r[c] || '-'}</td>`).join('') + '</tr>'
      ).join('') + '</tbody>';

    /* 알레르겐 요약 */
    const d = window.__acData;
    const sumEl = document.getElementById('ac-allergen-summary');
    if (sumEl && d) {
      sumEl.innerHTML = `⚠️ 함량 있는 EU26 알레르겐 ${d.active.length}종: `
        + d.active.map(c => `<strong>${c.name}</strong> ${c.pct}%`).join(' · ');
    }
  };

  /* ── CSV 다운로드 ── */
  window.acDownloadCSV = function () {
    const rows = acBuildRows();
    if (!rows.length) return;
    const COLS = ['code','name','inci','unit','supplier','shelf_days','std_cost','storage',
                  'ifra_category','ifra_limit','is_allergen','cas','allergen_pct','note'];
    const HEAD = ['code','name','inci','unit','supplier','shelf_days','std_cost','storage',
                  'ifra_category','ifra_limit','is_allergen','cas','allergen_pct','note'];
    const csv  = [HEAD.join(','), ...rows.map(r =>
      COLS.map(c => '"' + String(r[c] || '').replace(/"/g,'""') + '"').join(',')
    )].join('\n');

    const d    = window.__acData;
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'raw_upload_' + (d?.fragName || 'allergen').replace(/\s/g,'_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    if (typeof window.toast === 'function') window.toast('CSV 다운로드 완료', 'success');
  };

  /* ── ERP 직접 반영 ── */
  window.acImportDirect = function () {
    const rows = acBuildRows();
    if (!rows.length) return;
    if (!window.db?.master?.M_RAW) { if (typeof window.toast === 'function') window.toast('DB가 준비되지 않았습니다', 'error'); return; }

    let created = 0, updated = 0;
    rows.forEach((r, i) => {
      const code = (r.code || '').toLowerCase();
      const name = (r.name || '').toLowerCase();
      const existing = window.db.master.M_RAW.find(x =>
        (code && String(x.code||'').toLowerCase() === code) ||
        (!code && name && String(x.name||'').toLowerCase() === name)
      );
      const payload = {
        code:         r.code || '',
        name:         r.name || '',
        inci:         r.inci || '',
        unit:         r.unit || 'kg',
        supplier:     r.supplier || '',
        shelfDays:    parseInt(r.shelf_days) || 730,
        stdCost:      parseFloat(r.std_cost) || 0,
        storage:      r.storage || '실온',
        ifraCategory: r.ifra_category || '',
        ifraLimit:    parseFloat(r.ifra_limit) || 0,
        isAllergen:   r.is_allergen === '1' || r.is_allergen === true,
        cas:          r.cas || '',
        allergenPct:  parseFloat(r.allergen_pct) || 0,
        note:         r.note || ''
      };
      if (existing) {
        Object.assign(existing, payload);
        updated++;
      } else {
        payload.rawId = Date.now() + i;
        window.db.master.M_RAW.push(payload);
        created++;
      }
    });

    if (typeof window.logEvent === 'function') window.logEvent('알레르겐 변환 반영: 신규 ' + created + ' / 수정 ' + updated);
    if (typeof window.saveDB   === 'function') window.saveDB();
    if (typeof window.renderRaw === 'function') window.renderRaw();
    if (typeof window.toast    === 'function') window.toast('✓ ERP 반영 완료 — 신규 ' + created + '건 / 수정 ' + updated + '건', 'success');
    acReset();
  };

  /* ── 초기화 ── */
  window.acReset = function () {
    window.__acData = null;
    document.getElementById('ac-file').value  = '';
    document.getElementById('ac-result')?.classList.add('hidden');
    document.getElementById('ac-drop')?.classList.remove('hidden');
  };

  /* ── 원료 마스터 페이지 진입 시 변환기 삽입 ── */
  /* nav 버튼 직접 클릭 감지 */
  function bindAllergenNav () {
    const navBtn = document.getElementById('nav-master-raw');
    if (navBtn && !navBtn.__acBound) {
      navBtn.__acBound = true;
      navBtn.addEventListener('click', function () {
        setTimeout(buildAllergenConverter, 150);
      });
    }
  }

  /* page-master-raw 가 active 클래스 얻는 순간 MutationObserver 감지 */
  function watchRawPage () {
    const target = document.getElementById('page-master-raw');
    if (!target) return;
    const obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          if (target.classList.contains('active')) {
            setTimeout(buildAllergenConverter, 100);
          }
        }
      });
    });
    obs.observe(target, { attributes: true, attributeFilter: ['class'] });
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      bindAllergenNav();
      watchRawPage();
      const active = document.querySelector('.page-section.active');
      if (active && active.id === 'page-master-raw') buildAllergenConverter();
    }, 500);
  });

  console.log('[SHIFTI ERP Patch v3.2-fixed] 로드 완료 — 데이터 초기화 버그, saveDB 복원, 매출 업로드 모듈 통합, 알레르겐 변환기 추가');

})();
