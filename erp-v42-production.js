/*! MEDISCENT ERP v4.2 — single-operator production safety & usability */
(function () {
  'use strict';

  var VERSION = '4.2';
  var SNAPSHOT_KEY = 'mediscent_last_valid_db_v42';
  var LOT_KEYS = { RAW: 'RAW_LOT', PACK: 'PACK_LOT', BULK: 'BULK_LOT', FGT: 'FGT_LOT' };

  function n(v) { var x = Number(v); return Number.isFinite(x) ? x : 0; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(message, type) {
    try { (window.toast || function () {})(message, type || 'info'); } catch (_) {}
  }
  function allLots() {
    var stock = (window.db && window.db.stock) || {};
    var out = [];
    Object.keys(LOT_KEYS).forEach(function (type) {
      (stock[LOT_KEYS[type]] || []).forEach(function (lot) { out.push({ type: type, lot: lot }); });
    });
    return out;
  }
  function lotIdentity(type, lot) {
    var item = lot.rawId || lot.packId || lot.productId || '';
    return [type, String(lot.lotNo || '').trim().toUpperCase(), String(item), String(lot.location || '')].join('|');
  }
  function validateInventory() {
    var errors = [], seen = {};
    allLots().forEach(function (row) {
      var lot = row.lot;
      if (n(lot.remaining) < 0) errors.push('음수 재고: ' + (lot.lotNo || '-') + ' (' + lot.remaining + ')');
      if (String(lot.status || '').toUpperCase() === 'VOID') return;
      if (n(lot.remaining) > 0 && n(lot.unitCost) <= 0 && /실사 조정|실사 증가/.test(String(lot.note || ''))) {
        lot.status = 'HOLD';
        lot.costStatus = 'UNCONFIRMED';
      }
      var key = lotIdentity(row.type, lot);
      // 이동·분할 입고에서는 동일 LOT가 같은 위치에 여러 행으로 존재할 수 있다.
      // 정상 업무를 막지는 않고 정리 대상임을 표시해 감사 화면에서 식별한다.
      if (lot.lotNo && seen[key]) lot.dataIssue = 'DUPLICATE_LOT_IDENTITY';
      else if (lot.dataIssue === 'DUPLICATE_LOT_IDENTITY') delete lot.dataIssue;
      seen[key] = true;
    });
    return errors;
  }
  function snapshot() {
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(window.db)); } catch (_) {}
  }
  function restoreSnapshot() {
    try {
      var saved = localStorage.getItem(SNAPSHOT_KEY);
      if (!saved) return false;
      window.db = JSON.parse(saved);
      if (typeof window.renderAll === 'function') window.renderAll();
      return true;
    } catch (_) { return false; }
  }
  function showBlockingError(errors, restored) {
    var old = document.getElementById('v42-data-error');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'v42-data-error';
    box.className = 'v42-dialog-backdrop';
    box.innerHTML = '<div class="v42-dialog" role="alertdialog" aria-modal="true" aria-labelledby="v42-error-title">' +
      '<div class="v42-dialog-icon danger">!</div><h2 id="v42-error-title">재고 오류로 저장을 중단했습니다</h2>' +
      '<p>' + (restored ? '오류 발생 전 정상 상태로 되돌렸습니다.' : '데이터를 확인한 후 다시 저장해 주세요.') + '</p>' +
      '<ul>' + errors.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<button type="button" class="v42-primary" id="v42-error-close">확인</button></div>';
    document.body.appendChild(box);
    document.getElementById('v42-error-close').onclick = function () { box.remove(); };
    document.getElementById('v42-error-close').focus();
  }
  function protectSave() {
    var original = window.saveDB;
    if (typeof original !== 'function' || original.__v42Protected) return false;
    function guardedSave() {
      var errors = validateInventory();
      if (errors.length) {
        var restored = restoreSnapshot();
        showBlockingError(errors, restored);
        toast('음수 재고 때문에 저장하지 않았습니다.', 'error');
        return Promise.resolve(false);
      }
      snapshot();
      return original.apply(this, arguments);
    }
    guardedSave.__v42Protected = true;
    guardedSave.__original = original;
    window.saveDB = guardedSave;
    if (!validateInventory().length) snapshot();
    return true;
  }

  function modalReason(title, detail, callback) {
    var old = document.getElementById('v42-reason-dialog');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'v42-reason-dialog';
    box.className = 'v42-dialog-backdrop';
    box.innerHTML = '<div class="v42-dialog" role="dialog" aria-modal="true" aria-labelledby="v42-reason-title">' +
      '<div class="v42-dialog-icon">↶</div><h2 id="v42-reason-title">' + esc(title) + '</h2><p>' + esc(detail) + '</p>' +
      '<label for="v42-reason">취소 사유 <span>필수</span></label><textarea id="v42-reason" rows="3" placeholder="예: 잘못 등록한 입고 LOT"></textarea>' +
      '<div class="v42-dialog-actions"><button type="button" class="v42-secondary" id="v42-cancel">돌아가기</button>' +
      '<button type="button" class="v42-danger" id="v42-confirm" disabled>LOT 취소 처리</button></div></div>';
    document.body.appendChild(box);
    var input = document.getElementById('v42-reason');
    var confirm = document.getElementById('v42-confirm');
    input.oninput = function () { confirm.disabled = input.value.trim().length < 2; };
    document.getElementById('v42-cancel').onclick = function () { box.remove(); };
    confirm.onclick = function () { var reason = input.value.trim(); box.remove(); callback(reason); };
    box.onclick = function (event) { if (event.target === box) box.remove(); };
    input.focus();
  }
  function installVoidInsteadOfDelete() {
    window.deleteLot = function (type, idOrLotNo) {
      var key = LOT_KEYS[String(type || '').toUpperCase()];
      var rows = key && window.db && window.db.stock && window.db.stock[key];
      if (!rows) return;
      var lot = rows.find(function (x) { return String(x.id) === String(idOrLotNo) || String(x.lotNo) === String(idOrLotNo); });
      if (!lot) { toast('LOT를 찾을 수 없습니다.', 'error'); return; }
      if (String(lot.status || '').toUpperCase() === 'VOID') { toast('이미 취소 처리된 LOT입니다.', 'info'); return; }
      modalReason('LOT를 삭제하지 않고 취소합니다', (lot.lotNo || '-') + ' · 잔량 ' + n(lot.remaining).toLocaleString('ko-KR'), function (reason) {
        lot.voidedAt = new Date().toISOString();
        lot.voidReason = reason;
        lot.voidOriginalRemaining = n(lot.remaining);
        lot.remaining = 0;
        lot.status = 'VOID';
        lot.note = [lot.note, '취소: ' + reason].filter(Boolean).join(' · ');
        window.db.txn = window.db.txn || {};
        window.db.txn.T_ADJ = window.db.txn.T_ADJ || [];
        window.db.txn.T_ADJ.push({ id: 'VOID-' + Date.now().toString(36).toUpperCase(), date: (window.todayISO ? window.todayISO() : new Date().toISOString().slice(0, 10)), type: type, lotNo: lot.lotNo, qty: -lot.voidOriginalRemaining, reason: reason, action: 'VOID' });
        if (typeof window.logEvent === 'function') window.logEvent('LOT 취소: ' + lot.lotNo + ' · ' + reason);
        window.saveDB();
        toast('LOT는 삭제되지 않고 취소 이력으로 보존됐습니다.', 'success');
      });
    };
  }

  function installQuickActions() {
    var page = document.getElementById('page-dashboard');
    if (!page || document.getElementById('v42-quick-actions')) return;
    var bar = document.createElement('section');
    bar.id = 'v42-quick-actions';
    bar.className = 'v42-quick-actions';
    bar.setAttribute('aria-label', '자주 쓰는 업무');
    bar.innerHTML = '<div><strong>자주 쓰는 업무</strong><span>입력 순서대로 바로 이동</span></div>' +
      '<button type="button" data-page="t-goods-in"><b>1</b> 입고</button>' +
      '<button type="button" data-page="t-bulk"><b>2</b> 배합</button>' +
      '<button type="button" data-page="t-batch"><b>3</b> 충진</button>' +
      '<button type="button" data-page="stock"><b>4</b> 재고</button>' +
      '<button type="button" data-page="t-sale"><b>5</b> 출고</button>' +
      '<button type="button" data-page="biz-hub"><b>+</b> 계산·수출</button>';
    bar.querySelectorAll('button').forEach(function (button) {
      button.onclick = function () { if (typeof window.goPage === 'function') window.goPage(button.dataset.page); };
    });
    page.insertBefore(bar, page.firstElementChild);
  }
  function improveSemantics() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
      if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
      if (item.dataset.v42Keyboard) return;
      item.dataset.v42Keyboard = '1';
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); }
      });
    });
    var version = document.querySelector('#brand-logo + div span');
    if (version) version.textContent = 'v4.2 · 1인 운영';
  }
  function disableUnconfiguredOcr() {
    var ocrTab = document.getElementById('su-tab-image');
    if (ocrTab) {
      ocrTab.hidden = true;
      ocrTab.disabled = true;
      ocrTab.setAttribute('aria-hidden', 'true');
    }
    // 브라우저에서 외부 AI로 문서를 직접 보내는 경로는 키·동의·보관정책이
    // 구성되기 전까지 닫아 둔다. 서버 중계 방식이 준비되면 별도 기능으로 복구한다.
    window.suRunOCR = function () {
      toast('이미지 OCR은 보안 설정 후 사용할 수 있습니다. 현재는 직접 입력을 이용해 주세요.', 'info');
      return false;
    };
  }
  function flagDataIssues() {
    allLots().forEach(function (row) {
      if (n(row.lot.remaining) < 0) row.lot.dataIssue = 'NEGATIVE_STOCK';
      else if (row.lot.dataIssue === 'NEGATIVE_STOCK') delete row.lot.dataIssue;
    });
  }
  function boot() {
    flagDataIssues();
    protectSave();
    installVoidInsteadOfDelete();
    installQuickActions();
    improveSemantics();
    disableUnconfiguredOcr();
    window.MEDISCENT_ERP_VERSION = VERSION;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 900); });
  else setTimeout(boot, 900);
  window.addEventListener('load', function () { setTimeout(boot, 1800); });
  setTimeout(boot, 3500);
})();
