/*! ============================================================================
 *  SHIFTI ERP SUITE  v5.0  ·  통합 안정화 · 무결성 · 현업 편의 레이어
 *  ---------------------------------------------------------------------------
 *  적용법:  index.html 의 </body> 바로 앞, 모든 스크립트 "맨 마지막" 한 줄
 *
 *      <script src="shifti-erp-suite.js?v=5.0"></script>
 *
 *  ※ erp-hotfix.js / shifti-ai-fix.js 를 이미 넣으셨다면 두 줄 모두 지우고
 *    이 한 줄로 교체하세요. (두 파일의 내용이 전부 포함되어 있습니다)
 *  ※ 기존 파일은 한 글자도 수정하지 않습니다. 이 줄만 지우면 즉시 원상복구.
 *
 *  ── 목차 ────────────────────────────────────────────────────────────────
 *   M0   공통 유틸
 *   M1   시간·식별자          날짜 UTC 버그 / ID 중복
 *   M2   수치 정규화          부동소수 오차
 *   M3   작업자 서명          GMP 담당자 기록
 *   M4   LOT 적격성           부적합·만료·미판정 투입 차단
 *   M5   배분·트랜잭션        선입선출 / 유령재고 롤백
 *   M6   저장 엔진            직렬 큐 · 충돌감지 · 재시도 · 용량방어
 *   M7   데이터 수명주기      상태전이 / 감사로그 / 가져오기 / 초기화
 *   M8   입력 안전            중복제출 방지 / Enter 저장 / 필수값
 *   M9   화면 · 조작          검색 · 정렬 · 필터 · 엑셀 · 인쇄 · 알림 · 단축키
 *   M10  진단 · 백업
 *   M11  SHIFTI AI            XSS · 타입 · 문서번호 · 검증 · 실행연결
 *   M12  생산 가능량          원료 상한 · 숙성 리드타임
 *   M13  부팅
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '5.0';

  /* ═══════════════════════════════════════════════════════════════════════
   * M0 · 공통 유틸
   * ═══════════════════════════════════════════════════════════════════ */
  function LOG() { try { console.log.apply(console, ['%c[SUITE]', 'color:#0d9488;font-weight:700'].concat([].slice.call(arguments))); } catch (e) {} }
  function n(v, d) { var x = Number(v); return isFinite(x) ? x : (d || 0); }
  function r6(v) { return Math.round(n(v) * 1e6) / 1e6; }
  function fmt(v) { return Number(v || 0).toLocaleString('ko-KR'); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s];
    });
  }
  function el(id) { return document.getElementById(id); }
  function db() { return window.db; }
  function toast(m, t) { try { (window.toast || function () {})(m, t); } catch (e) { LOG(m); } }
  function safe(fn, label) { try { return fn(); } catch (e) { console.warn('[SUITE] ' + (label || '') + ':', e); } }
  function txt(node) { if (!node) return ''; return String(node.innerText || node.textContent || '').trim(); }
  function LOT_KEY(t) { return { RAW: 'RAW_LOT', PACK: 'PACK_LOT', BULK: 'BULK_LOT', FGT: 'FGT_LOT' }[t]; }
  function lots(t) { var k = LOT_KEY(t); return (k && db() && db().stock && db().stock[k]) || []; }

  /* 원본 함수를 감싼다. 아직 없으면 잠시 후 재시도 */
  function wrap(name, factory, tries) {
    var orig = window[name];
    if (typeof orig !== 'function') {
      if ((tries || 0) > 60) return;
      setTimeout(function () { wrap(name, factory, (tries || 0) + 1); }, 200);
      return;
    }
    window[name] = factory(orig);
    window[name].__suite = true;
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * M0b · 호환 심 (실기기 검증에서 발견된 실제 고장 복구)
   *
   *  masterName(4116줄) 과 allLots(4110줄) 는 v3 IIFE 안에 갇혀 있는데,
   *  6250줄(aiBriefings)과 6331줄(재발주 제안)은 다른 스크립트 블록에서
   *  이 이름을 그냥 부릅니다 →  ReferenceError: masterName is not defined
   *  → AI 리포트 화면이 렌더 도중 중단됩니다. (6408줄에는 이미
   *    typeof 가드로 우회한 흔적이 있습니다 — 같은 문제를 만났던 자리입니다)
   *
   *  전역에 같은 이름을 정의해 두면 그 블록들의 스코프 체인이 여기까지
   *  내려와 정상 동작합니다. IIFE 내부는 자기 지역 변수를 계속 쓰므로
   *  기존 동작에는 영향이 없습니다.
   * ═══════════════════════════════════════════════════════════════════ */
  (function compatShim() {
    function M(k) { return ((db() || {}).master || {})[k] || []; }
    function byId(arr, key, id) {
      return arr.find(function (x) { return String(x[key]) === String(id); }) || null;
    }
    if (typeof window.findRaw !== 'function') window.findRaw = function (id) { return byId(M('M_RAW'), 'rawId', id); };
    if (typeof window.findPack !== 'function') window.findPack = function (id) { return byId(M('M_PACK'), 'packId', id); };
    if (typeof window.findProduct !== 'function') window.findProduct = function (id) { return byId(M('M_PRODUCT'), 'productId', id); };
    if (typeof window.findCustomer !== 'function') window.findCustomer = function (id) { return byId(M('M_CUSTOMER'), 'customerId', id); };

    if (typeof window.lotArrayName !== 'function') {
      window.lotArrayName = function (t) { return LOT_KEY(t); };
    }
    if (typeof window.allLots !== 'function') {
      window.allLots = function () {
        var out = [];
        [['RAW', 'RAW_LOT'], ['PACK', 'PACK_LOT'], ['BULK', 'BULK_LOT'], ['FGT', 'FGT_LOT']].forEach(function (p) {
          (((db() || {}).stock || {})[p[1]] || []).forEach(function (x) {
            out.push(Object.assign({ type: p[0] }, x));
          });
        });
        return out;
      };
    }
    if (typeof window.masterName !== 'function') {
      window.masterName = function (type, itemId) {
        var r;
        if (type === 'RAW') { r = window.findRaw(itemId); return (r && r.name) || '-'; }
        if (type === 'PACK') { r = window.findPack(itemId); return (r && r.name) || '-'; }
        if (type === 'BULK' || type === 'FGT') { r = window.findProduct(itemId); return (r && r.name) || '-'; }
        return '-';
      };
    }
  })();

  /* ═══════════════════════════════════════════════════════════════════════
   * M1 · 시간과 식별자
   *
   *  [수정1] index.html:1490  todayISO() 가 toISOString() → UTC 기준이라
   *          한국시간 오전 9시 이전 입력이 전부 '어제' 로 저장되던 문제.
   *          today()(3351, 4107줄) 가 이 함수를 물고 있어 입고·배합·충진·
   *          QC·출고·조정 전표 날짜가 모두 하루씩 밀렸습니다.
   *
   *  [수정2] id:Date.now() / Date.now()+1 / generateId 가 같은 밀리초에
   *          중복 ID 를 만들어, find(l=>l.id===x) 가 엉뚱한 LOT 을 집어
   *          다른 LOT 재고를 차감하던 문제. (추적성 붕괴)
   * ═══════════════════════════════════════════════════════════════════ */
  (function () {
    var real = Date.now.bind(Date), last = 0;
    Date.now = function () {
      var t = real();
      if (t <= last + 1) t = last + 2;   // +1 패턴까지 안전하도록 2씩 벌린다
      last = t;
      return t;
    };
  })();

  function kstToday() {
    var d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 9 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  function kstNow() {
    var d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 9 * 3600000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  function addDays(iso, days) {
    var d = new Date(String(iso || kstToday()) + 'T00:00:00');
    d.setDate(d.getDate() + n(days));
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }
  window.todayISO = kstToday;
  window.kstToday = kstToday;
  window.generateId = function (p) {
    return (p || 'ID') + '-' + Date.now().toString(36).toUpperCase() +
      Math.random().toString(36).slice(2, 5).toUpperCase();
  };
  function docNo(p) { return p + '-' + Date.now().toString(36).toUpperCase(); }

  /* ═══════════════════════════════════════════════════════════════════════
   * M2 · 수치 정규화
   *
   *  0.1+0.2 = 0.30000000000000004 이 잔량에 쌓이면 remaining>0 조건에 걸려
   *  잔량 1e-10 짜리 유령 LOT 이 선입선출 목록에 계속 뜹니다.
   *  입고 kg→g 환산(3775줄)에서 단가가 소수로 내려가므로 6자리까지 보존합니다.
   * ═══════════════════════════════════════════════════════════════════ */
  var NUMK = /^(qty|remaining|amount|unitCost|unitPrice|price|totalCost|totalAmount|need|rawCost|packCost|bulkPerEa|stdCost|salePrice|fillWeight|shortage)$/;
  function normalize(o, d) {
    if (!o || typeof o !== 'object' || (d || 0) > 8) return;
    var k, dd = (d || 0) + 1;
    if (Array.isArray(o)) { for (k = 0; k < o.length; k++) normalize(o[k], dd); return; }
    for (k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
      var v = o[k];
      if (typeof v === 'number' && isFinite(v) && NUMK.test(k)) o[k] = r6(v);
      else if (v && typeof v === 'object') normalize(v, dd);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * M3 · 작업자 서명
   *
   *  화장품 GMP 는 "누가 했는지" 없는 기록을 기록으로 인정하지 않습니다.
   *  기존 logEvent 에는 담당자가 없고, 300건에서 잘려나갑니다.
   *  (화장품법상 제조기록 보관은 사용기한 경과 후 1년 → 300건은 부족)
   * ═══════════════════════════════════════════════════════════════════ */
  var OP_KEY = 'shifti_operator', LOG_MAX = 5000;
  function operator() { return localStorage.getItem(OP_KEY) || ''; }
  function askOperator(force) {
    if (operator() && !force) return;
    var v = window.prompt('작업자 이름을 입력하세요.\n\n입고·배합·충진·검사·출고 모든 이력에 함께 기록됩니다.', operator() || '');
    if (v && v.trim()) { localStorage.setItem(OP_KEY, v.trim()); paintOperator(); toast('작업자: ' + v.trim(), 'success'); }
  }
  function paintOperator() {
    var b = el('sf-operator');
    if (b) { b.textContent = '👤 ' + (operator() || '미지정'); b.style.color = operator() ? '#5eead4' : '#fca5a5'; }
  }
  window.shiftiSetOperator = function () { askOperator(true); };

  window.logEvent = function (m) {
    var d = db(); if (!d) return;
    d.logs = d.logs || [];
    d.logs.unshift('[' + kstNow() + '] ' + m + (operator() ? ' · ' + operator() : ''));
    if (d.logs.length > LOG_MAX) d.logs.length = LOG_MAX;
  };

  /* 신규 전표에 담당자·시각 각인 */
  function stampLast(arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    var x = arr[arr.length - 1];
    if (x && typeof x === 'object' && !x.by) { x.by = operator() || '미지정'; x.byAt = new Date().toISOString(); }
  }

  /* ═══════════════════════════════════════════════════════════════════════
   * M4 · LOT 적격성
   *
   *  allocateLots(4137줄) / totalStock(4129줄) 에 status 검사가 아예 없어
   *  부적합(FAIL)·만료(EXPIRED) 원료가 생산에 그대로 투입됐습니다.
   *  만료 LOT 이 가장 오래된 LOT 이므로 선입선출에서 1순위로 들어갑니다.
   *  (출고 4606줄에는 status 검사가 있는데 투입 단계에만 빠져 있었습니다)
   * ═══════════════════════════════════════════════════════════════════ */
  var HARD = ['FAIL', 'EXPIRED', 'REJECT', 'NG', '부적합', '폐기', '반품'];
  var SOFT = ['HOLD', 'QC', '보류', '검사중'];
  var STRICT_KEY = 'shifti_strict_lot';
  function strict() { return localStorage.getItem(STRICT_KEY) !== 'off'; }
  window.shiftiToggleStrict = function () {
    localStorage.setItem(STRICT_KEY, strict() ? 'off' : 'on');
    paintStrict();
    toast(strict() ? 'GMP 엄격모드 — 미판정(HOLD) LOT 투입을 차단합니다'
      : 'GMP 완화모드 — 미판정 LOT 도 투입됩니다', strict() ? 'success' : 'error');
    safe(function () { window.renderAll(); });
  };
  function paintStrict() {
    var b = el('sf-strict'); if (!b) return;
    b.textContent = strict() ? '🔒 GMP' : '🔓 완화';
    b.style.background = strict() ? '#ccfbf1' : '#fef3c7';
    b.style.color = strict() ? '#0f766e' : '#92400e';
  }

  function blockReason(lot) {
    if (!lot) return '없음';
    var s = String(lot.status || 'OK').toUpperCase();
    if (HARD.indexOf(s) >= 0) return s === 'EXPIRED' ? '유통기한 만료' : '검사 부적합(' + s + ')';
    if (lot.expDate && lot.expDate < kstToday()) return '유통기한 경과 ' + lot.expDate;
    if (lot.matureUntil && lot.matureUntil > kstToday()) return '숙성 미완료 ~' + lot.matureUntil;
    if (strict() && SOFT.indexOf(s) >= 0) return '검사 미판정(' + s + ')';
    return null;
  }
  function usable(lot) { return !blockReason(lot); }
  function matchLot(l, type, itemId) {
    return type === 'RAW' ? String(l.rawId) === String(itemId)
      : type === 'PACK' ? String(l.packId) === String(itemId)
        : String(l.productId) === String(itemId);
  }

  /* 가용재고 = 지금 당장 쓸 수 있는 수량 */
  wrap('totalStock', function (orig) {
    return function (type, itemId) {
      if (!LOT_KEY(type) || !db()) return orig.apply(this, arguments);
      return r6(lots(type).filter(function (l) { return matchLot(l, type, itemId) && usable(l); })
        .reduce(function (s, l) { return s + n(l.remaining); }, 0));
    };
  });
  /* 실물 총재고 = 창고에 실제로 있는 수량 (사용불가 포함) */
  window.totalStockGross = function (type, itemId) {
    return r6(lots(type).filter(function (l) { return matchLot(l, type, itemId); })
      .reduce(function (s, l) { return s + n(l.remaining); }, 0));
  };
  window.shiftiLotBlockReason = blockReason;

  /* ═══════════════════════════════════════════════════════════════════════
   * M5 · 선입선출 배분과 트랜잭션 롤백
   *
   *  createBulk2(4494줄) 는 원료 3종 중 2번째에서 실패하면 1번째 원료를
   *  차감한 채로 return 합니다. 전표는 안 생기고 재고만 줄어드는
   *  '유령재고' 가 조용히 누적되어 실사 때야 발견됩니다.
   *  createBatch2 의 포장재 배분(4539줄)도 동일 구조입니다.
   * ═══════════════════════════════════════════════════════════════════ */
  wrap('allocateLots', function (orig) {
    return function (type, itemId, needQty) {
      if (!LOT_KEY(type) || !db()) return orig.apply(this, arguments);
      var pool = lots(type).filter(function (l) {
        return matchLot(l, type, itemId) && n(l.remaining) > 0 && usable(l);
      }).sort(function (a, b) {
        var ax = String(a.expDate || a.matureUntil || '9999-12-31'), bx = String(b.expDate || b.matureUntil || '9999-12-31');
        if (ax !== bx) return ax < bx ? -1 : 1;                 // 유통기한 우선 (FEFO)
        return String(a.dateIn || '') < String(b.dateIn || '') ? -1 : 1;   // 동일하면 입고순 (FIFO)
      });

      var remain = r6(needQty), used = [];
      for (var i = 0; i < pool.length && remain > 1e-9; i++) {
        var take = Math.min(n(pool[i].remaining), remain);
        if (take <= 0) continue;
        pool[i].remaining = r6(n(pool[i].remaining) - take);
        remain = r6(remain - take);
        used.push({ lotNo: pool[i].lotNo, qty: take, id: pool[i].id });
      }
      if (remain > 1e-9) {
        used.forEach(function (u) {
          var l = lots(type).find(function (x) { return String(x.id) === String(u.id); });
          if (l) l.remaining = r6(n(l.remaining) + n(u.qty));
        });
        var blocked = lots(type).filter(function (l) {
          return matchLot(l, type, itemId) && n(l.remaining) > 0 && !usable(l);
        });
        var name = safe(function () { return window.masterName(type, itemId); }) || itemId;
        var hint = blocked.length ? '  ·  사용불가 ' + blocked.length + '건 ('
          + blocked.slice(0, 2).map(function (l) { return l.lotNo + ': ' + blockReason(l); }).join(', ') + ')' : '';
        return { ok: false, message: '가용재고 부족 — ' + name + ' · ' + fmt(remain) + ' 모자람' + hint };
      }
      return { ok: true, used: used };
    };
  });

  /* ─────────────────────────────────────────────────────────────────────
   *  [실기기 검증에서 발견]  createBulk2(4495줄) 와 createBatch2(4540줄) 는
   *  window.allocateLots 가 아니라 IIFE 내부의 "지역" allocateLots 를 부릅니다.
   *  (allocateLots 는 4137줄에서 정의되고 5078줄에서 window 로 내보내집니다)
   *  따라서 window 래핑만으로는 조향·충진 경로를 전혀 보호하지 못합니다.
   *
   *  클로저에는 손댈 수 없으므로, 작업이 도는 동안 사용불가 LOT 의 잔량을
   *  일시적으로 0 으로 만들어 지역 함수의 눈에서 감춥니다. 지역 totalStock
   *  사전검사와 지역 allocateLots 가 동시에 올바른 재고만 보게 됩니다.
   *  작업이 끝나면 원래 잔량을 되돌립니다.
   * ──────────────────────────────────────────────────────────────────── */
  var HIDING = false, HIDE_EXEMPT = {}, PENDING_SAVE = false;

  function hideBlocked() {
    var hidden = [];
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      lots(k).forEach(function (l) {
        if (HIDE_EXEMPT[String(l.id)]) return;          // 사용자가 강행 승인한 LOT 은 제외
        if (n(l.remaining) > 0 && !usable(l)) { hidden.push([l, l.remaining]); l.remaining = 0; }
      });
    });
    HIDING = hidden.length > 0 || true;
    return hidden;
  }
  function unhide(hidden) {
    hidden.forEach(function (pair) {
      if (n(pair[0].remaining) === 0) pair[0].remaining = pair[1];   // 손대지 않았을 때만 복원
    });
    HIDING = false;
    HIDE_EXEMPT = {};
  }

  function snapStock() { try { return JSON.stringify(db().stock); } catch (e) { return null; } }
  function restoreStock(s) {
    if (!s) return;
    try {
      var o = JSON.parse(s), cur = db().stock;
      Object.keys(o).forEach(function (k) {
        if (Array.isArray(cur[k]) && Array.isArray(o[k])) {
          cur[k].length = 0;                      // 배열 참조를 유지한 채 내용만 복원
          o[k].forEach(function (x) { cur[k].push(x); });
        } else cur[k] = o[k];
      });
    } catch (e) {}
  }
  function pathArr(p) { try { return p.split('.').reduce(function (o, k) { return o && o[k]; }, db()) || []; } catch (e) { return []; } }

  /* 전표가 생성되지 않았다면 = 중단된 것 → 재고를 시작 시점으로 되돌린다 */
  function guard(fnName, txnPath, label, hide) {
    wrap(fnName, function (orig) {
      return function () {
        if (!operator()) { askOperator(); if (!operator()) { toast('작업자 이름을 먼저 입력해 주세요', 'error'); return; } }
        var snap = snapStock(), before = pathArr(txnPath).length;
        var hidden = hide ? hideBlocked() : [];
        var out;
        try { out = orig.apply(this, arguments); }
        finally { if (hide) unhide(hidden); }
        if (pathArr(txnPath).length <= before) { restoreStock(snap); LOG(label + ' 중단 → 재고 원복'); }
        else stampLast(pathArr(txnPath));
        if (PENDING_SAVE) { PENDING_SAVE = false; window.saveDB(); }   // 감춘 값이 저장되지 않도록 이후 재저장
        return out;
      };
    });
  }
  /*  hide=true 는 "재고를 소모하는" 작업에만 적용합니다.
   *  재고 실사/조정(applyStockAdj2)은 부적합·만료 LOT 도 보여야 하므로 제외합니다. */
  guard('createBulk2', 'txn.T_BULK', '벌크배합', true);
  guard('createBatch2', 'txn.T_BATCH', '생산배치', true);
  guard('saveSale2', 'txn.T_SALE', '출고', false);
  guard('saveQc2', 'txn.T_QC', 'QC판정', false);
  guard('applyStockAdj2', 'txn.T_ADJ', '재고조정', false);
  guard('saveProdPlan', 'txn.T_PROD_PLAN', '생산계획', false);
  guard('saveSO', 'txn.T_SO', '수주', false);

  /* 숙성 미완료 · 부적합 벌크 충진 방어 */
  wrap('createBatch2', function (orig) {
    return function () {
      var id = String((el('batch-bulk-lot2') || {}).value || '');
      var b = lots('BULK').find(function (l) { return String(l.id) === id; });
      if (b) {
        var s = String(b.status || 'OK').toUpperCase();
        if (HARD.indexOf(s) >= 0) { toast('충진 불가 — ' + b.lotNo + ' : 검사 부적합', 'error'); return; }
        if (b.matureUntil && b.matureUntil > kstToday()) {
          var left = daysBetween(kstToday(), b.matureUntil);
          if (!confirm('숙성이 끝나지 않은 벌크입니다.\n\nLOT ' + b.lotNo + '\n숙성 완료 ' + b.matureUntil + ' (' + left + '일 남음)\n\n그래도 충진하시겠습니까?\n강행 사실이 이력에 기록됩니다.')) return;
          HIDE_EXEMPT[String(b.id)] = 1;      // 승인했으므로 이 LOT 만 감추지 않는다
          safe(function () { window.logEvent('⚠ 숙성 미완료 충진 강행: ' + b.lotNo + ' (완료예정 ' + b.matureUntil + ')'); });
        }
      }
      return orig.apply(this, arguments);
    };
  });

  /* 만료 LOT 합격 처리 방어 */
  wrap('saveQc2', function (orig) {
    return function () {
      var t = (el('qc-type2') || {}).value, id = String((el('qc-lot2') || {}).value || ''), st = (el('qc-status2') || {}).value;
      var l = LOT_KEY(t) && lots(t).find(function (x) { return String(x.id) === id; });
      if (l && st === 'OK') {
        if (l.expDate && l.expDate < kstToday()) { toast('유통기한이 지난 LOT 은 합격 처리할 수 없습니다 (' + l.expDate + ')', 'error'); return; }
        if (String(l.status).toUpperCase() === 'FAIL' &&
          !confirm('이미 부적합(FAIL) 판정된 LOT 입니다.\n합격으로 되돌리면 재판정 이력이 남습니다. 계속할까요?')) return;
      }
      return orig.apply(this, arguments);
    };
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * M6 · 저장 엔진
   *
   *  기존: 클릭 한 번마다 DB 전체를 POST. 호출부가 await 하지 않아
   *        빠르게 3번 저장하면 요청이 동시에 날아가고 1번이 3번보다 늦게
   *        도착해 마지막 작업이 사라집니다. 두 사람이 쓰면 나중 저장이
   *        상대 작업을 통째로 덮어씁니다. 경고도 없습니다.
   *  개선: 로컬 즉시 → 0.9초 모아 직렬 전송 → 충돌 감지 → 지수 백오프 재시도
   * ═══════════════════════════════════════════════════════════════════ */
  var SK = window.STORAGE_KEY || 'shifti_erp_v2';
  var S = { dirty: false, sending: false, fails: 0, timer: null, base: null, lastPush: null };

  function setStatus(kind) {
    var e = el('cloud-status'); if (!e) return;
    var m = {
      saved: ['☁️ 저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), '#ccfbf1', '#0f766e'],
      pending: ['✎ 저장 대기', '#fef3c7', '#92400e'],
      sending: ['⟳ 저장 중…', '#dbeafe', '#1e40af'],
      retry: ['⚠ 재시도 ' + S.fails + '회 · 로컬 보관', '#fee2e2', '#991b1b'],
      conflict: ['⚑ 충돌 감지', '#fee2e2', '#991b1b'],
      quota: ['⚠ 저장공간 부족', '#fee2e2', '#991b1b'],
      offline: ['⛌ 오프라인 · 로컬 보관', '#f1f5f9', '#475569']
    }[kind] || ['', '#f1f5f9', '#475569'];
    e.textContent = m[0]; e.style.background = m[1]; e.style.color = m[2]; e.style.borderColor = m[2] + '33';
  }

  function persistLocal() {
    try { localStorage.setItem(SK, JSON.stringify(db())); return true; }
    catch (e) {
      setStatus('quota');
      toast('브라우저 저장공간이 가득 찼습니다. [💾 백업] 후 🩺 진단에서 정리해 주세요.', 'error');
      return false;
    }
  }
  function H() { return { 'Content-Type': 'application/json', apikey: window.SB_KEY, Authorization: 'Bearer ' + window.SB_KEY }; }

  async function remoteStamp() {
    try {
      var r = await fetch(window.SB_URL + '/rest/v1/erp_data?id=eq.' +
        encodeURIComponent(window.SB_ROW || 'shifti_erp_main') + '&select=updated_at', { headers: H() });
      if (!r.ok) return null;
      var j = await r.json();
      return (j && j[0] && j[0].updated_at) || null;
    } catch (e) { return null; }
  }

  function conflictModal(remote) {
    if (el('sf-conflict')) return;
    var d = document.createElement('div');
    d.id = 'sf-conflict';
    d.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px';
    d.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:470px;width:100%;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<div style="font-size:15px;font-weight:900;color:#991b1b">다른 기기에서 먼저 저장했습니다</div>' +
      '<p style="font-size:12.5px;color:#475569;line-height:1.75;margin:10px 0 16px">클라우드 최종 저장: <b>' +
      esc(String(remote).replace('T', ' ').slice(0, 19)) + '</b><br>지금 덮어쓰면 상대방이 입력한 내용이 사라집니다. 먼저 백업을 받아두세요.</p>' +
      '<div style="display:flex;flex-direction:column;gap:8px">' +
      '<button id="sf-cb" class="btn btn-secondary">1. 내 작업을 백업파일로 내려받기</button>' +
      '<button id="sf-cr" class="btn btn-primary">2. 클라우드 최신본 불러오기 (내 변경 취소)</button>' +
      '<button id="sf-cf" class="btn btn-danger">3. 내 내용으로 덮어쓰기</button></div></div>';
    document.body.appendChild(d);
    el('sf-cb').onclick = function () { safe(function () { window.exportJSON(); }); };
    el('sf-cr').onclick = function () { S.dirty = false; d.remove(); location.reload(); };
    el('sf-cf').onclick = function () { d.remove(); S.base = remote; S.dirty = true; schedule(60); toast('덮어쓰기로 진행합니다', 'info'); };
    setStatus('conflict');
  }

  function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(flush, ms == null ? 900 : ms); }

  async function flush() {
    if (S.sending || !S.dirty || !window.SB_URL || !window.SB_KEY) return;
    if (navigator.onLine === false) { setStatus('offline'); return; }
    S.sending = true; setStatus('sending');
    var stamp = db().meta && db().meta.updatedAt;
    var body = JSON.stringify({ id: window.SB_ROW || 'shifti_erp_main', data: db(), updated_at: stamp });
    S.dirty = false;
    try {
      var rs = await remoteStamp();
      if (rs && S.base && rs > S.base && rs !== S.lastPush) { S.dirty = true; S.sending = false; conflictModal(rs); return; }
      var r = await fetch(window.SB_URL + '/rest/v1/erp_data', {
        method: 'POST',
        headers: Object.assign(H(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: body
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.base = stamp; S.lastPush = stamp; S.fails = 0;
      setStatus('saved'); rollingBackup();
    } catch (e) {
      S.dirty = true; S.fails++; setStatus('retry');
      setTimeout(flush, Math.min(30000, 1500 * S.fails));
    } finally {
      S.sending = false;
      if (S.dirty && S.fails === 0) schedule();
    }
  }

  var rendering = false;
  window.saveDB = function () {
    var d = db(); if (!d) return Promise.resolve();
    if (HIDING) { PENDING_SAVE = true; return Promise.resolve(); }   // 임시로 감춘 잔량이 저장되지 않도록 보류
    d.meta = d.meta || {};
    d.meta.updatedAt = new Date().toISOString();
    d.meta.updatedBy = operator() || '미지정';
    d.meta.suite = VERSION;
    normalize(d);
    clampNegative();
    persistLocal();
    if (!rendering) { rendering = true; safe(function () { window.renderAll(); }, 'renderAll'); rendering = false; }
    S.dirty = true; setStatus('pending'); schedule();
    safe(paintAlerts);
    return Promise.resolve();
  };
  window.shiftiFlushNow = function () { S.dirty = true; schedule(0); toast('클라우드로 즉시 저장합니다', 'info'); };

  window.addEventListener('beforeunload', function (ev) {
    if (S.dirty || S.sending) { ev.preventDefault(); ev.returnValue = ''; return ''; }
  });
  window.addEventListener('online', function () { S.fails = 0; if (S.dirty) schedule(200); });
  window.addEventListener('offline', function () { setStatus('offline'); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.dirty) schedule(200); });

  /* ═══════════════════════════════════════════════════════════════════════
   * M7 · 데이터 수명주기
   *
   *  [수정] renderBulkPage(4520줄) 가 "화면을 그리면서" l.status='OK' 로
   *         데이터를 바꿉니다. 그 화면을 한 번도 안 열면 숙성이 영원히
   *         끝나지 않습니다. → 불러오는 시점에 일괄 전이시킵니다.
   *  [수정] resetDB 가 confirm 한 번으로 전사 데이터를 지웁니다.
   *  [수정] importJSON 이 검증 없이 db=i 로 통째 교체합니다.
   * ═══════════════════════════════════════════════════════════════════ */
  function lifecycle() {
    var d = db(); if (!d || !d.stock) return 0;
    var t = kstToday(), changed = 0;
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      lots(k).forEach(function (l) {
        var s = String(l.status || 'OK').toUpperCase();
        if (l.expDate && l.expDate < t && s !== 'FAIL' && s !== 'EXPIRED') {
          l.status = 'EXPIRED'; changed++;
          safe(function () { window.logEvent('자동 만료 처리: ' + l.lotNo + ' (' + l.expDate + ')'); });
        }
        if (k === 'BULK' && l.matureUntil && l.matureUntil <= t && s === 'HOLD') {
          l.status = 'OK'; changed++;
          safe(function () { window.logEvent('숙성 완료: ' + l.lotNo); });
        }
      });
    });
    changed += clampNegative();
    if (d.logs && d.logs.length > LOG_MAX) { d.logs.length = LOG_MAX; }
    if (changed) { persistLocal(); S.dirty = true; schedule(1500); }
    return changed;
  }

  function clampNegative() {
    var c = 0;
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      lots(k).forEach(function (l) {
        if (n(l.remaining) < 0) {
          safe(function () { window.logEvent('⚠ 마이너스 재고 보정: ' + l.lotNo + ' ' + l.remaining + ' → 0'); });
          l.remaining = 0; c++;
        }
      });
    });
    return c;
  }

  wrap('loadDB', function (orig) {
    return async function () {
      var r = await orig.apply(this, arguments);
      S.base = (db() && db().meta && db().meta.updatedAt) || null;
      safe(lifecycle, 'lifecycle');
      return r;
    };
  });

  window.resetDB = function () {
    var w1 = prompt('⚠ 전사 데이터를 클라우드까지 모두 삭제합니다.\n복구할 수 없습니다.\n\n계속하려면 아래에 정확히 입력하세요:  삭제합니다');
    if (w1 !== '삭제합니다') { toast('취소했습니다', 'info'); return; }
    if (!confirm('마지막 확인입니다.\n\n삭제 전에 백업을 받으시겠습니까?\n[확인] 백업 후 삭제  ·  [취소] 중단')) { toast('취소했습니다', 'info'); return; }
    safe(function () { window.exportJSON(); });
    setTimeout(async function () {
      localStorage.removeItem(SK);
      try {
        await fetch(window.SB_URL + '/rest/v1/erp_data', {
          method: 'POST', headers: Object.assign(H(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify({ id: window.SB_ROW || 'shifti_erp_main', data: { meta: { version: VERSION } }, updated_at: new Date().toISOString() })
        });
      } catch (e) {}
      S.dirty = false;
      location.reload();
    }, 900);
  };

  window.importJSON = function (ev) {
    var f = ev && ev.target && ev.target.files && ev.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function (e) {
      var inc;
      try { inc = JSON.parse(e.target.result); } catch (er) { toast('JSON 형식이 아닙니다', 'error'); return; }
      var bad = [];
      if (!inc || typeof inc !== 'object') bad.push('최상위 구조 오류');
      if (!inc.master || !Array.isArray(inc.master.M_PRODUCT)) bad.push('master.M_PRODUCT 없음');
      if (!inc.stock || !Array.isArray(inc.stock.RAW_LOT)) bad.push('stock.RAW_LOT 없음');
      if (!inc.txn || typeof inc.txn !== 'object') bad.push('txn 없음');
      if (bad.length) { alert('복원할 수 없는 파일입니다.\n\n' + bad.join('\n')); return; }

      var cnt = ['M_RAW', 'M_PACK', 'M_PRODUCT', 'M_CUSTOMER'].reduce(function (s, k) { return s + ((inc.master[k] || []).length); }, 0);
      var lotCnt = ['RAW_LOT', 'PACK_LOT', 'BULK_LOT', 'FGT_LOT'].reduce(function (s, k) { return s + ((inc.stock[k] || []).length); }, 0);
      if (!confirm('복원 내용 확인\n\n· 마스터 ' + cnt + '건\n· LOT ' + lotCnt + '건\n· 기준시각 ' +
        String((inc.meta || {}).updatedAt || '알 수 없음').replace('T', ' ').slice(0, 19) +
        '\n\n현재 데이터는 자동 백업 후 교체됩니다. 진행할까요?')) return;

      safe(function () { window.exportJSON(); });          // 교체 전 현재본 자동 백업
      setTimeout(function () {
        window.db = inc;
        safe(lifecycle);
        window.saveDB();
        toast('복원 완료 — ' + lotCnt + '개 LOT', 'success');
        setTimeout(function () { location.reload(); }, 700);
      }, 800);
    };
    rd.readAsText(f);
  };

  /* 7일 롤링 자동 백업 (하루 1회) */
  function rollingBackup() {
    try {
      var t = kstToday();
      if (localStorage.getItem('shifti_bk_last') === t) return;
      var keys = JSON.parse(localStorage.getItem('shifti_bk_keys') || '[]');
      var k = 'shifti_bk_' + t;
      localStorage.setItem(k, JSON.stringify(db()));
      keys.push(k);
      while (keys.length > 7) localStorage.removeItem(keys.shift());
      localStorage.setItem('shifti_bk_keys', JSON.stringify(keys));
      localStorage.setItem('shifti_bk_last', t);
    } catch (e) { /* 용량 초과 시 건너뜀 */ }
  }
  window.shiftiRestoreLocal = function () {
    var keys = [];
    try { keys = JSON.parse(localStorage.getItem('shifti_bk_keys') || '[]'); } catch (e) {}
    if (!keys.length) { alert('로컬 자동 백업이 없습니다.'); return; }
    var pick = prompt('복원할 날짜를 입력하세요.\n\n보유: ' + keys.map(function (k) { return k.replace('shifti_bk_', ''); }).join(', '), keys[keys.length - 1].replace('shifti_bk_', ''));
    if (!pick) return;
    var raw = localStorage.getItem('shifti_bk_' + pick.trim());
    if (!raw) { alert('해당 날짜 백업이 없습니다.'); return; }
    if (!confirm(pick + ' 시점으로 되돌립니다. 현재 데이터는 사라집니다.\n계속할까요?')) return;
    try { window.db = JSON.parse(raw); window.saveDB(); setTimeout(function () { location.reload(); }, 600); }
    catch (e) { alert('백업 파일이 손상되었습니다.'); }
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * M8 · 입력 안전
   *  · 저장 버튼 연타로 전표가 2건 생기는 사고 방지
   *  · 입력칸에서 Enter → 그 카드의 기본 버튼 실행
   * ═══════════════════════════════════════════════════════════════════ */
  var COMMIT = /^(save|create|apply|register|submit|confirm|push|start|issue)/i;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button');
    if (!b) return;
    var oc = (b.getAttribute('onclick') || '').trim();
    var txt = (b.textContent || '').trim();
    var isCommit = COMMIT.test(oc) || (/저장|등록|처리|확정|반영|배합|충진|출고|입고|판정|지시/.test(txt) && !/추가|행|취소|초기화|닫기/.test(txt));
    if (!isCommit) return;
    if (b.dataset.sfBusy === '1') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    b.dataset.sfBusy = '1';
    var op = b.style.opacity;
    b.style.opacity = '.5'; b.style.pointerEvents = 'none';
    setTimeout(function () { b.dataset.sfBusy = ''; b.style.opacity = op; b.style.pointerEvents = ''; }, 1100);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (!t || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return;
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;
    if (t.id === 'sf-q' || t.id === 'sf-filter' || t.id === 'shifti-command-input') return;
    var card = t.closest('.card');
    var btn = card && card.querySelector('.btn-primary');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * M9 · 화면과 조작
   * ═══════════════════════════════════════════════════════════════════ */
  (function styles() {
    var s = document.createElement('style');
    s.id = 'sf-style';
    s.textContent = [
      '#sf-bar{position:fixed;right:16px;bottom:16px;z-index:900;display:flex;gap:5px;align-items:center;background:rgba(15,23,42,.94);padding:7px 9px;border-radius:999px;box-shadow:0 8px 26px rgba(15,23,42,.28);backdrop-filter:blur(6px);max-width:calc(100vw - 32px);flex-wrap:nowrap;overflow-x:auto}',
      '#sf-bar button{background:transparent;border:0;color:#cbd5e1;font-size:11.5px;font-weight:700;padding:5px 9px;border-radius:999px;cursor:pointer;white-space:nowrap;font-family:inherit;flex:0 0 auto}',
      '#sf-bar button:hover{background:#1e293b;color:#5eead4}',
      '#sf-bar button:focus-visible{outline:2px solid #2dd4bf;outline-offset:1px}',
      '#sf-bar .sep{width:1px;height:16px;background:#334155;flex:0 0 auto}',
      '#sf-filter{background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:999px;padding:5px 11px;font-size:11.5px;width:120px;font-family:inherit;flex:0 0 auto;transition:width .15s}',
      '#sf-filter:focus{outline:none;border-color:#2dd4bf;width:180px}',
      '#sf-filter::placeholder{color:#64748b}',
      '#sf-pal{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.5);display:none;align-items:flex-start;justify-content:center;padding-top:11vh}',
      '#sf-pal.on{display:flex}',
      '#sf-pal .box{background:#fff;width:min(660px,93vw);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.32);overflow:hidden}',
      '#sf-pal input{width:100%;border:0;border-bottom:1px solid #e2e8f0;padding:16px 18px;font-size:15px;font-family:inherit;outline:none}',
      '#sf-pal .res{max-height:56vh;overflow:auto}',
      '#sf-pal .r{padding:10px 18px;display:flex;gap:10px;align-items:center;cursor:pointer;border-bottom:1px solid #f8fafc}',
      '#sf-pal .r:hover,#sf-pal .r.sel{background:#f0fdfa}',
      '#sf-pal .r .k{font-size:9.5px;font-weight:800;color:#0f766e;background:#ccfbf1;padding:2px 7px;border-radius:999px;min-width:52px;text-align:center;flex:0 0 auto}',
      '#sf-pal .r .t{font-size:12.5px;font-weight:700;color:#0f172a}',
      '#sf-pal .r .s{font-size:11px;color:#64748b}',
      '#sf-pal .hint{padding:9px 18px;font-size:10.5px;color:#94a3b8;background:#f8fafc}',
      'thead th.sf-sortable{cursor:pointer;user-select:none}',
      'thead th.sf-sortable:hover{color:#0d9488}',
      'thead th.sf-asc::after{content:" ▲";font-size:8px}',
      'thead th.sf-desc::after{content:" ▼";font-size:8px}',
      '#sf-alerts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px}',
      '.sf-alert{border-radius:10px;padding:11px 13px;border:1px solid;cursor:pointer;transition:transform .12s}',
      '.sf-alert:hover{transform:translateY(-2px)}',
      '.sf-alert .n{font-size:22px;font-weight:900;line-height:1.1}',
      '.sf-alert .l{font-size:10.5px;font-weight:700;margin-top:3px;opacity:.85}',
      '.sf-red{background:#fef2f2;border-color:#fecaca;color:#b91c1c}',
      '.sf-amber{background:#fffbeb;border-color:#fde68a;color:#b45309}',
      '.sf-blue{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}',
      '.sf-teal{background:#f0fdfa;border-color:#99f6e4;color:#0f766e}',
      '.sf-money{position:absolute;font-size:10.5px;color:#0f766e;font-weight:800;background:#f0fdfa;border:1px solid #99f6e4;border-radius:5px;padding:1px 6px;z-index:50;pointer-events:none}',
      '@media (max-width:640px){#sf-bar{right:8px;bottom:8px;padding:6px}#sf-filter{width:82px}#sf-bar button{padding:5px 7px}}',
      '@media (prefers-reduced-motion:reduce){.sf-alert{transition:none}}',
      '@media print{',
      ' aside,#sf-bar,#sf-pal,header .btn,#toast-container,.no-print,#sf-alerts{display:none!important}',
      ' header{border:0!important}',
      ' main,#main-content{overflow:visible!important;height:auto!important;padding:0!important}',
      ' body{background:#fff!important;font-size:11px}',
      ' .card{box-shadow:none!important;border-color:#cbd5e1!important;break-inside:avoid}',
      ' .scroll-card,.scroll-card-lg{max-height:none!important;overflow:visible!important}',
      ' .doc-stage{background:#fff!important;border:0!important;padding:0!important}',
      ' .doc-page{box-shadow:none!important;border:0!important;margin:0!important;width:auto!important;padding:0!important}',
      ' table{break-inside:auto}tr{break-inside:avoid}thead{display:table-header-group}',
      ' @page{size:A4;margin:12mm}}'
    ].join('\n');
    document.head.appendChild(s);
  })();

  /* ── 통합 검색 (Ctrl+K) ── */
  var PAGES = [];
  function collectPages() {
    PAGES = [].slice.call(document.querySelectorAll('.nav-item[id^="nav-"]')).map(function (v) {
      return { id: v.id.replace(/^nav-/, ''), title: (v.textContent || '').trim().replace(/\s+/g, ' ') };
    }).filter(function (p) { return p.title; });
  }
  function search(q) {
    q = String(q || '').trim().toLowerCase();
    var out = [], d = db();
    if (!q) {
      (safe(function () { return JSON.parse(localStorage.getItem('shifti_recent') || '[]'); }) || []).slice(0, 7).forEach(function (id) {
        var p = PAGES.find(function (x) { return x.id === id; });
        if (p) out.push({ k: '최근', t: p.title, s: '', go: p.id });
      });
      return out;
    }
    if (!d) return out;
    PAGES.forEach(function (p) { if (p.title.toLowerCase().indexOf(q) >= 0) out.push({ k: '메뉴', t: p.title, s: '화면 이동', go: p.id }); });
    var M = d.master || {};
    function scan(arr, kind, page, nameF, subF) {
      (arr || []).forEach(function (r) {
        var nm = nameF(r) || '';
        if (String(nm).toLowerCase().indexOf(q) >= 0) out.push({ k: kind, t: String(nm).trim(), s: subF(r) || '', go: page });
      });
    }
    scan(M.M_RAW, '원료', 'master-raw', function (r) { return (r.code || '') + ' ' + (r.name || ''); },
      function (r) { return (r.inci || '') + ' · 가용 ' + fmt(window.totalStock('RAW', r.rawId)) + ' / 총 ' + fmt(window.totalStockGross('RAW', r.rawId)); });
    scan(M.M_PACK, '포장재', 'master-pack', function (r) { return (r.code || '') + ' ' + (r.name || ''); },
      function (r) { return (r.spec || '') + ' · 가용 ' + fmt(window.totalStock('PACK', r.packId)); });
    scan(M.M_PRODUCT, '제품', 'master-product', function (r) { return (r.code || '') + ' ' + (r.name || ''); },
      function (r) { return '완제품 ' + fmt(window.totalStock('FGT', r.productId)) + ' · 생산가능 ' + fmt(producible(r)) + 'ea'; });
    scan(M.M_CUSTOMER, '고객', 'master-cust', function (r) { return (r.name || '') + ' ' + (r.code || ''); }, function (r) { return r.channel || ''; });
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      var page = k === 'BULK' ? 'bulk-maturation' : 'stock';
      lots(k).forEach(function (l) {
        if (String(l.lotNo || '').toLowerCase().indexOf(q) >= 0) {
          var why = blockReason(l);
          out.push({ k: 'LOT', t: l.lotNo, s: '잔량 ' + fmt(l.remaining) + ' · ' + (l.status || 'OK') + (why ? ' · ⛔ ' + why : ' · 사용가능'), go: page });
        }
      });
    });
    return out.slice(0, 40);
  }
  function buildPal() {
    if (el('sf-pal')) return;
    var d = document.createElement('div');
    d.id = 'sf-pal';
    d.innerHTML = '<div class="box"><input id="sf-q" placeholder="LOT번호 · 원료 · 제품 · 고객 · 메뉴 검색" autocomplete="off" aria-label="통합 검색"><div class="res" id="sf-res"></div><div class="hint">↑↓ 이동 · Enter 열기 · Esc 닫기</div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) closePal(); });
    var q = el('sf-q');
    q.addEventListener('input', renderPal);
    q.addEventListener('keydown', function (e) {
      var it = [].slice.call(document.querySelectorAll('#sf-res .r'));
      if (!it.length) { if (e.key === 'Escape') closePal(); return; }
      var i = it.findIndex(function (x) { return x.classList.contains('sel'); });
      if (e.key === 'ArrowDown') { e.preventDefault(); if (it[i]) it[i].classList.remove('sel'); it[(i + 1) % it.length].classList.add('sel'); scrollSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (it[i]) it[i].classList.remove('sel'); it[(i - 1 + it.length) % it.length].classList.add('sel'); scrollSel(); }
      else if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('#sf-res .r.sel') || it[0]).click(); }
      else if (e.key === 'Escape') closePal();
    });
  }
  function scrollSel() { var s = document.querySelector('#sf-res .r.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); }
  function renderPal() {
    var res = search(el('sf-q').value);
    el('sf-res').innerHTML = res.length ? res.map(function (r, i) {
      return '<div class="r' + (i === 0 ? ' sel' : '') + '" data-go="' + esc(r.go) + '"><span class="k">' + esc(r.k) +
        '</span><span><span class="t">' + esc(r.t) + '</span><br><span class="s">' + esc(r.s) + '</span></span></div>';
    }).join('') : '<div class="hint" style="padding:20px 18px">검색 결과가 없습니다. 다른 이름이나 LOT 번호로 찾아보세요.</div>';
    [].slice.call(document.querySelectorAll('#sf-res .r')).forEach(function (rw) {
      rw.onclick = function () { closePal(); safe(function () { window.goPage(rw.dataset.go); }); };
    });
  }
  function openPal() { buildPal(); collectPages(); el('sf-pal').classList.add('on'); el('sf-q').value = ''; renderPal(); el('sf-q').focus(); }
  function closePal() { var p = el('sf-pal'); if (p) p.classList.remove('on'); }
  window.shiftiSearch = openPal;

  wrap('goPage', function (orig) {
    return function (id) {
      var r = orig.apply(this, arguments);
      safe(function () {
        var a = JSON.parse(localStorage.getItem('shifti_recent') || '[]').filter(function (x) { return x !== id; });
        a.unshift(id); localStorage.setItem('shifti_recent', JSON.stringify(a.slice(0, 10)));
      });
      safe(function () { if (el('sf-filter')) { el('sf-filter').value = ''; applyFilter(''); } });
      if (id === 'dashboard') safe(paintAlerts);
      return r;
    };
  });

  /* ── 표 정렬 ── */
  document.addEventListener('click', function (e) {
    var th = e.target && e.target.closest && e.target.closest('thead th');
    if (!th) return;
    var tb = th.closest('table'); if (!tb || !tb.tBodies[0]) return;
    var idx = [].slice.call(th.parentNode.children).indexOf(th);
    var dir = th.classList.contains('sf-asc') ? -1 : 1;
    [].slice.call(tb.querySelectorAll('thead th')).forEach(function (x) { x.classList.remove('sf-asc', 'sf-desc'); });
    th.classList.add(dir === 1 ? 'sf-asc' : 'sf-desc');
    var rows = [].slice.call(tb.tBodies[0].rows).filter(function (r) { return r.cells.length > idx; });
    var num = function (v) { var x = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(x) ? null : x; };
    rows.sort(function (a, b) {
      var av = txt(a.cells[idx]), bv = txt(b.cells[idx]);
      var an = num(av), bn = num(bv);
      if (an !== null && bn !== null) return (an - bn) * dir;
      return av.localeCompare(bv, 'ko') * dir;
    });
    rows.forEach(function (r) { tb.tBodies[0].appendChild(r); });
  });
  document.addEventListener('mouseover', function (e) {
    var th = e.target && e.target.closest && e.target.closest('thead th');
    if (th && !th.classList.contains('sf-sortable')) th.classList.add('sf-sortable');
  });

  function activeSec() { return document.querySelector('.page-section.active'); }
  function applyFilter(q) {
    var sec = activeSec(); if (!sec) return;
    q = String(q || '').trim().toLowerCase();
    var hit = 0, tot = 0;
    [].slice.call(sec.querySelectorAll('table')).forEach(function (t) {
      if (!t.tBodies[0]) return;
      [].slice.call(t.tBodies[0].rows).forEach(function (r) {
        tot++;
        var ok = !q || txt(r).toLowerCase().indexOf(q) >= 0;
        r.style.display = ok ? '' : 'none';
        if (ok) hit++;
      });
    });
    var b = el('sf-filter-n'); if (b) b.textContent = q ? (hit + '/' + tot) : '';
  }

  function exportVisible() {
    var sec = activeSec();
    if (!sec || typeof XLSX === 'undefined') { toast('내보낼 표가 없습니다', 'error'); return; }
    var ts = [].slice.call(sec.querySelectorAll('table')).filter(function (t) { return t.tBodies[0] && t.tBodies[0].rows.length; });
    if (!ts.length) { toast('이 화면에는 표가 없습니다', 'error'); return; }
    var wb = XLSX.utils.book_new();
    ts.forEach(function (t, i) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t, { display: true, raw: false }), ('표' + (i + 1)).slice(0, 28));
    });
    var title = (txt(sec.querySelector('h2')) || 'SHIFTI').replace(/[\\/:*?"<>|]/g, '');
    XLSX.writeFile(wb, title + '_' + kstToday() + '.xlsx');
    toast('엑셀 ' + ts.length + '개 시트로 내보냈습니다', 'success');
  }
  window.shiftiExportVisible = exportVisible;

  /* CSV 한글 깨짐 방지 — 모든 CSV Blob 에 UTF-8 BOM */
  (function () {
    var RB = window.Blob;
    function B(parts, opts) {
      try {
        if (opts && /text\/csv/.test(String(opts.type)) && Array.isArray(parts) &&
          typeof parts[0] === 'string' && parts[0].charCodeAt(0) !== 0xFEFF) {
          parts = ['\uFEFF' + parts[0]].concat(parts.slice(1));
        }
      } catch (e) {}
      return new RB(parts, opts);
    }
    B.prototype = RB.prototype;
    window.Blob = B;
  })();

  /* ── 대시보드 알림 ── */
  function computeAlerts() {
    var d = db(); if (!d || !d.stock) return null;
    var t = kstToday(), d30 = addDays(t, 30);
    var a = { expired: [], soon: [], hold: [], neg: [], short: [], mature: [] };
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      lots(k).forEach(function (l) {
        if (n(l.remaining) < 0) a.neg.push(l);
        if (n(l.remaining) <= 0) return;
        var s = String(l.status || 'OK').toUpperCase();
        if (l.expDate && l.expDate < t) a.expired.push(l);
        else if (l.expDate && l.expDate <= d30) a.soon.push(l);
        if (SOFT.indexOf(s) >= 0) a.hold.push(l);
        if (k === 'BULK' && l.matureUntil && l.matureUntil > t) a.mature.push(l);
      });
    });
    ((d.master || {}).M_SAFETY_STOCK || []).forEach(function (s) {
      if (window.totalStock(s.type, s.itemId) < n(s.minQty || s.min || s.qty)) a.short.push(s);
    });
    return a;
  }
  function paintAlerts() {
    var page = el('page-dashboard'); if (!page) return;
    var a = computeAlerts(); if (!a) return;
    var box = el('sf-alerts');
    if (!box) { box = document.createElement('div'); box.id = 'sf-alerts'; page.insertBefore(box, page.firstChild); }
    var cards = [
      { n: a.expired.length, l: '유통기한 만료 LOT', c: 'sf-red', go: 'stock' },
      { n: a.soon.length, l: '30일 내 만료 예정', c: 'sf-amber', go: 'stock' },
      { n: a.hold.length, l: '검사 미판정 LOT', c: 'sf-blue', go: 't-qc' },
      { n: a.mature.length, l: '숙성 진행 중 벌크', c: 'sf-blue', go: 'bulk-maturation' },
      { n: a.short.length, l: '안전재고 미달', c: 'sf-amber', go: 'safety-stock' },
      { n: a.neg.length, l: '마이너스 재고', c: 'sf-red', go: 'stock-ledger' }
    ].filter(function (c) { return c.n > 0; });
    box.innerHTML = cards.length ? cards.map(function (c) {
      return '<div class="sf-alert ' + c.c + '" data-go="' + c.go + '" role="button" tabindex="0"><div class="n">' + c.n + '</div><div class="l">' + c.l + '</div></div>';
    }).join('') : '<div class="sf-alert sf-teal" style="cursor:default"><div class="n">✓</div><div class="l">점검할 항목이 없습니다. 재고·유통기한·검사 상태 모두 정상입니다.</div></div>';
    [].slice.call(box.querySelectorAll('[data-go]')).forEach(function (x) {
      x.onclick = function () { safe(function () { window.goPage(x.dataset.go); }); };
      x.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); x.click(); } };
    });
  }
  window.shiftiAlerts = paintAlerts;

  /* ── 금액 한글 힌트 ── */
  function hangul(v) {
    v = Math.round(Math.abs(n(v))); if (!v) return '';
    var u = [['조', 1e12], ['억', 1e8], ['만', 1e4]], o = '';
    u.forEach(function (p) { var q = Math.floor(v / p[1]); if (q) { o += q.toLocaleString() + p[0] + ' '; v -= q * p[1]; } });
    if (v) o += v.toLocaleString();
    return o.trim() + '원';
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'number') return;
    if (!/price|cost|amount|금액|단가/i.test(t.id + ' ' + (t.placeholder || ''))) return;
    var tip = el('sf-money-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'sf-money-tip'; tip.className = 'sf-money'; document.body.appendChild(tip); }
    var v = n(t.value);
    if (!v) { tip.style.display = 'none'; return; }
    var r = t.getBoundingClientRect();
    tip.textContent = hangul(v); tip.style.display = 'block';
    tip.style.left = r.left + 'px'; tip.style.top = (r.bottom + 3) + 'px';
  });
  document.addEventListener('focusout', function () { var t = el('sf-money-tip'); if (t) t.style.display = 'none'; });

  /* ── 단축키 ── */
  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPal(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); window.shiftiFlushNow(); }
    else if (e.key === 'Escape') closePal();
    else if (e.key === 'F2') { e.preventDefault(); if (el('sf-filter')) el('sf-filter').focus(); }
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * M10 · 진단
   * ═══════════════════════════════════════════════════════════════════ */
  function diagnose() {
    var d = db(); if (!d) return;
    var iss = [], seen = {}, lotNos = {};
    ['RAW', 'PACK', 'BULK', 'FGT'].forEach(function (k) {
      lots(k).forEach(function (l) {
        var key = k + ':' + l.id;
        if (seen[key]) iss.push('ID 중복 · ' + k + ' · ' + l.lotNo);
        seen[key] = 1;
        if (lotNos[l.lotNo]) iss.push('LOT번호 중복 · ' + l.lotNo);
        lotNos[l.lotNo] = 1;
        if (n(l.remaining) < 0) iss.push('마이너스 잔량 · ' + l.lotNo + ' = ' + l.remaining);
        if (n(l.remaining) > n(l.qty) + 1e-6) iss.push('잔량>입고량 · ' + l.lotNo + ' (' + l.remaining + '/' + l.qty + ')');
        if (!l.lotNo) iss.push('LOT번호 없음 · ' + k + ' id=' + l.id);
        var mid = l.rawId || l.packId || l.productId;
        var master = k === 'RAW' ? (d.master.M_RAW || []).find(function (x) { return String(x.rawId) === String(mid); })
          : k === 'PACK' ? (d.master.M_PACK || []).find(function (x) { return String(x.packId) === String(mid); })
            : (d.master.M_PRODUCT || []).find(function (x) { return String(x.productId) === String(mid); });
        if (!master) iss.push('마스터 없는 LOT · ' + l.lotNo);
      });
    });
    (d.master.M_PRODUCT || []).forEach(function (p) {
      if (!p.bom || !p.bom.length) iss.push('BOM 미등록 제품 · ' + p.name);
    });
    var size = 0; try { size = new Blob([JSON.stringify(d)]).size; } catch (e) {}
    var txnN = Object.keys(d.txn || {}).reduce(function (s, k) { return s + (d.txn[k] || []).length; }, 0);
    alert('데이터 진단 · ' + kstNow() + '\n' +
      '────────────────────────────\n' +
      '용량        ' + (size / 1048576).toFixed(2) + ' MB' + (size > 3e6 ? '   ⚠ 3MB 초과 — 정리 권장' : '') + '\n' +
      'LOT         ' + ['RAW', 'PACK', 'BULK', 'FGT'].reduce(function (s, k) { return s + lots(k).length; }, 0) + '건\n' +
      '거래         ' + txnN + '건\n' +
      '감사로그    ' + (d.logs || []).length + ' / ' + LOG_MAX + '건\n' +
      '마지막저장 ' + String((d.meta || {}).updatedAt || '-').replace('T', ' ').slice(0, 19) + ' · ' + ((d.meta || {}).updatedBy || '-') + '\n' +
      '자동백업    ' + (safe(function () { return JSON.parse(localStorage.getItem('shifti_bk_keys') || '[]').length; }) || 0) + '일치 보관\n' +
      '────────────────────────────\n' +
      (iss.length ? '발견된 문제 ' + iss.length + '건\n\n' + iss.slice(0, 30).join('\n') + (iss.length > 30 ? '\n… 외 ' + (iss.length - 30) + '건' : '')
        : '✓ 무결성 문제 없음'));
  }
  window.shiftiDiagnose = diagnose;

  /* ═══════════════════════════════════════════════════════════════════════
   * M12 · 생산 가능량 (원료 상한 + 숙성 리드타임)
   *
   *  "500개 생산 권장" 이라고 해도 원료가 200개분뿐이면 의미가 없습니다.
   *  BOM 과 가용재고로 실제 만들 수 있는 수량을 산출합니다.
   * ═══════════════════════════════════════════════════════════════════ */
  function matureDays(p) {
    return n(p && p.matureDays) || n(localStorage.getItem('shifti_mature_days')) || 7;
  }
  function perUnit(product, row) {
    return window.bomNeed ? n(window.bomNeed(product, row, 1)) : n(row.qty);
  }
  /* 원료로 새로 만들 수 있는 개수 (포장재 제약 포함) */
  function producibleDetail(product) {
    if (!product) return { qty: 0, limits: [] };
    var bom = product.bom || [];
    if (!bom.length) return { qty: 0, limits: [{ name: 'BOM 미등록', avail: 0, per: 0, max: 0 }] };
    var fromBulk = r6(lots('BULK').filter(function (l) {
      return String(l.productId) === String(product.productId) && usable(l);
    }).reduce(function (s, l) { return s + n(l.remaining); }, 0));

    var rawMax = Infinity, packMax = Infinity, limits = [];
    bom.forEach(function (row) {
      var per = perUnit(product, row);
      if (per <= 0) return;
      var avail = window.totalStock(row.type, row.itemId);
      var max = Math.floor(r6(avail / per));
      var nm = safe(function () { return window.masterName(row.type, row.itemId); }) || row.itemId;
      limits.push({ name: nm, type: row.type, avail: avail, per: per, max: max });
      if (row.type === 'PACK') packMax = Math.min(packMax, max);
      else rawMax = Math.min(rawMax, max);
    });
    if (rawMax === Infinity) rawMax = 0;
    if (packMax === Infinity) packMax = Infinity;
    var total = Math.min(fromBulk + rawMax, packMax);
    return {
      qty: Math.max(0, Math.floor(total)),
      fromBulk: fromBulk, fromRaw: rawMax,
      packLimit: packMax === Infinity ? null : packMax,
      limits: limits.sort(function (a, b) { return a.max - b.max; })
    };
  }
  function producible(product) { return producibleDetail(product).qty; }
  window.shiftiProducible = producibleDetail;

  /* 출고 가능일 = 오늘 + 숙성 + 충진/검사 1일 (벌크 재고가 있으면 즉시 충진) */
  function readyDate(product, qty) {
    var det = producibleDetail(product);
    if (n(qty) <= det.fromBulk) return { date: addDays(kstToday(), 1), path: '기존 벌크로 충진' };
    return { date: addDays(kstToday(), matureDays(product) + 1), path: '조향 → 숙성 ' + matureDays(product) + '일 → 충진' };
  }
  window.shiftiReadyDate = readyDate;

  /* ═══════════════════════════════════════════════════════════════════════
   * M11 · SHIFTI AI
   *
   *  [수정] say() 가 서버응답·제품명·사용자입력을 innerHTML 에 그대로 삽입 (XSS)
   *  [수정] productId 가 문자열로 오면 findProduct(강한 비교)가 못 찾아
   *         생산계획 화면에 제품명이 "-" 로 표시됨
   *  [수정] 문서번호가 배열길이 기반이라 삭제 시 중복. UTC 라 전날 번호.
   *         기존 체계(PP-M2X8K3)와 형식도 불일치
   *  [수정] items[].unitPrice — 기존 saveSO 는 price 키를 씁니다 (양쪽 다 기록)
   *  [수정] 모든 오류가 "명령 처리 중 오류"로 뭉개져 원인 파악 불가
   *  [보완] 계산 결과에서 바로 생산계획 등록 · 원료 상한 · 출고가능일
   * ═══════════════════════════════════════════════════════════════════ */
  /*  정확 일치만 반환합니다.
   *  부분 일치를 조용히 채택하면 "없는제품" 이 "BOM없는제품" 으로 잡히는 식의
   *  오등록이 발생합니다. 부분 일치는 resolveLoose 로 분리해 사용자 확인을 받습니다. */
  function exactFind(L, v, idKey) {
    if (v == null || v === '') return null;
    var s = String(v).toLowerCase();
    return L.find(function (x) { return String(x[idKey]) === String(v); })
      || L.find(function (x) { return x.code && String(x.code).toLowerCase() === s; })
      || L.find(function (x) { return x.name && String(x.name).toLowerCase() === s; })
      || null;
  }
  function looseFind(L, v, idKey) {
    var hit = exactFind(L, v, idKey);
    if (hit) return { item: hit, fuzzy: false };
    if (v == null || v === '') return { item: null, fuzzy: false };
    var s = String(v).toLowerCase().replace(/\s+/g, '');
    var c = L.filter(function (x) {
      return x.name && String(x.name).toLowerCase().replace(/\s+/g, '').indexOf(s) >= 0;
    });
    /* 후보가 정확히 하나일 때만 제안한다. 둘 이상이면 사람이 골라야 한다 */
    return { item: c.length === 1 ? c[0] : null, fuzzy: c.length === 1, ambiguous: c.length > 1, candidates: c };
  }
  function PRODUCTS() { return ((db() || {}).master || {}).M_PRODUCT || []; }
  function CUSTOMERS() { return ((db() || {}).master || {}).M_CUSTOMER || []; }
  function resolveProduct(v) { return exactFind(PRODUCTS(), v, 'productId'); }
  function resolveCustomer(v) { return exactFind(CUSTOMERS(), v, 'customerId'); }
  function resolveProductLoose(v) { return looseFind(PRODUCTS(), v, 'productId'); }
  function resolveCustomerLoose(v) { return looseFind(CUSTOMERS(), v, 'customerId'); }

  /* 부분 일치일 때는 반드시 확인을 받는다. 못 찾으면 안내 문구를 돌려준다. */
  function pickOrExplain(res, label, raw) {
    if (res.item && !res.fuzzy) return res.item;
    if (res.item && res.fuzzy) {
      return confirm('입력하신 "' + raw + '" 와 가장 가까운 항목입니다.\n\n  → ' + res.item.name +
        '\n\n이 ' + label + '(으)로 진행할까요?') ? res.item : null;
    }
    if (res.ambiguous) {
      say('❌ ' + label + ' 후보가 여러 개입니다: <b>' + res.candidates.slice(0, 5).map(function (x) { return esc(x.name); }).join(', ') +
        '</b><br>정확한 이름으로 다시 말씀해 주세요.');
      return null;
    }
    say('❌ ' + label + '을(를) 찾지 못했습니다: <b>' + esc(raw) + '</b><br>마스터에 등록된 이름으로 다시 말씀해 주세요.');
    return null;
  }

  async function syncFirst() {
    if (!S) return;
    S.dirty && schedule(0);
    for (var i = 0; i < 24; i++) {
      if (!S.dirty && !S.sending) return;
      await new Promise(function (r) { setTimeout(r, 250); });
    }
  }

  async function aiApi(action, body) {
    var url = (window.SB_URL || '') + '/functions/v1/shifti-ai?action=' + encodeURIComponent(action);
    if (!window.SB_KEY) throw new Error('Supabase 키가 없습니다. 로그인 상태를 확인해 주세요.');
    var opt = { headers: { apikey: window.SB_KEY, Authorization: 'Bearer ' + window.SB_KEY } };
    if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    var r = await fetch(url, opt);
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      throw new Error((d.message || d.error || '') || ('서버 응답 ' + r.status +
        (r.status === 401 ? ' · 인증 실패 (재로그인 필요)' : r.status === 404 ? ' · shifti-ai 함수를 찾을 수 없음' : r.status >= 500 ? ' · 서버 오류' : '')));
    }
    return d;
  }

  var aiRows = [];
  window.shiftiAIRefresh = async function () {
    var tb = el('shifti-ai-table'); if (!tb) return;
    tb.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-slate-400">동기화 후 계산 중…</td></tr>';
    await syncFirst();
    try {
      var d = await aiApi('daily-production');
      aiRows = d.rows || [];
      if (el('shifti-ai-total')) el('shifti-ai-total').textContent = fmt(d.totalRecommendedQty);
      if (el('shifti-ai-source')) el('shifti-ai-source').textContent = d.sourceUpdatedAt ? new Date(d.sourceUpdatedAt).toLocaleDateString('ko-KR') : '-';
      var age = d.sourceAgeDays, ae = el('shifti-ai-age');
      if (ae) {
        ae.textContent = age == null ? '기준일 확인 필요' : (age === 0 ? '오늘 데이터' : age + '일 전 데이터');
        ae.style.color = (age == null || age >= 1) ? '#b45309' : '#64748b';
        ae.style.fontWeight = (age == null || age >= 1) ? '800' : '400';
      }
      var wn = el('shifti-ai-warnings');
      if (wn) {
        var ws = (d.warnings || []).slice();
        if (age != null && age >= 1) ws.unshift('계산 기준 데이터가 ' + age + '일 전입니다. 최근 입고·출고가 반영되지 않았을 수 있습니다.');
        wn.innerHTML = ws.map(function (w) {
          return '<div class="card p-3 border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold mb-2">⚠ ' + esc(w) + '</div>';
        }).join('');
      }
      ensureAICols();
      tb.innerHTML = aiRows.map(function (r, i) {
        var p = resolveProduct(r.productId != null ? r.productId : (r.code || r.name));
        var want = n(r.recommendedQty);
        var det = p ? producibleDetail(p) : { qty: 0, limits: [] };
        var canMake = det.qty;
        var real = Math.min(want, canMake);
        var short = Math.max(0, want - canMake);
        var rd = p && real > 0 ? readyDate(p, real) : null;
        var bottleneck = short > 0 && det.limits.length ? det.limits[0].name : '';
        var btn = !p ? '<span class="text-[10px] text-red-500 font-bold">제품 미등록</span>'
          : real > 0 ? '<button class="btn btn-primary btn-sm" data-ai-plan="' + i + '">계획 등록</button>'
            : want > 0 ? '<span class="text-[10px] text-red-500 font-bold">원료 부족</span>'
              : '<span class="text-[10px] text-slate-300">—</span>';
        return '<tr>' +
          '<td><div class="font-bold">' + esc(r.name) + '</div><div class="text-[10px] text-slate-400">' + esc(r.code) + '</div></td>' +
          '<td class="text-right">' + fmt(r.stockOk) + '</td>' +
          '<td class="text-right">' + fmt(r.openOrders) + '</td>' +
          '<td class="text-right">' + fmt(r.safetyStock) + '</td>' +
          '<td class="text-right">' + fmt(r.recentSalesQty) + '</td>' +
          '<td class="text-right">' + fmt(want) + '</td>' +
          '<td class="text-right ' + (canMake < want ? 'text-amber-600 font-bold' : 'text-slate-500') + '">' + fmt(canMake) + '</td>' +
          '<td class="text-right font-black ' + (real > 0 ? 'text-teal-700' : 'text-slate-300') + '">' + fmt(real) + '</td>' +
          '<td class="text-[10.5px] ' + (short > 0 ? 'text-red-600 font-bold' : 'text-slate-400') + '">' +
          (short > 0 ? esc(bottleneck) + ' ' + fmt(short) + '개분 부족' : '충족') + '</td>' +
          '<td class="text-[10.5px] text-slate-500">' + (rd ? esc(rd.date) + '<br><span class="text-[9.5px] text-slate-400">' + esc(rd.path) + '</span>' : '-') + '</td>' +
          '<td class="text-right pr-3">' + btn + '</td></tr>';
      }).join('') || '<tr><td colspan="11" class="text-center py-8 text-slate-400">지금은 추가 생산이 필요한 제품이 없습니다.</td></tr>';

      [].slice.call(tb.querySelectorAll('[data-ai-plan]')).forEach(function (b) {
        b.onclick = function () { planFromRow(aiRows[Number(b.dataset.aiPlan)]); };
      });
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-red-500 text-xs">' + esc(e.message || e) + '</td></tr>';
    }
  };

  function ensureAICols() {
    var tr = document.querySelector('#page-shifti-ai thead tr');
    if (!tr || tr.dataset.sfCols === '1') return;
    tr.dataset.sfCols = '1';
    tr.innerHTML = ['제품', 'OK재고', '미출고주문', '안전재고', '최근판매', '필요수량', '생산가능', '권장생산', '제약', '출고가능일', '실행']
      .map(function (h, i) { return '<th class="' + (i >= 1 && i <= 7 ? 'text-right' : (i === 10 ? 'text-right pr-3' : '')) + '">' + h + '</th>'; }).join('');
  }

  function planFromRow(row) {
    if (!row) return;
    var p = resolveProduct(row.productId != null ? row.productId : (row.code || row.name));
    if (!p) { toast('제품 마스터에 없는 항목입니다: ' + row.name, 'error'); return; }
    var det = producibleDetail(p);
    var qty = Math.min(n(row.recommendedQty), det.qty);
    if (qty <= 0) { toast('원료 가용량이 없어 계획을 세울 수 없습니다', 'error'); return; }
    var rd = readyDate(p, qty);
    if (!confirm(p.name + '  ' + fmt(qty) + '개\n\n· 필요 ' + fmt(row.recommendedQty) + '개 중 원료로 가능한 만큼\n· 경로 ' + rd.path +
      '\n· 출고 가능 예정 ' + rd.date + '\n· 담당 ' + (operator() || '미지정') + '\n\n생산계획으로 등록할까요?')) return;
    pushPlan(p, qty, kstToday(), (row.priority === '긴급' || row.priority === '최우선') ? row.priority : '일반',
      'SHIFTI AI 추천 · 출고가능 ' + rd.date);
  }

  function pushPlan(product, qty, date, priority, note) {
    var d = db(); d.txn = d.txn || {}; d.txn.T_PROD_PLAN = d.txn.T_PROD_PLAN || [];
    var pp = {
      id: window.generateId('PP'), no: docNo('PP'),
      productId: Number(product.productId), qty: r6(qty),
      date: date || kstToday(), priority: priority || '일반',
      note: note || 'SHIFTI AI', status: '계획',
      by: operator() || '미지정', byAt: new Date().toISOString()
    };
    d.txn.T_PROD_PLAN.push(pp);
    safe(function () { window.logEvent('생산계획(AI): ' + product.name + ' ' + fmt(qty) + 'ea'); });
    window.saveDB();
    toast('생산계획 ' + pp.no + ' · ' + product.name + ' ' + fmt(qty) + 'ea', 'success');
    return pp;
  }

  function pushSO(cust, prd, qty, unitPrice, date) {
    var d = db(); d.txn = d.txn || {}; d.txn.T_SO = d.txn.T_SO || [];
    var amt = r6(n(qty) * n(unitPrice));
    var so = {
      id: window.generateId('SO'), no: docNo('SO'),
      customerId: Number(cust.customerId), date: date || kstToday(), dueDate: date || kstToday(),
      /* 기존 saveSO() 는 price 키를 읽습니다. 두 키를 모두 기록해 호환시킵니다 */
      items: [{ productId: Number(prd.productId), qty: r6(qty), price: r6(unitPrice), unitPrice: r6(unitPrice), amount: amt }],
      totalAmount: amt, status: '접수',
      by: operator() || '미지정', byAt: new Date().toISOString()
    };
    d.txn.T_SO.push(so);
    safe(function () { window.logEvent('수주등록(AI): ' + so.no + ' / ' + cust.name); });
    window.saveDB();
    toast('수주 등록 ' + so.no, 'success');
    return so;
  }

  function say(html) {
    var b = el('shifti-command-result');
    if (b) b.innerHTML = '<div style="padding:12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12.5px;line-height:1.75">' + html + '</div>';
  }

  function execAction(r) {
    if (!r || !r.clientAction) return;
    var a = r.args || {};
    if (r.requiresConfirmation && !confirm(String(r.message || '') + '\n\n실행할까요?')) { say('취소했습니다.'); return; }

    if (r.clientAction === 'navigate') {
      if (!a.pageId || !el('page-' + a.pageId)) { say('❌ 화면을 찾지 못했습니다: ' + esc(a.pageId)); return; }
      window.goPage(a.pageId); return;
    }
    if (r.clientAction === 'open_quote') { window.goPage('doc-quote'); return; }
    if (r.clientAction === 'backup') { window.exportJSON(); say('✅ 백업 파일을 내려받았습니다.'); return; }

    if (r.clientAction === 'create_production_plan') {
      var pRaw = a.productId != null ? a.productId : (a.productCode || a.productName);
      var p = pickOrExplain(resolveProductLoose(pRaw), '제품', pRaw);
      if (!p) return;
      var q = n(a.qty);
      if (q <= 0) { say('❌ 수량이 확인되지 않았습니다. 예: "' + esc(p.name) + ' 50개 생산계획"'); return; }
      var det = producibleDetail(p);
      if (q > det.qty) {
        var bn = det.limits.length ? det.limits[0].name : '원료';
        if (!confirm('현재 원료로는 ' + fmt(det.qty) + '개까지만 생산 가능합니다.\n(제약: ' + bn + ')\n\n요청하신 ' + fmt(q) + '개로 계획을 잡을까요?\n[취소] 하면 ' + fmt(det.qty) + '개로 조정합니다.')) q = det.qty;
        if (q <= 0) { say('❌ 원료 가용량이 0입니다. 발주가 필요합니다.'); return; }
      }
      var rd = readyDate(p, q);
      var pp = pushPlan(p, q, a.date || kstToday(), a.priority, 'SHIFTI AI 자연어 명령 · 출고가능 ' + rd.date);
      say('✅ <b>' + esc(p.name) + ' ' + fmt(q) + '개</b> 생산계획 등록 (' + esc(pp.no) + ')<br>' +
        '경로 ' + esc(rd.path) + ' · 출고 가능 예정 <b>' + esc(rd.date) + '</b><br>' +
        '<button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="goPage(\'prod-plan\')">생산계획 화면 열기</button>');
      return;
    }

    if (r.clientAction === 'create_sales_order') {
      var cRaw = a.customerId != null ? a.customerId : a.customerName;
      var prRaw = a.productId != null ? a.productId : (a.productCode || a.productName);
      var c = pickOrExplain(resolveCustomerLoose(cRaw), '거래처', cRaw);
      if (!c) return;
      var pr = pickOrExplain(resolveProductLoose(prRaw), '제품', prRaw);
      if (!pr) return;
      var sq = n(a.qty);
      if (sq <= 0) { say('❌ 수량이 확인되지 않았습니다.'); return; }
      var up = n(a.unitPrice) || n(pr.salePrice);
      if (up <= 0 && !confirm('단가가 0원입니다. 그대로 등록할까요?')) { say('취소했습니다.'); return; }
      var stock = window.totalStock('FGT', pr.productId);
      var so = pushSO(c, pr, sq, up);
      say('✅ <b>' + esc(c.name) + '</b> · ' + esc(pr.name) + ' ' + fmt(sq) + '개 수주 등록 (' + esc(so.no) + ')<br>' +
        '금액 ' + fmt(so.totalAmount) + '원' +
        (stock < sq ? '<br><span style="color:#b45309;font-weight:800">⚠ 출고가능 재고 ' + fmt(stock) + '개 — ' + fmt(sq - stock) + '개 생산 필요</span>' : '') +
        '<br><button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="goPage(\'sales-order\')">수주관리 열기</button>');
      return;
    }

    if (r.clientAction === 'export_shipping_excel') return exportShipping();
    if (r.clientAction === 'export_tax_excel') return exportTax();
    say('처리했습니다.');
  }

  function exportShipping() {
    if (!window.XLSX) { say('❌ 엑셀 모듈을 찾을 수 없습니다.'); return; }
    var d = db(), rows = [];
    ((d.txn || {}).T_SO || []).forEach(function (so) {
      if (['완료', '출고완료', '취소'].indexOf(so.status) >= 0) return;
      (so.items || []).forEach(function (it) {
        var p = resolveProduct(it.productId), c = resolveCustomer(so.customerId);
        rows.push({
          수주번호: so.no || '', 거래처: (c && c.name) || '', 제품: (p && p.name) || it.productId,
          수량: n(it.qty), 출고예정일: so.dueDate || so.date || '',
          재고: p ? window.totalStock('FGT', p.productId) : ''
        });
      });
    });
    if (!rows.length) { say('출고 대기 중인 수주가 없습니다.'); return; }
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '택배등록');
    XLSX.writeFile(wb, 'SHIFTI_택배등록_' + kstToday() + '.xlsx');
    say('✅ 택배등록 엑셀 ' + rows.length + '건을 만들었습니다.');
  }
  function exportTax() {
    if (!window.XLSX) { say('❌ 엑셀 모듈을 찾을 수 없습니다.'); return; }
    var rows = (((db() || {}).txn || {}).T_SALE || []).map(function (s) {
      var p = resolveProduct(s.productId), c = resolveCustomer(s.customerId);
      var sup = Math.round(n(s.amount));
      return {
        거래일: s.date || '', 거래처: (c && c.name) || '', 제품: (p && p.name) || s.productId,
        수량: n(s.qty), 공급가액: sup, 부가세: Math.round(sup * 0.1), 합계: Math.round(sup * 1.1)
      };
    });
    if (!rows.length) { say('출고 내역이 없습니다.'); return; }
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '세금계산서자료');
    XLSX.writeFile(wb, 'SHIFTI_세금계산서자료_' + kstToday() + '.xlsx');
    say('✅ 세금계산서 자료 ' + rows.length + '건 (부가세 10% 별도 산출 포함)');
  }

  var aiRunning = false;
  async function runCommand(text) {
    text = String(text || '').trim();
    if (!text || aiRunning) return;
    aiRunning = true;
    say('⏳ <b>' + esc(text) + '</b> 처리 중…');
    try {
      await syncFirst();
      var r = await aiApi('command', { text: text });
      say('🤖 ' + esc(r.message || '처리했습니다.'));
      if (r.intent === 'daily_production' && r.data) {
        var rs = (r.data.rows || []).filter(function (x) { return n(x.recommendedQty) > 0; });
        say('<b>오늘 생산 권장 ' + fmt(r.data.totalRecommendedQty) + '개</b><br><br>' +
          (rs.map(function (x) {
            var p = resolveProduct(x.productId != null ? x.productId : (x.code || x.name));
            var can = p ? producibleDetail(p).qty : 0;
            return '• ' + esc(x.name) + ' : <b>' + fmt(Math.min(n(x.recommendedQty), can)) + '개</b>' +
              (can < n(x.recommendedQty) ? ' <span style="color:#b45309">(원료 상한 ' + fmt(can) + ')</span>' : '');
          }).join('<br>') || '추가 생산이 필요한 제품이 없습니다.'));
      }
      if (r.intent === 'shortage_report' && r.data) {
        say('<b>' + esc(r.message) + '</b><br><br>' +
          ((r.data.rows || []).slice(0, 15).map(function (x) { return '• ' + esc(x.name) + ' 부족 <b>' + fmt(x.shortage) + '</b>'; }).join('<br>') || '부족 품목이 없습니다.'));
      }
      execAction(r);
    } catch (e) {
      say('❌ ' + esc(e.message || e) + '<br><span style="color:#94a3b8;font-size:11px">네트워크 또는 shifti-ai 함수 상태를 확인해 주세요.</span>');
    } finally { aiRunning = false; }
  }
  window.shiftiRunCommand = runCommand;

  function installCommander() {
    var page = el('page-shifti-ai'); if (!page) return false;
    var old = el('shifti-command-box');
    if (old && old.dataset.sf === '1') return true;
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'shifti-command-box'; box.dataset.sf = '1'; box.className = 'card p-4 mb-4';
    box.innerHTML =
      '<div style="font-weight:900;font-size:16px;margin-bottom:4px">🎙 SHIFTI AI 업무비서</div>' +
      '<div style="font-size:11px;color:#64748b;margin-bottom:12px">말하거나 자연어로 입력하세요. 등록 전에 항상 확인을 거칩니다.</div>' +
      '<div style="display:flex;gap:8px">' +
      '<input id="shifti-command-input" placeholder="예: ARIRANG 30ml 50개 생산계획 잡아줘" aria-label="AI 명령 입력" style="flex:1;border:1px solid #cbd5e1;border-radius:9px;padding:11px;font-family:inherit;font-size:13px">' +
      '<button id="shifti-mic" class="btn btn-secondary" style="font-size:18px;padding:8px 13px" aria-label="음성 입력">🎙</button>' +
      '<button id="shifti-send" class="btn btn-primary" style="padding:8px 18px">실행</button></div>' +
      '<div id="shifti-command-result" style="margin-top:12px"></div>' +
      '<div style="font-size:11px;color:#94a3b8;margin-top:10px">오늘 생산량 알려줘 · 원료 부족 알려줘 · 이번달 매출 보여줘 · ARIRANG 50개 생산계획 잡아줘 · 수주관리 열어줘 · 택배파일 만들어줘</div>';
    page.insertBefore(box, page.firstChild);

    var input = el('shifti-command-input');
    el('shifti-send').onclick = function () { runCommand(input.value); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runCommand(input.value); } });

    var rec = null;
    el('shifti-mic').onclick = function () {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { say('이 브라우저는 음성인식을 지원하지 않습니다. Chrome 에서 사용해 주세요.'); return; }
      if (rec) { try { rec.stop(); } catch (e) {} rec = null; return; }
      rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = false;
      el('shifti-mic').textContent = '⏹';
      say('🎙 듣고 있습니다… 다시 누르면 중지합니다.');
      rec.onresult = function (e) { var t = e.results[0][0].transcript; input.value = t; runCommand(t); };
      rec.onerror = function (e) {
        say(e.error === 'not-allowed' ? '❌ 마이크 권한이 거부되었습니다. 주소창 자물쇠 → 마이크 → 허용으로 바꿔 주세요.'
          : e.error === 'no-speech' ? '음성이 감지되지 않았습니다. 다시 시도해 주세요.'
            : '❌ 음성인식 오류: ' + esc(e.error));
      };
      rec.onend = function () { rec = null; el('shifti-mic').textContent = '🎙'; };
      try { rec.start(); } catch (e) { rec = null; el('shifti-mic').textContent = '🎙'; }
    };
    return true;
  }

  function fixQuick() {
    var page = el('page-shifti-ai'); if (!page || page.dataset.sfQuick === '1') return;
    var t = [].slice.call(page.querySelectorAll('.card')).find(function (c) { return /빠른 명령/.test(c.textContent || ''); });
    if (!t) return;
    page.dataset.sfQuick = '1';
    t.innerHTML = '<div class="font-black mb-3">빠른 명령</div><div class="grid grid-cols-1 md:grid-cols-2 gap-2">' +
      '<button class="btn btn-secondary justify-start" data-q="calc">오늘 몇 개 생산해야 돼?</button>' +
      '<button class="btn btn-secondary justify-start" data-q="short">원료 부족한 거 알려줘</button>' +
      '<button class="btn btn-secondary justify-start" data-q="ship">택배등록 파일 만들어줘</button>' +
      '<button class="btn btn-secondary justify-start" data-q="tax">세금계산서 자료 뽑아줘</button></div>' +
      '<div style="font-size:10.5px;color:#94a3b8;margin-top:9px">Gmail 주문 수집 · 견적 메일 발송 · 텔레그램 알림은 아직 연결 전입니다.</div>';
    [].slice.call(t.querySelectorAll('[data-q]')).forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.q;
        if (k === 'calc') window.shiftiAIRefresh();
        else if (k === 'short') runCommand('원료 부족 알려줘');
        else if (k === 'ship') exportShipping();
        else exportTax();
      };
    });
  }
  function fixNav() { var v = document.querySelector('[data-shifti-ai-nav="1"]'); if (v && !v.id) v.id = 'nav-shifti-ai'; }

  /* ═══════════════════════════════════════════════════════════════════════
   * M13 · 부팅
   * ═══════════════════════════════════════════════════════════════════ */
  function buildBar() {
    if (el('sf-bar')) return;
    var b = document.createElement('div');
    b.id = 'sf-bar';
    b.innerHTML =
      '<button id="sf-b-search" title="Ctrl+K">🔍 검색</button>' +
      '<input id="sf-filter" placeholder="표에서 찾기 (F2)" aria-label="표 필터"><span id="sf-filter-n" style="font-size:10px;color:#5eead4;font-weight:800;min-width:32px"></span>' +
      '<span class="sep"></span>' +
      '<button id="sf-b-xls" title="보이는 표를 엑셀로">⬇ 엑셀</button>' +
      '<button id="sf-b-print" title="A4 인쇄">🖨 인쇄</button>' +
      '<span class="sep"></span>' +
      '<button id="sf-operator" title="작업자 변경">👤</button>' +
      '<button id="sf-strict" title="GMP 엄격모드 전환" style="border-radius:999px;padding:4px 9px"></button>' +
      '<button id="sf-b-diag" title="데이터 진단">🩺</button>' +
      '<button id="sf-b-restore" title="로컬 자동백업 복원">↩</button>' +
      '<button id="sf-b-save" title="Ctrl+S 즉시 저장">⚡</button>';
    document.body.appendChild(b);
    el('sf-b-search').onclick = openPal;
    el('sf-b-xls').onclick = exportVisible;
    el('sf-b-print').onclick = function () { window.print(); };
    el('sf-operator').onclick = function () { askOperator(true); };
    el('sf-strict').onclick = window.shiftiToggleStrict;
    el('sf-b-diag').onclick = diagnose;
    el('sf-b-restore').onclick = window.shiftiRestoreLocal;
    el('sf-b-save').onclick = window.shiftiFlushNow;
    el('sf-filter').addEventListener('input', function () { applyFilter(this.value); });
    paintOperator(); paintStrict();
  }

  var tries = 0;
  function boot() {
    buildBar(); collectPages(); fixNav();
    S.base = (db() && db().meta && db().meta.updatedAt) || null;
    safe(lifecycle); safe(paintAlerts);
    var ok = installCommander(); fixQuick();
    if (!ok && ++tries < 40) { setTimeout(boot, 400); return; }
    setTimeout(function () { installCommander(); fixQuick(); collectPages(); paintAlerts(); }, 3200);
    setTimeout(function () { askOperator(false); }, 1400);
    LOG('SHIFTI ERP Suite v' + VERSION + ' · KST ' + kstToday() + ' · 작업자 ' + (operator() || '미지정') + ' · GMP ' + (strict() ? '엄격' : '완화'));
  }
  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', function () { setTimeout(boot, 300); });

  window.SHIFTI_SUITE = {
    version: VERSION,
    kstToday: kstToday, addDays: addDays,
    usable: usable, blockReason: blockReason,
    alerts: computeAlerts, lifecycle: lifecycle,
    producible: producibleDetail, readyDate: readyDate,
    resolveProduct: resolveProduct, resolveCustomer: resolveCustomer,
    resolveProductLoose: resolveProductLoose,
    diagnose: diagnose, flush: function () { S.dirty = true; schedule(0); },
    state: S
  };
})();
