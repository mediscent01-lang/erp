/* ╔══════════════════════════════════════════════════════════╗
   SHIFTI ERP 확장 모듈 nose-modules.js v5.5 — 노즈 (2026-07-21)
   v5.5: 🛒 판매 수량 직접 입력 (엑셀 왕복 포함)
     · 주간정산 표·엑셀에 [📮 택배 판매] [🛒 매장 판매] 열 추가
     · 판매 수량을 적으면 그만큼 해당 위치에서 차감 + 매출 계상
       (LOT별 FIFO, 판매기록에 택배/매장 출처 표기)
     · 판매를 적은 위치는 실물과의 나머지 차이를 손실·오차로 조정
       → 판매와 파손·분실이 분리되어 매출이 정확해집니다
     · 판매를 비워두면 기존처럼 감소분 전체를 판매로 추정
   v5.4: 엑셀 왕복 / v5.3: 엑셀 다운로드 / v5.0: 3거점
   설치: nose-modules.js 교체 + index.html의 src를 ?v=5.5 로 변경
   ╚══════════════════════════════════════════════════════════╝ */


/* ═══════════ 모듈: MES 확장 패치 v4.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v, d){ var x = Number(v); return isFinite(x) ? x : (d||0); };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var PROC_ORDER = ['조향/벌크배합','숙성','여과','충진','포장','검사'];
var ST_COLOR = {'대기':'#d97706','진행중':'#2563eb','완료':'#059669','계획':'#64748b','숙성':'#7c3aed','입고예정':'#0d9488'};

/* ════════ 0. 스타일 ════════ */
var css = document.createElement('style');
css.textContent = [
'.mes-modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px}',
'.mes-modal{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25)}',
'.mes-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px}',
'.mes-kpi .v{font-size:22px;font-weight:900;color:#0f172a}',
'.mes-kpi .l{font-size:10.5px;font-weight:700;color:#64748b;margin-top:2px}',
'.mes-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;min-width:640px}',
'.mes-cal-head{font-size:10.5px;font-weight:800;color:#64748b;text-align:center;padding:4px 0}',
'.mes-cal-day{background:#fff;border:1px solid #e2e8f0;border-radius:8px;min-height:86px;padding:4px;font-size:10.5px;overflow:hidden}',
'.mes-cal-day.other{background:#f8fafc;opacity:.5}',
'.mes-cal-day.today{border-color:#059669;border-width:2px}',
'.mes-cal-num{font-weight:800;color:#334155;margin-bottom:2px}',
'.mes-chip{display:block;border-radius:4px;padding:1px 4px;margin-bottom:2px;color:#fff;font-size:9.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
'.mes-gantt{min-width:760px}',
'.mes-gantt-row{display:grid;align-items:center;gap:0;border-bottom:1px solid #f1f5f9}',
'.mes-gantt-label{font-size:10.5px;font-weight:700;color:#334155;padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-right:1px solid #e2e8f0}',
'.mes-gantt-cell{border-right:1px dashed #f1f5f9;height:30px;position:relative}',
'.mes-gantt-cell.wk{background:#fafafa}',
'.mes-gantt-bar{position:absolute;top:6px;height:18px;border-radius:5px;font-size:9px;font-weight:800;color:#fff;padding:2px 5px;white-space:nowrap;overflow:hidden;z-index:2;box-shadow:0 1px 3px rgba(0,0,0,.15)}',
'.mes-tab{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;color:#64748b;background:#f1f5f9}',
'.mes-tab.on{background:#0f766e;color:#fff}',
'.mes-yield-bar{height:8px;border-radius:4px;background:#e2e8f0;overflow:hidden}',
'.mes-yield-bar>div{height:100%;border-radius:4px}',
'@media(max-width:768px){.mes-kpi .v{font-size:18px}}'
].join('\n');
document.head.appendChild(css);

/* ════════ 1. 공통 헬퍼 ════════ */
function ensureWO(){
  if(!window.db) return false;
  db.txn = db.txn || {};
  db.txn.T_WORK_ORDER = db.txn.T_WORK_ORDER || [];
  db.txn.T_PROD_PLAN = db.txn.T_PROD_PLAN || [];
  return true;
}
function woPlan(wo){ return (db.txn.T_PROD_PLAN||[]).find(function(p){ return p.id===wo.planId; }); }
function woProduct(wo){ var p = woPlan(wo); return p && (typeof findProduct==='function') ? findProduct(p.productId) : null; }
function fmtPct(v){ return (v==null||!isFinite(v)) ? '-' : (Math.round(v*10)/10)+'%'; }
function ymd(d){ return d.toISOString().split('T')[0]; }

/* 수율 계산: 생산수율 = 양품/(양품+불량), 자재수율 = 산출/실투입, 달성률 = 양품/계획 */
function calcYields(wo){
  var r = wo.result; if(!r) return {};
  var out = N(r.outputQty), def = N(r.defectQty), inp = N(r.inputQty), plan = N(r.planQty);
  return {
    prodYield: (out+def) > 0 ? out/(out+def)*100 : null,
    matYield:  inp > 0 ? out/inp*100 : null,
    achieve:   plan > 0 ? out/plan*100 : null
  };
}

/* ════════ 2. Phase 1 — 작업지시 상태머신 ════════ */
window.startWO = function(woId){
  ensureWO();
  var wo = db.txn.T_WORK_ORDER.find(function(w){ return w.id===woId; });
  if(!wo) return;
  wo.status = '진행중';
  wo.startedAt = new Date().toISOString();
  if(typeof logEvent==='function') logEvent('작업시작: '+wo.no+' ['+wo.process+']');
  if(typeof toast==='function') toast('작업 시작: '+wo.no,'success');
  saveDB(); renderWorkOrder(); renderSchedule();
};

/* 기존 completeWO를 실적입력 모달로 대체 */
window.completeWO = function(woId){ openWoResultModal(woId); };

window.openWoResultModal = function(woId){
  ensureWO();
  var wo = db.txn.T_WORK_ORDER.find(function(w){ return w.id===woId; });
  if(!wo) return;
  var plan = woPlan(wo), prod = woProduct(wo);
  var planQty = plan ? N(plan.qty) : 0;
  /* 배합 공정이면 BOM 이론 투입량 자동 계산해 참고값 제공 */
  var theoTxt = '';
  if(wo.process==='조향/벌크배합' && prod && prod.bom && typeof bomNeed==='function'){
    var theo = 0;
    prod.bom.filter(function(b){ return b.type==='RAW'; }).forEach(function(b){ theo += bomNeed(prod, b, planQty); });
    if(theo>0) theoTxt = '<div style="font-size:10.5px;color:#0d9488;font-weight:700;margin-top:-4px">BOM 이론투입량: '+theo.toFixed(1)+' g (계획 '+planQty+' 기준)</div>';
  }
  var old = wo.result || {};
  var bg = document.createElement('div');
  bg.className = 'mes-modal-bg'; bg.id = 'mes-wo-modal';
  bg.innerHTML =
  '<div class="mes-modal" onclick="event.stopPropagation()">'+
    '<div style="font-weight:900;font-size:15px;color:#0f172a">작업 완료 · 실적 입력</div>'+
    '<div style="font-size:11.5px;color:#64748b;margin:4px 0 14px">'+E(wo.no)+' · '+E(wo.process)+' · '+E(prod?prod.name:'-')+(planQty?' · 계획 '+planQty:'')+'</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
      '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">양품 산출수량 *</label><input id="mesr-out" type="number" step="0.01" class="input-field text-right" value="'+(old.outputQty!=null?old.outputQty:'')+'" placeholder="0"></div>'+
      '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">불량 수량</label><input id="mesr-def" type="number" step="0.01" class="input-field text-right" value="'+(old.defectQty!=null?old.defectQty:'0')+'"></div>'+
      '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">실투입량 (자재수율용)</label><input id="mesr-in" type="number" step="0.01" class="input-field text-right" value="'+(old.inputQty!=null?old.inputQty:'')+'" placeholder="선택"></div>'+
      '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">소요시간 (분)</label><input id="mesr-min" type="number" class="input-field text-right" value="'+(old.durationMin!=null?old.durationMin:'')+'" placeholder="선택"></div>'+
    '</div>'+ theoTxt +
    '<div style="margin-top:10px"><label style="font-size:10.5px;font-weight:800;color:#64748b">실적 비고 (이상·손실 사유)</label><input id="mesr-note" class="input-field" value="'+E(old.note||'')+'" placeholder="예: 여과 중 손실 120g"></div>'+
    '<div id="mesr-preview" style="margin-top:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;font-size:11.5px;font-weight:700;color:#166534;display:none"></div>'+
    '<div style="display:flex;gap:8px;margin-top:16px">'+
      '<button class="btn btn-primary flex-1" onclick="saveWoResult(\''+wo.id+'\')">완료 저장</button>'+
      '<button class="btn btn-secondary" onclick="closeWoModal()">취소</button>'+
    '</div>'+
  '</div>';
  bg.onclick = closeWoModal;
  document.body.appendChild(bg);
  /* 입력 즉시 수율 미리보기 */
  ['mesr-out','mesr-def','mesr-in'].forEach(function(id){
    $(id).oninput = function(){
      var o=N($('mesr-out').value), d=N($('mesr-def').value), i=N($('mesr-in').value);
      var pv=$('mesr-preview'), rows=[];
      if(o+d>0) rows.push('생산수율 '+fmtPct(o/(o+d)*100));
      if(i>0&&o>0) rows.push('자재수율 '+fmtPct(o/i*100));
      if(planQty>0&&o>0) rows.push('계획달성률 '+fmtPct(o/planQty*100));
      pv.style.display = rows.length?'block':'none';
      pv.textContent = rows.join('  ·  ');
    };
  });
};
window.closeWoModal = function(){ var m=$('mes-wo-modal'); if(m) m.remove(); };

window.saveWoResult = function(woId){
  ensureWO();
  var wo = db.txn.T_WORK_ORDER.find(function(w){ return w.id===woId; });
  if(!wo) return;
  var out = N($('mesr-out').value);
  if(out<=0){ if(typeof toast==='function') toast('양품 산출수량을 입력하세요','error'); return; }
  var plan = woPlan(wo);
  wo.result = {
    outputQty: out,
    defectQty: N($('mesr-def').value),
    inputQty:  N($('mesr-in').value) || null,
    durationMin: N($('mesr-min').value) || null,
    planQty: plan ? N(plan.qty) : null,
    note: ($('mesr-note').value||'').trim(),
    completedAt: new Date().toISOString()
  };
  wo.status = '완료';
  var y = calcYields(wo);
  if(typeof logEvent==='function') logEvent('작업완료: '+wo.no+' 양품 '+out+' / 생산수율 '+fmtPct(y.prodYield));
  if(typeof toast==='function') toast('완료 · 생산수율 '+fmtPct(y.prodYield),'success');
  closeWoModal(); saveDB(); renderWorkOrder(); renderSchedule(); renderYieldPage();
};

/* renderWorkOrder 재정의: 상태별 버튼 + 수율 뱃지 */
var _origRenderWO = window.renderWorkOrder;
window.renderWorkOrder = function(){
  if(!ensureWO()) return;
  var tbody = $('tbl-workorder');
  if(!tbody){ if(typeof _origRenderWO==='function') _origRenderWO(); return; }
  tbody.innerHTML = db.txn.T_WORK_ORDER.slice().reverse().map(function(wo){
    var prod = woProduct(wo);
    var st = wo.status||'대기';
    var badge = '<span class="badge-soft" style="background:'+(ST_COLOR[st]||'#64748b')+'22;color:'+(ST_COLOR[st]||'#64748b')+';font-weight:800">'+E(st)+'</span>';
    var act = '';
    if(st==='대기') act = '<button onclick="startWO(\''+wo.id+'\')" class="btn btn-primary btn-sm">▶ 시작</button>';
    else if(st==='진행중') act = '<button onclick="completeWO(\''+wo.id+'\')" class="btn btn-primary btn-sm" style="background:#059669">✓ 완료·실적</button>';
    else {
      var y = calcYields(wo);
      act = '<span style="font-size:10px;font-weight:800;color:#059669">수율 '+fmtPct(y.prodYield)+'</span> <button onclick="openWoResultModal(\''+wo.id+'\')" class="btn btn-secondary btn-sm">수정</button>';
    }
    return '<tr><td class="pl-3 mono text-xs">'+E(wo.no)+'</td><td class="text-xs">'+E(wo.date)+'</td>'+
      '<td class="text-xs">'+E(prod?prod.name:'-')+'</td><td class="text-xs">'+E(wo.process)+'</td>'+
      '<td class="text-xs">'+E(wo.worker)+'</td><td class="text-center">'+badge+'</td>'+
      '<td class="text-right pr-3" style="white-space:nowrap">'+act+'</td></tr>';
  }).join('') || '<tr><td colspan="7" class="text-center py-4 text-slate-400">작업지시 없음</td></tr>';
};

/* ════════ 3. 신규 페이지 주입 (생산 일정 · 수율 분석) ════════ */
function injectPages(){
  if($('page-prod-schedule')) return;
  var host = document.querySelector('#page-work-order');
  if(!host || !host.parentNode) return;

  var sched = document.createElement('section');
  sched.id = 'page-prod-schedule';
  sched.className = 'page-section space-y-4';
  sched.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">'+
      '<h2 class="text-lg font-black text-slate-800">생산 일정 (캘린더 · 간트)</h2>'+
      '<div style="display:flex;gap:6px;align-items:center">'+
        '<span class="mes-tab on" id="mes-tab-cal" onclick="mesTab(\'cal\')">📅 캘린더</span>'+
        '<span class="mes-tab" id="mes-tab-gantt" onclick="mesTab(\'gantt\')">📊 간트</span>'+
        '<button class="btn btn-secondary btn-sm" onclick="mesMonth(-1)">◀</button>'+
        '<span id="mes-month-label" style="font-weight:900;font-size:13px;min-width:86px;text-align:center"></span>'+
        '<button class="btn btn-secondary btn-sm" onclick="mesMonth(1)">▶</button>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:700">'+
      '<span style="color:'+ST_COLOR['계획']+'">■</span> 생산계획 '+
      '<span style="color:'+ST_COLOR['대기']+'">■</span> 지시대기 '+
      '<span style="color:'+ST_COLOR['진행중']+'">■</span> 진행중 '+
      '<span style="color:'+ST_COLOR['완료']+'">■</span> 완료 '+
      '<span style="color:'+ST_COLOR['숙성']+'">■</span> 벌크숙성 '+
      '<span style="color:'+ST_COLOR['입고예정']+'">■</span> 발주입고예정</div>'+
    '<div class="card p-3" style="overflow-x:auto"><div id="mes-cal-wrap"></div><div id="mes-gantt-wrap" style="display:none"></div></div>';
  host.parentNode.insertBefore(sched, host.nextSibling);

  var yld = document.createElement('section');
  yld.id = 'page-yield';
  yld.className = 'page-section space-y-4';
  yld.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">수율 분석 (자재 · 생산)</h2>'+
    '<div id="mes-yield-kpi" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px"></div>'+
    '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">'+
      '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">공정별 평균 수율</h3></div><div class="p-4" id="mes-yield-proc"></div></div>'+
      '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">월별 생산수율 추이</h3></div><div class="p-4" id="mes-yield-trend"></div></div>'+
    '</div>'+
    '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">완료 실적 목록</h3><span class="badge-soft" id="mes-yield-count">0</span></div>'+
      '<div class="scroll-card"><table><thead><tr><th class="pl-3">완료일</th><th>지시번호</th><th>제품</th><th>공정</th>'+
      '<th class="text-right">계획</th><th class="text-right">양품</th><th class="text-right">불량</th>'+
      '<th class="text-right">자재수율</th><th class="text-right">생산수율</th><th class="text-right pr-3">달성률</th></tr></thead>'+
      '<tbody id="mes-yield-tbl"></tbody></table></div></div>';
  host.parentNode.insertBefore(yld, sched.nextSibling);

  /* 사이드바 메뉴 주입 */
  var navWo = $('nav-work-order');
  if(navWo && !$('nav-prod-schedule')){
    var n1 = document.createElement('div');
    n1.id='nav-prod-schedule'; n1.className='nav-item'; n1.setAttribute('onclick',"goPage('prod-schedule')");
    n1.innerHTML = '<i data-lucide="calendar-days" class="w-4 h-4 shrink-0"></i> 생산 일정 🆕';
    var n2 = document.createElement('div');
    n2.id='nav-yield'; n2.className='nav-item'; n2.setAttribute('onclick',"goPage('yield')");
    n2.innerHTML = '<i data-lucide="trending-up" class="w-4 h-4 shrink-0"></i> 수율 분석 🆕';
    navWo.parentNode.insertBefore(n1, navWo.nextSibling);
    navWo.parentNode.insertBefore(n2, n1.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
}

/* ════════ 4. Phase 2 — 캘린더 ════════ */
var mesCur = new Date(); mesCur.setDate(1);
window.mesMonth = function(d){ mesCur.setMonth(mesCur.getMonth()+d); renderSchedule(); };
window.mesTab = function(t){
  $('mes-tab-cal').classList.toggle('on', t==='cal');
  $('mes-tab-gantt').classList.toggle('on', t==='gantt');
  $('mes-cal-wrap').style.display = t==='cal'?'block':'none';
  $('mes-gantt-wrap').style.display = t==='gantt'?'block':'none';
};

/* 일정 이벤트 수집: {date, endDate?, label, color, page} */
function collectEvents(){
  ensureWO();
  var ev = [];
  (db.txn.T_PROD_PLAN||[]).forEach(function(p){
    var prod = (typeof findProduct==='function') && findProduct(p.productId);
    ev.push({date:p.date, label:'계획 '+(prod?prod.name:'')+' '+p.qty, color:ST_COLOR['계획'], page:'prod-plan'});
  });
  (db.txn.T_WORK_ORDER||[]).forEach(function(w){
    var prod = woProduct(w);
    ev.push({date:w.date, label:'['+(w.process||'').slice(0,2)+'] '+(prod?prod.name:w.no), color:ST_COLOR[w.status||'대기'], page:'work-order'});
  });
  (db.stock && db.stock.BULK_LOT||[]).forEach(function(b){
    if(b.mfgDate && b.matureUntil && b.status==='HOLD')
      ev.push({date:b.mfgDate, endDate:b.matureUntil, label:'숙성 '+b.lotNo, color:ST_COLOR['숙성'], page:'t-bulk', span:true});
  });
  (db.txn.T_PO||[]).forEach(function(po){
    if(po.dueDate && po.status!=='입고완료')
      ev.push({date:po.dueDate, label:'입고예정 '+po.no, color:ST_COLOR['입고예정'], page:'purchase-order'});
  });
  return ev;
}

function renderCalendar(){
  var wrap = $('mes-cal-wrap'); if(!wrap) return;
  var y = mesCur.getFullYear(), m = mesCur.getMonth();
  $('mes-month-label').textContent = y+'년 '+(m+1)+'월';
  var first = new Date(y,m,1), start = new Date(first); start.setDate(1-first.getDay());
  var todayStr = ymd(new Date());
  var ev = collectEvents();
  var byDate = {};
  ev.forEach(function(e){
    if(e.span && e.endDate){ /* 숙성 기간: 시작·종료일에 표시 */
      byDate[e.date]=(byDate[e.date]||[]).concat([{label:'▶'+e.label,color:e.color,page:e.page}]);
      byDate[e.endDate]=(byDate[e.endDate]||[]).concat([{label:'✓숙성완료 '+e.label.replace('숙성 ',''),color:e.color,page:e.page}]);
    } else byDate[e.date]=(byDate[e.date]||[]).concat([e]);
  });
  var html = ['일','월','화','수','목','금','토'].map(function(d){ return '<div class="mes-cal-head">'+d+'</div>'; }).join('');
  var cur = new Date(start);
  for(var i=0;i<42;i++){
    var ds = ymd(cur), other = cur.getMonth()!==m;
    var items = (byDate[ds]||[]).slice(0,4);
    var more = (byDate[ds]||[]).length - items.length;
    html += '<div class="mes-cal-day'+(other?' other':'')+(ds===todayStr?' today':'')+'">'+
      '<div class="mes-cal-num">'+cur.getDate()+'</div>'+
      items.map(function(e){ return '<span class="mes-chip" style="background:'+e.color+'" onclick="goPage(\''+e.page+'\')" title="'+E(e.label)+'">'+E(e.label)+'</span>'; }).join('')+
      (more>0?'<span style="font-size:9px;color:#94a3b8;font-weight:700">+'+more+'건</span>':'')+
    '</div>';
    cur.setDate(cur.getDate()+1);
  }
  wrap.innerHTML = '<div class="mes-cal">'+html+'</div>';
}

/* ════════ 5. Phase 2 — 간트차트 ════════ */
function renderGantt(){
  var wrap = $('mes-gantt-wrap'); if(!wrap) return;
  var y = mesCur.getFullYear(), m = mesCur.getMonth();
  var days = new Date(y, m+1, 0).getDate();
  var monthStr = y+'-'+String(m+1).padStart(2,'0');
  var rows = [];

  /* 생산계획 행 + 하위 작업지시 행 (공정 순서 정렬) */
  (db.txn.T_PROD_PLAN||[]).forEach(function(p){
    var wos = (db.txn.T_WORK_ORDER||[]).filter(function(w){ return w.planId===p.id; })
      .sort(function(a,b){ return PROC_ORDER.indexOf(a.process)-PROC_ORDER.indexOf(b.process); });
    var dates = [p.date].concat(wos.map(function(w){ return w.date; })).filter(Boolean).sort();
    var inMonth = dates.some(function(d){ return d && d.indexOf(monthStr)===0; });
    if(!inMonth) return;
    var prod = (typeof findProduct==='function') && findProduct(p.productId);
    rows.push({label:'📋 '+(prod?prod.name:p.no)+' ('+p.qty+')', start:dates[0], end:dates[dates.length-1], color:ST_COLOR['계획'], bold:true});
    wos.forEach(function(w){
      rows.push({label:'　'+(w.process||'')+(w.worker?' · '+w.worker:''), start:w.date, end:w.date, color:ST_COLOR[w.status||'대기'],
        tag: w.status==='완료' && w.result ? fmtPct(calcYields(w).prodYield) : (w.status||'')});
    });
  });
  /* 계획 미연결 작업지시 */
  (db.txn.T_WORK_ORDER||[]).filter(function(w){ return !w.planId && w.date && w.date.indexOf(monthStr)===0; })
    .forEach(function(w){ rows.push({label:'🔧 '+w.no+' '+(w.process||''), start:w.date, end:w.date, color:ST_COLOR[w.status||'대기'], tag:w.status}); });
  /* 벌크 숙성 기간 바 */
  (db.stock && db.stock.BULK_LOT||[]).forEach(function(b){
    if(!b.mfgDate || !b.matureUntil) return;
    if(b.mfgDate.indexOf(monthStr)!==0 && b.matureUntil.indexOf(monthStr)!==0 && !(b.mfgDate<monthStr+'-01' && b.matureUntil>monthStr+'-'+days)) return;
    rows.push({label:'🧪 숙성 '+b.lotNo, start:b.mfgDate, end:b.matureUntil, color:ST_COLOR['숙성'], tag:b.status});
  });

  if(!rows.length){ wrap.innerHTML = '<div class="text-center py-8 text-slate-400 text-sm">이 달의 일정이 없습니다. 생산계획·작업지시를 등록하세요.</div>'; return; }

  var grid = '180px repeat('+days+', minmax(22px,1fr))';
  var head = '<div class="mes-gantt-row" style="grid-template-columns:'+grid+'"><div class="mes-gantt-label" style="font-weight:900">'+(m+1)+'월</div>';
  for(var d=1; d<=days; d++){
    var dow = new Date(y,m,d).getDay();
    head += '<div class="mes-gantt-cell '+(dow===0||dow===6?'wk':'')+'" style="height:22px;font-size:9px;text-align:center;color:'+(dow===0?'#dc2626':'#94a3b8')+';font-weight:700">'+d+'</div>';
  }
  head += '</div>';

  var body = rows.map(function(r){
    var s = N((r.start||'').split('-')[2]), e2 = N((r.end||'').split('-')[2]);
    var sm = (r.start||'').slice(0,7), em = (r.end||'').slice(0,7);
    if(sm < monthStr) s = 1; if(sm > monthStr) s = 0;
    if(em > monthStr) e2 = days; if(em < monthStr) e2 = 0;
    var cells = '';
    for(var d=1; d<=days; d++){
      var dow = new Date(y,m,d).getDay();
      var bar = '';
      if(s>0 && d===Math.min(s,e2||s)){
        var span = Math.max(1, (e2||s)-s+1);
        bar = '<div class="mes-gantt-bar" style="left:2px;width:calc('+span+'00% - 4px);background:'+r.color+'" title="'+E(r.label)+'">'+E(r.tag||'')+'</div>';
      }
      cells += '<div class="mes-gantt-cell '+(dow===0||dow===6?'wk':'')+'">'+bar+'</div>';
    }
    return '<div class="mes-gantt-row" style="grid-template-columns:'+grid+'"><div class="mes-gantt-label" '+(r.bold?'style="font-weight:900;background:#f8fafc"':'')+'>'+E(r.label)+'</div>'+cells+'</div>';
  }).join('');

  wrap.innerHTML = '<div class="mes-gantt">'+head+body+'</div>';
}

window.renderSchedule = function(){
  if(!$('mes-cal-wrap')) return;
  try{ renderCalendar(); renderGantt(); }catch(e){ console.warn('MES schedule', e); }
};

/* ════════ 6. Phase 1 — 수율 분석 페이지 ════════ */
window.renderYieldPage = function(){
  if(!$('mes-yield-kpi')) return;
  ensureWO();
  var done = db.txn.T_WORK_ORDER.filter(function(w){ return w.status==='완료' && w.result; });
  var ys = done.map(function(w){ return {w:w, y:calcYields(w)}; });
  function avg(k){ var v = ys.map(function(x){ return x.y[k]; }).filter(function(v){ return v!=null&&isFinite(v); }); return v.length ? v.reduce(function(a,b){return a+b;},0)/v.length : null; }
  var kpis = [
    {l:'완료 작업지시', v: done.length+'건'},
    {l:'평균 생산수율', v: fmtPct(avg('prodYield'))},
    {l:'평균 자재수율', v: fmtPct(avg('matYield'))},
    {l:'평균 계획달성률', v: fmtPct(avg('achieve'))},
    {l:'총 불량수량', v: done.reduce(function(s,w){ return s+N(w.result.defectQty); },0).toLocaleString()}
  ];
  $('mes-yield-kpi').innerHTML = kpis.map(function(k){ return '<div class="mes-kpi"><div class="v">'+k.v+'</div><div class="l">'+k.l+'</div></div>'; }).join('');

  /* 공정별 평균 */
  var byProc = {};
  ys.forEach(function(x){
    var p = x.w.process||'기타';
    (byProc[p] = byProc[p]||[]).push(x.y.prodYield);
  });
  $('mes-yield-proc').innerHTML = PROC_ORDER.concat(Object.keys(byProc).filter(function(p){ return PROC_ORDER.indexOf(p)<0; }))
    .filter(function(p){ return byProc[p]; })
    .map(function(p){
      var vals = byProc[p].filter(function(v){ return v!=null; });
      var a = vals.length ? vals.reduce(function(x,y){return x+y;},0)/vals.length : 0;
      var col = a>=95?'#059669':a>=85?'#d97706':'#dc2626';
      return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:11.5px;font-weight:800;color:#334155"><span>'+E(p)+' <span style="color:#94a3b8;font-weight:600">('+vals.length+'건)</span></span><span style="color:'+col+'">'+fmtPct(a)+'</span></div>'+
        '<div class="mes-yield-bar"><div style="width:'+Math.min(100,a)+'%;background:'+col+'"></div></div></div>';
    }).join('') || '<div class="text-slate-400 text-sm text-center py-4">완료 실적이 쌓이면 표시됩니다</div>';

  /* 월별 추이 (최근 6개월) */
  var byMonth = {};
  ys.forEach(function(x){
    var ym2 = (x.w.result.completedAt||x.w.date||'').slice(0,7);
    if(ym2 && x.y.prodYield!=null) (byMonth[ym2]=byMonth[ym2]||[]).push(x.y.prodYield);
  });
  var months = Object.keys(byMonth).sort().slice(-6);
  $('mes-yield-trend').innerHTML = months.length ?
    '<div style="display:flex;align-items:flex-end;gap:10px;height:130px">'+months.map(function(mm){
      var vals = byMonth[mm], a = vals.reduce(function(x,y){return x+y;},0)/vals.length;
      return '<div style="flex:1;text-align:center"><div style="font-size:10px;font-weight:800;color:#0f766e">'+fmtPct(a)+'</div>'+
        '<div style="background:linear-gradient(180deg,#14b8a6,#0f766e);border-radius:6px 6px 0 0;height:'+Math.max(8,a)+'px;margin:2px auto 0;max-width:44px"></div>'+
        '<div style="font-size:9.5px;color:#64748b;font-weight:700;margin-top:3px">'+mm.slice(2).replace('-','.')+'</div></div>';
    }).join('')+'</div>'
    : '<div class="text-slate-400 text-sm text-center py-4">완료 실적이 쌓이면 표시됩니다</div>';

  /* 실적 목록 */
  $('mes-yield-count').textContent = done.length;
  $('mes-yield-tbl').innerHTML = ys.slice().reverse().map(function(x){
    var w = x.w, r = w.result, prod = woProduct(w);
    return '<tr><td class="pl-3 text-xs">'+E((r.completedAt||'').slice(0,10))+'</td><td class="mono text-xs">'+E(w.no)+'</td>'+
      '<td class="text-xs font-bold">'+E(prod?prod.name:'-')+'</td><td class="text-xs">'+E(w.process)+'</td>'+
      '<td class="text-right text-xs">'+(r.planQty!=null?r.planQty:'-')+'</td>'+
      '<td class="text-right text-xs font-bold text-emerald-700">'+r.outputQty+'</td>'+
      '<td class="text-right text-xs '+(N(r.defectQty)>0?'text-red-600 font-bold':'text-slate-400')+'">'+N(r.defectQty)+'</td>'+
      '<td class="text-right text-xs">'+fmtPct(x.y.matYield)+'</td>'+
      '<td class="text-right text-xs font-bold">'+fmtPct(x.y.prodYield)+'</td>'+
      '<td class="text-right pr-3 text-xs">'+fmtPct(x.y.achieve)+'</td></tr>';
  }).join('') || '<tr><td colspan="10" class="text-center py-4 text-slate-400">완료 실적 없음 — 작업지시를 [시작]→[완료·실적]으로 처리하면 자동 집계됩니다</td></tr>';
};

/* ════════ 7. 페이지 라우팅 연결 ════════ */
var _origInit = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _origInit==='function') _origInit(pageId); }catch(e){}
  if(pageId==='prod-schedule') renderSchedule();
  if(pageId==='yield') renderYieldPage();
  if(pageId==='work-order') renderWorkOrder();
};

function boot(){
  injectPages();
  try{ renderWorkOrder(); }catch(e){}
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
/* 클라우드 로드·화면 갱신으로 주입이 밀리거나 지워지는 경우 대비: 90초간 3초마다 자가복구 */
var __mesKeep = setInterval(injectPages, 3000);
setTimeout(function(){ clearInterval(__mesKeep); }, 90000);
setTimeout(boot, 1500);
setTimeout(function(){ try{ renderWorkOrder(); }catch(e){} }, 3000);
})();

/* ═══════════ 모듈: 알레르겐 프로파일 자동화 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x = Number(v); return isFinite(x) ? x : 0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };

/* ── EU 26 알레르겐 레지스트리 (SCCNFP) — CAS를 저장 키로 사용 ── */
var A26 = [
 {cas:'127-51-5',  en:'ALPHA-ISOMETHYL IONONE',    ko:'알파-이소메틸 이오논'},
 {cas:'122-40-7',  en:'AMYL CINNAMAL',              ko:'아밀신남알'},
 {cas:'101-85-9',  en:'AMYL CINNAMYL ALCOHOL',      ko:'아밀신나밀알코올'},
 {cas:'105-13-5',  en:'ANISYL ALCOHOL',             ko:'아니스알코올'},
 {cas:'100-51-6',  en:'BENZYL ALCOHOL',             ko:'벤질알코올'},
 {cas:'120-51-4',  en:'BENZYL BENZOATE',            ko:'벤질벤조에이트'},
 {cas:'103-41-3',  en:'BENZYL CINNAMATE',           ko:'벤질신나메이트'},
 {cas:'118-58-1',  en:'BENZYL SALICYLATE',          ko:'벤질살리실레이트'},
 {cas:'80-54-6',   en:'LYSMERAL (BMHCA)',           ko:'부틸페닐메틸프로피오날'},
 {cas:'104-55-2',  en:'CINNAMAL',                   ko:'신남알'},
 {cas:'104-54-1',  en:'CINNAMYL ALCOHOL',           ko:'신나밀알코올'},
 {cas:'5392-40-5', en:'CITRAL',                     ko:'시트랄'},
 {cas:'106-22-9',  en:'CITRONELLOL',                ko:'시트로넬올'},
 {cas:'91-64-5',   en:'COUMARIN',                   ko:'쿠마린'},
 {cas:'97-53-0',   en:'EUGENOL',                    ko:'유제놀'},
 {cas:'90028-67-4',en:'TREEMOSS EXTRACT',           ko:'트리모스추출물'},
 {cas:'90028-68-5',en:'OAKMOSS EXTRACT',            ko:'오크모스추출물'},
 {cas:'4602-84-0', en:'FARNESOL',                   ko:'파네솔'},
 {cas:'106-24-1',  en:'GERANIOL',                   ko:'제라니올'},
 {cas:'101-86-0',  en:'HEXYL CINNAMAL',             ko:'헥실신남알'},
 {cas:'107-75-5',  en:'HYDROXYCITRONELLAL',         ko:'하이드록시시트로넬알'},
 {cas:'31906-04-4',en:'LYRAL (HICC)',               ko:'하이드록시이소헥실 3-사이클로헥센 카복스알데하이드'},
 {cas:'97-54-1',   en:'ISOEUGENOL',                 ko:'이소유제놀'},
 {cas:'5989-27-5', en:'d-LIMONENE',                 ko:'리모넨'},
 {cas:'78-70-6',   en:'LINALOOL',                   ko:'리날룰'},
 {cas:'111-12-6',  en:'METHYL HEPTINE CARBONATE',   ko:'메틸헵틴카보네이트'}
];
var TH_LEAVE = 0.001, TH_RINSE = 0.01; /* 완제품 기준 표기 임계값(%) */

/* ════════ 1. UI 주입 ════════ */
function injectUI(){
  /* 원료 마스터: 특화 박스에 프로파일 버튼 */
  var box = document.querySelector('#page-master-raw .bg-amber-50');
  if(box && !$('alg-open-btn')){
    var b = document.createElement('button');
    b.id='alg-open-btn'; b.className='btn btn-secondary w-full btn-sm';
    b.style.cssText='margin-top:4px;font-weight:800';
    b.textContent='🧬 알레르겐 프로파일 관리 (26종 %)';
    b.onclick=function(){ openAllergenProfileModal($('raw-edit-id') && $('raw-edit-id').value); };
    box.appendChild(b);
  }
  /* 알레르겐 계산 페이지 안내 문구: 본체 템플릿 주입("원본 v2와 동일" 감지)이
     끝난 뒤에만 갱신해야 함 — 먼저 바꾸면 본체 주입 조건이 깨짐 */
  var pg = $('page-allergen-report');
  if(pg && !pg.dataset.algUp && $('allergen-product2')){
    pg.dataset.algUp='1';
    var h2 = pg.querySelector('h2');
    if(h2){
      var note = document.createElement('div');
      note.style.cssText='font-size:10.5px;color:#64748b;font-weight:600';
      note.textContent='원료 프로파일 × BOM 배합비 → 완제품 함량 및 표기의무 자동 판정 (leave-on 0.001% / rinse-off 0.01%)';
      h2.parentNode.insertBefore(note, h2.nextSibling);
    }
  }
}

/* ════════ 2. 프로파일 편집 모달 ════════ */
window.openAllergenProfileModal = function(preferRawId){
  if(!window.db) return;
  var raws = (db.master.M_RAW||[]);
  var opts = raws.map(function(r){
    var has = r.allergenProfile && Object.keys(r.allergenProfile).some(function(k){ return N(r.allergenProfile[k])>0; });
    return '<option value="'+r.rawId+'"'+(String(r.rawId)===String(preferRawId)?' selected':'')+'>'+(has?'🧬 ':'')+E(r.name)+'</option>';
  }).join('');
  var bg = document.createElement('div');
  bg.id='alg-modal'; bg.className='mes-modal-bg';
  bg.style.cssText = bg.className ? '' : 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px';
  if(!document.querySelector('.mes-modal-bg')) bg.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML =
  '<div style="background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:92vh;overflow-y:auto;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25)" onclick="event.stopPropagation()">'+
    '<div style="font-weight:900;font-size:15px;color:#0f172a">🧬 알레르겐 프로파일 (EU 26종)</div>'+
    '<div style="font-size:11px;color:#64748b;margin:4px 0 10px">공급사 성분표의 "Total in Fragrance Oil(%)" 값을 저장합니다.</div>'+
    '<label style="font-size:10.5px;font-weight:800;color:#64748b">원료 선택</label>'+
    '<select id="alg-raw-sel" class="input-field" style="margin-bottom:10px">'+opts+'</select>'+
    '<div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:10px;margin-bottom:10px">'+
      '<div style="font-size:10.5px;font-weight:800;color:#0f766e;margin-bottom:6px">📂 공급사 알레르겐 성분표(XLS/XLSX)를 그대로 업로드하세요</div>'+
      '<button class="btn btn-primary btn-sm w-full" onclick="document.getElementById(\'alg-file\').click()">알레르겐 XLS 업로드 → 자동 인식</button>'+
      '<input type="file" id="alg-file" accept=".xls,.xlsx" style="display:none">'+
      '<div style="font-size:10px;color:#64748b;margin:8px 0 4px;font-weight:700">또는 시트에서 성분 행 복사 → 붙여넣기:</div>'+
      '<textarea id="alg-paste" class="input-field" rows="2" placeholder="예: LINALOOL	78-70-6	2.0833"></textarea>'+
      '<button class="btn btn-secondary btn-sm w-full" style="margin-top:6px" onclick="parseAllergenPaste()">붙여넣기 해석</button>'+
      '<div id="alg-paste-msg" style="font-size:10.5px;font-weight:700;margin-top:4px"></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 90px;gap:4px;max-height:290px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px">'+
      A26.map(function(a){
        return '<div style="font-size:10.5px;font-weight:700;color:#334155;align-self:center">'+E(a.en)+'<span style="color:#94a3b8;font-weight:500"> '+a.cas+'</span></div>'+
               '<input id="alg-'+a.cas+'" type="number" step="0.0001" min="0" class="input-field text-right" style="padding:3px 6px;font-size:11px" placeholder="0">';
      }).join('')+
    '</div>'+
    '<div style="display:flex;gap:8px;margin-top:14px">'+
      '<button class="btn btn-primary flex-1" onclick="saveAllergenProfile()">저장</button>'+
      '<button class="btn btn-secondary" onclick="closeAllergenModal()">닫기</button>'+
    '</div>'+
  '</div>';
  bg.onclick = closeAllergenModal;
  document.body.appendChild(bg);
  $('alg-raw-sel').onchange = loadProfileToForm;
  $('alg-file').onchange = function(e){ uploadAllergenXls(e.target.files && e.target.files[0]); e.target.value=''; };
  loadProfileToForm();
};
window.closeAllergenModal = function(){ var m=$('alg-modal'); if(m) m.remove(); };

function loadProfileToForm(){
  var raw = (db.master.M_RAW||[]).find(function(r){ return String(r.rawId)===String($('alg-raw-sel').value); });
  var p = (raw && raw.allergenProfile) || {};
  A26.forEach(function(a){ var el=$('alg-'+a.cas); if(el) el.value = N(p[a.cas]) || ''; });
}

/* 공통 파싱 파이프라인: 텍스트 행 배열에서 CAS 앵커로 %값 추출 → 폼 채움 */
function applyAllergenLines(lines, srcLabel){
  var found = 0, unknown = [];
  lines.forEach(function(line){
    var m = String(line).match(/(\d{2,7}-\d{2}-\d)\b/);
    if(!m) return;
    var cas = m[1];
    var def = A26.find(function(a){ return a.cas===cas; });
    var after = String(line).slice(String(line).indexOf(cas)+cas.length);
    var num = after.match(/-?\d+(?:[.,]\d+)?/);
    if(!def){ if(num && parseFloat(num[0].replace(',','.'))>0) unknown.push(cas); return; }
    if(!num) return;
    var v = parseFloat(num[0].replace(',','.'));
    var el = $('alg-'+cas);
    if(el && isFinite(v)){ el.value = v || ''; found++; }
  });
  var msg = $('alg-paste-msg');
  if(msg){
    msg.style.color = found ? '#0f766e' : '#c0392b';
    msg.textContent = found
      ? '✅ '+(srcLabel||'')+' '+found+'개 성분 인식 완료. 값 확인 후 [저장]을 누르세요.'+(unknown.length?' (26종 외 CAS 무시: '+unknown.join(', ')+')':'')
      : '인식된 성분이 없습니다. 성분명·CAS·% 열이 포함되어 있는지 확인해 주세요.';
  }
  return found;
}

window.parseAllergenPaste = function(){
  applyAllergenLines(($('alg-paste').value||'').split(/\r?\n/), '붙여넣기:');
};

/* XLS/XLSX 직접 업로드: 본체에 이미 로드된 SheetJS(window.XLSX) 사용 */
window.uploadAllergenXls = function(file){
  if(!file) return;
  if(!window.XLSX){
    var msg=$('alg-paste-msg'); if(msg){ msg.style.color='#c0392b'; msg.textContent='엑셀 파서 로드 실패 — 새로고침 후 다시 시도하거나 붙여넣기 방식을 사용하세요.'; }
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      var lines = [];
      wb.SheetNames.forEach(function(sn){
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, defval:'', raw:true});
        rows.forEach(function(r){ lines.push(r.map(function(c){ return c==null?'':String(c); }).join('\t')); });
      });
      applyAllergenLines(lines, '파일 "'+file.name+'":');
    }catch(err){
      var msg=$('alg-paste-msg'); if(msg){ msg.style.color='#c0392b'; msg.textContent='파일 해석 실패: '+err; }
    }
  };
  reader.readAsArrayBuffer(file);
};

window.saveAllergenProfile = function(){
  var raw = (db.master.M_RAW||[]).find(function(r){ return String(r.rawId)===String($('alg-raw-sel').value); });
  if(!raw){ if(typeof toast==='function') toast('원료를 선택하세요','error'); return; }
  var p = {}, cnt = 0;
  A26.forEach(function(a){
    var v = N($('alg-'+a.cas) && $('alg-'+a.cas).value);
    if(v>0){ p[a.cas]=v; cnt++; }
  });
  raw.allergenProfile = p;
  raw.isAllergen = cnt>0 || !!raw.isAllergen;
  if(typeof logEvent==='function') logEvent('알레르겐 프로파일 저장: '+raw.name+' ('+cnt+'종)');
  if(typeof toast==='function') toast(raw.name+' 프로파일 저장 ('+cnt+'종 검출)','success');
  saveDB(); closeAllergenModal();
  if(typeof renderRaw==='function') try{ renderRaw(); }catch(e){}
};

/* ════════ 3. 완제품 알레르겐 계산 + 표기의무 판정 (기존 페이지 업그레이드) ════════ */
window.renderAllergen2 = function(){
  var productId = Number($('allergen-product2') && $('allergen-product2').value);
  var product = (typeof findProduct==='function') && findProduct(productId);
  var wrap = $('allergen-result2'); if(!wrap) return;
  if(!product){ wrap.innerHTML='<div class="text-slate-400 text-sm">제품을 선택하세요.</div>'; return; }

  var bomRaws = (product.bom||[]).filter(function(r){ return r.type==='RAW'; });
  /* ea당 원료 g: ERP 공통 수식(bomNeed, batchQty=1). 기준중량 = 충전량 or 원료합 */
  var perEa = bomRaws.map(function(r){
    return { raw: findRaw(r.itemId), g: (typeof bomNeed==='function') ? bomNeed(product, r, 1) : N(r.qty) };
  });
  var base = N(product.fillWeight) > 0 ? N(product.fillWeight) : perEa.reduce(function(s,x){ return s+x.g; },0);
  if(base<=0){ wrap.innerHTML='<div class="text-sm text-slate-500">BOM에 원료가 없습니다.</div>'; return; }

  /* 알레르겐별 합산: Σ (원료비중 × 원료 내 알레르겐%) */
  var acc = {}, noProfile = [];
  perEa.forEach(function(x){
    if(!x.raw) return;
    var frac = x.g / base; /* 완제품 내 원료 비중 (0~1) */
    var p = x.raw.allergenProfile;
    if(p && Object.keys(p).length){
      Object.keys(p).forEach(function(cas){
        var add = frac * N(p[cas]);
        if(add>0){
          if(!acc[cas]) acc[cas] = {pct:0, from:[]};
          acc[cas].pct += add;
          acc[cas].from.push(x.raw.name+' '+(frac*100).toFixed(1)+'%');
        }
      });
    } else if (x.raw.isAllergen){
      noProfile.push(x.raw.name);
    }
  });

  var rows = Object.keys(acc).map(function(cas){
    var def = A26.find(function(a){ return a.cas===cas; }) || {en:cas, ko:''};
    var v = acc[cas].pct;
    return { def:def, pct:v, from:acc[cas].from,
      leave: v>=TH_LEAVE, rinse: v>=TH_RINSE };
  }).sort(function(a,b){ return b.pct-a.pct; });

  var mustLeave = rows.filter(function(r){ return r.leave; }).length;

  var html = '';
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
    kpi(rows.length+'종', '검출 알레르겐') +
    kpi(mustLeave+'종', 'leave-on 표기의무', mustLeave>0?'#c2410c':'#059669') +
    kpi((N(product.fillWeight)>0?'충전량 '+product.fillWeight+'g':'원료합 기준'), '기준중량') +
  '</div>';

  if(noProfile.length){
    html += '<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 10px;font-size:11px;font-weight:700;color:#92400e;margin-bottom:10px">⚠ 프로파일 미입력 알레르겐 원료: '+noProfile.map(E).join(', ')+' — 🧬 버튼으로 공급사 성분표를 등록해야 판정이 완전해집니다.</div>';
  }

  html += rows.length
    ? '<table><thead><tr><th class="pl-3">알레르겐 (INCI)</th><th>국문 표시명</th><th class="text-right">완제품 함량(%)</th><th class="text-center">향수·크림 등<br>leave-on ≥0.001%</th><th class="text-center">워시오프<br>rinse-off ≥0.01%</th><th>기여 원료</th></tr></thead><tbody>'+
      rows.map(function(r){
        return '<tr><td class="pl-3 font-bold text-xs">'+E(r.def.en)+'<div style="color:#94a3b8;font-weight:500">'+r.def.cas+'</div></td>'+
          '<td class="text-xs">'+E(r.def.ko)+'</td>'+
          '<td class="text-right text-xs font-bold">'+r.pct.toFixed(4)+'</td>'+
          '<td class="text-center">'+(r.leave?'<span style="color:#c2410c;font-weight:900">표기</span>':'<span style="color:#94a3b8">면제</span>')+'</td>'+
          '<td class="text-center">'+(r.rinse?'<span style="color:#c2410c;font-weight:900">표기</span>':'<span style="color:#94a3b8">면제</span>')+'</td>'+
          '<td class="text-xs" style="color:#64748b">'+r.from.map(E).join('<br>')+'</td></tr>';
      }).join('')+'</tbody></table>'
    : '<div class="text-sm text-slate-500 py-3">검출된 알레르겐이 없습니다.'+(noProfile.length?' (단, 미입력 원료 존재)':'')+'</div>';

  if(mustLeave>0){
    html += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;margin-top:10px;font-size:11.5px;color:#166534"><b>📋 전성분 표기 문구(leave-on):</b> '+
      rows.filter(function(r){ return r.leave; }).map(function(r){ return r.def.ko||r.def.en; }).join(', ')+'</div>';
  }
  wrap.innerHTML = html;

  function kpi(v,l,c){ return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;min-width:120px"><div style="font-size:16px;font-weight:900;color:'+(c||'#0f172a')+'">'+v+'</div><div style="font-size:10px;font-weight:700;color:#64748b">'+l+'</div></div>'; }
};

function boot(){ injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __algKeep = setInterval(function(){ try{ injectUI(); }catch(e){} }, 3000);
setTimeout(function(){ clearInterval(__algKeep); }, 90000);
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='master-raw' || pageId==='allergen-report') injectUI();
};
})();

/* ═══════════ 모듈: 식약처 규제문서 자동출력 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var CO = { name:'주식회사 메디센츠', reg:'화장품제조업 등록 제7691호',
  addr:'경기도 구리시 갈매순환로 154, 현대테라타워 A동 1038호', tel:'070-4365-4807' };

/* ════════ 페이지·메뉴 주입 ════════ */
function injectUI(){
  if($('page-mfds-docs')) return;
  var anchor = $('page-allergen-report') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-mfds-docs'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span onclick="goPage(\'doc-center\')" style="cursor:pointer;font-size:11px;font-weight:800;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:4px 10px">← 문서센터</span>'+
      '<h2 class="text-lg font-black text-slate-800" style="margin:0">규제문서 출력 (식약처 의무기록)</h2>'+
    '</div>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:600">화장품법 시행규칙 제11조①2호 — 제조관리기록서·품질관리기록서를 ERP 데이터로 자동 생성해 인쇄(PDF 저장)합니다.</div>'+
    '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">'+
      '<div class="card p-4 space-y-3">'+
        '<h3 class="font-bold text-slate-700 text-sm">📄 제조관리기록서 (배치기록)</h3>'+
        '<div style="font-size:10.5px;color:#64748b">충진(생산배치) LOT를 선택하면 배합 원료 LOT·숙성·충진·검사 기록이 자동 조립됩니다.</div>'+
        '<select id="mfds-batch-sel" class="input-field"></select>'+
        '<button class="btn btn-primary w-full" onclick="printBatchRecord()">제조관리기록서 인쇄 / PDF</button>'+
      '</div>'+
      '<div class="card p-4 space-y-3">'+
        '<h3 class="font-bold text-slate-700 text-sm">🧪 품질관리기록서 (시험기록)</h3>'+
        '<div style="font-size:10.5px;color:#64748b">생산품검사(QC) 기록을 선택하면 시험기록서 양식으로 출력됩니다.</div>'+
        '<select id="mfds-qc-sel" class="input-field"></select>'+
        '<button class="btn btn-primary w-full" onclick="printQcRecord()">품질관리기록서 인쇄 / PDF</button>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:10px;color:#94a3b8">※ 인쇄 창에서 "PDF로 저장"을 선택하면 전자문서로 보관됩니다. 보존기간: 최소 5년.</div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);
  /* v1.2: 별도 사이드바 메뉴 없음 — 문서센터 카탈로그에서 진입 (UX 통합) */
  var legacyNav = $('nav-mfds-docs'); if(legacyNav) legacyNav.remove();
}

function fillSelectors(){
  var bs = $('mfds-batch-sel');
  if(bs){
    bs.innerHTML = '<option value="">충진 LOT 선택</option>' +
      (db.txn.T_BATCH||[]).slice().reverse().map(function(b){
        var p = (typeof findProduct==='function') && findProduct(b.productId);
        return '<option value="'+E(b.id)+'">['+E(b.lotNo)+'] '+E(p?p.name:'')+' / '+E(b.qty)+'ea / '+E(b.date)+'</option>';
      }).join('');
  }
  var qs = $('mfds-qc-sel');
  if(qs){
    qs.innerHTML = '<option value="">검사기록 선택</option>' +
      (db.txn.T_QC_PROD||[]).slice().reverse().map(function(q){
        var p = (typeof findProduct==='function') && findProduct(q.productId);
        return '<option value="'+E(q.id)+'">['+E(q.lotNo)+'] '+E(p?p.name:'')+' / '+E(q.result)+' / '+E(q.date)+'</option>';
      }).join('');
  }
}

/* ════════ 인쇄 공통 ════════ */
var PRINT_CSS =
'@page{size:A4;margin:14mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#111;font-size:11px;line-height:1.5}'+
'h1{font-size:20px;text-align:center;margin:2px 0 2px}'+
'.co{color:#0f766e;font-weight:800;text-align:center;font-size:12px}'+
'.sub{text-align:center;color:#555;font-size:10px;margin-bottom:10px}'+
'table{width:100%;border-collapse:collapse;margin:6px 0}'+
'th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:middle}'+
'th{background:#eef5f2;font-weight:800;text-align:center}'+
'.r{text-align:right}.c{text-align:center}'+
'h3{font-size:12.5px;margin:12px 0 4px;border-bottom:2px solid #0f766e;padding-bottom:2px}'+
'.sign td{height:26px}.small{font-size:9.5px;color:#666}';

window.mfdsPrint = function(title, bodyHtml){
  var w = window.open('', '_blank');
  if(!w){ if(typeof toast==='function') toast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.','error'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+title+'</title><style>'+PRINT_CSS+'</style></head><body>'+bodyHtml+
    '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
  w.document.close();
};

function header(title, docNo){
  return '<div class="co">'+CO.name+'</div><h1>'+title+'</h1>'+
    '<div class="sub">'+CO.reg+' · '+CO.addr+' · TEL '+CO.tel+'</div>'+
    '<table><tr><th style="width:18%">문서번호</th><td style="width:32%">'+E(docNo)+'</td><th style="width:18%">출력일</th><td>'+new Date().toISOString().split('T')[0]+' (ERP 자동생성)</td></tr></table>';
}
function signBlock(rows){
  return '<h3>확인 및 서명</h3><table class="sign">'+rows.map(function(r){
    return '<tr><th style="width:22%">'+r+'</th><td style="width:45%">(서명)</td><th style="width:12%">일자</th><td></td></tr>';
  }).join('')+'</table>';
}

/* ════════ 1. 제조관리기록서 ════════ */
window.printBatchRecord = function(){
  var id = $('mfds-batch-sel') && $('mfds-batch-sel').value;
  var batch = (db.txn.T_BATCH||[]).find(function(b){ return String(b.id)===String(id); });
  if(!batch){ if(typeof toast==='function') toast('충진 LOT를 선택하세요','error'); return; }
  var product = (typeof findProduct==='function') && findProduct(batch.productId);
  var bulk = (db.txn.T_BULK||[]).find(function(b){ return b.lotNo===batch.bulkLotNo; });
  var bulkStock = (db.stock.BULK_LOT||[]).find(function(b){ return b.lotNo===batch.bulkLotNo; });
  var qcs = (db.txn.T_QC_PROD||[]).filter(function(q){ return q.lotNo===batch.lotNo; });

  /* 원료 사용 표 (배합 시 LOT 배분 내역) */
  var matRows = '';
  ((bulk && bulk.materials)||[]).forEach(function(m, i){
    var nm = m.type==='PACK'
      ? ((typeof findPack==='function') && findPack(m.itemId) || {}).name
      : ((typeof findRaw==='function') && findRaw(m.itemId) || {}).name;
    var lots = (m.lots||[]).map(function(l){ return E(l.lotNo)+' ('+E(l.take)+')'; }).join('<br>') || '-';
    matRows += '<tr><td class="c">'+(i+1)+'</td><td>'+E(nm||m.itemId)+'</td><td>'+lots+'</td><td class="r">'+E(m.need)+'</td><td></td></tr>';
  });
  /* 포장재 사용 */
  ((batch.consumedLots)||[]).forEach(function(m){
    var nm = ((typeof findPack==='function') && findPack(m.itemId) || {}).name;
    var lots = (m.lots||[]).map(function(l){ return E(l.lotNo)+' ('+E(l.take)+')'; }).join('<br>') || '-';
    matRows += '<tr><td class="c">포장</td><td>'+E(nm||m.itemId||'')+'</td><td>'+lots+'</td><td class="r">'+E(m.need||'')+'</td><td></td></tr>';
  });
  if(!matRows) matRows = '<tr><td colspan="5" class="c small">원료 배분 기록 없음 — 수기 기재</td></tr>';

  /* MES 수율 실적(있으면) */
  var yieldRow = '';
  var wo = (db.txn.T_WORK_ORDER||[]).find(function(w){
    return w.status==='완료' && w.result && w.result.completedAt && (function(){
      var pl = (db.txn.T_PROD_PLAN||[]).find(function(p){ return p.id===w.planId; });
      return pl && pl.productId===batch.productId && w.process==='충진';
    })();
  });
  if(wo && wo.result){
    var out=N(wo.result.outputQty), def=N(wo.result.defectQty);
    yieldRow = '<tr><th>생산수율(MES)</th><td colspan="3">양품 '+out+' / 불량 '+def+' → '+((out+def)>0?(out/(out+def)*100).toFixed(1):'-')+'%'+(wo.result.durationMin?' · 소요 '+wo.result.durationMin+'분':'')+'</td></tr>';
  }

  var qcHtml = qcs.length
    ? qcs.map(function(q){ return '<tr><td>'+E(q.date)+'</td><td>'+E(q.visual||'-')+'</td><td>'+E(q.scent||'-')+'</td><td>'+E(q.volume||'-')+'</td><td class="c"><b>'+E(q.result)+'</b></td><td>'+E(q.inspector||'-')+'</td></tr>'; }).join('')
    : '<tr><td colspan="6" class="c small">검사기록 없음 — 품질관리기록서 별도 작성</td></tr>';

  var body =
    header('제조관리기록서', 'MS-BR-'+batch.lotNo) +
    '<h3>1. 제조 기본정보</h3><table>'+
    '<tr><th style="width:18%">제품명</th><td style="width:32%">'+E(product?product.name:'')+'</td><th style="width:18%">제품표준서 번호</th><td>MS-PS-________</td></tr>'+
    '<tr><th>제조번호(LOT)</th><td><b>'+E(batch.lotNo)+'</b></td><th>제조단위</th><td>'+E(batch.qty)+' EA</td></tr>'+
    '<tr><th>벌크 LOT</th><td>'+E(batch.bulkLotNo)+'</td><th>충진일</th><td>'+E(batch.date)+'</td></tr>'+
    '</table>'+
    '<h3>2. 사용 원료·자재 (배합 LOT 배분 내역)</h3>'+
    '<table><tr><th style="width:7%">No</th><th>원료·자재명</th><th style="width:26%">사용 LOT (수량)</th><th style="width:13%">소요량</th><th style="width:14%">칭량자 확인</th></tr>'+matRows+'</table>'+
    '<h3>3. 공정 기록</h3><table>'+
    '<tr><th style="width:18%">배합(조향)일</th><td style="width:32%">'+E(bulk?bulk.date:'-')+'</td><th style="width:18%">배합량(벌크)</th><td>'+E(bulk?bulk.qty:'-')+'</td></tr>'+
    '<tr><th>숙성 기간</th><td>'+E(bulkStock?bulkStock.mfgDate:'-')+' ~ '+E(bulkStock?bulkStock.matureUntil:'-')+(bulk&&bulk.matureDays?' ('+bulk.matureDays+'일)':'')+'</td><th>충진량/EA</th><td>'+E(batch.bulkPerEa||'-')+'</td></tr>'+
    yieldRow+
    '<tr><th>공정 특이사항</th><td colspan="3">'+E(batch.note||bulk&&bulk.note||'')+'&nbsp;</td></tr>'+
    '</table>'+
    '<h3>4. 완제품 검사 요약</h3>'+
    '<table><tr><th>검사일</th><th>성상</th><th>향취</th><th>용량</th><th>판정</th><th>검사자</th></tr>'+qcHtml+'</table>'+
    signBlock(['제조 작업자','제조책임자','품질관리자 확인'])+
    '<div class="small">화장품법 시행규칙 제11조①2호 및 CGMP 제15조④에 따른 제조관리기록서 — '+CO.name+' ERP 자동생성본. 보존: 사용기한 경과 후 1년 이상(최소 5년).</div>';
  mfdsPrint('제조관리기록서 '+batch.lotNo, body);
};

/* ════════ 2. 품질관리기록서 ════════ */
window.printQcRecord = function(){
  var id = $('mfds-qc-sel') && $('mfds-qc-sel').value;
  var q = (db.txn.T_QC_PROD||[]).find(function(x){ return String(x.id)===String(id); });
  if(!q){ if(typeof toast==='function') toast('검사기록을 선택하세요','error'); return; }
  var product = (typeof findProduct==='function') && findProduct(q.productId);
  var body =
    header('품질관리기록서 (시험기록서)', 'MS-QC-'+q.id) +
    '<h3>1. 시험 기본정보</h3><table>'+
    '<tr><th style="width:18%">시험번호</th><td style="width:32%">'+E(q.id)+'</td><th style="width:18%">시험일자</th><td>'+E(q.date)+'</td></tr>'+
    '<tr><th>품목 구분</th><td>완제품</td><th>품목명</th><td>'+E(product?product.name:'')+'</td></tr>'+
    '<tr><th>LOT/제조번호</th><td><b>'+E(q.lotNo)+'</b></td><th>시험자</th><td>'+E(q.inspector||'')+'</td></tr>'+
    '</table>'+
    '<h3>2. 시험 항목 및 결과</h3>'+
    '<table><tr><th style="width:24%">시험항목</th><th style="width:34%">기준</th><th style="width:28%">결과</th><th>판정</th></tr>'+
    '<tr><td>성상</td><td>표준 성상과 동일</td><td>'+E(q.visual||'')+'</td><td class="c"></td></tr>'+
    '<tr><td>향취</td><td>표준품과 동일</td><td>'+E(q.scent||'')+'</td><td class="c"></td></tr>'+
    '<tr><td>충진량</td><td>표기량의 97% 이상</td><td>'+E(q.volume||'')+'</td><td class="c"></td></tr>'+
    '<tr><td>표시기재</td><td>화장품법 제10조 적합</td><td></td><td class="c"></td></tr>'+
    '<tr><td>기타</td><td></td><td>'+E(q.memo||'')+'</td><td class="c"></td></tr>'+
    '</table>'+
    '<h3>3. 종합판정</h3><table>'+
    '<tr><th style="width:22%">종합판정</th><td><b style="font-size:13px">'+E(q.result==='OK'?'적합':q.result==='FAIL'?'부적합':'보류')+'</b> ('+E(q.result)+')</td></tr>'+
    '<tr><th>조치사항</th><td>'+(q.result==='FAIL'?'출고 차단 — 반품/폐기/재작업 평가':'')+'&nbsp;</td></tr>'+
    '</table>'+
    signBlock(['시험자','품질관리책임자 판정'])+
    '<div class="small">화장품법 시행규칙 제11조①2호에 따른 품질관리기록서 — '+CO.name+' ERP 자동생성본. LOT 상태와 연동(적합 시 출하 가능). 보존: 최소 5년.</div>';
  mfdsPrint('품질관리기록서 '+q.lotNo, body);
};

/* ════════ 라우팅 ════════ */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='mfds-docs'){ injectUI(); fillSelectors(); }
};
function boot(){ injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __mfdsKeep = setInterval(function(){ try{ injectUI(); }catch(e){} }, 3000);
setTimeout(function(){ clearInterval(__mfdsKeep); }, 90000);
})();

/* ═══════════ 모듈: 거래명세서 발행 + QR LOT 라벨 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var F = function(v){ return Math.round(N(v)).toLocaleString(); };

var PRINT_CSS =
'@page{size:A4;margin:12mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#111;font-size:11px;line-height:1.5}'+
'h1{font-size:22px;text-align:center;letter-spacing:14px;margin:4px 0 10px}'+
'table{width:100%;border-collapse:collapse;margin:6px 0}'+
'th,td{border:1px solid #444;padding:4px 6px}'+
'th{background:#f2f2f2;font-weight:800;text-align:center}'+
'.r{text-align:right}.c{text-align:center}.small{font-size:9.5px;color:#666}'+
'.half{width:49.5%;display:inline-block;vertical-align:top}';

function popPrint(title, body){
  var w = window.open('', '_blank');
  if(!w){ if(typeof toast==='function') toast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.','error'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+title+'</title><style>'+PRINT_CSS+'</style></head><body>'+body+
    '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
  w.document.close();
}
function cfg(){
  try{ return (typeof getDocConfig==='function' ? getDocConfig() : {}) || {}; }catch(e){ return {}; }
}

/* ════════ 1. 페이지 주입 ════════ */
function injectUI(){
  if($('page-trade-docs')) return;
  var anchor = $('page-mfds-docs') || $('page-allergen-report') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-trade-docs'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
      '<span onclick="goPage(\'doc-center\')" style="cursor:pointer;font-size:11px;font-weight:800;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:4px 10px">← 문서센터</span>'+
      '<h2 class="text-lg font-black text-slate-800" style="margin:0">거래서류 발행 (명세서 · 부가세 기초)</h2>'+
    '</div>'+
    '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">'+
      '<div class="card p-4 space-y-3">'+
        '<h3 class="font-bold text-slate-700 text-sm">🧾 거래명세서 발행</h3>'+
        '<div style="font-size:10.5px;color:#64748b">고객·기간을 선택하면 해당 출고 건이 자동으로 명세서에 담깁니다. 공급자 정보는 문서관리 설정을 사용합니다.</div>'+
        '<select id="td-cust" class="input-field"></select>'+
        '<div class="grid grid-cols-2 gap-2">'+
          '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">시작일</label><input id="td-from" type="date" class="input-field"></div>'+
          '<div><label style="font-size:10.5px;font-weight:800;color:#64748b">종료일</label><input id="td-to" type="date" class="input-field"></div>'+
        '</div>'+
        '<select id="td-vat" class="input-field">'+
          '<option value="incl">단가에 부가세 포함 (공급가액 역산)</option>'+
          '<option value="excl">단가는 공급가액 (부가세 10% 별도)</option>'+
          '<option value="zero">면세/영세 (세액 0)</option>'+
        '</select>'+
        '<button class="btn btn-primary w-full" onclick="printTradeDoc()">거래명세서 인쇄 / PDF</button>'+
      '</div>'+
      '<div class="card p-4 space-y-3">'+
        '<h3 class="font-bold text-slate-700 text-sm">📊 부가세 신고 기초자료 (월별 매출·매입 대사)</h3>'+
        '<div style="font-size:10.5px;color:#64748b">해당 월의 출고(매출)와 입고(매입) 집계표입니다. 세무 신고용 참고자료이며 세금계산서 발행분과 대사해 사용하세요.</div>'+
        '<input id="td-month" type="month" class="input-field">'+
        '<select id="td-vat2" class="input-field">'+
          '<option value="incl">금액에 부가세 포함 (공급가액 역산)</option>'+
          '<option value="excl">금액은 공급가액 (세액 10% 별도)</option>'+
        '</select>'+
        '<button class="btn btn-primary w-full" onclick="printVatSummary()">월별 집계표 인쇄 / PDF</button>'+
      '</div>'+
    '</div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);
  /* v1.2: 별도 사이드바 메뉴 없음 — 문서센터 카탈로그에서 진입 (UX 통합) */
  var legacyNav = $('nav-trade-docs'); if(legacyNav) legacyNav.remove();
}
function fillTd(){
  var cs = $('td-cust');
  if(cs) cs.innerHTML = '<option value="">고객 선택</option>' + (db.master.M_CUSTOMER||[]).map(function(c){
    return '<option value="'+E(c.customerId)+'">'+E(c.name)+' ('+E(c.channel||'-')+')</option>';
  }).join('');
  var t = (typeof todayISO==='function') ? todayISO() : new Date().toISOString().split('T')[0];
  if($('td-from') && !$('td-from').value) $('td-from').value = t;
  if($('td-to') && !$('td-to').value) $('td-to').value = t;
  if($('td-month') && !$('td-month').value) $('td-month').value = t.slice(0,7);
}

/* VAT 분해 */
function splitVat(amount, mode){
  if(mode==='zero') return { supply: amount, vat: 0, total: amount };
  if(mode==='excl') { var v = Math.round(amount*0.1); return { supply: amount, vat: v, total: amount+v }; }
  var s = Math.round(amount/1.1); return { supply: s, vat: amount - s, total: amount };
}

/* ════════ 2. 거래명세서 ════════ */
window.printTradeDoc = function(){
  var custId = $('td-cust') && $('td-cust').value;
  var cust = (db.master.M_CUSTOMER||[]).find(function(c){ return String(c.customerId)===String(custId); });
  if(!cust){ if(typeof toast==='function') toast('고객을 선택하세요','error'); return; }
  var from = $('td-from').value, to = $('td-to').value, mode = $('td-vat').value;
  var rows = (db.txn.T_SALE||[]).filter(function(s){
    return String(s.customerId)===String(custId) && s.date>=from && s.date<=to;
  });
  if(!rows.length){ if(typeof toast==='function') toast('해당 기간 출고 건이 없습니다','error'); return; }

  var c = cfg();
  var sup=0, vat=0, tot=0;
  var body =
    '<h1>거 래 명 세 서</h1>'+
    '<div class="small" style="text-align:right">거래기간: '+E(from)+' ~ '+E(to)+' · 발행일: '+new Date().toISOString().split('T')[0]+'</div>'+
    '<div class="half"><table>'+
      '<tr><th colspan="2" style="background:#e8f3f0">공 급 자</th></tr>'+
      '<tr><th style="width:32%">상호</th><td>'+E(c.company||'주식회사 메디센츠')+'</td></tr>'+
      '<tr><th>사업자등록번호</th><td>'+E(c.bizNo||'')+'</td></tr>'+
      '<tr><th>대표자</th><td>'+E(c.ceo||'')+'</td></tr>'+
      '<tr><th>주소</th><td>'+E(c.addr||'')+'</td></tr>'+
      '<tr><th>연락처</th><td>'+E(c.tel||'070-4365-4807')+'</td></tr>'+
    '</table></div>'+
    '<div class="half" style="float:right"><table>'+
      '<tr><th colspan="2" style="background:#eef2f8">공 급 받 는 자</th></tr>'+
      '<tr><th style="width:32%">상호</th><td>'+E(cust.name)+'</td></tr>'+
      '<tr><th>사업자등록번호</th><td>&nbsp;</td></tr>'+
      '<tr><th>대표자</th><td>&nbsp;</td></tr>'+
      '<tr><th>주소</th><td>&nbsp;</td></tr>'+
      '<tr><th>연락처</th><td>'+E(cust.tel||'')+'</td></tr>'+
    '</table></div>'+
    '<div style="clear:both"></div>'+
    '<table><tr><th style="width:5%">No</th><th>품목</th><th style="width:14%">LOT</th><th style="width:8%">수량</th><th style="width:12%">단가</th><th style="width:13%">공급가액</th><th style="width:11%">세액</th><th style="width:9%">비고</th></tr>'+
    rows.map(function(s, i){
      var p = (typeof findProduct==='function') && findProduct(s.productId);
      var v = splitVat(N(s.amount), mode);
      sup+=v.supply; vat+=v.vat; tot+=v.total;
      return '<tr><td class="c">'+(i+1)+'</td><td>'+E(p?p.name:s.productId)+'</td><td class="c">'+E(s.lotNo||'-')+'</td>'+
        '<td class="r">'+F(s.qty)+'</td><td class="r">'+F(s.unitPrice)+'</td><td class="r">'+F(v.supply)+'</td><td class="r">'+F(v.vat)+'</td><td class="small">'+E(s.note||'')+'</td></tr>';
    }).join('')+
    '<tr><th colspan="5">합 계</th><th class="r">'+F(sup)+'</th><th class="r">'+F(vat)+'</th><th></th></tr>'+
    '</table>'+
    '<table><tr><th style="width:25%">총 합계금액 (VAT 포함)</th><td class="r" style="font-size:14px;font-weight:900">'+F(tot)+' 원</td></tr></table>'+
    '<table><tr><th style="width:25%">인수자</th><td style="width:42%">(서명)</td><th style="width:12%">인수일</th><td></td></tr></table>'+
    '<div class="small">'+(mode==='incl'?'※ 단가는 부가세 포함가이며 공급가액은 역산(÷1.1)한 금액입니다.':mode==='excl'?'※ 단가는 공급가액이며 부가세 10%가 별도 가산되었습니다.':'※ 면세/영세율 거래로 세액이 없습니다.')+' 본 명세서는 세금계산서를 대신하지 않습니다.</div>';
  popPrint('거래명세서 '+cust.name, body);
};

/* ════════ 3. 부가세 기초자료 (월별 매출·매입 대사표) ════════ */
window.printVatSummary = function(){
  var ym = $('td-month').value, mode = $('td-vat2').value;
  if(!ym){ if(typeof toast==='function') toast('월을 선택하세요','error'); return; }
  var c = cfg();
  /* 매출: T_SALE, 매입: T_GOODS_IN(수량×단가) */
  var sales = (db.txn.T_SALE||[]).filter(function(s){ return String(s.date||'').indexOf(ym)===0; });
  var buys  = (db.txn.T_GOODS_IN||[]).filter(function(g){ return String(g.date||'').indexOf(ym)===0; });
  var byCust={}, sSup=0, sVat=0;
  sales.forEach(function(s){
    var cu = (db.master.M_CUSTOMER||[]).find(function(x){ return String(x.customerId)===String(s.customerId); });
    var k = cu?cu.name:'미지정';
    var v = splitVat(N(s.amount), mode);
    if(!byCust[k]) byCust[k]={supply:0,vat:0,cnt:0};
    byCust[k].supply+=v.supply; byCust[k].vat+=v.vat; byCust[k].cnt++;
    sSup+=v.supply; sVat+=v.vat;
  });
  var bSup=0, bVat=0;
  buys.forEach(function(g){
    var amt = N(g.qty)*N(g.unitCost);
    var v = splitVat(amt, mode);
    bSup+=v.supply; bVat+=v.vat;
  });
  var body =
    '<h1 style="letter-spacing:4px">부가세 신고 기초자료 ('+E(ym)+')</h1>'+
    '<div class="small" style="text-align:right">'+E(c.company||'주식회사 메디센츠')+' · 사업자번호 '+E(c.bizNo||'')+' · 출력 '+new Date().toISOString().split('T')[0]+'</div>'+
    '<h3 style="font-size:12.5px;margin:10px 0 4px;border-bottom:2px solid #444">1. 매출 (출고) — 거래처별</h3>'+
    '<table><tr><th>거래처</th><th style="width:10%">건수</th><th style="width:18%">공급가액</th><th style="width:15%">세액</th><th style="width:18%">합계</th></tr>'+
    Object.keys(byCust).map(function(k){
      var v=byCust[k];
      return '<tr><td>'+E(k)+'</td><td class="c">'+v.cnt+'</td><td class="r">'+F(v.supply)+'</td><td class="r">'+F(v.vat)+'</td><td class="r">'+F(v.supply+v.vat)+'</td></tr>';
    }).join('')+
    '<tr><th>매출 합계</th><th class="c">'+sales.length+'</th><th class="r">'+F(sSup)+'</th><th class="r">'+F(sVat)+'</th><th class="r">'+F(sSup+sVat)+'</th></tr></table>'+
    '<h3 style="font-size:12.5px;margin:10px 0 4px;border-bottom:2px solid #444">2. 매입 (원자재 입고)</h3>'+
    '<table><tr><th>구분</th><th style="width:10%">건수</th><th style="width:18%">공급가액</th><th style="width:15%">세액</th><th style="width:18%">합계</th></tr>'+
    '<tr><td>원료·자재 입고</td><td class="c">'+buys.length+'</td><td class="r">'+F(bSup)+'</td><td class="r">'+F(bVat)+'</td><td class="r">'+F(bSup+bVat)+'</td></tr></table>'+
    '<h3 style="font-size:12.5px;margin:10px 0 4px;border-bottom:2px solid #444">3. 대사 요약</h3>'+
    '<table><tr><th style="width:30%">매출세액 − 매입세액 (참고)</th><td class="r" style="font-weight:900;font-size:13px">'+F(sVat-bVat)+' 원</td></tr></table>'+
    '<div class="small">※ ERP 출고·입고 기록 기준 참고자료입니다. 실제 신고는 세금계산서·카드·현금영수증 발행분 기준으로 세무대리인과 대사하세요. 운임·경비 등 기타 매입은 포함되지 않습니다.</div>';
  popPrint('부가세 기초자료 '+ym, body);
};

/* ════════ 4. QR LOT 라벨 + 스캔 조회 ════════ */
function loadQR(cb){
  if(window.QRCode) return cb();
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = cb; s.onerror = function(){ cb('fail'); };
  document.head.appendChild(s);
}
/* 라벨 미리보기 감시: .label-sheet가 렌더될 때마다 QR 자동 부착
   (renderLabel2가 클로저 내부여도 동작 — 함수 래핑 방식의 한계 해결) */
function attachQR(){
  var type = $('label-type2') && $('label-type2').value || 'RAW';
  var lotId = $('label-lot2') && $('label-lot2').value;
  var sheet = document.querySelector('#label-preview2 .label-sheet');
  if(!sheet || !lotId || sheet.dataset.qrDone) return;
  sheet.dataset.qrDone = '1';
  var url = location.origin + location.pathname + '#lot=' + type + ':' + lotId;
  var box = document.createElement('div');
  box.style.cssText='display:flex;align-items:center;gap:8px;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1';
  var qrDiv = document.createElement('div');
  var txt = document.createElement('div');
  txt.style.cssText='font-size:9px;color:#64748b;line-height:1.4';
  txt.textContent = '📱 스캔하면 이 LOT의 잔량·유통기한·QC상태 즉시 확인';
  box.appendChild(qrDiv); box.appendChild(txt);
  sheet.appendChild(box);
  loadQR(function(err){
    if(err || !window.QRCode){ qrDiv.textContent = url; qrDiv.style.fontSize='8px'; return; }
    new QRCode(qrDiv, { text:url, width:64, height:64, correctLevel: QRCode.CorrectLevel.M });
  });
}
function watchLabelPreview(){
  var pre = $('label-preview2');
  if(!pre || pre.dataset.qrWatch) return;
  pre.dataset.qrWatch = '1';
  new MutationObserver(function(){ try{ attachQR(); }catch(e){} }).observe(pre, {childList:true});
  attachQR();
}

/* 스캔 진입: #lot=TYPE:ID → 퀵뷰 모달 */
window.openLotQuickView = function(type, lotId){
  if(!window.db) return false;
  var keyMap = { RAW:'RAW_LOT', PACK:'PACK_LOT', BULK:'BULK_LOT', FGT:'FGT_LOT' };
  var arr = db.stock[keyMap[type]||'RAW_LOT']||[];
  var lot = arr.find(function(l){ return String(l.id)===String(lotId); });
  if(!lot) return false;
  var name = '';
  if(type==='RAW'){ var r=(db.master.M_RAW||[]).find(function(x){return x.rawId===lot.rawId;}); name=r?r.name:''; }
  else if(type==='PACK'){ var pk=(db.master.M_PACK||[]).find(function(x){return x.packId===lot.packId;}); name=pk?pk.name:''; }
  else { var pr=(db.master.M_PRODUCT||[]).find(function(x){return x.productId===lot.productId;}); name=pr?pr.name:''; }
  var st = String(lot.status||'OK').toUpperCase();
  var stColor = st==='OK'?'#059669':st==='FAIL'?'#dc2626':'#d97706';
  var old = $('lot-qv-modal'); if(old) old.remove();
  var bg = document.createElement('div');
  bg.id='lot-qv-modal';
  bg.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:950;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML =
    '<div style="background:#fff;border-radius:16px;max-width:380px;width:100%;padding:20px" onclick="event.stopPropagation()">'+
      '<div style="font-size:11px;font-weight:800;color:#0f766e">📱 LOT 스캔 조회 · '+E(type)+'</div>'+
      '<div style="font-size:17px;font-weight:900;color:#0f172a;margin:4px 0 2px">'+E(name)+'</div>'+
      '<div style="font-family:monospace;font-size:12px;color:#64748b;margin-bottom:12px">'+E(lot.lotNo)+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        qv('잔량', (lot.remaining!=null?lot.remaining:'-') + (lot.qty!=null?' / '+lot.qty:'')) +
        qv('QC 상태', '<span style="color:'+stColor+';font-weight:900">'+E(st)+'</span>') +
        qv('입고/제조일', E(lot.dateIn||lot.mfgDate||'-')) +
        qv('유통기한/숙성', E(lot.expDate||lot.matureUntil||'-')) +
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">'+
        '<button class="btn btn-primary" onclick="scanAction(\'move\',\''+E(type)+'\',\''+E(lotId)+'\')">🔄 이관하기</button>'+
        '<button class="btn btn-secondary" onclick="scanAction(\'count\',\''+E(type)+'\',\''+E(lotId)+'\')">🔢 실사 입력</button>'+
      '</div>'+
      '<button class="btn btn-secondary w-full" style="margin-top:6px" onclick="document.getElementById(\'lot-qv-modal\').remove()">닫기</button>'+
    '</div>';
  bg.onclick = function(){ bg.remove(); };
  document.body.appendChild(bg);
  return true;
  function qv(l,v){ return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px"><div style="font-size:9.5px;font-weight:800;color:#64748b">'+l+'</div><div style="font-size:13px;font-weight:800;color:#0f172a">'+v+'</div></div>'; }
};
function checkHash(){
  var m = (location.hash||'').match(/#lot=([A-Z]+):(.+)$/);
  if(!m) return;
  var tries = 0;
  (function attempt(){
    if(window.db && openLotQuickView(m[1], decodeURIComponent(m[2]))) return;
    if(++tries < 20) setTimeout(attempt, 500); /* 클라우드 로드 대기 (최대 10초) */
  })();
}
window.addEventListener('hashchange', checkHash);

/* 스캔 → 액션: 이관 폼 자동 채움 / 실사 시트 열기 */
window.scanAction = function(kind, type, lotId){
  var m = $('lot-qv-modal'); if(m) m.remove();
  if(typeof goPage==='function') goPage('loc-stock');
  setTimeout(function(){
    try{
      if(kind==='move'){
        var mt = $('mv-type');
        if(mt){ mt.value = (type==='PACK') ? 'PACK' : 'FGT'; if(mt.onchange) mt.onchange(); }
        var lot = (db.stock[type==='PACK'?'PACK_LOT':'FGT_LOT']||[]).find(function(l){ return String(l.id)===String(lotId); });
        var dir = $('mv-dir');
        if(dir && lot){ dir.value = (lot.location==='인사동') ? '인사동>창고' : '창고>인사동'; if(dir.onchange) dir.onchange(); }
        var sel = $('mv-lot');
        if(sel){ sel.value = String(lotId); if(!sel.value && lot){ sel.innerHTML += '<option value="'+lotId+'" selected>['+(lot.lotNo||'')+']</option>'; sel.value=String(lotId); } }
        var q = $('mv-qty'); if(q) q.focus();
        if(typeof toast==='function') toast('이관 폼에 LOT를 채웠습니다. 수량만 입력하세요.','success');
      } else {
        var st = $('st-type');
        if(st){ st.value = (type==='PACK') ? 'PACK' : (type==='RAW' ? 'RAW' : 'FGT'); }
        var lot2 = (db.stock[type==='PACK'?'PACK_LOT':type==='RAW'?'RAW_LOT':'FGT_LOT']||[]).find(function(l){ return String(l.id)===String(lotId); });
        var sl = $('st-loc'); if(sl && lot2 && lot2.location) sl.value = lot2.location;
        if(typeof startStocktake==='function') startStocktake();
        if(typeof toast==='function') toast('실사 시트를 열었습니다. 실물 수량을 입력하세요.','success');
      }
    }catch(e){}
  }, 400);
};

/* ════════ 라우팅·부트 ════════ */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='trade-docs'){ injectUI(); fillTd(); }
};
function boot(){ injectUI(); checkHash(); watchLabelPreview(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(injectUI, 1500);
setTimeout(watchLabelPreview, 1500);
var __tqKeep = setInterval(function(){ try{ injectUI(); watchLabelPreview(); }catch(e){} }, 3000);
setTimeout(function(){ clearInterval(__tqKeep); }, 90000);
})();

/* ═══════════ 모듈: 문서센터 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var F = function(v){ return Math.round(N(v)).toLocaleString(); };
var F2 = function(v){ return (Math.round(N(v)*100)/100).toLocaleString(); };
var TODAY = function(){ return new Date().toISOString().split('T')[0]; };

/* ════════ ④ 승인 스탬프 ════════ */
var CUR_USER = '';
function fetchUser(){
  try{
    var sb = window.sbAuth || window.sb;
    if(sb && sb.auth && sb.auth.getSession){
      sb.auth.getSession().then(function(r){
        CUR_USER = (r && r.data && r.data.session && r.data.session.user && r.data.session.user.email) || '';
      }).catch(function(){});
    }
  }catch(e){}
}
window.docStamp = function(){
  return '<div style="margin-top:10px;border:1px solid #999;border-radius:6px;padding:6px 10px;font-size:9.5px;color:#444;background:#fafafa">'+
    '🔏 전자 작성확인 — 작성 계정: <b>'+E(CUR_USER||'(로그인 계정)')+'</b> · 시스템 출력일시: '+new Date().toISOString().replace('T',' ').slice(0,19)+
    ' · 승인자: ________________ (서명)</div>';
};
/* 기존 규제문서 출력에도 스탬프 자동 적용 */
setTimeout(function(){
  if(typeof window.mfdsPrint === 'function' && !window.mfdsPrint.__stamped){
    var _m = window.mfdsPrint;
    window.mfdsPrint = function(t, b){ _m(t, b + window.docStamp()); };
    window.mfdsPrint.__stamped = true;
  }
}, 800);

var PRINT_CSS =
'@page{size:A4;margin:12mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;color:#111;font-size:11px;line-height:1.5}'+
'h1{font-size:19px;text-align:center;margin:2px 0 2px}'+
'.co{color:#0f766e;font-weight:800;text-align:center;font-size:12px}'+
'.sub{text-align:center;color:#555;font-size:10px;margin-bottom:8px}'+
'table{width:100%;border-collapse:collapse;margin:6px 0}'+
'th,td{border:1px solid #444;padding:3.5px 6px}'+
'th{background:#eef5f2;font-weight:800;text-align:center}'+
'.r{text-align:right}.c{text-align:center}.small{font-size:9.5px;color:#666}'+
'h3{font-size:12.5px;margin:12px 0 4px;border-bottom:2px solid #0f766e;padding-bottom:2px}'+
'.ok{color:#059669;font-weight:900}.ng{color:#dc2626;font-weight:900}';

function popPrint(title, body){
  var w = window.open('', '_blank');
  if(!w){ if(typeof toast==='function') toast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.','error'); return; }
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+title+'</title><style>'+PRINT_CSS+'</style></head><body>'+body+window.docStamp()+
    '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
  w.document.close();
}
function docHead(title, sub){
  return '<div class="co">주식회사 메디센츠 (화장품제조업 등록 제7691호)</div><h1>'+title+'</h1><div class="sub">'+sub+'</div>';
}
function ensureLog(){ if(window.db){ db.txn = db.txn||{}; db.txn.T_CHECKLOG = db.txn.T_CHECKLOG||[]; } }

/* ════════ 문서센터 페이지 (카탈로그 UI) ════════ */
/* ════════ 문서센터 페이지 (그룹형 카탈로그 — 모든 문서의 단일 관문) ════════ */
var CATALOG_GROUPS = [
  { title:'📆 정기 일지 (기간 선택 → 자동 생성)', items:[
    {icon:'📦', title:'월간 원자재 수불부', desc:'기초·입고·사용·기말 자동 집계 (원료/포장재)', act:'openLedgerReport()'},
    {icon:'🏭', title:'생산월보', desc:'배합·충진·QC 실적 월간 요약', act:'openProdMonthly()'},
    {icon:'📅', title:'연간 생산실적 집계표', desc:'식약처 생산실적 보고(매년 2월) 기초자료', act:'openAnnualReport()'}
  ]},
  { title:'🏷 LOT 기록 (식약처 의무·감사 대응)', items:[
    {icon:'📄', title:'제조·품질관리기록서', desc:'LOT 선택 → 배치기록·시험기록 인쇄 (CGMP 양식)', act:"goPage('mfds-docs')"},
    {icon:'🧾', title:'제조기록서 (간이형)', desc:'본체 기본 양식의 배치 기록', act:"goPage('doc-batch-record')"},
    {icon:'🔬', title:'품질검사성적서', desc:'LOT 시험 성적서 발행', act:"goPage('doc-qc-report')"},
    {icon:'📘', title:'제품표준서', desc:'제품별 표준서 작성·출력', act:"goPage('doc-pspec')"},
    {icon:'🔍', title:'LOT 추적성 패키지', desc:'제조기록+QC+원료CoA+알레르겐 일괄 출력 (리콜 대응)', act:'openTracePack()'}
  ]},
  { title:'🧾 거래 서류', items:[
    {icon:'🧾', title:'거래명세서 · 부가세 기초', desc:'고객·기간 선택 → 명세서 인쇄, 월별 매출·매입 대사표', act:"goPage('trade-docs')"},
    {icon:'📤', title:'출고기록서', desc:'출고 건 기록서 발행', act:"goPage('doc-release')"},
    {icon:'💰', title:'견적서 (OEM)', desc:'OEM·B2B 견적서 작성·출력', act:"goPage('doc-quote')"}
  ]},
  { title:'🧼 점검 · 교육 기록', items:[
    {icon:'🧼', title:'위생점검일지', desc:'일일 위생점검 입력 + 월별 일지 출력', act:"openCheckLog('위생')"},
    {icon:'⚙️', title:'설비점검일지', desc:'월 1회 설비점검 입력 + 일지 출력 (기준서 3항 근거)', act:"openCheckLog('설비')"},
    {icon:'🎓', title:'교육이수 대장', desc:'법정·사내 교육 기록 + 대장 출력', act:"openCheckLog('교육')"}
  ]}
];
function injectUI(){
  if($('page-doc-center')) return;
  var anchor = $('page-trade-docs') || $('page-mfds-docs') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-doc-center'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">📚 문서센터</h2>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:600">모든 서류가 여기 있습니다 — 정기 일지 · 식약처 기록 · 거래 서류 · 점검일지를 한 곳에서 출력합니다.</div>'+
    CATALOG_GROUPS.map(function(g){
      return '<div style="font-size:12px;font-weight:900;color:#334155;margin:14px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:3px">'+g.title+'</div>'+
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">'+
        g.items.map(function(c){
          return '<div class="card p-4" style="cursor:pointer" onclick="'+c.act+'">'+
            '<div style="font-size:20px">'+c.icon+'</div>'+
            '<div style="font-weight:900;font-size:12.5px;color:#0f172a;margin:3px 0 2px">'+c.title+'</div>'+
            '<div style="font-size:10.5px;color:#64748b;line-height:1.5">'+c.desc+'</div></div>';
        }).join('')+'</div>';
    }).join('')+
    '<div id="dc-panel"></div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var nav = $('nav-allergen-report');
  if(nav && !$('nav-doc-center')){
    var n = document.createElement('div');
    n.id='nav-doc-center'; n.className='nav-item'; n.setAttribute('onclick',"goPage('doc-center')");
    n.innerHTML='<i data-lucide="library-big" class="w-4 h-4 shrink-0"></i> 📚 문서센터';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
  /* 본체의 흩어진 문서 메뉴 흡수 (페이지는 유지, 문서센터 카드로 진입) */
  ['nav-doc-quote','nav-doc-release','nav-doc-qc-report','nav-doc-batch-record','nav-doc-pspec'].forEach(function(id){
    var el = $(id); if(el) el.remove();
  });
}
function panel(html){ var p=$('dc-panel'); if(p){ p.innerHTML='<div class="card p-4 space-y-3" style="border:2px solid #0f766e">'+html+'</div>'; try{ p.scrollIntoView({behavior:'smooth'}); }catch(e){} } }
function monthInput(id){ return '<input id="'+id+'" type="month" class="input-field" value="'+TODAY().slice(0,7)+'">'; }

/* ════════ ①-a 월간 원자재 수불부 ════════ */
window.openLedgerReport = function(){
  panel('<h3 class="font-bold text-sm text-slate-700">📦 월간 원자재 수불부</h3>'+
    '<div class="grid grid-cols-2 gap-2">'+
    '<select id="lr-type" class="input-field"><option value="RAW">원료</option><option value="PACK">포장재</option></select>'+
    monthInput('lr-month')+'</div>'+
    '<button class="btn btn-primary w-full" onclick="printLedgerReport()">수불부 인쇄 / PDF</button>');
};
window.printLedgerReport = function(){
  var type = $('lr-type').value, ym = $('lr-month').value;
  var from = ym+'-01', to = ym+'-31';
  var before = buildLedgerEntries(type, '', ym+'-00');      /* 월초 이전 누적 */
  var during = buildLedgerEntries(type, from, to);           /* 월중 */
  var agg = {};
  function add(list, key){
    list.forEach(function(e){
      var k = e.name || '(미지정)';
      if(!agg[k]) agg[k] = { open:0, inQ:0, outQ:0 };
      if(key==='open') agg[k].open += N(e.inQty) - N(e.outQty);
      else { agg[k].inQ += N(e.inQty); agg[k].outQ += N(e.outQty); }
    });
  }
  add(before,'open'); add(during,'during');
  var names = Object.keys(agg).sort();
  var tIn=0,tOut=0;
  var rows = names.map(function(k){
    var a = agg[k], close = a.open + a.inQ - a.outQ;
    tIn+=a.inQ; tOut+=a.outQ;
    return '<tr><td>'+E(k)+'</td><td class="r">'+F2(a.open)+'</td><td class="r">'+F2(a.inQ)+'</td><td class="r">'+F2(a.outQ)+'</td><td class="r"><b>'+F2(close)+'</b></td></tr>';
  }).join('');
  popPrint((type==='RAW'?'원료':'포장재')+' 수불부 '+ym,
    docHead((type==='RAW'?'원료':'포장재')+' 수불부', '대상월: '+ym+' · 재고 원장(입출고·배합사용·충진사용) 기준 자동 집계')+
    '<table><tr><th>품목</th><th style="width:16%">월초재고</th><th style="width:16%">당월 입고</th><th style="width:16%">당월 사용</th><th style="width:16%">월말재고</th></tr>'+
    (rows||'<tr><td colspan="5" class="c small">해당 월 거래 없음</td></tr>')+
    (rows?'<tr><th>합계</th><th></th><th class="r">'+F2(tIn)+'</th><th class="r">'+F2(tOut)+'</th><th></th></tr>':'')+
    '</table><div class="small">※ 월초재고 = 월 이전 전체 원장 누적, 월말재고 = 월초 + 입고 − 사용. 실사 차이는 재고조정 기록으로 반영하세요.</div>');
};

/* ════════ ①-b 생산월보 ════════ */
window.openProdMonthly = function(){
  panel('<h3 class="font-bold text-sm text-slate-700">🏭 생산월보</h3>'+monthInput('pm-month')+
    '<button class="btn btn-primary w-full" onclick="printProdMonthly()">생산월보 인쇄 / PDF</button>');
};
window.printProdMonthly = function(){
  var ym = $('pm-month').value;
  var inM = function(d){ return String(d||'').indexOf(ym)===0; };
  var bulks = (db.txn.T_BULK||[]).filter(function(b){ return inM(b.date); });
  var fills = (db.txn.T_BATCH||[]).filter(function(b){ return inM(b.date); });
  var qcs = (db.txn.T_QC_PROD||[]).filter(function(q){ return inM(q.date); });
  var byProd = {};
  fills.forEach(function(b){
    var p = (typeof findProduct==='function') && findProduct(b.productId);
    var k = p?p.name:String(b.productId);
    if(!byProd[k]) byProd[k]={qty:0,cnt:0};
    byProd[k].qty+=N(b.qty); byProd[k].cnt++;
  });
  var okC = qcs.filter(function(q){return q.result==='OK';}).length;
  var failC = qcs.filter(function(q){return q.result==='FAIL';}).length;
  var wos = (db.txn.T_WORK_ORDER||[]).filter(function(w){ return w.status==='완료' && w.result && inM((w.result.completedAt||'').slice(0,10)); });
  var yAvg = (function(){ var v=wos.map(function(w){ var o=N(w.result.outputQty),d=N(w.result.defectQty); return (o+d)>0?o/(o+d)*100:null; }).filter(function(x){return x!=null;}); return v.length? (v.reduce(function(a,b){return a+b;},0)/v.length).toFixed(1)+'%':'-'; })();
  popPrint('생산월보 '+ym,
    docHead('생 산 월 보', '대상월: '+ym)+
    '<h3>1. 요약</h3><table><tr><th>배합(벌크)</th><th>충진(완제품)</th><th>QC 적합</th><th>QC 부적합</th><th>평균 생산수율(MES)</th></tr>'+
    '<tr><td class="c">'+bulks.length+'건</td><td class="c">'+fills.length+'건 / '+F(fills.reduce(function(s,b){return s+N(b.qty);},0))+' EA</td>'+
    '<td class="c ok">'+okC+'건</td><td class="c '+(failC?'ng':'c')+'">'+failC+'건</td><td class="c">'+yAvg+'</td></tr></table>'+
    '<h3>2. 제품별 충진(생산) 실적</h3>'+
    '<table><tr><th>제품</th><th style="width:16%">배치 수</th><th style="width:20%">생산량(EA)</th></tr>'+
    (Object.keys(byProd).map(function(k){ return '<tr><td>'+E(k)+'</td><td class="c">'+byProd[k].cnt+'</td><td class="r">'+F(byProd[k].qty)+'</td></tr>'; }).join('')||'<tr><td colspan="3" class="c small">당월 충진 없음</td></tr>')+
    '</table>'+
    '<h3>3. 배합(벌크) 내역</h3>'+
    '<table><tr><th>일자</th><th>벌크 LOT</th><th>제품</th><th style="width:16%">배합량</th></tr>'+
    (bulks.map(function(b){ var p=(typeof findProduct==='function')&&findProduct(b.productId); return '<tr><td class="c">'+E(b.date)+'</td><td class="c">'+E(b.lotNo)+'</td><td>'+E(p?p.name:'')+'</td><td class="r">'+F(b.qty)+'</td></tr>'; }).join('')||'<tr><td colspan="4" class="c small">당월 배합 없음</td></tr>')+
    '</table>');
};

/* ════════ ①-c 연간 생산실적 집계표 ════════ */
window.openAnnualReport = function(){
  var y = new Date().getFullYear();
  panel('<h3 class="font-bold text-sm text-slate-700">📅 연간 생산실적 집계표 (식약처 보고 기초)</h3>'+
    '<select id="ar-year" class="input-field">'+[y,y-1,y-2].map(function(v){ return '<option value="'+v+'"'+(v===y-0?'':'')+'>'+v+'년</option>'; }).join('')+'</select>'+
    '<div style="font-size:10px;color:#64748b">생산량 = 해당 연도 충진(배치) 합계. 생산금액은 연 평균 판매단가 기준 참고치이며, 보고 시 공장도가 기준으로 조정하세요.</div>'+
    '<button class="btn btn-primary w-full" onclick="printAnnualReport()">집계표 인쇄 / PDF</button>');
};
window.printAnnualReport = function(){
  var y = $('ar-year').value;
  var inY = function(d){ return String(d||'').indexOf(y)===0; };
  var fills = (db.txn.T_BATCH||[]).filter(function(b){ return inY(b.date); });
  var sales = (db.txn.T_SALE||[]).filter(function(s){ return inY(s.date); });
  var byProd = {};
  fills.forEach(function(b){
    if(!byProd[b.productId]) byProd[b.productId]={qty:0,batches:0,saleAmt:0,saleQty:0};
    byProd[b.productId].qty+=N(b.qty); byProd[b.productId].batches++;
  });
  sales.forEach(function(s){
    if(!byProd[s.productId]) byProd[s.productId]={qty:0,batches:0,saleAmt:0,saleQty:0};
    byProd[s.productId].saleAmt+=N(s.amount); byProd[s.productId].saleQty+=N(s.qty);
  });
  var tQty=0,tAmt=0,items=0;
  var rows = Object.keys(byProd).map(function(pid){
    var a = byProd[pid];
    if(a.qty<=0) return '';
    items++;
    var p = (typeof findProduct==='function') && findProduct(Number(pid)||pid);
    var avg = a.saleQty>0 ? a.saleAmt/a.saleQty : 0;
    var amt = a.qty*avg;
    tQty+=a.qty; tAmt+=amt;
    return '<tr><td>'+E(p?p.name:pid)+'</td><td class="c">'+a.batches+'</td><td class="r">'+F(a.qty)+'</td>'+
      '<td class="r">'+(avg?F(avg):'<span class="small">판매기록 없음</span>')+'</td><td class="r"><b>'+(avg?F(amt):'-')+'</b></td></tr>';
  }).join('');
  popPrint('생산실적 '+y,
    docHead(y+'년 생산실적 집계표', '화장품법 제5조 생산실적 보고(익년 2월 말, 대한화장품협회 접수) 기초자료')+
    '<table><tr><th>품목명</th><th style="width:10%">배치수</th><th style="width:16%">생산량(EA)</th><th style="width:18%">평균 판매단가(원)</th><th style="width:20%">생산금액(원, 참고)</th></tr>'+
    (rows||'<tr><td colspan="5" class="c small">해당 연도 생산기록 없음</td></tr>')+
    (rows?'<tr><th>합계 ('+items+'품목)</th><th></th><th class="r">'+F(tQty)+'</th><th></th><th class="r">'+F(tAmt)+'</th></tr>':'')+
    '</table><div class="small">※ 보고 품목 분류(유형별)와 공장도가 기준 금액은 협회 보고 양식에 맞춰 최종 조정이 필요합니다. 수출·내수 구분은 판매 채널 기준으로 구분해 기재하세요.</div>');
};

/* ════════ ② LOT 추적성 패키지 ════════ */
window.openTracePack = function(){
  var opts = (db.txn.T_BATCH||[]).slice().reverse().map(function(b){
    var p=(typeof findProduct==='function')&&findProduct(b.productId);
    return '<option value="'+E(b.id)+'">['+E(b.lotNo)+'] '+E(p?p.name:'')+' / '+E(b.date)+'</option>';
  }).join('');
  panel('<h3 class="font-bold text-sm text-slate-700">🔍 LOT 추적성 패키지 (감사·리콜 대응)</h3>'+
    '<select id="tp-batch" class="input-field"><option value="">충진 LOT 선택</option>'+opts+'</select>'+
    '<button class="btn btn-primary w-full" onclick="printTracePack()">추적성 패키지 인쇄 / PDF</button>');
};
window.printTracePack = function(){
  var id = $('tp-batch').value;
  var batch = (db.txn.T_BATCH||[]).find(function(b){ return String(b.id)===String(id); });
  if(!batch){ if(typeof toast==='function') toast('LOT를 선택하세요','error'); return; }
  var product = (typeof findProduct==='function') && findProduct(batch.productId);
  var bulk = (db.txn.T_BULK||[]).find(function(b){ return b.lotNo===batch.bulkLotNo; });
  var bulkStock = (db.stock.BULK_LOT||[]).find(function(b){ return b.lotNo===batch.bulkLotNo; });
  var qcs = (db.txn.T_QC_PROD||[]).filter(function(q){ return q.lotNo===batch.lotNo; });
  var sold = (db.txn.T_SALE||[]).filter(function(s){ return s.lotNo===batch.lotNo; });

  /* 원료 LOT + CoA 체크 */
  var matRows='';
  ((bulk && bulk.materials)||[]).forEach(function(m){
    var raw = m.type!=='PACK' && (typeof findRaw==='function') && findRaw(m.itemId);
    var pk  = m.type==='PACK' && (typeof findPack==='function') && findPack(m.itemId);
    var nm = (raw&&raw.name)||(pk&&pk.name)||m.itemId;
    (m.lots||[{lotNo:'-',take:m.need}]).forEach(function(l){
      matRows+='<tr><td class="c">'+E(m.type||'RAW')+'</td><td>'+E(nm)+'</td><td class="c">'+E(l.lotNo)+'</td><td class="r">'+F2(l.take)+'</td><td class="c">□ 보관확인</td></tr>';
    });
  });
  ((batch.consumedLots)||[]).forEach(function(m){
    var pk=(typeof findPack==='function')&&findPack(m.itemId);
    (m.lots||[]).forEach(function(l){
      matRows+='<tr><td class="c">PACK</td><td>'+E(pk?pk.name:'')+'</td><td class="c">'+E(l.lotNo)+'</td><td class="r">'+F2(l.take)+'</td><td class="c">□ 보관확인</td></tr>';
    });
  });

  /* 알레르겐 판정 (원료 프로파일 × 배합비) — CAS→명칭 자체 내장(패치 간 독립) */
  var algRows='', algWarn=[];
  var A26MAP = {'127-51-5':['ALPHA-ISOMETHYL IONONE','알파-이소메틸 이오논'],'122-40-7':['AMYL CINNAMAL','아밀신남알'],'101-85-9':['AMYL CINNAMYL ALCOHOL','아밀신나밀알코올'],'105-13-5':['ANISYL ALCOHOL','아니스알코올'],'100-51-6':['BENZYL ALCOHOL','벤질알코올'],'120-51-4':['BENZYL BENZOATE','벤질벤조에이트'],'103-41-3':['BENZYL CINNAMATE','벤질신나메이트'],'118-58-1':['BENZYL SALICYLATE','벤질살리실레이트'],'80-54-6':['LYSMERAL (BMHCA)','부틸페닐메틸프로피오날'],'104-55-2':['CINNAMAL','신남알'],'104-54-1':['CINNAMYL ALCOHOL','신나밀알코올'],'5392-40-5':['CITRAL','시트랄'],'106-22-9':['CITRONELLOL','시트로넬올'],'91-64-5':['COUMARIN','쿠마린'],'97-53-0':['EUGENOL','유제놀'],'90028-67-4':['TREEMOSS EXTRACT','트리모스추출물'],'90028-68-5':['OAKMOSS EXTRACT','오크모스추출물'],'4602-84-0':['FARNESOL','파네솔'],'106-24-1':['GERANIOL','제라니올'],'101-86-0':['HEXYL CINNAMAL','헥실신남알'],'107-75-5':['HYDROXYCITRONELLAL','하이드록시시트로넬알'],'31906-04-4':['LYRAL (HICC)','하이드록시이소헥실'],'97-54-1':['ISOEUGENOL','이소유제놀'],'5989-27-5':['d-LIMONENE','리모넨'],'78-70-6':['LINALOOL','리날룰'],'111-12-6':['METHYL HEPTINE CARBONATE','메틸헵틴카보네이트']};
  (function(){
    var bomRaws = ((product&&product.bom)||[]).filter(function(r){ return r.type==='RAW'; });
    var perEa = bomRaws.map(function(r){ return { raw:(typeof findRaw==='function')&&findRaw(r.itemId), g:(typeof bomNeed==='function')?bomNeed(product,r,1):N(r.qty) }; });
    var base = N(product&&product.fillWeight)>0 ? N(product.fillWeight) : perEa.reduce(function(s,x){return s+x.g;},0);
    if(base<=0) return;
    var acc={};
    perEa.forEach(function(x){
      if(!x.raw) return;
      var p = x.raw.allergenProfile;
      if(p && Object.keys(p).length){
        Object.keys(p).forEach(function(cas){
          var add = (x.g/base)*N(p[cas]);
          if(add>0) acc[cas]=(acc[cas]||0)+add;
        });
      } else if(x.raw.isAllergen) algWarn.push(x.raw.name);
    });
    algRows = Object.keys(acc).sort(function(a,b){return acc[b]-acc[a];}).map(function(cas){
      var def = A26MAP[cas]||[cas,''];
      var v = acc[cas];
      return '<tr><td>'+E(def[0])+'</td><td class="c">'+E(def[1])+'</td><td class="r">'+v.toFixed(4)+'</td><td class="c">'+(v>=0.001?'<span class="ng">표기</span>':'면제')+'</td></tr>';
    }).join('');
  })();

  var body =
    docHead('LOT 추적성 패키지', '제조번호 <b>'+E(batch.lotNo)+'</b> · '+E(product?product.name:'')+' · 출력 '+TODAY())+
    '<h3>1. 요약 (Traceability Summary)</h3>'+
    '<table><tr><th style="width:18%">제조번호</th><td style="width:32%"><b>'+E(batch.lotNo)+'</b></td><th style="width:18%">제품</th><td>'+E(product?product.name:'')+'</td></tr>'+
    '<tr><th>벌크 LOT</th><td>'+E(batch.bulkLotNo)+'</td><th>제조단위</th><td>'+F(batch.qty)+' EA</td></tr>'+
    '<tr><th>배합일 → 충진일</th><td>'+E(bulk?bulk.date:'-')+' → '+E(batch.date)+'</td><th>숙성</th><td>'+E(bulkStock?bulkStock.mfgDate:'-')+' ~ '+E(bulkStock?bulkStock.matureUntil:'-')+'</td></tr>'+
    '<tr><th>출하 이력</th><td colspan="3">'+(sold.length? sold.map(function(s){ var cu=(db.master.M_CUSTOMER||[]).find(function(c){return String(c.customerId)===String(s.customerId);}); return E(s.date)+' '+E(cu?cu.name:'')+' '+F(s.qty)+'EA'; }).join(' / ') : '출하 기록 없음')+'</td></tr></table>'+
    '<h3>2. 사용 원료·자재 LOT 및 성적서(CoA) 확인</h3>'+
    '<table><tr><th style="width:10%">구분</th><th>품목</th><th style="width:20%">LOT</th><th style="width:14%">사용량</th><th style="width:15%">CoA</th></tr>'+
    (matRows||'<tr><td colspan="5" class="c small">배분 기록 없음</td></tr>')+'</table>'+
    '<h3>3. 완제품 검사 (QC)</h3>'+
    '<table><tr><th>검사일</th><th>성상</th><th>향취</th><th>용량</th><th>판정</th><th>검사자</th></tr>'+
    (qcs.map(function(q){ return '<tr><td class="c">'+E(q.date)+'</td><td class="c">'+E(q.visual||'-')+'</td><td class="c">'+E(q.scent||'-')+'</td><td class="c">'+E(q.volume||'-')+'</td><td class="c '+(q.result==='OK'?'ok':'ng')+'">'+E(q.result)+'</td><td class="c">'+E(q.inspector||'')+'</td></tr>'; }).join('')||'<tr><td colspan="6" class="c small">검사기록 없음</td></tr>')+'</table>'+
    '<h3>4. 알레르겐 판정 (EU 26 · leave-on 0.001%)</h3>'+
    '<table><tr><th>성분</th><th style="width:22%">국문 표시명</th><th style="width:16%">완제품 함량(%)</th><th style="width:12%">표기</th></tr>'+
    (algRows||'<tr><td colspan="4" class="c small">검출 없음 또는 프로파일 미등록</td></tr>')+'</table>'+
    (algWarn.length?'<div class="small">⚠ 프로파일 미입력 알레르겐 원료: '+algWarn.map(E).join(', ')+'</div>':'');
  popPrint('추적성 '+batch.lotNo, body);
};

/* ════════ ③ 점검일지 (위생·설비·교육) ════════ */
var CHECK_ITEMS = {
  '위생': ['작업복·위생모 착용','손 세척·소독','작업대·기구 청결','바닥·배수 상태','방충·방서 상태'],
  '설비': ['전자저울 작동·수평','배합조 세척 상태','충진기 작동·세척','여과 필터 상태','저울 교정 확인(연1회)'],
  '교육': []
};
window.openCheckLog = function(kind){
  ensureLog();
  var items = CHECK_ITEMS[kind]||[];
  var form = kind==='교육'
    ? '<input id="cl-edu-name" class="input-field" placeholder="교육명 (예: 화장품 책임판매관리자 법정교육)">'+
      '<div class="grid grid-cols-2 gap-2"><input id="cl-edu-hours" type="number" class="input-field" placeholder="교육시간(h)"><input id="cl-edu-org" class="input-field" placeholder="교육기관"></div>'
    : items.map(function(it,i){
        return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;margin-bottom:4px">'+
          '<span style="font-size:12px;font-weight:700">'+it+'</span>'+
          '<select id="cl-item-'+i+'" class="input-field" style="width:90px"><option>적합</option><option>부적합</option></select></div>';
      }).join('');
  panel('<h3 class="font-bold text-sm text-slate-700">'+(kind==='위생'?'🧼':kind==='설비'?'⚙️':'🎓')+' '+kind+(kind==='교육'?' 이수 기록':'점검 입력')+'</h3>'+
    '<div class="grid grid-cols-2 gap-2">'+
    '<input id="cl-date" type="date" class="input-field" value="'+TODAY()+'">'+
    '<input id="cl-worker" class="input-field" placeholder="'+(kind==='교육'?'이수자':'점검자')+'"></div>'+
    form+
    '<input id="cl-note" class="input-field" placeholder="비고 (부적합 시 조치내용)">'+
    '<div class="grid grid-cols-2 gap-2">'+
    '<button class="btn btn-primary" onclick="saveCheckLog(\''+kind+'\')">기록 저장</button>'+
    '<button class="btn btn-secondary" onclick="printCheckLog(\''+kind+'\')">월별 일지 출력</button></div>'+
    '<div id="cl-recent" style="font-size:10.5px;color:#64748b">'+recentLogs(kind)+'</div>');
};
function recentLogs(kind){
  ensureLog();
  var l = db.txn.T_CHECKLOG.filter(function(x){return x.kind===kind;}).slice(-5).reverse();
  return l.length ? '최근: '+l.map(function(x){ return x.date+'('+(x.worker||'-')+')'; }).join(', ') : '기록 없음 — 첫 기록을 저장하세요.';
}
window.saveCheckLog = function(kind){
  ensureLog();
  var items = {};
  (CHECK_ITEMS[kind]||[]).forEach(function(it,i){ items[it] = $('cl-item-'+i) ? $('cl-item-'+i).value : ''; });
  var rec = {
    id: (typeof generateId==='function') ? generateId('CHK') : 'CHK'+Date.now(),
    kind: kind, date: $('cl-date').value, worker: ($('cl-worker').value||'').trim() || CUR_USER,
    items: items, note: ($('cl-note').value||'').trim()
  };
  if(kind==='교육'){
    rec.eduName = ($('cl-edu-name').value||'').trim();
    rec.eduHours = N($('cl-edu-hours').value);
    rec.eduOrg = ($('cl-edu-org').value||'').trim();
    if(!rec.eduName){ if(typeof toast==='function') toast('교육명을 입력하세요','error'); return; }
  }
  db.txn.T_CHECKLOG.push(rec);
  if(typeof logEvent==='function') logEvent(kind+'점검 기록: '+rec.date+' '+(rec.worker||''));
  if(typeof toast==='function') toast(kind+' 기록 저장 완료','success');
  saveDB();
  var r=$('cl-recent'); if(r) r.textContent = recentLogs(kind).replace(/<[^>]+>/g,'');
};
window.printCheckLog = function(kind){
  ensureLog();
  var ym = ($('cl-date').value||TODAY()).slice(0,7);
  var logs = db.txn.T_CHECKLOG.filter(function(x){ return x.kind===kind && String(x.date||'').indexOf(ym)===0; })
    .sort(function(a,b){ return a.date<b.date?-1:1; });
  var body;
  if(kind==='교육'){
    body = '<table><tr><th>일자</th><th>교육명</th><th style="width:10%">시간</th><th>기관</th><th style="width:14%">이수자</th><th>비고</th></tr>'+
      (logs.map(function(x){ return '<tr><td class="c">'+E(x.date)+'</td><td>'+E(x.eduName||'')+'</td><td class="c">'+E(x.eduHours||'')+'</td><td>'+E(x.eduOrg||'')+'</td><td class="c">'+E(x.worker||'')+'</td><td class="small">'+E(x.note||'')+'</td></tr>'; }).join('')||'<tr><td colspan="6" class="c small">기록 없음</td></tr>')+'</table>'+
      '<div class="small">※ 책임판매관리자 법정교육(연 8시간) 이수 여부를 본 대장으로 관리하세요.</div>';
  } else {
    var items = CHECK_ITEMS[kind];
    body = '<table><tr><th style="width:12%">일자</th>'+items.map(function(it){return '<th>'+it+'</th>';}).join('')+'<th style="width:11%">점검자</th></tr>'+
      (logs.map(function(x){
        return '<tr><td class="c">'+E(x.date)+'</td>'+items.map(function(it){
          var v=(x.items||{})[it]||'-';
          return '<td class="c '+(v==='부적합'?'ng':'')+'">'+E(v==='적합'?'O':v==='부적합'?'X':v)+'</td>';
        }).join('')+'<td class="c">'+E(x.worker||'')+'</td></tr>'+
        (x.note?'<tr><td class="small c">└ 비고</td><td colspan="'+(items.length+1)+'" class="small">'+E(x.note)+'</td></tr>':'');
      }).join('')||'<tr><td colspan="'+(items.length+2)+'" class="c small">기록 없음</td></tr>')+'</table>'+
      '<div class="small">※ O=적합, X=부적합(비고에 조치내용 기재). 제조관리기준서 '+(kind==='설비'?'3항(시설·기구 관리)':'2항(제조공정관리)')+' 근거 기록.</div>';
  }
  popPrint(kind+'일지 '+ym, docHead(kind+(kind==='교육'?' 이수 대장':' 점검일지'), '대상월: '+ym)+body);
};

/* ════════ 라우팅·부트 ════════ */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='doc-center'){ injectUI(); }
};
function boot(){ injectUI(); fetchUser(); ensureLog(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __dcKeep = setInterval(function(){ try{ injectUI(); }catch(e){} }, 3000);
setTimeout(function(){ clearInterval(__dcKeep); }, 90000);
})();

/* ═══════════ 모듈: 오늘 할 일 위젯 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); };
var F = function(v){ return Math.round(N(v)).toLocaleString(); };
var todayStr = function(){ return new Date().toISOString().split('T')[0]; };
function plusDays(d){ var t=new Date(); t.setDate(t.getDate()+d); return t.toISOString().split('T')[0]; }

/* 안전재고용 현재고 합산 (FAIL 제외) */
function stockOf(type, itemId){
  var map = { RAW:['RAW_LOT','rawId'], PACK:['PACK_LOT','packId'], FGT:['FGT_LOT','productId'], BULK:['BULK_LOT','productId'] };
  var m = map[type]; if(!m || !window.db || !db.stock) return 0;
  return (db.stock[m[0]]||[]).filter(function(l){ return String(l[m[1]])===String(itemId) && String(l.status||'OK').toUpperCase()!=='FAIL'; })
    .reduce(function(s,l){ return s+N(l.remaining); },0);
}

function metrics(){
  var t = todayStr(), soon = plusDays(30);
  var qcWait = (db.stock.FGT_LOT||[]).filter(function(l){ return String(l.status||'').toUpperCase()==='HOLD'; }).length;
  var matured = (db.stock.BULK_LOT||[]).filter(function(l){ return String(l.status||'').toUpperCase()==='HOLD' && l.matureUntil && l.matureUntil<=t && N(l.remaining)>0; }).length;
  var safety = (db.master.M_SAFETY_STOCK||[]).filter(function(x){ return stockOf(x.type,x.itemId) < N(x.minQty); }).length;
  var expiring = [].concat(db.stock.RAW_LOT||[], db.stock.PACK_LOT||[]).filter(function(l){
    return N(l.remaining)>0 && String(l.status||'OK').toUpperCase()!=='FAIL' && l.expDate && l.expDate<=soon;
  }).length;
  var woWait = (db.txn.T_WORK_ORDER||[]).filter(function(w){ return (w.status||'대기')==='대기'; }).length;
  var woRun  = (db.txn.T_WORK_ORDER||[]).filter(function(w){ return w.status==='진행중'; }).length;
  var poDue = (db.txn.T_PO||[]).filter(function(p){ return p.status!=='입고완료' && p.dueDate && p.dueDate<=t; }).length;
  var planToday = (db.txn.T_PROD_PLAN||[]).filter(function(p){ return p.date===t && p.status!=='완료'; }).length;
  var lowN = lowStockList().length;
  var lowTh = N((db.meta&&db.meta.lowStockTh)!=null?db.meta.lowStockTh:10)||10;
  return [
    {n:qcWait,   icon:'🧪', label:'QC 대기 완제품', unit:'LOT', page:'qc-prod',      urgent:qcWait>0},
    {n:lowN,     icon:'🔻', label:'품절 임박 완제품 ('+lowTh+'개 미만)', unit:'품목', page:'loc-stock', urgent:lowN>0},
    {n:matured,  icon:'🫙', label:'숙성완료 · 충진 가능', unit:'LOT', page:'t-batch', urgent:false},
    {n:safety,   icon:'📉', label:'안전재고 미달', unit:'품목', page:'safety-stock',  urgent:safety>0},
    {n:expiring, icon:'⏰', label:'유통기한 30일 임박', unit:'LOT', page:'stock',     urgent:expiring>0},
    {n:woWait+woRun, icon:'🔧', label:'작업지시 (대기 '+woWait+' · 진행 '+woRun+')', unit:'건', page:'work-order', urgent:false},
    {n:poDue,    icon:'🚚', label:'입고 예정·지연 발주', unit:'건', page:'purchase-order', urgent:poDue>0},
    {n:planToday,icon:'📋', label:'오늘 생산계획', unit:'건', page:'prod-schedule',  urgent:false}
  ];
}

/* ── 본체 버그 수정: 완제품 분포 차트가 '등록순 앞 5개'만 그리던 것을
     '수량 상위 5개' 정렬로 재구성 (Chart.js 재빌드) ── */
function fixStockChart(){
  try{
    var canvas = $('stockChart');
    if(!canvas || !window.Chart || !window.db) return;
    var agg = {};
    (db.stock.FGT_LOT||[]).forEach(function(l){
      if(String(l.status||'OK').toUpperCase()==='FAIL') return;
      var p = (typeof findProduct==='function') && findProduct(l.productId);
      var k = p ? p.name : String(l.productId);
      agg[k] = (agg[k]||0) + N(l.remaining);
    });
    var top = Object.keys(agg).sort(function(a,b){ return agg[b]-agg[a]; }).slice(0,5);
    var prev = (Chart.getChart && Chart.getChart(canvas)) || null;
    if(prev) prev.destroy();
    new Chart(canvas.getContext('2d'), {
      type:'bar',
      data:{ labels: top, datasets:[{ label:'재고수량', data: top.map(function(k){return agg[k];}), backgroundColor:'#0f766e' }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
    });
  }catch(e){}
}

function invSnapshot(){
  var sum = function(arr, fn){ return (arr||[]).reduce(function(s,l){ return String(l.status||'OK').toUpperCase()==='FAIL'?s:s+fn(l); },0); };
  var q = function(l){ return N(l.remaining); };
  var v = function(l){ return N(l.remaining)*N(l.unitCost); };
  var FL={'공장':0,'물류센터':0,'매장':0}, FV={'공장':0,'물류센터':0,'매장':0};
  (db.stock.FGT_LOT||[]).forEach(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return;
    var lc=l.location||'공장'; if(FL[lc]==null){FL[lc]=0;FV[lc]=0;}
    FL[lc]+=q(l); FV[lc]+=v(l);
  });
  return [
    {icon:'🧪', label:'원료',   qty: sum(db.stock.RAW_LOT,q).toLocaleString()+' g',  val: sum(db.stock.RAW_LOT,v),  page:'stock'},
    (function(){
      var pw=0, pi=0, pv=0;
      (db.stock.PACK_LOT||[]).forEach(function(l){ if(String(l.status||'OK').toUpperCase()==='FAIL') return; if((l.location||'공장')!=='공장') pi+=N(l.remaining); else pw+=N(l.remaining); pv+=N(l.remaining)*N(l.unitCost); });
      return {icon:'🧰', label:'부자재'+(pi>0?' (공장 '+pw.toLocaleString()+' · 외부 '+pi.toLocaleString()+')':''), qty:(pw+pi).toLocaleString()+' EA', val:pv, page:'master-pack'};
    })(),
    {icon:'🫙', label:'벌크',   qty: sum(db.stock.BULK_LOT,q).toLocaleString()+' EA분', val: sum(db.stock.BULK_LOT,v), page:'stock'},
    {icon:'🏭', label:'완제품·공장', qty: FL['공장'].toLocaleString()+' EA', val: FV['공장'], page:'loc-stock'},
    {icon:'📦', label:'완제품·물류센터', qty: FL['물류센터'].toLocaleString()+' EA', val: FV['물류센터'], page:'loc-stock'},
    {icon:'🏬', label:'완제품·매장', qty: FL['매장'].toLocaleString()+' EA', val: FV['매장'], page:'loc-stock'}
  ];
}

/* 완제품 품절 임박 (기본 10개 미만, 위치 합계 기준) */
function lowStockList(){
  var th = N((db.meta&&db.meta.lowStockTh)!=null ? db.meta.lowStockTh : 10) || 10;
  var agg={};
  (db.stock.FGT_LOT||[]).forEach(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return;
    var k=l.productId;
    if(!agg[k]) agg[k]={wh:0,st:0};
    if((l.location||'공장')!=='공장') agg[k].st+=N(l.remaining); else agg[k].wh+=N(l.remaining);
  });
  /* 마스터에 있으나 재고 0인 제품도 포함 */
  (db.master.M_PRODUCT||[]).forEach(function(p){ if(!agg[p.productId]) agg[p.productId]={wh:0,st:0}; });
  return Object.keys(agg).map(function(id){
    var p=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(id); });
    var a=agg[id];
    return { pid:id, name:p?p.name:String(id), wh:a.wh, st:a.st, tot:a.wh+a.st };
  }).filter(function(x){ return x.tot < th; })
    .sort(function(a,b){ return a.tot-b.tot; });
}
window.setLowTh=function(v){
  if(!window.db) return;
  db.meta=db.meta||{};
  db.meta.lowStockTh=N(v)||10;
  saveDB();
  render();
};

function render(){
  var host = $('page-dashboard');
  if(!host || !window.db) return;
  var box = $('nose-todo-widget');
  if(!box){
    box = document.createElement('div');
    box.id = 'nose-todo-widget';
    box.style.cssText = 'margin-bottom:14px';
    host.insertBefore(box, host.firstChild);
  }
  var ms = metrics();
  var total = ms.reduce(function(s,m){ return s+(m.urgent?m.n:0); },0);
  box.innerHTML =
    '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">'+
      '<span style="font-size:14px;font-weight:900;color:#0f172a">☀️ 오늘 할 일</span>'+
      '<span style="font-size:10.5px;font-weight:700;color:'+(total>0?'#c2410c':'#059669')+'">'+
        (total>0 ? '긴급 처리 '+total+'건' : '긴급 사항 없음 — 좋은 아침입니다, 주인님')+'</span>'+
      '<span style="font-size:9.5px;color:#94a3b8;margin-left:auto">'+todayStr()+' · 실시간</span>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">'+
    ms.map(function(m){
      var zero = m.n===0;
      var col = m.urgent ? '#c2410c' : zero ? '#94a3b8' : '#0f766e';
      var bg  = m.urgent ? '#fff7ed' : '#ffffff';
      var bd  = m.urgent ? '#fdba74' : '#e2e8f0';
      return '<div onclick="goPage(\''+m.page+'\')" style="cursor:pointer;background:'+bg+';border:1.5px solid '+bd+';border-radius:12px;padding:10px 12px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between">'+
          '<span style="font-size:16px">'+m.icon+'</span>'+
          '<span style="font-size:20px;font-weight:900;color:'+col+'">'+m.n+'<span style="font-size:10px;font-weight:700;color:#94a3b8"> '+m.unit+'</span></span>'+
        '</div>'+
        '<div style="font-size:10.5px;font-weight:800;color:#334155;margin-top:3px;line-height:1.35">'+m.label+'</div>'+
      '</div>';
    }).join('')+'</div>'+
    (function(){
      var lows=lowStockList();
      var th=N((db.meta&&db.meta.lowStockTh)!=null?db.meta.lowStockTh:10)||10;
      var head='<div style="display:flex;align-items:center;gap:8px;margin:12px 0 6px;flex-wrap:wrap">'+
        '<span style="font-size:12px;font-weight:900;color:#0f172a">🔻 품절 임박 완제품</span>'+
        '<span style="font-size:9.5px;color:#94a3b8;font-weight:700">합계 기준 미만</span>'+
        '<input type="number" min="1" value="'+th+'" onchange="setLowTh(this.value)" style="width:58px;padding:2px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;text-align:right">'+
        '<span style="font-size:10px;color:#64748b;font-weight:700">개</span></div>';
      if(!lows.length) return head+'<div style="font-size:11px;color:#059669;font-weight:700;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px">전 품목 재고 여유 — 품절 임박 없음</div>';
      return head+'<div style="background:#fff;border:1.5px solid #fdba74;border-radius:12px;overflow:hidden">'+
        '<table style="width:100%;font-size:11px"><tr style="background:#fff7ed"><th style="text-align:left;padding:5px 10px">제품</th><th style="width:20%">🏭 공장</th><th style="width:20%">🏬 외부(물류·매장)</th><th style="width:18%">합계</th></tr>'+
        lows.map(function(x){
          var c = x.tot===0?'#dc2626':'#c2410c';
          return '<tr style="border-top:1px solid #f1f5f9;cursor:pointer" onclick="goPage(\'quick-log\')"><td style="padding:4px 10px;font-weight:700">'+E(x.name)+(x.tot===0?' <span style="font-size:9px;color:#dc2626;font-weight:900">품절</span>':'')+'</td>'+
            '<td style="text-align:right;padding-right:10px">'+F(x.wh)+'</td>'+
            '<td style="text-align:right;padding-right:10px">'+F(x.st)+'</td>'+
            '<td style="text-align:right;padding-right:10px;font-weight:900;color:'+c+'">'+F(x.tot)+'</td></tr>';
        }).join('')+'</table></div>'+
        '<div style="font-size:9.5px;color:#94a3b8;margin-top:3px">행을 누르면 간편 기록(생산 입력)으로 이동합니다.</div>';
    })()+
    '<div style="font-size:12px;font-weight:900;color:#0f172a;margin:12px 0 6px">📦 재고 스냅샷 <span style="font-size:9.5px;font-weight:700;color:#94a3b8">원료 · 부자재 · 벌크 · 완제품(위치별)</span></div>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">'+
    invSnapshot().map(function(s){
      return '<div onclick="goPage(\''+s.page+'\')" style="cursor:pointer;background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:10px 12px">'+
        '<div style="display:flex;align-items:center;justify-content:space-between">'+
          '<span style="font-size:15px">'+s.icon+'</span>'+
          '<span style="font-size:14px;font-weight:900;color:#0f172a">'+s.qty+'</span>'+
        '</div>'+
        '<div style="font-size:10.5px;font-weight:800;color:#334155;margin-top:2px">'+s.label+'</div>'+
        '<div style="font-size:9.5px;color:'+(s.val>0?'#0f766e':'#cbd5e1')+';font-weight:700">'+(s.val>0?'₩'+Math.round(s.val).toLocaleString():'원가 미입력')+'</div>'+
      '</div>';
    }).join('')+'</div>';
}

/* 대시보드 진입 시마다 + 데이터 저장 시마다 갱신 */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='dashboard'){ render(); setTimeout(fixStockChart, 350); }
};
/* saveDB 후 자동 갱신 (대시보드가 열려 있을 때) */
setTimeout(function(){
  if(typeof window.saveDB==='function' && !window.saveDB.__todoWrap){
    var _s = window.saveDB;
    window.saveDB = function(){
      var r = _s.apply(this, arguments);
      try{ if($('page-dashboard') && $('page-dashboard').classList.contains('active')){ render(); setTimeout(fixStockChart, 250); } }catch(e){}
      return r;
    };
    window.saveDB.__todoWrap = true;
  }
}, 1200);

function boot(){ render(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __todoKeep = setInterval(render, 3000);
setTimeout(function(){ clearInterval(__todoKeep); }, 90000);
/* 이후에는 1분 주기로 가볍게 갱신 (날짜·임박 상태 반영) */
setInterval(function(){ try{ if($('page-dashboard') && $('page-dashboard').classList.contains('active')) render(); }catch(e){} }, 60000);
})();

/* ═══════════ 모듈: 위치 재고(창고·인사동) 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var LOCS = ['공장','물류센터','매장'];
/* 기존 데이터 이관: 창고→공장, 인사동→매장 (1회) */
window.migrateLoc=function(){
  if(!window.db||!db.stock) return;
  var map={'창고':'공장','인사동':'매장'};
  ['FGT_LOT','PACK_LOT'].forEach(function(k){ (db.stock[k]||[]).forEach(function(l){
    if(map[l.location]) l.location=map[l.location];
    else if(!l.location) l.location='공장';   /* 위치 미지정 LOT도 공장으로 명시 */
  }); });
  ((db.txn||{}).T_STOCK_MOVE||[]).forEach(function(m){ if(map[m.from]) m.from=map[m.from]; if(map[m.to]) m.to=map[m.to]; });
};
var locOf = function(l){ return l.location || '공장'; };
var TODAY = function(){ return new Date().toISOString().split('T')[0]; };
function ensure(){ if(window.db){ db.txn = db.txn||{}; db.txn.T_STOCK_MOVE = db.txn.T_STOCK_MOVE||[]; } }
function genId(p){ return (typeof generateId==='function') ? generateId(p) : p+'-'+Date.now()+Math.floor(Math.random()*999); }

/* ════════ 페이지 주입 ════════ */
function injectUI(){
  if($('page-loc-stock')) return;
  var anchor = $('page-safety-stock') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-loc-stock'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">🏬 위치 재고 (공장 · 물류센터 · 매장)</h2>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:600">완제품 재고를 위치별로 관리합니다. 이관은 QC 적합(OK) LOT만 가능합니다.</div>'+
    '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">완제품 위치별 재고</h3>'+
      '<span style="font-size:10px;color:#94a3b8;font-weight:700;margin-left:auto">부자재·원료 재고는 각 마스터 화면에서 관리</span></div>'+
      '<div class="scroll-card"><table><thead><tr><th class="pl-3">제품</th><th class="text-right">🏭 공장</th><th class="text-right">📦 물류센터</th><th class="text-right">🏬 매장</th><th class="text-right pr-3">합계</th></tr></thead>'+
      '<tbody id="loc-matrix"></tbody></table></div></div>'+
    '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">'+
      '<div class="card p-4 space-y-2">'+
        '<h3 class="font-bold text-slate-700 text-sm">🔄 재고 이관</h3>'+
        '<div class="grid grid-cols-2 gap-2">'+
          '<select id="mv-type" class="input-field"><option value="FGT">완제품</option><option value="PACK">부자재</option></select>'+
          '<select id="mv-from" class="input-field">'+LOCS.map(function(x){return '<option>'+x+'</option>';}).join('')+'</select>'+'<select id="mv-to" class="input-field">'+LOCS.map(function(x,i){return '<option'+(i===1?' selected':'')+'>'+x+'</option>';}).join('')+'</select>'+
        '</div>'+
        '<select id="mv-lot" class="input-field"></select>'+
        '<div class="grid grid-cols-2 gap-2">'+
          '<input id="mv-qty" type="number" min="1" class="input-field text-right" placeholder="이관 수량">'+
          '<input id="mv-date" type="date" class="input-field" value="'+TODAY()+'">'+
        '</div>'+
        '<input id="mv-note" class="input-field" placeholder="비고 (예: 위탁 납품 7월분)">'+
        '<button class="btn btn-primary w-full" onclick="doStockMove()">이관 실행</button>'+
      '</div>'+
      '<div class="card p-4 space-y-2">'+
        '<h3 class="font-bold text-slate-700 text-sm">✍️ 수기 기초재고 등록</h3>'+
        '<div style="font-size:10px;color:#64748b">이미 각 위치에 나가 있는 기존 재고를 생산이력 없이 등록합니다. (최초 정리용)</div>'+
        '<select id="init-prod" class="input-field"></select>'+
        '<div class="grid grid-cols-2 gap-2">'+
          '<select id="init-loc" class="input-field">'+LOCS.map(function(x){return '<option>'+x+'</option>';}).join('')+'</select>'+
          '<input id="init-qty" type="number" min="1" class="input-field text-right" placeholder="수량(EA)">'+
        '</div>'+
        '<div class="grid grid-cols-2 gap-2">'+
          '<input id="init-lot" class="input-field" placeholder="LOT번호 (모르면 비움)">'+
          '<input id="init-cost" type="number" class="input-field text-right" placeholder="원가/EA (선택)">'+
        '</div>'+
        '<button class="btn btn-secondary w-full" onclick="saveInitStock()">기초재고 등록</button>'+
      '</div>'+
    '</div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #7fb8a4">'+
      '<h3 class="font-bold text-slate-700 text-sm">📋 일괄 기초재고 등록 (엑셀·실사표 붙여넣기)</h3>'+
      '<div style="font-size:10px;color:#64748b">엑셀에서 "제품명 + 수량" 열을 복사해 붙여넣으세요. 제품 마스터와 자동 매칭됩니다. (예: 시프트아이_더그레잇 30ml → The Great 30ml)</div>'+
      '<div class="grid grid-cols-3 gap-2">'+
        '<select id="bulk-init-type" class="input-field"><option value="FGT">완제품</option><option value="RAW">원료</option><option value="PACK">포장재(부자재)</option></select>'+
        '<select id="bulk-init-loc" class="input-field">'+LOCS.map(function(x){return '<option>'+x+'</option>';}).join('')+'</select>'+
        '<button class="btn btn-primary" onclick="parseBulkInit()">해석 → 미리보기</button>'+
      '</div>'+
      '<div style="font-size:9.5px;color:#94a3b8">원료는 재고 기준단위(g) 수량으로, 포장재는 EA로 입력하세요. 형식: 품명 [탭] 수량 [탭] 원가(선택)</div>'+
      '<textarea id="bulk-init-paste" class="input-field" rows="5" placeholder="시프트아이_더그레잇 30ml	5"></textarea>'+
      '<div id="bulk-init-preview"></div>'+
    '</div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #0f766e">'+
      '<h3 class="font-bold text-slate-700 text-sm">📋 순환 실사 (사이클 카운트)</h3>'+
      '<div style="font-size:10px;color:#64748b">장부 수량 옆에 실물 수량을 입력하면 차이를 자동 계산하고, 승인 시 재고가 조정되며 실사 기록서가 남습니다. 월 1회 권장.</div>'+
      '<div class="grid grid-cols-3 gap-2">'+
        '<select id="sc-type" class="input-field"><option value="FGT">완제품</option><option value="PACK">부자재</option><option value="RAW">원료</option></select>'+
        '<select id="sc-loc" class="input-field"><option>창고</option><option>인사동</option></select>'+
        '<button class="btn btn-primary" onclick="startStockCount()">실사 시작</button>'+
      '</div>'+
      '<div id="sc-panel"></div>'+
      '<div id="sc-history" style="font-size:10.5px;color:#64748b"></div>'+
    '</div>'+
    '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">이동 이력</h3><span class="badge-soft" id="mv-count">0</span></div>'+
      '<div class="scroll-card"><table><thead><tr><th class="pl-3">일자</th><th>LOT</th><th>제품</th><th class="text-right">수량</th><th>이동</th><th>비고</th></tr></thead>'+
      '<tbody id="mv-history"></tbody></table></div></div>'+
    '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">🛠 LOT 관리 (수정 · 삭제)</h3>'+
      '<select id="lm-type" class="input-field" style="width:130px;padding:3px 8px"><option value="RAW_LOT">원료</option><option value="PACK_LOT">포장재</option><option value="BULK_LOT">벌크</option><option value="FGT_LOT" selected>완제품</option></select></div>'+
      '<div class="scroll-card"><table><thead><tr><th class="pl-3">LOT</th><th>품목</th><th class="text-right">잔량</th><th>상태</th><th>위치/기한</th><th class="text-right pr-3">관리</th></tr></thead>'+
      '<tbody id="lm-list"></tbody></table></div></div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #93c5fd;background:#f8fbff">'+
      '<h3 class="font-bold text-slate-700 text-sm">📋 피킹 리스트 (출고 준비 작업지시)</h3>'+
      '<div style="font-size:10px;color:#64748b">보낼 품목·수량을 적으면 어느 LOT에서 몇 개를 꺼낼지(FIFO) 자동 계산합니다. 인쇄해서 들고 다니거나 폰으로 체크하세요.</div>'+
      '<div class="grid grid-cols-2 gap-2">'+
        '<select id="pk-dest" class="input-field"><option value="매장">매장 보충 (확정 시 자동 이관)</option><option value="물류센터">물류센터 보충 (확정 시 자동 이관)</option><option value="고객">고객 출고 (리스트만 발행)</option></select>'+
        '<input id="pk-note" class="input-field" placeholder="비고 (예: 7월 2차 보충)">'+
      '</div>'+
      '<div class="grid grid-cols-2 gap-2">'+
        '<select id="pk-type" class="input-field"><option value="FGT">완제품</option><option value="PACK">부자재</option></select>'+
        '<select id="pk-item" class="input-field"></select>'+
      '</div>'+
      '<div class="grid grid-cols-2 gap-2">'+
        '<input id="pk-qty" type="number" min="1" class="input-field text-right" placeholder="필요 수량">'+
        '<button class="btn btn-secondary" onclick="addPickLine()">＋ 리스트에 추가</button>'+
      '</div>'+
      '<div id="pk-lines"></div>'+
    '</div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #94b8ae;background:#f7fbfa">'+
      '<h3 class="font-bold text-slate-700 text-sm">🔢 순환 실사 (사이클 카운트)</h3>'+
      '<div style="font-size:10px;color:#64748b">실물을 세서 입력하면 장부와의 차이를 자동 계산하고, 확정 시 재고를 조정합니다. 매월 말 10분 루틴을 추천합니다.</div>'+
      '<div class="grid grid-cols-3 gap-2">'+
        '<select id="st-type" class="input-field"><option value="FGT">완제품</option><option value="PACK">부자재</option><option value="RAW">원료</option></select>'+
        '<select id="st-loc" class="input-field">'+LOCS.map(function(x){return '<option>'+x+'</option>';}).join('')+'</select>'+
        '<button class="btn btn-primary" onclick="startStocktake()">실사 시트 열기</button>'+
      '</div>'+
      '<div id="st-sheet"></div>'+
      '<div id="st-history" style="font-size:10.5px;color:#64748b"></div>'+
    '</div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #fca5a5;background:#fff7f7">'+
      '<h3 class="font-bold text-sm" style="color:#b91c1c">⚠️ 전체 초기화 (새 출발)</h3>'+
      '<div style="font-size:10.5px;color:#7f1d1d">기존 재고를 전부 지우고 실사 수량으로 새로 시작할 때 사용합니다. 실행 전 <b>백업 파일이 자동 다운로드</b>됩니다.</div>'+
      '<label style="font-size:11px;font-weight:700;display:block"><input type="checkbox" id="wipe-txn"> 재고 이력도 삭제 (입고·배합·충진·이관 기록)</label>'+
      '<label style="font-size:11px;font-weight:700;display:block"><input type="checkbox" id="wipe-sale"> 판매(출고) 기록도 삭제 — 매출·명세서 이력이 사라집니다</label>'+
      '<button class="btn w-full" style="background:#dc2626;color:#fff;font-weight:800" onclick="wipeAllStock()">모든 재고 LOT 삭제 후 새로 시작</button>'+
    '</div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var nav = $('nav-safety-stock');
  if(nav && !$('nav-loc-stock')){
    var n = document.createElement('div');
    n.id='nav-loc-stock'; n.className='nav-item'; n.setAttribute('onclick',"goPage('loc-stock')");
    n.innerHTML='<i data-lucide="store" class="w-4 h-4 shrink-0"></i> 🏬 위치 재고';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
  var dir = $('mv-dir'); if(dir) dir.onchange = fillMoveLots;
  var mvt = $('mv-type'); if(mvt) mvt.onchange = fillMoveLots;
  var mvf = $('mv-from'); if(mvf) mvf.onchange = fillMoveLots;
  var pkt = $('pk-type'); if(pkt) pkt.onchange = pkFillItems;
  var lm = $('lm-type'); if(lm) lm.onchange = renderLotManager;
}

/* ════════ 렌더 ════════ */
window.renderLocPage=function(){
  ensure(); try{ migrateLoc(); }catch(e){}
  var mx = $('loc-matrix'); if(!mx) return;
  function buildRows(stockKey, idk, master, label, badge){
    var agg = {};
    (db.stock[stockKey]||[]).forEach(function(l){
      if(String(l.status||'OK').toUpperCase()==='FAIL' || N(l.remaining)<=0) return;
      var k = l[idk];
      if(!agg[k]) agg[k] = {'공장':0,'물류센터':0,'매장':0};
      agg[k][locOf(l)] = (agg[k][locOf(l)]||0) + N(l.remaining);
    });
    var keys = Object.keys(agg);
    if(!keys.length) return '';
    var head = '<tr><td colspan="5" style="background:#f1f5f9;font-size:10.5px;font-weight:900;color:#475569;padding:4px 12px">'+badge+' '+label+'</td></tr>';
    return head + keys.map(function(id){
      var m = master.find(function(x){ return String(x[idk])===String(isNaN(Number(id))?id:Number(id)) || String(x[idk])===String(id); });
      var a = agg[id], tot = N(a['공장'])+N(a['물류센터'])+N(a['매장']);
      return '<tr><td class="pl-3 text-xs font-bold">'+E(m?m.name:id)+'</td>'+
        '<td class="text-right text-xs">'+N(a['공장']).toLocaleString()+'</td>'+
        '<td class="text-right text-xs" style="color:#3d6f91;font-weight:800">'+N(a['물류센터']).toLocaleString()+'</td>'+
        '<td class="text-right text-xs" style="color:#0f766e;font-weight:800">'+N(a['매장']).toLocaleString()+'</td>'+
        '<td class="text-right pr-3 text-xs font-bold">'+tot.toLocaleString()+'</td></tr>';
    }).join('');
  }
  var rows = buildRows('FGT_LOT','productId', db.master.M_PRODUCT||[], '완제품','🏭');
  mx.innerHTML = rows || '<tr><td colspan="5" class="text-center py-4 text-slate-400">완제품 재고 없음</td></tr>';

  fillMoveLots();
  try{ pkFillItems(); }catch(e){}
  var ps = $('init-prod');
  if(ps) ps.innerHTML = '<option value="">제품 선택</option>' + (db.master.M_PRODUCT||[]).map(function(p){
    return '<option value="'+E(p.productId)+'">'+E(p.name)+'</option>';
  }).join('');

  var hist = db.txn.T_STOCK_MOVE.slice().reverse().slice(0,30);
  var mc = $('mv-count'); if(mc) mc.textContent = db.txn.T_STOCK_MOVE.length;
  var hv = $('mv-history');
  if(hv) hv.innerHTML = hist.map(function(m){
    var p = (typeof findProduct==='function') && findProduct(m.productId);
    return '<tr><td class="pl-3 text-xs">'+E(m.date)+'</td><td class="mono text-xs">'+E(m.lotNo)+'</td>'+
      '<td class="text-xs">'+E(p?p.name:'')+'</td><td class="text-right text-xs font-bold">'+N(m.qty).toLocaleString()+'</td>'+
      '<td class="text-xs">'+E(m.from)+' → <b>'+E(m.to)+'</b></td><td class="text-xs" style="color:#64748b">'+E(m.note||'')+'</td></tr>';
  }).join('') || '<tr><td colspan="6" class="text-center py-4 text-slate-400">이동 이력 없음</td></tr>';
};
function fillMoveLots(){
  var el = $('mv-lot'); if(!el) return;
  var type = (($('mv-type')||{}).value)||'FGT';
  var stockKey = type==='PACK' ? 'PACK_LOT' : 'FGT_LOT';
  var from = (($('mv-from')||{}).value)||'공장';
  el.innerHTML = '<option value="">이관할 LOT 선택 ('+from+' '+(type==='PACK'?'부자재':'완제품')+')</option>' +
    (db.stock[stockKey]||[]).filter(function(l){
      return locOf(l)===from && N(l.remaining)>0 && String(l.status||'OK').toUpperCase()==='OK';
    }).map(function(l){
      var nm = type==='PACK'
        ? ((db.master.M_PACK||[]).find(function(x){return x.packId===l.packId;})||{}).name
        : ((typeof findProduct==='function') && findProduct(l.productId)||{}).name;
      return '<option value="'+E(l.id)+'">['+E(l.lotNo)+'] '+E(nm||'')+' / 잔량 '+E(l.remaining)+'</option>';
    }).join('');
}

/* ════════ 이관 실행 (완제품·부자재 공용) ════════ */
window.doStockMove = function(){
  ensure();
  var type = (($('mv-type')||{}).value)||'FGT';
  var stockKey = type==='PACK' ? 'PACK_LOT' : 'FGT_LOT';
  var idk = type==='PACK' ? 'packId' : 'productId';
  var from = $('mv-from').value, to = $('mv-to').value;
  if(from===to){ if(typeof toast==='function') toast('출발지와 도착지가 같습니다','error'); return; }
  var src = (db.stock[stockKey]||[]).find(function(l){ return String(l.id)===String($('mv-lot').value); });
  var qty = N($('mv-qty').value);
  if(!src){ if(typeof toast==='function') toast('LOT를 선택하세요','error'); return; }
  if(qty<=0){ if(typeof toast==='function') toast('수량을 입력하세요','error'); return; }
  if(String(src.status||'OK').toUpperCase()!=='OK'){ if(typeof toast==='function') toast('QC 적합(OK) LOT만 이관할 수 있습니다','error'); return; }
  if(qty > N(src.remaining)){ if(typeof toast==='function') toast('잔량 부족: 현재 '+src.remaining,'error'); return; }
  src.remaining = N(src.remaining) - qty;
  var dest = (db.stock[stockKey]||[]).find(function(l){
    return l.lotNo===src.lotNo && String(l[idk])===String(src[idk]) && locOf(l)===to;
  });
  if(dest){ dest.remaining = N(dest.remaining) + qty; dest.qty = N(dest.qty) + qty; }
  else {
    var nl = { id: genId(type), lotNo: src.lotNo, qty: qty, remaining: qty, unitCost: src.unitCost, expDate: src.expDate, status: 'OK', location: to, note: '이관('+from+'→'+to+')' };
    nl[idk] = src[idk];
    db.stock[stockKey].push(nl);
  }
  var rec = { id: genId('MV'), date: $('mv-date').value||TODAY(), lotNo: src.lotNo, productId: type==='PACK'?null:src.productId,
    qty: qty, from: from, to: to, note: (type==='PACK'?'[부자재] ':'')+(($('mv-note').value||'').trim()) };
  db.txn.T_STOCK_MOVE.push(rec);
  if(typeof logEvent==='function') logEvent('재고이관('+(type==='PACK'?'부자재':'완제품')+'): '+src.lotNo+' '+qty+' '+from+'→'+to);
  if(typeof toast==='function') toast(qty+' 이관 완료 ('+from+' → '+to+')','success');
  $('mv-qty').value=''; $('mv-note').value='';
  saveDB(); renderLocPage();
};

/* ════════ 수기 기초재고 ════════ */
window.saveInitStock = function(){
  ensure();
  var pid = $('init-prod').value, qty = N($('init-qty').value), loc = $('init-loc').value;
  if(!pid){ if(typeof toast==='function') toast('제품을 선택하세요','error'); return; }
  if(qty<=0){ if(typeof toast==='function') toast('수량을 입력하세요','error'); return; }
  var lotNo = ($('init-lot').value||'').trim() || ('INIT-'+TODAY().replace(/-/g,'').slice(2)+'-'+Math.floor(Math.random()*90+10));
  db.stock.FGT_LOT.push({
    id: genId('FGT'), lotNo: lotNo, productId: isNaN(Number(pid))?pid:Number(pid),
    qty: qty, remaining: qty, unitCost: N($('init-cost').value)||0,
    status: 'OK', location: loc, note: '수기 기초재고 등록'
  });
  db.txn.T_STOCK_MOVE.push({ id: genId('MV'), date: TODAY(), lotNo: lotNo, productId: isNaN(Number(pid))?pid:Number(pid),
    qty: qty, from: '(기초등록)', to: loc, note: '수기 기초재고' });
  if(typeof logEvent==='function') logEvent('기초재고 등록: '+lotNo+' '+qty+'EA @'+loc);
  if(typeof toast==='function') toast('기초재고 등록 완료: '+lotNo+' ('+loc+')','success');
  $('init-qty').value=''; $('init-lot').value=''; $('init-cost').value='';
  saveDB(); renderLocPage();
};

/* ════════ LOT 관리: 목록·수정·삭제 ════════ */
function lotName(key, l){
  if(key==='RAW_LOT'){ var r=(db.master.M_RAW||[]).find(function(x){return x.rawId===l.rawId;}); return r?r.name:l.rawId; }
  if(key==='PACK_LOT'){ var p=(db.master.M_PACK||[]).find(function(x){return x.packId===l.packId;}); return p?p.name:l.packId; }
  var pr=(db.master.M_PRODUCT||[]).find(function(x){return x.productId===l.productId;}); return pr?pr.name:l.productId;
}
window.renderLotManager = function(){
  var tb = $('lm-list'); if(!tb) return;
  var key = ($('lm-type')||{}).value || 'FGT_LOT';
  var arr = (db.stock[key]||[]);
  tb.innerHTML = arr.slice().reverse().map(function(l){
    var st = String(l.status||'OK').toUpperCase();
    var stC = st==='OK'?'#059669':st==='FAIL'?'#dc2626':'#d97706';
    var extra = key==='FGT_LOT' ? (l.location||'공장') : (l.expDate||l.matureUntil||'-');
    return '<tr><td class="pl-3 mono text-xs">'+E(l.lotNo)+'</td><td class="text-xs">'+E(lotName(key,l))+'</td>'+
      '<td class="text-right text-xs font-bold">'+N(l.remaining).toLocaleString()+'</td>'+
      '<td class="text-xs" style="color:'+stC+';font-weight:800">'+E(st)+'</td>'+
      '<td class="text-xs">'+E(extra)+'</td>'+
      '<td class="text-right pr-3" style="white-space:nowrap">'+
        '<button class="btn btn-secondary btn-sm" onclick="openLotEdit(\''+key+'\',\''+E(l.id)+'\')">수정</button> '+
        '<button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;font-weight:800" onclick="deleteLot(\''+key+'\',\''+E(l.id)+'\')">삭제</button>'+
      '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="text-center py-4 text-slate-400">LOT 없음</td></tr>';
};
window.openLotEdit = function(key, id){
  var l = (db.stock[key]||[]).find(function(x){ return String(x.id)===String(id); });
  if(!l) return;
  var isFgt = key==='FGT_LOT' || key==='PACK_LOT';
  var bg = document.createElement('div');
  bg.id='lot-edit-modal';
  bg.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:960;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML =
    '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:20px" onclick="event.stopPropagation()">'+
      '<div style="font-weight:900;font-size:14px;color:#0f172a;margin-bottom:2px">LOT 수정</div>'+
      '<div style="font-size:11px;color:#64748b;margin-bottom:12px">'+E(lotName(key,l))+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<div style="grid-column:1/3"><label style="font-size:10px;font-weight:800;color:#64748b">LOT 번호</label><input id="le-lotno" class="input-field" value="'+E(l.lotNo||'')+'"></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">잔량</label><input id="le-rem" type="number" step="0.01" class="input-field text-right" value="'+N(l.remaining)+'"></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">단가</label><input id="le-cost" type="number" step="0.01" class="input-field text-right" value="'+N(l.unitCost)+'"></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">상태</label><select id="le-status" class="input-field"><option'+(String(l.status||'OK').toUpperCase()==='OK'?' selected':'')+'>OK</option><option'+(String(l.status).toUpperCase()==='HOLD'?' selected':'')+'>HOLD</option><option'+(String(l.status).toUpperCase()==='FAIL'?' selected':'')+'>FAIL</option></select></div>'+
        (isFgt
          ? '<div><label style="font-size:10px;font-weight:800;color:#64748b">위치</label><select id="le-loc" class="input-field">'+LOCS.map(function(x){return '<option'+((l.location||'공장')===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select></div>'
          : '<div><label style="font-size:10px;font-weight:800;color:#64748b">'+(key==='BULK_LOT'?'숙성완료일':'유통기한')+'</label><input id="le-exp" type="date" class="input-field" value="'+E(l.expDate||l.matureUntil||'')+'"></div>')+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:14px">'+
        '<button class="btn btn-primary flex-1" onclick="saveLotEdit(\''+key+'\',\''+E(l.id)+'\')">저장</button>'+
        '<button class="btn btn-secondary" onclick="document.getElementById(\'lot-edit-modal\').remove()">취소</button>'+
      '</div>'+
    '</div>';
  bg.onclick=function(){ bg.remove(); };
  document.body.appendChild(bg);
};
window.saveLotEdit = function(key, id){
  var l = (db.stock[key]||[]).find(function(x){ return String(x.id)===String(id); });
  if(!l) return;
  var before = l.lotNo+'/'+l.remaining+'/'+(l.status||'OK');
  l.lotNo = ($('le-lotno').value||'').trim() || l.lotNo;
  l.remaining = N($('le-rem').value);
  if(N(l.qty) < l.remaining) l.qty = l.remaining;
  l.unitCost = N($('le-cost').value);
  l.status = $('le-status').value;
  if($('le-loc')) l.location = $('le-loc').value;
  if($('le-exp')){ if(key==='BULK_LOT') l.matureUntil = $('le-exp').value; else l.expDate = $('le-exp').value; }
  if(typeof logEvent==='function') logEvent('LOT 수정('+key+'): '+before+' → '+l.lotNo+'/'+l.remaining+'/'+l.status);
  if(typeof toast==='function') toast('LOT 수정 완료','success');
  var m=$('lot-edit-modal'); if(m) m.remove();
  saveDB(); renderLotManager(); renderLocPage();
};
window.deleteLot = function(key, id){
  var arr = db.stock[key]||[];
  var i = arr.findIndex(function(x){ return String(x.id)===String(id); });
  if(i<0) return;
  var l = arr[i];
  if(!window.confirm('['+l.lotNo+'] 잔량 '+N(l.remaining)+' — 이 LOT를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.')) return;
  arr.splice(i,1);
  if(typeof logEvent==='function') logEvent('LOT 삭제('+key+'): '+l.lotNo+' 잔량 '+N(l.remaining));
  if(typeof toast==='function') toast('삭제 완료: '+l.lotNo,'success');
  saveDB(); renderLotManager(); renderLocPage();
};

/* ════════ 전체 초기화 (백업 → 2중 확인 → 삭제) ════════ */
function downloadBackup(){
  try{
    var data = JSON.stringify(db, null, 1);
    var blob = new Blob([data], {type:'application/json'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'erp-backup-' + new Date().toISOString().replace(/[:.]/g,'-').slice(0,19) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  }catch(e){ return false; }
}
window.wipeAllStock = function(){
  ensure();
  var cnt = ['RAW_LOT','PACK_LOT','BULK_LOT','FGT_LOT'].reduce(function(s,k){ return s+(db.stock[k]||[]).length; },0);
  if(!window.confirm('⚠️ 재고 LOT '+cnt+'건을 전부 삭제합니다.\n실행 전 백업 파일이 다운로드됩니다. 계속할까요?')) return;
  var backed = downloadBackup();
  if(!window.confirm((backed?'백업 파일이 다운로드되었습니다.\n':'⚠️ 백업 다운로드에 실패했습니다!\n')+'정말로 모든 재고를 삭제하고 새로 시작할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
  db.stock.RAW_LOT=[]; db.stock.PACK_LOT=[]; db.stock.BULK_LOT=[]; db.stock.FGT_LOT=[];
  var wiped = ['재고 LOT '+cnt+'건'];
  if($('wipe-txn') && $('wipe-txn').checked){
    var t=(db.txn.T_GOODS_IN||[]).length+(db.txn.T_BULK||[]).length+(db.txn.T_BATCH||[]).length+(db.txn.T_STOCK_MOVE||[]).length;
    db.txn.T_GOODS_IN=[]; db.txn.T_BULK=[]; db.txn.T_BATCH=[]; db.txn.T_STOCK_MOVE=[];
    wiped.push('재고 이력 '+t+'건');
  }
  if($('wipe-sale') && $('wipe-sale').checked){
    wiped.push('판매기록 '+(db.txn.T_SALE||[]).length+'건');
    db.txn.T_SALE=[];
  }
  if(typeof logEvent==='function') logEvent('⚠️ 재고 전체 초기화: '+wiped.join(', '));
  if(typeof toast==='function') toast('초기화 완료 — '+wiped.join(', ')+' 삭제. 이제 수기 기초재고/입고로 새로 등록하세요.','success');
  saveDB(); renderLotManager(); renderLocPage();
};

/* ════════ 일괄 기초재고: 붙여넣기 해석 + 한/영 제품 매칭 ════════ */
var ALIAS = { '더그레잇':'thegreat','그레잇':'thegreat','레드타라':'redtara','바이올렛힐':'violethill','선릿윈도우':'sunlitwindow','시크릿가든':'secretgarden','아리랑':'arirang','앤':'anne','어반포레스트':'urbanforest','포기스터디':'foggystudy','포기스터디':'foggystudy','후엠아이':'whoami','말괄량이':'말괄량이' };
function normN(s){ return String(s||'').toLowerCase().replace(/시프트아이|shifti|시프티/g,'').replace(/[\s_\-·.]/g,''); }
function sizeOf(s){ var m = String(s||'').match(/(\d+)\s*ml/i); return m ? m[1] : ''; }
function matchProduct(rawName){
  var nn = normN(rawName).replace(/\d+ml/i,''); var sz = sizeOf(rawName);
  var alias = '';
  Object.keys(ALIAS).forEach(function(k){ if(nn.indexOf(normN(k))>=0) alias = ALIAS[k]; });
  var best = null;
  (db.master.M_PRODUCT||[]).forEach(function(p){
    var pn = normN(p.name); var psz = sizeOf(p.name);
    var nameHit = (alias && pn.indexOf(alias)>=0) || (nn && (pn.indexOf(nn)>=0 || nn.indexOf(pn.replace(/\d+ml/i,''))>=0 && pn.replace(/\d+ml/i,'').length>1));
    if(!nameHit) return;
    if(sz && psz && sz!==psz) return;           /* 용량 불일치 배제 */
    var score = (sz && psz && sz===psz ? 2 : 1) + (alias && pn.indexOf(alias)>=0 ? 2 : 0);
    if(!best || score>best.score) best = {p:p, score:score};
  });
  return best ? best.p : null;
}
function masterOf(type){ return type==='RAW' ? (db.master.M_RAW||[]) : type==='PACK' ? (db.master.M_PACK||[]) : (db.master.M_PRODUCT||[]); }
function idKey(type){ return type==='RAW' ? 'rawId' : type==='PACK' ? 'packId' : 'productId'; }
function matchItem(type, rawName){
  if(type==='FGT') return matchProduct(rawName);
  var nn = normN(rawName);
  var best = null;
  masterOf(type).forEach(function(m){
    var pn = normN(m.name);
    if(!pn || !nn) return;
    if(pn===nn){ best={m:m,score:3}; return; }
    if((pn.indexOf(nn)>=0 || nn.indexOf(pn)>=0) && (!best || best.score<2)) best={m:m,score:2};
  });
  return best ? best.m : null;
}
var bulkRows = [];
window.parseBulkInit = function(){
  ensure();
  var type = ($('bulk-init-type')||{}).value || 'FGT';
  var txt = ($('bulk-init-paste').value||'');
  bulkRows = [];
  txt.split(/\r?\n/).forEach(function(line){
    if(!line.trim()) return;
    var cols = line.split(/\t|\s{2,}/).map(function(c){ return c.trim(); }).filter(Boolean);
    if(cols.length<2){
      var m = line.trim().match(/^(.*?)[\s]+([\d,]+(?:\.\d+)?)$/); if(m) cols=[m[1],m[2]]; else return;
    }
    var nums = cols.filter(function(c){ return /^[\d,]+(\.\d+)?$/.test(c); });
    var qty = N((nums[0]||cols[cols.length-1]||'').replace(/,/g,''));
    var cost = nums.length>1 ? N(nums[1].replace(/,/g,'')) : 0;
    var name = cols.filter(function(c){ return !/^[\d,]+(\.\d+)?$/.test(c); }).join(' ');
    if(!name) return;
    bulkRows.push({ name:name, qty:qty, cost:cost, match: matchItem(type, name), skip: qty<=0 });
  });
  var pv = $('bulk-init-preview'); if(!pv) return;
  if(!bulkRows.length){ pv.innerHTML='<div style="font-size:11px;color:#c0392b;font-weight:700">인식된 행이 없습니다. "품명 [탭] 수량" 형식으로 붙여넣어 주세요.</div>'; return; }
  var typeLabel = type==='RAW'?'원료':type==='PACK'?'포장재':'제품';
  var idk = idKey(type);
  var opts = masterOf(type).map(function(m){ return '<option value="'+E(m[idk])+'">'+E(m.name)+'</option>'; }).join('');
  pv.innerHTML =
    '<table style="width:100%;font-size:11px"><tr><th style="text-align:left">입력명</th><th>수량</th><th style="text-align:left">매칭 '+typeLabel+'</th></tr>'+
    bulkRows.map(function(r,i){
      var sel = r.skip
        ? '<span style="color:#94a3b8">0개 — 제외</span>'
        : '<select id="bi-sel-'+i+'" class="input-field" style="padding:2px 6px;font-size:11px">'+
            '<option value="__new__"'+(r.match?'':' selected')+'>➕ 신규 '+typeLabel+'(으)로 생성: '+E(r.name)+'</option>'+
            opts.replace('value="'+(r.match?E(r.match[idk]):'')+'"','value="'+(r.match?E(r.match[idk]):'')+'" selected')+
          '</select>';
      return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(r.name)+'</td><td style="text-align:right;font-weight:800">'+r.qty+'</td><td>'+sel+'</td></tr>';
    }).join('')+'</table>'+
    '<div style="font-size:10.5px;color:#64748b;margin-top:6px">'+bulkRows.filter(function(r){return !r.skip;}).length+'개 품목 · 총 '+bulkRows.reduce(function(s,r){return s+(r.skip?0:r.qty);},0).toLocaleString()+(type==='RAW'?' g':' EA')+' — 매칭이 틀린 행은 드롭다운으로 고친 뒤 등록하세요.</div>'+
    '<button class="btn btn-primary w-full" style="margin-top:6px" onclick="commitBulkInit()">위 내용대로 일괄 등록</button>';
};
window.commitBulkInit = function(){
  ensure();
  var type = ($('bulk-init-type')||{}).value || 'FGT';
  var loc = $('bulk-init-loc').value || '창고';
  var idk = idKey(type);
  var stockKey = type==='RAW'?'RAW_LOT':type==='PACK'?'PACK_LOT':'FGT_LOT';
  var done=0, created=0, tot=0;
  bulkRows.forEach(function(r,i){
    if(r.skip) return;
    var sel = $('bi-sel-'+i); if(!sel) return;
    var iid = sel.value;
    if(iid==='__new__'){
      iid = Date.now()+i;
      if(type==='RAW') db.master.M_RAW.push({ rawId: iid, name: r.name, unit:'g' });
      else if(type==='PACK') db.master.M_PACK.push({ packId: iid, name: r.name, unit:'ea' });
      else db.master.M_PRODUCT.push({ productId: iid, name: r.name, bom: [] });
      created++;
    } else { iid = isNaN(Number(iid)) ? iid : Number(iid); }
    var lotNo = 'INIT-'+TODAY().replace(/-/g,'').slice(2)+'-'+String(i+1).padStart(2,'0');
    var lot = { id: genId(type), lotNo: lotNo, qty: r.qty, remaining: r.qty, unitCost: N(r.cost)||0, status:'OK', note:'일괄 기초재고', dateIn: TODAY() };
    lot[idk] = iid;
    if(type==='FGT' || type==='PACK') lot.location = loc;
    db.stock[stockKey].push(lot);
    db.txn.T_STOCK_MOVE.push({ id: genId('MV'), date: TODAY(), lotNo: lotNo, productId: type==='FGT'?iid:null, qty: r.qty, from:'(기초등록)', to: (type==='FGT'?loc:'창고')+'·'+(type==='RAW'?'원료':type==='PACK'?'포장재':'완제품'), note:'일괄 기초재고' });
    done++; tot+=r.qty;
  });
  if(typeof logEvent==='function') logEvent('일괄 기초재고('+type+'): '+done+'품목 '+tot+(type==='RAW'?'g':'EA')+(created?' (신규 '+created+'개 생성)':''));
  if(typeof toast==='function') toast('일괄 등록 완료: '+done+'품목 '+tot.toLocaleString()+(type==='RAW'?'g':'EA')+(created?' · 신규 '+created+'개':''),'success');
  $('bulk-init-paste').value=''; $('bulk-init-preview').innerHTML='';
  bulkRows=[];
  saveDB(); renderLocPage(); renderLotManager();
};

/* ════════ 📋 순환 실사 (사이클 카운트) ════════ */
function scStockKey(t){ return t==='RAW'?'RAW_LOT':t==='PACK'?'PACK_LOT':'FGT_LOT'; }
function scIdKey(t){ return t==='RAW'?'rawId':t==='PACK'?'packId':'productId'; }
function scMaster(t){ return t==='RAW'?(db.master.M_RAW||[]):t==='PACK'?(db.master.M_PACK||[]):(db.master.M_PRODUCT||[]); }
function scLotsOf(t, itemId, loc){
  var idk = scIdKey(t);
  return (db.stock[scStockKey(t)]||[]).filter(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return false;
    if(String(l[idk])!==String(itemId)) return false;
    if(t==='RAW') return true;                    /* 원료는 창고 단일 */
    return locOf(l)===loc;
  });
}
var scLines = [];
window.startStockCount = function(){
  ensure();
  db.txn.T_STOCK_COUNT = db.txn.T_STOCK_COUNT||[];
  var t = $('sc-type').value, loc = $('sc-loc').value;
  var idk = scIdKey(t);
  scLines = [];
  scMaster(t).forEach(function(m){
    var book = scLotsOf(t, m[idk], loc).reduce(function(s,l){ return s+N(l.remaining); },0);
    if(book>0) scLines.push({ itemId:m[idk], name:m.name, book:book, actual:null });
  });
  var pv = $('sc-panel'); if(!pv) return;
  if(!scLines.length){ pv.innerHTML='<div style="font-size:11px;color:#94a3b8;padding:6px 0">해당 구역의 장부 재고가 없습니다.</div>'; renderScHistory(); return; }
  pv.innerHTML =
    '<table style="width:100%;font-size:11.5px;margin-top:4px"><tr><th style="text-align:left">품목</th><th style="text-align:right">장부</th><th style="text-align:right;width:110px">실물 수량</th><th style="text-align:right;width:70px">차이</th></tr>'+
    scLines.map(function(r,i){
      return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(r.name)+'</td><td style="text-align:right;color:#64748b">'+r.book.toLocaleString()+'</td>'+
        '<td><input id="sc-act-'+i+'" type="number" step="0.01" class="input-field text-right" style="padding:3px 6px" placeholder="'+r.book+'" oninput="calcStockCount()"></td>'+
        '<td id="sc-diff-'+i+'" style="text-align:right;font-weight:800;color:#94a3b8">-</td></tr>';
    }).join('')+'</table>'+
    '<div id="sc-summary" style="font-size:11px;font-weight:800;color:#64748b;margin-top:6px">실물 수량을 입력하세요. 비워두면 "장부와 동일"로 처리됩니다.</div>'+
    '<button class="btn btn-primary w-full" style="margin-top:6px" onclick="applyStockCount()">차이 조정 승인 + 실사 기록 저장</button>';
  renderScHistory();
};
window.calcStockCount = function(){
  var diffCnt=0, plus=0, minus=0;
  scLines.forEach(function(r,i){
    var el = $('sc-act-'+i); if(!el) return;
    var v = el.value==='' ? r.book : N(el.value);
    r.actual = v;
    var d = v - r.book;
    var cell = $('sc-diff-'+i);
    if(cell){
      cell.textContent = d===0 ? '=' : (d>0?'+':'')+d.toLocaleString();
      cell.style.color = d===0 ? '#94a3b8' : d>0 ? '#0f766e' : '#dc2626';
    }
    if(d!==0){ diffCnt++; if(d>0) plus+=d; else minus+=d; }
  });
  var s = $('sc-summary');
  if(s) s.innerHTML = diffCnt===0
    ? '차이 없음 — 장부와 실물이 일치합니다. ✅'
    : '<span style="color:#c2410c">차이 '+diffCnt+'품목</span> (초과 +'+plus.toLocaleString()+' / 부족 '+minus.toLocaleString()+') — 승인 시 재고가 조정됩니다.';
};
window.applyStockCount = function(){
  ensure();
  db.txn.T_STOCK_COUNT = db.txn.T_STOCK_COUNT||[];
  calcStockCount();
  var t = $('sc-type').value, loc = $('sc-loc').value;
  var diffs = scLines.filter(function(r){ return r.actual!=null && r.actual!==r.book; });
  if(diffs.length && !window.confirm('차이 '+diffs.length+'품목의 재고를 실물 수량으로 조정합니다. 계속할까요?')) return;
  var idk = scIdKey(t), stockKey = scStockKey(t);
  diffs.forEach(function(r){
    var d = r.actual - r.book;
    var lots = scLotsOf(t, r.itemId, loc).sort(function(a,b){ return String(a.dateIn||a.mfgDate||'')<String(b.dateIn||b.mfgDate||'')?-1:1; });
    if(d<0){ /* 부족: FIFO 차감 */
      var need = -d;
      lots.forEach(function(l){
        if(need<=0) return;
        var take = Math.min(N(l.remaining), need);
        l.remaining = N(l.remaining) - take; need -= take;
      });
    } else { /* 초과: 조정 LOT 생성 */
      var cost = lots.length ? N(lots[lots.length-1].unitCost) : 0;
      var nl = { id: genId(t), lotNo: 'ADJ-'+TODAY().replace(/-/g,'').slice(2), qty:d, remaining:d, unitCost:cost, status:'OK', note:'실사 조정(+)', dateIn: TODAY() };
      nl[idk] = r.itemId;
      if(t!=='RAW') nl.location = loc;
      db.stock[stockKey].push(nl);
    }
  });
  var rec = { id: genId('SC'), date: TODAY(), type:t, loc: (t==='RAW'?'창고':loc),
    lines: scLines.map(function(r){ return { name:r.name, book:r.book, actual:(r.actual!=null?r.actual:r.book), diff:(r.actual!=null?r.actual:r.book)-r.book }; }) };
  db.txn.T_STOCK_COUNT.push(rec);
  if(typeof logEvent==='function') logEvent('재고 실사('+t+'/'+rec.loc+'): '+scLines.length+'품목, 조정 '+diffs.length+'건');
  if(typeof toast==='function') toast('실사 완료 — 조정 '+diffs.length+'건 반영. 아래 이력에서 기록서를 인쇄하세요.','success');
  $('sc-panel').innerHTML='';
  scLines=[];
  saveDB(); renderLocPage(); renderLotManager(); renderScHistory();
};
function renderScHistory(){
  var h = $('sc-history'); if(!h) return;
  var recs = (db.txn.T_STOCK_COUNT||[]).slice(-5).reverse();
  h.innerHTML = recs.length
    ? '최근 실사: ' + recs.map(function(r){
        var adj = r.lines.filter(function(l){return l.diff!==0;}).length;
        return '<span style="cursor:pointer;text-decoration:underline;color:#0f766e" onclick="printStockCount(\''+E(r.id)+'\')">'+E(r.date)+' '+(r.type==='RAW'?'원료':r.type==='PACK'?'부자재':'완제품')+'·'+E(r.loc)+' (조정 '+adj+')</span>';
      }).join(' · ') + '  — 클릭하면 실사 기록서 인쇄'
    : '실사 이력 없음 — 월 1회 실사를 권장합니다.';
}
window.printStockCount = function(recId){
  var r = (db.txn.T_STOCK_COUNT||[]).find(function(x){ return String(x.id)===String(recId); });
  if(!r) return;
  var pw = window.open('', '_blank');
  if(!pw){ if(typeof toast==='function') toast('팝업이 차단되었습니다','error'); return; }
  var diffs = r.lines.filter(function(l){return l.diff!==0;});
  var body =
    '<div style="color:#0f766e;font-weight:800;text-align:center;font-size:12px">주식회사 메디센츠 (화장품제조업 등록 제7691호)</div>'+
    '<h1 style="font-size:19px;text-align:center;margin:2px 0 8px">재고 실사 기록서</h1>'+
    '<table><tr><th style="width:18%">실사일</th><td style="width:32%">'+E(r.date)+'</td><th style="width:18%">대상</th><td>'+(r.type==='RAW'?'원료':r.type==='PACK'?'부자재':'완제품')+' · '+E(r.loc)+'</td></tr>'+
    '<tr><th>실사 품목</th><td>'+r.lines.length+'개</td><th>조정 발생</th><td>'+diffs.length+'개 품목</td></tr></table>'+
    '<table><tr><th>품목</th><th style="width:15%">장부</th><th style="width:15%">실물</th><th style="width:15%">차이</th></tr>'+
    r.lines.map(function(l){
      return '<tr><td>'+E(l.name)+'</td><td class="r">'+l.book.toLocaleString()+'</td><td class="r">'+l.actual.toLocaleString()+'</td>'+
        '<td class="r" style="font-weight:800;color:'+(l.diff===0?'#94a3b8':l.diff>0?'#0f766e':'#dc2626')+'">'+(l.diff>0?'+':'')+l.diff.toLocaleString()+'</td></tr>';
    }).join('')+'</table>'+
    '<table class="sign"><tr><th style="width:22%">실사자</th><td style="width:45%">(서명)</td><th style="width:12%">승인자</th><td>(서명)</td></tr></table>'+
    '<div style="font-size:9.5px;color:#666">※ 차이분은 승인 시점에 ERP 재고에 자동 조정 반영되었습니다 (부족: FIFO 차감 / 초과: ADJ 조정 LOT 생성). 제조관리기준서 4항(재고관리) 근거 기록.</div>'+
    (typeof window.docStamp==='function' ? window.docStamp() : '');
  pw.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>실사기록서 '+E(r.date)+'</title><style>@page{size:A4;margin:12mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;font-size:11px;line-height:1.5;color:#111}table{width:100%;border-collapse:collapse;margin:6px 0}th,td{border:1px solid #444;padding:4px 6px}th{background:#eef5f2;font-weight:800;text-align:center}.r{text-align:right}.sign td{height:26px}</style></head><body>'+body+
    '<scr'+'ipt>window.onload=function(){setTimeout(function(){window.print();},300);};</scr'+'ipt></body></html>');
  pw.document.close();
};

/* ════════ 피킹 리스트 (FIFO 할당 · 인쇄 · 확정 이관) ════════ */
var pkLines = [];
function pkFillItems(){
  var sel = $('pk-item'); if(!sel) return;
  var type = ($('pk-type')||{}).value||'FGT';
  var arr = type==='PACK' ? (db.master.M_PACK||[]) : (db.master.M_PRODUCT||[]);
  var idk = type==='PACK' ? 'packId' : 'productId';
  sel.innerHTML = '<option value="">품목 선택</option>' + arr.map(function(m){
    return '<option value="'+E(m[idk])+'">'+E(m.name)+'</option>';
  }).join('');
}
/* 창고 재고에서 FIFO로 꺼낼 LOT 계산 */
function pkAllocate(type, itemId, qty){
  var key = type==='PACK'?'PACK_LOT':'FGT_LOT';
  var idk = type==='PACK'?'packId':'productId';
  var lots = (db.stock[key]||[]).filter(function(l){
    return String(l[idk])===String(itemId) && locOf(l)==='공장' && N(l.remaining)>0 && String(l.status||'OK').toUpperCase()==='OK';
  }).sort(function(a,b){ return String(a.dateIn||a.mfgDate||'').localeCompare(String(b.dateIn||b.mfgDate||'')); });
  var need = qty, picks = [];
  lots.forEach(function(l){
    if(need<=0) return;
    var take = Math.min(N(l.remaining), need);
    picks.push({ lotId:l.id, lotNo:l.lotNo, take:take, exp:l.expDate||'' });
    need -= take;
  });
  return { picks: picks, short: need };
}
window.addPickLine = function(){
  ensure();
  var type = $('pk-type').value, itemId = $('pk-item').value, qty = N($('pk-qty').value);
  if(!itemId){ if(typeof toast==='function') toast('품목을 선택하세요','error'); return; }
  if(qty<=0){ if(typeof toast==='function') toast('수량을 입력하세요','error'); return; }
  var arr = type==='PACK' ? (db.master.M_PACK||[]) : (db.master.M_PRODUCT||[]);
  var idk = type==='PACK' ? 'packId' : 'productId';
  var m = arr.find(function(x){ return String(x[idk])===String(itemId); });
  var alloc = pkAllocate(type, itemId, qty);
  pkLines.push({ type:type, itemId:(isNaN(Number(itemId))?itemId:Number(itemId)), name:m?m.name:itemId, qty:qty, picks:alloc.picks, short:alloc.short, done:false });
  $('pk-qty').value='';
  renderPickLines();
};
window.removePickLine = function(i){ pkLines.splice(i,1); renderPickLines(); };
window.togglePickDone = function(i){ pkLines[i].done = !pkLines[i].done; renderPickLines(); };
function renderPickLines(){
  var box = $('pk-lines'); if(!box) return;
  if(!pkLines.length){ box.innerHTML=''; return; }
  var shortAny = pkLines.some(function(l){ return l.short>0; });
  box.innerHTML =
    '<table style="width:100%;font-size:11px;margin-top:4px"><tr><th style="width:6%"></th><th style="text-align:left">품목</th><th style="width:12%">필요</th><th style="text-align:left;width:40%">꺼낼 LOT (FIFO)</th><th style="width:8%"></th></tr>'+
    pkLines.map(function(l,i){
      var lotTxt = l.picks.map(function(p){ return E(p.lotNo)+' × '+p.take+(p.exp?' <span style="color:#94a3b8">('+E(p.exp)+')</span>':''); }).join('<br>') || '<span style="color:#dc2626">창고 재고 없음</span>';
      if(l.short>0) lotTxt += '<br><b style="color:#dc2626">부족 '+l.short+'</b>';
      return '<tr style="border-top:1px solid #e2e8f0;'+(l.done?'background:#f0fdf4':'')+'">'+
        '<td style="text-align:center"><input type="checkbox" '+(l.done?'checked':'')+' onchange="togglePickDone('+i+')"></td>'+
        '<td style="font-weight:700">'+E(l.name)+'<span style="color:#94a3b8">'+(l.type==='PACK'?' (부자재)':'')+'</span></td>'+
        '<td style="text-align:right;font-weight:800">'+l.qty+'</td>'+
        '<td style="line-height:1.5">'+lotTxt+'</td>'+
        '<td style="text-align:center"><span style="cursor:pointer;color:#dc2626;font-weight:800" onclick="removePickLine('+i+')">✕</span></td></tr>';
    }).join('')+'</table>'+
    (shortAny?'<div style="font-size:10.5px;color:#b91c1c;font-weight:700;margin-top:4px">⚠ 창고 재고가 부족한 품목이 있습니다. 수량을 줄이거나 생산·발주를 확인하세요.</div>':'')+
    '<div class="grid grid-cols-2 gap-2" style="margin-top:8px">'+
      '<button class="btn btn-secondary" onclick="printPickList()">📄 피킹 리스트 인쇄</button>'+
      '<button class="btn btn-primary" onclick="commitPickList()">피킹 완료 → 확정</button>'+
    '</div>';
}
window.printPickList = function(){
  if(!pkLines.length){ if(typeof toast==='function') toast('리스트가 비어 있습니다','error'); return; }
  if(typeof window.mfdsPrint!=='function' && typeof window.popPrint!=='function'){ window.print(); return; }
  var dest = $('pk-dest').value, note = ($('pk-note').value||'').trim();
  var body =
    '<div class="co">주식회사 메디센츠</div><h1>피 킹 리 스 트</h1>'+
    '<div class="sub">작성일: '+TODAY()+' · 대상: '+E(dest==='고객'?'고객 출고':dest+' 보충')+(note?' · '+E(note):'')+'</div>'+
    '<table><tr><th style="width:7%">완료</th><th>품목</th><th style="width:12%">수량</th><th style="width:34%">꺼낼 LOT (오래된 것부터)</th><th style="width:14%">실제 담은 수</th></tr>'+
    pkLines.map(function(l){
      var lotTxt = l.picks.map(function(p){ return E(p.lotNo)+' × '+p.take; }).join('<br>') || '재고없음';
      if(l.short>0) lotTxt += '<br>부족 '+l.short;
      return '<tr><td class="c">□</td><td>'+E(l.name)+(l.type==='PACK'?' (부자재)':'')+'</td><td class="r"><b>'+l.qty+'</b></td><td>'+lotTxt+'</td><td></td></tr>';
    }).join('')+'</table>'+
    '<table class="sign"><tr><th style="width:22%">피킹 작업자</th><td style="width:45%">(서명)</td><th style="width:12%">일자</th><td></td></tr>'+
    '<tr><th>인수자</th><td>(서명)</td><th>일자</th><td></td></tr></table>'+
    '<div class="small">※ LOT는 선입선출(FIFO) 기준으로 배정되었습니다. 실제 담은 수량이 다르면 표에 적고 ERP에서 수정하세요.</div>';
  (window.mfdsPrint||window.popPrint)('피킹리스트 '+TODAY(), body);
};
window.commitPickList = function(){
  ensure();
  if(!pkLines.length) return;
  var dest = $('pk-dest').value, note = ($('pk-note').value||'').trim();
  db.txn.T_PICK = db.txn.T_PICK || [];
  if(dest==='고객'){
    db.txn.T_PICK.push({ id: genId('PK'), date: TODAY(), dest: dest, note: note,
      lines: pkLines.map(function(l){ return {name:l.name, qty:l.qty, picks:l.picks}; }) });
    if(typeof toast==='function') toast('피킹 리스트 저장 완료. 고객 출고는 판매(출고) 화면에서 등록하세요.','success');
    if(typeof logEvent==='function') logEvent('피킹리스트(고객): '+pkLines.length+'품목');
    pkLines=[]; renderPickLines(); saveDB(); return;
  }
  var moved = 0, movedQty = 0;
  pkLines.forEach(function(l){
    var key = l.type==='PACK'?'PACK_LOT':'FGT_LOT';
    var idk = l.type==='PACK'?'packId':'productId';
    l.picks.forEach(function(p){
      var src = (db.stock[key]||[]).find(function(x){ return String(x.id)===String(p.lotId); });
      if(!src || N(src.remaining) < p.take) return;
      src.remaining = N(src.remaining) - p.take;
      var destLot = (db.stock[key]||[]).find(function(x){
        return x.lotNo===src.lotNo && String(x[idk])===String(src[idk]) && locOf(x)===dest;
      });
      if(destLot){ destLot.remaining = N(destLot.remaining)+p.take; destLot.qty = N(destLot.qty)+p.take; }
      else {
        var nl = { id: genId(l.type), lotNo: src.lotNo, qty: p.take, remaining: p.take, unitCost: src.unitCost,
          expDate: src.expDate, status:'OK', location:dest, note:'피킹 이관' };
        nl[idk] = src[idk];
        db.stock[key].push(nl);
      }
      db.txn.T_STOCK_MOVE.push({ id: genId('MV'), date: TODAY(), lotNo: src.lotNo,
        productId: l.type==='PACK'?null:src.productId, qty: p.take, from:'공장', to:dest,
        note: (l.type==='PACK'?'[부자재] ':'')+'피킹'+(note?' · '+note:'') });
      moved++; movedQty += p.take;
    });
  });
  db.txn.T_PICK.push({ id: genId('PK'), date: TODAY(), dest: dest, note: note,
    lines: pkLines.map(function(l){ return {name:l.name, qty:l.qty, picks:l.picks}; }) });
  if(typeof logEvent==='function') logEvent('피킹 확정: '+pkLines.length+'품목 '+movedQty+' 공장→'+dest);
  if(typeof toast==='function') toast('피킹 완료 — '+pkLines.length+'품목 '+movedQty.toLocaleString()+' '+dest+' 이관','success');
  pkLines=[]; renderPickLines();
  saveDB(); renderLocPage(); renderLotManager();
};

/* ════════ 순환 실사 (사이클 카운트) ════════ */

function stStockKey(t){ return t==='RAW'?'RAW_LOT':t==='PACK'?'PACK_LOT':'FGT_LOT'; }
function stIdKey(t){ return t==='RAW'?'rawId':t==='PACK'?'packId':'productId'; }
function stMaster(t){ return t==='RAW'?(db.master.M_RAW||[]):t==='PACK'?(db.master.M_PACK||[]):(db.master.M_PRODUCT||[]); }
function stLotsOf(type, loc, itemId){
  var idk = stIdKey(type);
  return (db.stock[stStockKey(type)]||[]).filter(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return false;
    if(String(l[idk])!==String(itemId)) return false;
    if(type!=='RAW' && locOf(l)!==loc) return false;
    return true;
  });
}
var stRows = [];
window.startStocktake = function(){
  ensure();
  db.txn.T_STOCKTAKE = db.txn.T_STOCKTAKE || [];
  var type = $('st-type').value, loc = $('st-loc').value;
  if(type==='RAW') loc = '창고';
  var idk = stIdKey(type);
  var agg = {};
  (db.stock[stStockKey(type)]||[]).forEach(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return;
    if(type!=='RAW' && locOf(l)!==loc) return;
    agg[l[idk]] = (agg[l[idk]]||0) + N(l.remaining);
  });
  stRows = Object.keys(agg).map(function(id){
    var m = stMaster(type).find(function(x){ return String(x[idk])===String(id); });
    return { itemId: isNaN(Number(id))?id:Number(id), name: m?m.name:id, book: agg[id] };
  }).sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
  var unit = type==='RAW'?'g':'EA';
  var sheet = $('st-sheet'); if(!sheet) return;
  if(!stRows.length){ sheet.innerHTML='<div style="font-size:11px;color:#94a3b8;padding:6px 0">해당 위치에 재고가 없습니다.</div>'; return; }
  sheet.innerHTML =
    '<table style="width:100%;font-size:11.5px;margin-top:4px"><tr><th style="text-align:left">품목</th><th style="width:18%;text-align:right">장부('+unit+')</th><th style="width:22%">실물 수량</th><th style="width:18%;text-align:right">차이</th></tr>'+
    stRows.map(function(r,i){
      return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(r.name)+'</td><td style="text-align:right">'+r.book.toLocaleString()+'</td>'+
        '<td><input id="st-act-'+i+'" type="number" step="0.01" class="input-field text-right" style="padding:3px 6px" placeholder="'+r.book+'" oninput="stDiff('+i+')"></td>'+
        '<td id="st-diff-'+i+'" style="text-align:right;font-weight:800;color:#94a3b8">-</td></tr>';
    }).join('')+'</table>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">'+
      '<input id="st-worker" class="input-field" placeholder="실사자 이름">'+
      '<button class="btn btn-primary" onclick="commitStocktake()">실사 확정 → 재고 조정</button>'+
    '</div>'+
    '<div style="font-size:9.5px;color:#94a3b8;margin-top:4px">빈칸은 "장부와 동일"로 처리됩니다. 부족분은 오래된 LOT부터 차감, 초과분은 조정 LOT(ADJ)로 생성됩니다.</div>';
  renderStHistory();
};
window.stDiff = function(i){
  var v = $('st-act-'+i).value;
  var el = $('st-diff-'+i);
  if(v===''){ el.textContent='-'; el.style.color='#94a3b8'; return; }
  var d = N(v) - stRows[i].book;
  el.textContent = (d>0?'+':'')+d.toLocaleString();
  el.style.color = d===0 ? '#059669' : d>0 ? '#2563eb' : '#dc2626';
};
window.commitStocktake = function(){
  ensure();
  db.txn.T_STOCKTAKE = db.txn.T_STOCKTAKE || [];
  var type = $('st-type').value, loc = type==='RAW'?'창고':$('st-loc').value;
  var idk = stIdKey(type), key = stStockKey(type);
  var changes = [], items = [];
  stRows.forEach(function(r,i){
    var v = $('st-act-'+i) ? $('st-act-'+i).value : '';
    var actual = v==='' ? r.book : N(v);
    var diff = actual - r.book;
    items.push({ name:r.name, book:r.book, actual:actual, diff:diff });
    if(diff!==0) changes.push({ r:r, diff:diff });
  });
  if(!changes.length){ if(typeof toast==='function') toast('차이가 없습니다 — 장부와 실물 일치 ✅ (기록만 저장)','success'); }
  else if(!window.confirm('차이 '+changes.length+'개 품목을 조정합니다:\n'+changes.map(function(c){ return c.r.name+' '+(c.diff>0?'+':'')+c.diff; }).join('\n')+'\n\n확정할까요?')) return;
  changes.forEach(function(c){
    var lots = stLotsOf(type, loc, c.r.itemId).sort(function(a,b){ return String(a.dateIn||a.mfgDate||'').localeCompare(String(b.dateIn||b.mfgDate||'')); });
    if(c.diff < 0){
      var need = -c.diff;
      lots.forEach(function(l){
        if(need<=0) return;
        var take = Math.min(N(l.remaining), need);
        l.remaining = N(l.remaining) - take; need -= take;
      });
    } else {
      var totV=0, totQ=0;
      lots.forEach(function(l){ totV+=N(l.remaining)*N(l.unitCost); totQ+=N(l.remaining); });
      var avgCost = totQ>0 ? totV/totQ : 0;
      var nl = { id: genId(type), lotNo: 'ADJ-'+TODAY().replace(/-/g,'').slice(2), qty: c.diff, remaining: c.diff,
        unitCost: Math.round(avgCost*100)/100, status:'OK', note:'실사 조정(+)', dateIn: TODAY() };
      nl[idk] = c.r.itemId;
      if(type!=='RAW') nl.location = loc;
      db.stock[key].push(nl);
    }
  });
  var rec = { id: genId('ST'), date: TODAY(), type: type, loc: loc,
    worker: ($('st-worker').value||'').trim(), items: items,
    diffCount: changes.length };
  db.txn.T_STOCKTAKE.push(rec);
  if(typeof logEvent==='function') logEvent('실사 확정('+type+'@'+loc+'): '+items.length+'품목, 조정 '+changes.length+'건');
  if(typeof toast==='function') toast('실사 완료 — '+items.length+'품목 확인, '+changes.length+'건 조정','success');
  $('st-sheet').innerHTML='';
  stRows=[];
  saveDB(); renderLocPage(); renderLotManager(); renderStHistory();
};
function renderStHistory(){
  var h = $('st-history'); if(!h) return;
  var list = (db.txn.T_STOCKTAKE||[]).slice(-5).reverse();
  h.innerHTML = list.length
    ? '최근 실사: '+list.map(function(s){
        return '<span style="cursor:pointer;text-decoration:underline" onclick="printStocktake(\''+E(s.id)+'\')">'+E(s.date)+' '+(s.type==='RAW'?'원료':s.type==='PACK'?'부자재':'완제품')+'@'+E(s.loc)+'(조정'+s.diffCount+')</span>';
      }).join(' · ')+' — 클릭하면 기록서 인쇄'
    : '실사 이력 없음 — 첫 실사를 시작해 보세요.';
}
window.printStocktake = function(id){
  var s = (db.txn.T_STOCKTAKE||[]).find(function(x){ return String(x.id)===String(id); });
  if(!s || typeof window.mfdsPrint!=='function') return;
  var unit = s.type==='RAW'?'g':'EA';
  var body =
    '<div class="co">주식회사 메디센츠 (화장품제조업 등록 제7691호)</div><h1>재고 실사 기록서</h1>'+
    '<div class="sub">실사일: '+E(s.date)+' · 대상: '+(s.type==='RAW'?'원료':s.type==='PACK'?'부자재':'완제품')+' @ '+E(s.loc)+' · 실사자: '+E(s.worker||'-')+'</div>'+
    '<table><tr><th>품목</th><th style="width:16%">장부('+unit+')</th><th style="width:16%">실물('+unit+')</th><th style="width:16%">차이</th></tr>'+
    s.items.map(function(it){
      return '<tr><td>'+E(it.name)+'</td><td class="r">'+N(it.book).toLocaleString()+'</td><td class="r">'+N(it.actual).toLocaleString()+'</td>'+
        '<td class="r" style="font-weight:800;color:'+(it.diff===0?'#059669':it.diff>0?'#2563eb':'#dc2626')+'">'+(it.diff>0?'+':'')+N(it.diff).toLocaleString()+'</td></tr>';
    }).join('')+
    '<tr><th>합계</th><th></th><th></th><th class="r">조정 '+s.diffCount+'건</th></tr></table>'+
    '<table class="sign"><tr><th style="width:22%">실사자</th><td style="width:45%">'+E(s.worker||'')+' (서명)</td><th style="width:12%">승인</th><td></td></tr></table>'+
    '<div class="small">※ 차이분은 확정 시점에 재고 조정(부족: FIFO 차감 / 초과: ADJ LOT 생성)으로 반영되었습니다. 제조관리기준서 4항(재고관리) 근거 기록. 보존 5년.</div>';
  window.mfdsPrint('실사기록서 '+s.date, body);
};

/* ════════ 판매 화면 LOT 목록에 위치 태그 ════════ */

function decorateSaleLots(){
  var el = $('sale-lot2'); if(!el) return;
  for(var i=0;i<el.options.length;i++){
    var op = el.options[i];
    if(!op.value || op.dataset.locTag) continue;
    var lot = (db.stock.FGT_LOT||[]).find(function(l){ return String(l.id)===String(op.value); });
    if(lot){
      op.text = op.text + '  ' + ({'매장':'🏬매장','물류센터':'📦물류','공장':'🏭공장'}[locOf(lot)]||locOf(lot));
      op.dataset.locTag='1';
    }
  }
}

/* ════════ 라우팅·부트 ════════ */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='loc-stock'){ injectUI(); renderLocPage(); renderLotManager(); try{ renderScHistory(); }catch(e){} }
  if(pageId==='t-sale'){ setTimeout(decorateSaleLots, 200); }
};
function boot(){ ensure(); try{ migrateLoc(); }catch(e){} injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
setTimeout(function(){ try{ migrateLoc(); }catch(e){} }, 3000);
var __locKeep = setInterval(function(){ try{ injectUI(); }catch(e){} }, 3000);
setTimeout(function(){ clearInterval(__locKeep); }, 90000);
setInterval(function(){ try{ decorateSaleLots(); }catch(e){} }, 2000);
})();

/* ═══════════ 모듈: 운영가이드 업데이트 패치 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };

var GUIDE_HTML =
'<div id="nose-guide-v22" class="card p-4 space-y-3" style="border:2px solid #0f766e;background:#f7fbfa">'+
  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
    '<h3 class="font-bold text-sm" style="color:#0f766e;margin:0">🆕 확장 모듈 운영가이드 (v2.2)</h3>'+
    '<span style="font-size:9.5px;font-weight:800;color:#fff;background:#0f766e;border-radius:6px;padding:2px 7px">노즈 모듈</span>'+
    '<button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="printNoseGuide()">📄 인쇄 / PDF</button>'+
  '</div>'+

  '<div class="gd-sec"><b>📅 하루 · 한 달 운영 리듬</b>'+
    '<div class="gd-step"><span class="gd-num">매일</span><div class="flex-1"><b>대시보드 ☀️ 오늘 할 일</b> — 긴급 카드(주황)부터 처리. 카드를 누르면 해당 화면으로 바로 이동합니다. 아래 <b>📦 재고 스냅샷</b>에서 원료·부자재·벌크·완제품(창고/인사동) 수량과 금액을 확인하세요.</div></div>'+
    '<div class="gd-step"><span class="gd-num">주간</span><div class="flex-1"><b>피킹·출고</b> — 물류센터·매장 보충은 📋 피킹 리스트로. 매장/택배 판매분은 주간정산에서 실물 수량만 적으면 판매로 자동 계상됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">월말</span><div class="flex-1"><b>실사 + 서류</b> — 🔢 순환 실사로 공장→물류센터→매장 순으로 세고 확정. 그다음 📚 문서센터에서 수불부·생산월보를 출력해 보관합니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">연 1회</span><div class="flex-1"><b>2월 말 식약처 생산실적 보고</b> — 문서센터 → 연간 생산실적 집계표 출력 후 대한화장품협회에 보고. 책임판매관리자 법정교육(8시간)은 교육이수 대장에 기록.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>🏬 위치 재고 (공장 · 물류센터 · 매장)</b>'+
    '<div class="gd-step"><span class="gd-num">1</span><div class="flex-1"><b>기초 등록</b> — 실사표를 엑셀에서 복사해 <b>📋 일괄 기초재고 등록</b>에 붙여넣기(형식: 품명 [탭] 수량 [탭] 원가). 유형(완제품/원료/포장재)과 위치를 먼저 고르세요. <b>원료는 g 단위</b>로 입력합니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">2</span><div class="flex-1"><b>이관</b> — 공장↔물류센터↔매장 자유 이동. QC 적합(OK) LOT만 이관되며 이력이 자동 기록됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">3</span><div class="flex-1"><b>피킹 리스트</b> — 보낼 품목·수량을 넣으면 꺼낼 LOT을 FIFO로 배정. 인쇄해 들고 담고, [피킹 완료 → 확정]하면 인사동 보충은 자동 이관됩니다. (고객 출고는 리스트만 발행 — 차감은 판매 화면에서)</div></div>'+
    '<div class="gd-step"><span class="gd-num">4</span><div class="flex-1"><b>순환 실사</b> — 유형·위치 선택 → 시트 열기 → 실물 수량 입력(빈칸은 장부와 동일) → 확정. 부족분은 오래된 LOT부터 차감, 초과분은 ADJ LOT으로 생성됩니다. 실사기록서는 이력 링크에서 인쇄하세요.</div></div>'+
    '<div class="gd-step"><span class="gd-num">5</span><div class="flex-1"><b>LOT 수정·삭제</b> — 🛠 LOT 관리에서 잔량·단가·상태·위치·기한을 고치거나 삭제. 전체 초기화는 백업 자동 다운로드 후 2중 확인을 거칩니다.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>📱 QR 라벨 현장 사용</b>'+
    '<div class="gd-step"><span class="gd-num">1</span><div class="flex-1">재고 라벨 출력 시 QR이 자동으로 붙습니다. 라벨을 자재·박스에 부착하세요.</div></div>'+
    '<div class="gd-step"><span class="gd-num">2</span><div class="flex-1">폰 카메라로 QR을 찍으면 ERP가 열리며 <b>잔량·유통기한·QC 상태</b> 카드가 표시됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">3</span><div class="flex-1">카드의 <b>[🔄 이관하기]</b>는 그 LOT이 채워진 이관 폼으로, <b>[🔢 실사 입력]</b>은 해당 품목 실사 시트로 바로 연결됩니다.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>🔧 생산 · 수율</b>'+
    '<div class="gd-step"><span class="gd-num">1</span><div class="flex-1"><b>작업지시</b>를 발행하면 대기 상태. [▶ 시작] → 진행중 → [✓ 완료·실적]에서 양품·불량·실투입량을 입력하면 <b>생산수율·자재수율·계획달성률</b>이 자동 계산됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">2</span><div class="flex-1"><b>생산 일정</b>에서 월간 캘린더·간트로 계획, 작업지시, 숙성기간, 발주 입고예정일을 한눈에 봅니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">3</span><div class="flex-1"><b>수율 분석</b>에서 공정별 평균 수율과 월별 추이를 확인. 수율이 떨어지면 원인 공정을 바로 찾을 수 있습니다.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>🧬 알레르겐 · 규제</b>'+
    '<div class="gd-step"><span class="gd-num">1</span><div class="flex-1">원료 마스터 → <b>[🧬 알레르겐 프로파일 관리]</b> → 공급사 알레르겐 XLS를 그대로 업로드하면 EU 26종 %가 자동 인식됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">2</span><div class="flex-1">알레르겐 계산 화면에서 제품을 고르면 <b>완제품 함량과 표기의무(leave-on 0.001%)</b>가 판정되고, 전성분 표기 문구가 생성됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">3</span><div class="flex-1">MSDS·IFRA 인증서 등 문서 원본은 드라이브에 보관하고 ERP 문서관리에 등록 정보만 남기세요.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>📚 문서센터 — 모든 서류의 단일 관문</b>'+
    '<div class="gd-step"><span class="gd-num">정기</span><div class="flex-1">월간 원자재 수불부 · 생산월보 · 연간 생산실적 집계표</div></div>'+
    '<div class="gd-step"><span class="gd-num">LOT</span><div class="flex-1">제조·품질관리기록서(CGMP) · 제조기록서(간이) · 품질검사성적서 · 제품표준서 · <b>LOT 추적성 패키지</b>(감사·리콜 대응 일괄 출력)</div></div>'+
    '<div class="gd-step"><span class="gd-num">거래</span><div class="flex-1">거래명세서(부가세 포함/별도/면세) · 부가세 신고 기초자료 · 출고기록서 · 견적서</div></div>'+
    '<div class="gd-step"><span class="gd-num">점검</span><div class="flex-1">위생점검일지 · 설비점검일지 · 교육이수 대장 — 입력하면 월별 일지로 출력됩니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">서명</span><div class="flex-1">모든 출력물 하단에 <b>작성 계정·출력일시</b> 전자 스탬프가 자동으로 찍히며, 승인자 서명란이 포함됩니다. 보존기간 5년.</div></div>'+
  '</div>'+

  '<div class="gd-sec"><b>⚠️ 꼭 지킬 것</b>'+
    '<div class="gd-step"><span class="gd-num">!</span><div class="flex-1"><b>제품 충전량(fillWeight) 변경 금지</b> — 값이 있으면 BOM 수량을 %로, 없으면 절대량(g)으로 해석합니다. 도중에 바꾸면 원료 소요량이 통째로 달라집니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">!</span><div class="flex-1"><b>단위는 g 기준 통일</b> — 입고·BOM·실사 모두 g. kg으로 섞으면 재고와 소요량이 어긋납니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">!</span><div class="flex-1"><b>기록 없으면 서류도 없습니다</b> — 배합·충진·검사·이관을 ERP에 그때그때 입력해야 제조기록서·수불부·추적성 패키지가 채워집니다.</div></div>'+
    '<div class="gd-step"><span class="gd-num">!</span><div class="flex-1"><b>전체 초기화 전 백업 파일 보관</b> — 자동 다운로드되는 JSON을 지우지 마세요.</div></div>'+
  '</div>'+

  '<div style="font-size:10px;color:#94a3b8">확장 모듈은 nose-modules.js 파일 하나로 관리됩니다. 업데이트 시 이 파일만 교체하면 되며, index.html은 수정하지 않습니다.</div>'+
'</div>';

function injectGuide(){
  var page = $('page-guide');
  if(!page || $('nose-guide-v22')) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = GUIDE_HTML;
  var target = page.querySelector('.card') || page.firstElementChild;
  if(target && target.parentNode) target.parentNode.insertBefore(wrap.firstChild, target);
  else page.appendChild(wrap.firstChild);
}

window.printNoseGuide = function(){
  var el = $('nose-guide-v22'); if(!el) return;
  var css = '@page{size:A4;margin:14mm}body{font-family:"Noto Sans KR","Malgun Gothic",sans-serif;font-size:11px;line-height:1.6;color:#111}'+
    'h1{font-size:19px;text-align:center;margin-bottom:2px}.sub{text-align:center;color:#666;font-size:10px;margin-bottom:12px}'+
    '.gd-sec{margin:12px 0;page-break-inside:avoid}.gd-sec>b{display:block;font-size:12.5px;color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:2px;margin-bottom:5px}'+
    '.gd-step{display:flex;gap:8px;padding:3px 0;border-bottom:1px dotted #ddd}'+
    '.gd-num{min-width:44px;font-weight:800;color:#0f766e;font-size:10px}button{display:none}';
  var body = '<h1>SHIFTI ERP 운영가이드</h1><div class="sub">주식회사 메디센츠 · 확장 모듈 v2.2 · 출력 '+new Date().toISOString().split('T')[0]+'</div>' + el.innerHTML;
  var w2 = window.open('', '_blank');
  if(!w2){ if(typeof toast==='function') toast('팝업이 차단되었습니다','error'); return; }
  w2.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>SHIFTI ERP 운영가이드</title><style>'+css+'</style></head><body>'+body+
    '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
  w2.document.close();
};

var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='guide') injectGuide();
};
function boot(){ injectGuide(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __gKeep = setInterval(injectGuide, 3000);
setTimeout(function(){ clearInterval(__gKeep); }, 90000);
})();

/* ═══════════ 모듈: AI 조향 코파일럿 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var F = function(v){ return Math.round(N(v)).toLocaleString(); };
var TODAY = function(){ return new Date().toISOString().split('T')[0]; };
var TH_LEAVE = 0.001;
var A26MAP = {'127-51-5':'알파-이소메틸이오논','122-40-7':'아밀신남알','101-85-9':'아밀신나밀알코올','105-13-5':'아니스알코올','100-51-6':'벤질알코올','120-51-4':'벤질벤조에이트','103-41-3':'벤질신나메이트','118-58-1':'벤질살리실레이트','80-54-6':'부틸페닐메틸프로피오날','104-55-2':'신남알','104-54-1':'신나밀알코올','5392-40-5':'시트랄','106-22-9':'시트로넬올','91-64-5':'쿠마린','97-53-0':'유제놀','90028-67-4':'트리모스추출물','90028-68-5':'오크모스추출물','4602-84-0':'파네솔','106-24-1':'제라니올','101-86-0':'헥실신남알','107-75-5':'하이드록시시트로넬알','31906-04-4':'하이드록시이소헥실','97-54-1':'이소유제놀','5989-27-5':'리모넨','78-70-6':'리날룰','111-12-6':'메틸헵틴카보네이트'};

/* ════════ 페이지 주입 ════════ */
function injectUI(){
  if($('page-perfume-ai')) return;
  var anchor = $('page-allergen-report') || $('page-doc-center') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-perfume-ai'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">🧪 AI 조향 코파일럿</h2>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:600">컨셉 → 처방 제안 → ERP 실시간 검증(재고·원가·IFRA·알레르겐) → 시제품 작업지시 발행. 향의 조화는 마지막에 사람이 시향으로 판단합니다.</div>'+
    '<div class="card p-4 space-y-2">'+
      '<h3 class="font-bold text-slate-700 text-sm">1️⃣ 컨셉 정의</h3>'+
      '<div class="grid grid-cols-2 xl:grid-cols-4 gap-2">'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">감정·상태</label><select id="pf-emotion" class="input-field"><option>불안 완화</option><option>집중</option><option>활력</option><option>휴식·수면</option><option>회복</option><option>자존감·기분전환</option></select></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">계열</label><select id="pf-family" class="input-field"><option>우디</option><option>플로럴</option><option>시트러스</option><option>오리엔탈</option><option>그린·허벌</option><option>머스크</option></select></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">목표 원가 (원/EA)</label><input id="pf-cost" type="number" class="input-field text-right" value="8000"></div>'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">충전량 (g/EA)</label><input id="pf-fill" type="number" class="input-field text-right" value="30"></div>'+
      '</div>'+
      '<div class="grid grid-cols-2 gap-2">'+
        '<input id="pf-note" class="input-field" placeholder="추가 요구 (예: 발효주정, 천연유래 98% 이상, 오크모스 제외)">'+
        '<button class="btn btn-secondary" onclick="copyPfPrompt()">📋 노즈용 요청문 복사</button>'+
      '</div>'+
      '<div style="font-size:10px;color:#64748b">요청문을 복사해 노즈에게 붙여넣으면 처방을 만들어 드립니다. 받은 처방을 아래에 붙여넣으세요.</div>'+
    '</div>'+
    '<div class="card p-4 space-y-2">'+
      '<h3 class="font-bold text-slate-700 text-sm">2️⃣ 처방 입력 (원료명 [탭] 배합비%)</h3>'+
      '<textarea id="pf-formula" class="input-field" rows="6" placeholder="Ethanol 99%	78&#10;AnnE Fragrance Oil	12&#10;DPG	10"></textarea>'+
      '<button class="btn btn-primary w-full" onclick="validateFormula()">⚗️ ERP 검증 실행</button>'+
    '</div>'+
    '<div id="pf-result"></div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var nav = $('nav-allergen-report');
  if(nav && !$('nav-perfume-ai')){
    var n = document.createElement('div');
    n.id='nav-perfume-ai'; n.className='nav-item'; n.setAttribute('onclick',"goPage('perfume-ai')");
    n.innerHTML='<i data-lucide="flask-conical" class="w-4 h-4 shrink-0"></i> 🧪 AI 조향 코파일럿';
    nav.parentNode.insertBefore(n, nav);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
}

/* ════════ 요청문 생성 ════════ */
window.copyPfPrompt = function(){
  var raws = (db.master.M_RAW||[]).map(function(r){
    var st = stockOfRaw(r.rawId);
    return '- '+r.name+' (INCI '+(r.inci||'-')+', 재고 '+F(st)+'g, 단가 '+F(r.stdCost?r.stdCost/1000:0)+'원/g'+(r.ifraLimit?', IFRA한도 '+r.ifraLimit+'%':'')+')';
  }).join('\n');
  var txt =
'노즈, SHIFTI 신제품 처방을 제안해줘.\n\n'+
'[컨셉]\n- 감정·상태: '+$('pf-emotion').value+'\n- 계열: '+$('pf-family').value+
'\n- 목표 원가: '+$('pf-cost').value+'원/EA\n- 충전량: '+$('pf-fill').value+'g\n'+
($('pf-note').value?'- 추가 요구: '+$('pf-note').value+'\n':'')+
'\n[사용 가능 원료 — 우리 창고 재고]\n'+raws+
'\n\n[요청]\n위 원료만 사용해 후보 처방 3개를 제안해줘. 각 처방은 "원료명[탭]배합비%" 형식으로, 합계 100%가 되게. '+
'처방마다 예상 원가와 향의 구조(탑/미들/베이스)를 한 줄로 설명해줘.';
  try{
    navigator.clipboard.writeText(txt);
    if(typeof toast==='function') toast('요청문을 복사했습니다. 노즈 대화창에 붙여넣으세요.','success');
  }catch(e){
    var ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); if(typeof toast==='function') toast('요청문 복사 완료','success'); }catch(e2){}
    ta.remove();
  }
};

function stockOfRaw(rawId){
  return (db.stock.RAW_LOT||[]).filter(function(l){
    return String(l.rawId)===String(rawId) && String(l.status||'OK').toUpperCase()!=='FAIL';
  }).reduce(function(s,l){ return s+N(l.remaining); },0);
}
function costOfRaw(r){
  /* 실재고 가중평균 우선, 없으면 표준원가(kg 기준 → g 환산) */
  var lots = (db.stock.RAW_LOT||[]).filter(function(l){ return String(l.rawId)===String(r.rawId) && N(l.remaining)>0 && String(l.status||'OK').toUpperCase()!=='FAIL'; });
  var q=0,v=0;
  lots.forEach(function(l){ q+=N(l.remaining); v+=N(l.remaining)*N(l.unitCost); });
  if(q>0 && v>0) return v/q;                 /* 원/g */
  if(N(r.stdCost)>0) return N(r.stdCost)/1000; /* stdCost는 kg 기준 */
  return 0;
}
function findRawByName(name){
  var nn = String(name||'').toLowerCase().replace(/[\s_\-·.]/g,'');
  var best=null;
  (db.master.M_RAW||[]).forEach(function(r){
    var pn = String(r.name||'').toLowerCase().replace(/[\s_\-·.]/g,'');
    if(!pn) return;
    if(pn===nn){ best={r:r,s:3}; return; }
    if((pn.indexOf(nn)>=0 || nn.indexOf(pn)>=0) && (!best||best.s<2)) best={r:r,s:2};
    var code = String(r.code||'').toLowerCase().replace(/[\s_\-]/g,'');
    if(code && code===nn && (!best||best.s<3)) best={r:r,s:3};
  });
  return best?best.r:null;
}

/* ════════ 검증 엔진 ════════ */
var lastValid = null;
window.validateFormula = function(){
  var fill = N($('pf-fill').value)||30;
  var target = N($('pf-cost').value);
  var lines = ($('pf-formula').value||'').split(/\r?\n/);
  var rows = [], sum = 0, unknown = [];
  lines.forEach(function(line){
    if(!line.trim()) return;
    var cols = line.split(/\t|\s{2,}/).map(function(c){ return c.trim(); }).filter(Boolean);
    if(cols.length<2){ var m=line.trim().match(/^(.*?)[\s]+([\d.]+)\s*%?$/); if(m) cols=[m[1],m[2]]; else return; }
    var pct = N(String(cols[cols.length-1]).replace(/[%,]/g,''));
    var name = cols.slice(0,-1).join(' ');
    if(!name || pct<=0) return;
    var raw = findRawByName(name);
    if(!raw) unknown.push(name);
    rows.push({ name:name, pct:pct, raw:raw });
    sum += pct;
  });
  var box = $('pf-result');
  if(!rows.length){ box.innerHTML='<div class="card p-4" style="color:#c0392b;font-size:12px;font-weight:700">처방을 인식하지 못했습니다. "원료명 [탭] 배합비%" 형식으로 입력하세요.</div>'; return; }

  /* 계산 */
  var costPerEa=0, natNum=0, natDen=0, alg={}, ifraFlags=[], stockFlags=[], maxEa=Infinity;
  rows.forEach(function(r){
    var gPerEa = fill * r.pct/100;
    r.gPerEa = gPerEa;
    if(r.raw){
      var cg = costOfRaw(r.raw);
      r.cost = gPerEa*cg; costPerEa += r.cost;
      var st = stockOfRaw(r.raw.rawId);
      r.stock = st;
      var canEa = gPerEa>0 ? Math.floor(st/gPerEa) : Infinity;
      r.canEa = canEa;
      if(canEa < maxEa) maxEa = canEa;
      if(st <= 0) stockFlags.push(r.raw.name+' 재고 없음');
      /* IFRA */
      var lim = N(r.raw.ifraLimit);
      if(lim>0 && r.pct > lim) ifraFlags.push(r.raw.name+' '+r.pct+'% > 한도 '+lim+'%');
      /* 알레르겐 */
      var p = r.raw.allergenProfile;
      if(p){ Object.keys(p).forEach(function(cas){ alg[cas]=(alg[cas]||0)+(r.pct/100)*N(p[cas]); }); }
      else if(r.raw.isAllergen) r.algUnknown = true;
      /* 천연유래 */
      var ni = r.raw.naturalIndex!=null ? N(r.raw.naturalIndex) : (/ethanol|alcohol|주정/i.test(r.raw.name)?100:null);
      if(ni!=null){ natNum += r.pct*ni; natDen += r.pct; }
    }
  });
  if(!isFinite(maxEa)) maxEa = 0;
  var algRows = Object.keys(alg).filter(function(c){ return alg[c]>0; }).sort(function(a,b){ return alg[b]-alg[a]; });
  var mustLabel = algRows.filter(function(c){ return alg[c]>=TH_LEAVE; });
  var natIdx = natDen>0 ? natNum/natDen : null;
  var sumOk = Math.abs(sum-100) < 0.5;
  var costOk = target<=0 || costPerEa <= target;
  var pass = sumOk && !unknown.length && !ifraFlags.length && !stockFlags.length;
  lastValid = { rows:rows, fill:fill, costPerEa:costPerEa, maxEa:maxEa, pass:pass, mustLabel:mustLabel, alg:alg };

  function kpi(v,l,c){ return '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px"><div style="font-size:17px;font-weight:900;color:'+(c||'#0f172a')+'">'+v+'</div><div style="font-size:10px;font-weight:700;color:#64748b">'+l+'</div></div>'; }
  function flag(txt, ok){ return '<div style="font-size:11.5px;font-weight:700;color:'+(ok?'#059669':'#c2410c')+';padding:3px 0">'+(ok?'✅ ':'⚠️ ')+txt+'</div>'; }

  box.innerHTML =
    '<div class="card p-4 space-y-3" style="border:2px solid '+(pass?'#7fb8a4':'#fca5a5')+'">'+
      '<h3 class="font-bold text-slate-700 text-sm">3️⃣ ERP 검증 결과 '+(pass?'<span style="color:#059669">— 통과</span>':'<span style="color:#c2410c">— 확인 필요</span>')+'</h3>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">'+
        kpi('₩'+F(costPerEa), '원가/EA (충전 '+fill+'g)', costOk?'#0f172a':'#c2410c')+
        kpi(F(maxEa)+' EA', '현재 재고로 생산가능', maxEa>0?'#0f172a':'#c2410c')+
        kpi(sum.toFixed(1)+'%', '배합비 합계', sumOk?'#0f172a':'#c2410c')+
        kpi(natIdx!=null?natIdx.toFixed(1)+'%':'-', '천연유래(지수 입력분 '+natDen.toFixed(0)+'% 기준)')+
        kpi(mustLabel.length+'종', '알레르겐 표기의무', mustLabel.length?'#c2410c':'#059669')+
      '</div>'+
      '<div>'+
        flag('배합비 합계 100% '+(sumOk?'정합':'불일치 ('+sum.toFixed(1)+'%)'), sumOk)+
        (unknown.length?flag('미등록 원료: '+unknown.map(E).join(', ')+' — 원료 마스터에 먼저 등록하세요', false):flag('모든 원료가 마스터에 등록됨', true))+
        (ifraFlags.length?flag('IFRA 한도 초과: '+ifraFlags.map(E).join(' / '), false):flag('IFRA 한도 이내', true))+
        (stockFlags.length?flag('재고 부족: '+stockFlags.map(E).join(', '), false):flag('전 원료 재고 보유', true))+
        (target>0?flag('목표 원가 '+F(target)+'원 대비 '+(costOk?'충족':'초과 (+'+F(costPerEa-target)+'원)'), costOk):'')+
      '</div>'+
      '<table style="width:100%;font-size:11px"><tr><th style="text-align:left">원료</th><th>배합비</th><th>g/EA</th><th>원가/EA</th><th>재고(g)</th><th>가능수량</th></tr>'+
      rows.map(function(r){
        return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(r.raw?r.raw.name:r.name)+(r.raw?'':' <b style="color:#c0392b">(미등록)</b>')+(r.algUnknown?' <span style="color:#b8860b">알레르겐 프로파일 미입력</span>':'')+'</td>'+
          '<td style="text-align:right">'+r.pct+'%</td><td style="text-align:right">'+r.gPerEa.toFixed(2)+'</td>'+
          '<td style="text-align:right">'+(r.raw?F(r.cost):'-')+'</td>'+
          '<td style="text-align:right">'+(r.raw?F(r.stock):'-')+'</td>'+
          '<td style="text-align:right;font-weight:800;color:'+(r.raw&&r.canEa<=0?'#c2410c':'#0f172a')+'">'+(r.raw?(isFinite(r.canEa)?F(r.canEa):'-'):'-')+'</td></tr>';
      }).join('')+'</table>'+
      (algRows.length?'<div style="background:#f8fafc;border-radius:8px;padding:8px 10px;font-size:11px">'+
        '<b>알레르겐 판정</b> (완제품 기준)<br>'+
        algRows.map(function(c){ return (A26MAP[c]||c)+' '+alg[c].toFixed(4)+'%'+(alg[c]>=TH_LEAVE?' <b style="color:#c2410c">표기</b>':' <span style="color:#94a3b8">면제</span>'); }).join(' · ')+
        (mustLabel.length?'<br><b>전성분 표기 문구:</b> '+mustLabel.map(function(c){ return A26MAP[c]||c; }).join(', '):'')+
      '</div>':'')+
      '<div class="grid grid-cols-2 gap-2">'+
        '<input id="pf-name" class="input-field" placeholder="제품명 (예: 시프트아이_고요 30ml)">'+
        '<button class="btn btn-primary" onclick="createTrialProduct()">🧾 제품·BOM 등록 + 시제품 지시 발행</button>'+
      '</div>'+
      '<div style="font-size:10px;color:#94a3b8">※ 검증은 재고·원가·규제 적합성만 판단합니다. 향의 조화·확산력·잔향은 시제품 시향으로 확인하세요.</div>'+
    '</div>';
};

/* ════════ 제품·BOM 등록 + 시제품 작업지시 ════════ */
window.createTrialProduct = function(){
  if(!lastValid){ return; }
  var name = ($('pf-name').value||'').trim();
  if(!name){ if(typeof toast==='function') toast('제품명을 입력하세요','error'); return; }
  var missing = lastValid.rows.filter(function(r){ return !r.raw; });
  if(missing.length){ if(typeof toast==='function') toast('미등록 원료가 있어 등록할 수 없습니다: '+missing[0].name,'error'); return; }
  var pid = Date.now();
  var bom = lastValid.rows.map(function(r){ return { type:'RAW', itemId:r.raw.rawId, qty:r.pct }; });
  db.master.M_PRODUCT.push({ productId: pid, name: name, fillWeight: lastValid.fill, bom: bom, costing:{lossRate:0}, note:'AI 조향 코파일럿 생성' });

  db.txn = db.txn||{};
  db.txn.T_PROD_PLAN = db.txn.T_PROD_PLAN||[];
  db.txn.T_WORK_ORDER = db.txn.T_WORK_ORDER||[];
  var trialQty = Math.max(1, Math.min(10, lastValid.maxEa||1));
  var planId = (typeof generateId==='function')?generateId('PLAN'):'PLAN'+Date.now();
  db.txn.T_PROD_PLAN.push({ id:planId, no:'PP-TRIAL-'+TODAY().replace(/-/g,'').slice(2), productId:pid, qty:trialQty, date:TODAY(), status:'계획', note:'시제품(AI 코파일럿)' });
  var woId = (typeof generateId==='function')?generateId('WO'):'WO'+Date.now();
  db.txn.T_WORK_ORDER.push({ id:woId, no:'WO-TRIAL-'+TODAY().replace(/-/g,'').slice(2), planId:planId, date:TODAY(), worker:'', process:'조향/벌크배합', status:'대기', note:'시제품 시향용' });

  if(typeof logEvent==='function') logEvent('AI 조향: 제품 등록 '+name+' + 시제품 지시 '+trialQty+'EA');
  if(typeof toast==='function') toast(name+' 등록 완료 · 시제품 '+trialQty+'EA 작업지시 발행됨 (작업지시 화면에서 시작)','success');
  saveDB();
};

/* ════════ 라우팅·부트 ════════ */
var _init = window.initNewPage;
window.initNewPage = function(pageId){
  try{ if(typeof _init==='function') _init(pageId); }catch(e){}
  if(pageId==='perfume-ai') injectUI();
};
function boot(){ injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1500);
var __pfKeep = setInterval(injectUI, 3000);
setTimeout(function(){ clearInterval(__pfKeep); }, 90000);
})();

/* ═══════════ 모듈: 간편 기록 모드 v1.0 ═══════════ */
(function(){
'use strict';
var $ = function(id){ return document.getElementById(id); };
var N = function(v){ var x=Number(v); return isFinite(x)?x:0; };
var E = function(v){ return (typeof escH==='function') ? escH(v) : String(v==null?'':v); };
var F = function(v){ return Math.round(N(v)).toLocaleString(); };
var TODAY = function(){ return new Date().toISOString().split('T')[0]; };
function genId(p){ return (typeof generateId==='function') ? generateId(p) : p+'-'+Date.now()+Math.floor(Math.random()*999); }
function ensure(){ if(window.db){ db.txn=db.txn||{}; db.txn.T_STOCK_MOVE=db.txn.T_STOCK_MOVE||[]; db.txn.T_QUICK=db.txn.T_QUICK||[]; } }

function injectUI(){
  if($('page-quick-log')) return;
  if(!$('ql-style')){
    var st=document.createElement('style');
    st.id='ql-style';
    st.textContent=[
      '#page-quick-log table{font-size:13.5px}',
      '#page-quick-log th{font-size:12px;font-weight:900;color:#0f172a;background:#eef5f2;padding:7px 6px}',
      '#page-quick-log td{padding:7px 6px;color:#0f172a}',
      '#page-quick-log input.input-field,#page-quick-log select.input-field{font-size:15px !important;padding:8px 10px !important;font-weight:800;color:#0f172a;border:1.5px solid #cbd5e1;border-radius:8px;min-height:40px}',
      '#page-quick-log input.input-field:focus{border-color:#0f766e;outline:2px solid #99f6e4}',
      '#page-quick-log input::placeholder{color:#94a3b8;font-weight:600}',
      '#page-quick-log .ql-book{display:inline-block;font-size:12px;font-weight:800;color:#0f766e;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px;padding:2px 7px;margin-top:3px}',
      '#page-quick-log .mes-tab{font-size:13.5px;padding:8px 16px}',
      '#page-quick-log .ql-name{font-size:14px;font-weight:900;color:#0f172a}',
      '@media(max-width:768px){#page-quick-log table{font-size:13px}#page-quick-log .ql-name{font-size:13.5px}}'
    ].join('\n');
    document.head.appendChild(st);
  }
  var anchor = $('page-dashboard') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-quick-log'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">⚡ 간편 기록 (주간 정리) <span style="font-size:10px;font-weight:700;color:#0f766e;background:#e7efed;border-radius:6px;padding:2px 7px;vertical-align:middle">모듈 v5.2</span></h2>'+
    '<div style="font-size:10.5px;color:#64748b;font-weight:600">평일엔 안 적어도 됩니다. 주말에 여기서 한 번에 정리하면 뒤에서 LOT·원가·수불부·제조기록이 자동으로 채워집니다.</div>'+
    '<div class="card p-4 space-y-2">'+
      '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
        '<span class="mes-tab on" id="ql-tab-week" onclick="qlTab(\'week\')">📅 주간정산</span>'+
        '<span class="mes-tab" id="ql-tab-prod" onclick="qlTab(\'prod\')">🏭 생산</span>'+
        '<span class="mes-tab" id="ql-tab-move" onclick="qlTab(\'move\')">🚚 매장출고</span>'+
        '<span class="mes-tab" id="ql-tab-sale" onclick="qlTab(\'sale\')">💰 판매</span>'+
        '<input id="ql-date" type="date" class="input-field" style="width:150px;margin-left:auto" value="'+TODAY()+'">'+
      '</div>'+
      '<div id="ql-desc" style="font-size:10.5px;color:#0f766e;font-weight:700"></div>'+
      '<div id="ql-body"></div>'+
    '</div>'+
    '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">최근 간편 기록</h3></div>'+
      '<div class="scroll-card"><table><thead><tr><th class="pl-3">일자</th><th>구분</th><th>내용</th><th class="text-right pr-3">비고</th></tr></thead><tbody id="ql-history"></tbody></table></div></div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var navD = $('nav-dashboard');
  if(navD && !$('nav-quick-log')){
    var n=document.createElement('div');
    n.id='nav-quick-log'; n.className='nav-item'; n.setAttribute('onclick',"goPage('quick-log')");
    n.innerHTML='<i data-lucide="zap" class="w-4 h-4 shrink-0"></i> ⚡ 간편 기록';
    navD.parentNode.insertBefore(n, navD.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
}

var qlMode='week';
window.qlTab=function(m){
  qlMode=m;
  ['week','prod','move','sale'].forEach(function(k){ var t=$('ql-tab-'+k); if(t) t.classList.toggle('on', k===m); });
  renderQl();
};

/* ════════ 주간 정산: 세고 → 넣고 → 한 번에 반영 ════════ */
function weekProducts(){
  /* 제품 마스터 전체 + 마스터 없는 재고까지 표시 */
  var list=(db.master.M_PRODUCT||[]).map(function(p){
    return { pid:p.productId, name:p.name,
      f: fgtStock(p.productId,'공장').reduce(function(s,l){return s+N(l.remaining);},0),
      l: fgtStock(p.productId,'물류센터').reduce(function(s,l){return s+N(l.remaining);},0),
      s: fgtStock(p.productId,'매장').reduce(function(s,l){return s+N(l.remaining);},0),
      price:N(p.price)||0, noBom:!(p.bom&&p.bom.length) };
  });
  var seen={}; list.forEach(function(x){ seen[x.pid]=1; });
  (db.stock.FGT_LOT||[]).forEach(function(lt){
    if(seen[lt.productId]||N(lt.remaining)<=0) return;
    seen[lt.productId]=1;
    list.push({ pid:lt.productId, name:'(마스터 없음) '+lt.productId,
      f:fgtStock(lt.productId,'공장').reduce(function(s,x){return s+N(x.remaining);},0),
      l:fgtStock(lt.productId,'물류센터').reduce(function(s,x){return s+N(x.remaining);},0),
      s:fgtStock(lt.productId,'매장').reduce(function(s,x){return s+N(x.remaining);},0),
      price:0, noBom:true });
  });
  return list.sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
}
function weekRaws(){
  var ids={};
  (db.stock.RAW_LOT||[]).forEach(function(l){ if(N(l.remaining)>0 && String(l.status||'OK').toUpperCase()!=='FAIL') ids[l.rawId]=1; });
  return Object.keys(ids).map(function(id){
    var r=(db.master.M_RAW||[]).find(function(x){ return String(x.rawId)===String(id); });
    return { rid: isNaN(Number(id))?id:Number(id), name:r?r.name:id,
      book:(db.stock.RAW_LOT||[]).filter(function(l){ return String(l.rawId)===String(id) && String(l.status||'OK').toUpperCase()!=='FAIL'; })
        .reduce(function(s,l){ return s+N(l.remaining); },0) };
  }).sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
}
var wkP=[], wkR=[];
function renderWeek(){
  wkP=weekProducts(); wkR=weekRaws();
  var h =
  '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">'+
    '<span style="font-size:12px;color:#0f766e;font-weight:800;flex:1">① <b>생산·보낸 수량</b> ② <b>판매 수량</b>(택배·매장, 알면 입력) ③ <b>실물 수량</b>. 빈칸은 "변동 없음"이며, 판매를 적으면 그만큼 매출로 잡고 나머지 차이는 손실·오차로 조정합니다.</span>'+
    '<button class="btn btn-secondary btn-sm" onclick="exportWeekXlsx(\'blank\')">📥 실사양식 받기</button>'+
    '<button class="btn btn-primary btn-sm" onclick="document.getElementById(\'wk-file\').click()">📤 작성본 올리기</button>'+
    '<input type="file" id="wk-file" accept=".xlsx,.xls" style="display:none" onchange="importWeekXlsx(this.files&&this.files[0]);this.value=\'\';">'+
    '<button class="btn btn-secondary btn-sm" onclick="exportWeekXlsx(\'full\')">📊 현재값 엑셀</button>'+
    '<button class="btn btn-secondary btn-sm" onclick="refreshWeek()">🔄 새로고침</button>'+
  '</div>'+
  '<div style="overflow-x:auto"><table style="width:100%;min-width:1020px">'+
  '<tr><th style="text-align:left">제품</th>'+
    '<th style="width:9%">🏭 생산</th>'+
    '<th style="width:11%">→ 물류센터</th>'+
    '<th style="width:11%">→ 매장</th>'+
    '<th style="width:13%">🏭 공장 실물</th>'+
    '<th style="width:13%">📦 물류 실물</th>'+
    '<th style="width:13%">🏬 매장 실물</th>'+
    '<th style="width:11%">📮 택배 판매</th>'+
    '<th style="width:11%">🛒 매장 판매</th>'+
    '<th style="width:11%">판매단가</th></tr>'+
  wkP.map(function(p,i){
    return '<tr style="border-top:1px solid #e2e8f0"><td><span class="ql-name">'+E(p.name)+'</span>'+
      (p.noBom?' <span style="font-size:10px;color:#c2410c;font-weight:900">BOM 없음</span>':'')+'</td>'+
      '<td><input id="wk-prod-'+i+'" type="number" min="0" class="input-field text-right" placeholder="0"></td>'+
      '<td><input id="wk-mvl-'+i+'" type="number" min="0" class="input-field text-right" placeholder="0"></td>'+
      '<td><input id="wk-mvs-'+i+'" type="number" min="0" class="input-field text-right" placeholder="0"></td>'+
      '<td><input id="wk-cf-'+i+'" type="number" min="0" class="input-field text-right" placeholder="'+p.f+'"><span class="ql-book">장부 '+F(p.f)+'</span></td>'+
      '<td><input id="wk-cl-'+i+'" type="number" min="0" class="input-field text-right" placeholder="'+p.l+'"><span class="ql-book">장부 '+F(p.l)+'</span></td>'+
      '<td><input id="wk-cs-'+i+'" type="number" min="0" class="input-field text-right" placeholder="'+p.s+'"><span class="ql-book">장부 '+F(p.s)+'</span></td>'+
      '<td><input id="wk-sl-'+i+'" type="number" min="0" class="input-field text-right" placeholder="0"></td>'+
      '<td><input id="wk-ss-'+i+'" type="number" min="0" class="input-field text-right" placeholder="0"></td>'+
      '<td><input id="wk-pr-'+i+'" type="number" class="input-field text-right" placeholder="'+(p.price||'단가')+'"></td></tr>';
  }).join('')+'</table></div>'+
  (wkR.length?
  '<div style="font-size:12px;color:#0f766e;font-weight:800;margin:10px 0 4px">③ 원료 실물 (g) — 생산 반영 후 남은 양</div>'+
  '<div style="overflow-x:auto"><table style="width:100%"><tr><th style="text-align:left">원료</th><th style="width:22%">현재 장부</th><th style="width:26%">실물(g)</th></tr>'+
  wkR.map(function(r,i){
    return '<tr style="border-top:1px solid #e2e8f0"><td><span class="ql-name">'+E(r.name)+'</span></td>'+
      '<td style="text-align:right"><span class="ql-book">'+F(r.book)+' g</span></td>'+
      '<td><input id="wk-raw-'+i+'" type="number" step="0.01" class="input-field text-right" placeholder="'+Math.round(r.book)+'"></td></tr>';
  }).join('')+'</table></div>':'')+
  '<div class="grid grid-cols-2 gap-2" style="margin-top:10px">'+
    '<select id="wk-cause" class="input-field"><option value="판매">물류·매장 감소분 = 판매로 처리</option><option value="조정">물류·매장 감소분 = 테스터·파손(매출 없음)</option></select>'+
    '<input id="wk-worker" class="input-field" placeholder="작성자">'+
  '</div>'+
  '<button class="btn btn-primary w-full" style="margin-top:8px" onclick="commitWeek()">📅 주간 정산 실행 (생산·이동·판매·조정 한 번에)</button>'+
  '<div id="ql-msg" style="font-size:13px;font-weight:800;margin-top:8px;line-height:1.7"></div>';
  return h;
}
window.refreshWeek=function(){ var b=$('ql-body'); if(b) b.innerHTML=renderWeek(); if(typeof toast==='function') toast('제품 목록을 새로 불러왔습니다','success'); };

/* 위치 간 이관 (공장 → 대상) */
function wkMove(pid, qty, to, date, log, warn, name){
  if(qty<=0) return;
  var lots=fgtStock(pid,'공장').sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
  var rest=qty, moved=0;
  lots.forEach(function(src){
    if(rest<=0) return;
    var t=Math.min(N(src.remaining),rest); src.remaining=N(src.remaining)-t; rest-=t; moved+=t;
    var d=(db.stock.FGT_LOT||[]).find(function(x){ return x.lotNo===src.lotNo&&String(x.productId)===String(src.productId)&&(x.location||'공장')===to; });
    if(d){ d.remaining=N(d.remaining)+t; d.qty=N(d.qty)+t; }
    else db.stock.FGT_LOT.push({id:genId('FGT'),lotNo:src.lotNo,productId:src.productId,qty:t,remaining:t,unitCost:src.unitCost,expDate:src.expDate,status:'OK',location:to,note:'주간정산 이관'});
    db.txn.T_STOCK_MOVE.push({id:genId('MV'),date:date,lotNo:src.lotNo,productId:src.productId,qty:t,from:'공장',to:to,note:'주간정산'});
  });
  if(moved>0) log.push(name+' → '+to+' '+moved);
  if(rest>0) warn.push(name+': 공장 부족 '+rest+' 미이관');
}
/* 판매 수량 직접 처리: 해당 위치에서 차감하고 매출 계상 */
function wkSell(p, loc, qty, price, date, log, warn){
  if(qty<=0) return;
  var lots=fgtStock(p.pid,loc).sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
  var rest=qty, sold=0;
  lots.forEach(function(src){
    if(rest<=0) return;
    var t=Math.min(N(src.remaining),rest); src.remaining=N(src.remaining)-t; rest-=t; sold+=t;
    db.txn.T_SALE.push({id:genId('SALE'),date:date,customerId:null,productId:p.pid,lotNo:src.lotNo,
      qty:t,unitPrice:price,amount:t*price,note:'주간정산 판매('+(loc==='물류센터'?'택배':'매장')+')'});
  });
  if(sold>0) log.push(p.name+' · '+(loc==='물류센터'?'택배':'매장')+' 판매 '+sold+(price?' ₩'+F(sold*price):''));
  if(rest>0) warn.push(p.name+': '+loc+' 재고 부족으로 판매 '+rest+'EA 미반영');
  if(sold>0 && !price) warn.push(p.name+': 판매단가 미입력 (매출 0원 기록)');
}

/* 실물 대비 차이 반영: 감소분을 판매 또는 조정으로 */
function wkReconcile(p, loc, actual, price, cause, date, log, warn){
  var book=fgtStock(p.pid,loc).reduce(function(s,l){return s+N(l.remaining);},0);
  var diff=book-actual;
  if(Math.abs(diff)<0.001) return;
  if(diff>0){
    var lots=fgtStock(p.pid,loc).sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
    var rest=diff;
    lots.forEach(function(src){
      if(rest<=0) return;
      var t=Math.min(N(src.remaining),rest); src.remaining=N(src.remaining)-t; rest-=t;
      var sellable=(loc==='물류센터'||loc==='매장') && cause==='판매';
      if(sellable){
        db.txn.T_SALE.push({id:genId('SALE'),date:date,customerId:null,productId:p.pid,lotNo:src.lotNo,qty:t,unitPrice:price,amount:t*price,note:'주간정산('+loc+')'});
      } else {
        db.txn.T_STOCK_MOVE.push({id:genId('MV'),date:date,lotNo:src.lotNo,productId:p.pid,qty:t,from:loc,to:(sellable?'(판매)':'(조정)'),note:'주간정산 조정'});
      }
    });
    var kind=((loc==='물류센터'||loc==='매장')&&cause==='판매')?'판매':'조정';
    log.push(p.name+' · '+loc+' '+F(book)+'→'+F(actual)+' ('+kind+' '+diff+(kind==='판매'&&price?' ₩'+F(diff*price):'')+')');
    if(kind==='판매' && !price) warn.push(p.name+': 판매단가 미입력 (매출 0원 기록)');
  } else {
    db.stock.FGT_LOT.push({id:genId('FGT'),lotNo:'ADJ-'+String(date).replace(/-/g,'').slice(2),productId:p.pid,qty:-diff,remaining:-diff,unitCost:0,status:'OK',location:loc,dateIn:date,note:'주간정산 실사 증가'});
    log.push(p.name+' · '+loc+' '+F(book)+'→'+F(actual)+' (실사 증가 +'+(-diff)+')');
  }
}
/* ── 실사양식 엑셀 업로드 → 표에 자동 채움 ── */
function normName(x){ return String(x||'').trim().toLowerCase().replace(/[\s_\-·.]/g,''); }
window.importWeekXlsx=function(file){
  if(!file) return;
  if(!window.XLSX){ if(typeof toast==='function') toast('엑셀 모듈 로드 실패 — 새로고침 후 다시 시도하세요','error'); return; }
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
      if(!wkP.length){ wkP=weekProducts(); wkR=weekRaws(); }
      var filled=0, unknown=[], sheetP=null, sheetR=null;
      wb.SheetNames.forEach(function(n){
        if(/완제품|product/i.test(n)) sheetP=wb.Sheets[n];
        else if(/원료|raw/i.test(n)) sheetR=wb.Sheets[n];
      });
      if(!sheetP) sheetP=wb.Sheets[wb.SheetNames[0]];

      /* 완제품 시트: 헤더에서 열 위치를 찾아 매핑 (열 순서가 바뀌어도 동작) */
      var rows=XLSX.utils.sheet_to_json(sheetP,{header:1,defval:''});
      var hdrIdx=-1, col={};
      for(var i=0;i<Math.min(rows.length,10);i++){
        var r=rows[i].map(function(c){ return String(c||'').trim(); });
        if(r.some(function(c){ return /제품/.test(c); }) && r.some(function(c){ return /실물|생산/.test(c); })){
          hdrIdx=i;
          r.forEach(function(c,j){
            if(/^제품/.test(c)) col.name=j;
            else if(/생산/.test(c)) col.prod=j;
            else if(/물류센터$|→\s*물류/.test(c)) col.mvl=j;
            else if(/매장$|→\s*매장/.test(c)) col.mvs=j;
            else if(/택배.*판매/.test(c)) col.sl=j;
            else if(/매장.*판매/.test(c)) col.ss=j;
            else if(/공장.*실물/.test(c)) col.cf=j;
            else if(/물류.*실물/.test(c)) col.cl=j;
            else if(/매장.*실물/.test(c)) col.cs=j;
            else if(/단가/.test(c)) col.price=j;
          });
          break;
        }
      }
      if(hdrIdx<0 || col.name==null){ if(typeof toast==='function') toast('양식을 인식하지 못했습니다. [실사양식 받기]로 받은 파일을 사용하세요','error'); return; }

      var map={};
      wkP.forEach(function(p,i){ map[normName(p.name)]=i; });
      for(var k=hdrIdx+1;k<rows.length;k++){
        var row=rows[k]; if(!row||!row.length) continue;
        var nm=String(row[col.name]||'').trim();
        if(!nm || /^합계$/.test(nm)) continue;
        var idx=map[normName(nm)];
        if(idx==null){ unknown.push(nm); continue; }
        [['prod','wk-prod-'],['mvl','wk-mvl-'],['mvs','wk-mvs-'],['sl','wk-sl-'],['ss','wk-ss-'],['cf','wk-cf-'],['cl','wk-cl-'],['cs','wk-cs-'],['price','wk-pr-']].forEach(function(pair){
          var c=col[pair[0]]; if(c==null) return;
          var v=row[c];
          if(v===''||v==null) return;
          var num=N(String(v).replace(/,/g,''));
          if(!isFinite(num)) return;
          var el=$(pair[1]+idx); if(!el) return;
          el.value=num; filled++;
        });
      }
      /* 원료 시트 */
      if(sheetR && wkR.length){
        var rr=XLSX.utils.sheet_to_json(sheetR,{header:1,defval:''});
        var rmap={}; wkR.forEach(function(r,i){ rmap[normName(r.name)]=i; });
        rr.forEach(function(row){
          var nm=String(row[0]||'').trim();
          if(!nm||/^(원료|합계)$/.test(nm)) return;
          var idx=rmap[normName(nm)]; if(idx==null) return;
          var v=row[2];
          if(v===''||v==null) return;
          var num=N(String(v).replace(/,/g,''));
          var el=$('wk-raw-'+idx); if(el&&isFinite(num)){ el.value=num; filled++; }
        });
      }
      var msg=$('ql-msg');
      if(msg){
        msg.style.color=unknown.length?'#c2410c':'#0f766e';
        msg.innerHTML='📤 엑셀에서 '+filled+'개 값을 표에 채웠습니다. 확인 후 <b>[주간 정산 실행]</b>을 누르세요.'+
          (unknown.length?'<br>⚠️ 매칭되지 않은 항목: '+unknown.slice(0,8).map(E).join(', ')+(unknown.length>8?' 외 '+(unknown.length-8)+'건':''):'');
      }
      if(typeof toast==='function') toast(filled+'개 값 불러오기 완료'+(unknown.length?' (미매칭 '+unknown.length+')':''),'success');
    }catch(err){
      if(typeof toast==='function') toast('파일 해석 실패: '+err,'error');
    }
  };
  reader.readAsArrayBuffer(file);
};

/* ── 주간정산 표 엑셀 다운로드 ── */
window.exportWeekXlsx=function(mode){
  if(!window.XLSX){ if(typeof toast==='function') toast('엑셀 모듈 로드 실패 — 새로고침 후 다시 시도하세요','error'); return; }
  if(!wkP.length) wkP=weekProducts(), wkR=weekRaws();
  var date=($('ql-date')&&$('ql-date').value)||TODAY();
  var withInput = mode!=='blank';
  var head=['제품','판매단가','이번주 생산','→물류센터','→매장','택배 판매','매장 판매','공장 장부','공장 실물','물류 장부','물류 실물','매장 장부','매장 실물','합계 장부'];
  var rows=[head];
  wkP.forEach(function(p,i){
    function v(id){ var e=$(id); return (withInput&&e&&e.value!=='')?N(e.value):''; }
    rows.push([p.name, p.price||'', v('wk-prod-'+i), v('wk-mvl-'+i), v('wk-mvs-'+i),
      v('wk-sl-'+i), v('wk-ss-'+i),
      p.f, v('wk-cf-'+i), p.l, v('wk-cl-'+i), p.s, v('wk-cs-'+i), p.f+p.l+p.s]);
  });
  rows.push([]);
  rows.push(['합계','','','','','','',
    wkP.reduce(function(a,x){return a+x.f;},0),'',
    wkP.reduce(function(a,x){return a+x.l;},0),'',
    wkP.reduce(function(a,x){return a+x.s;},0),'',
    wkP.reduce(function(a,x){return a+x.f+x.l+x.s;},0)]);
  var wb=XLSX.utils.book_new();
  var ws=XLSX.utils.aoa_to_sheet(rows);
  ws['!cols']=[{wch:26},{wch:10},{wch:10},{wch:11},{wch:10},{wch:11},{wch:11},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:10},{wch:11}];
  XLSX.utils.book_append_sheet(wb, ws, '완제품');
  if(wkR.length){
    var r2=[['원료','장부(g)','실물(g)']];
    wkR.forEach(function(r,i){
      var e=$('wk-raw-'+i);
      r2.push([r.name, r.book, (withInput&&e&&e.value!=='')?N(e.value):'']);
    });
    r2.push([]); r2.push(['합계', wkR.reduce(function(a,x){return a+x.book;},0), '']);
    var ws2=XLSX.utils.aoa_to_sheet(r2);
    ws2['!cols']=[{wch:28},{wch:14},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws2, '원료');
  }
  var hist=((db.txn&&db.txn.T_QUICK)||[]).slice(-30).reverse();
  if(hist.length){
    var r3=[['일자','구분','내용','확인 필요','작성자']];
    hist.forEach(function(q){ r3.push([q.date, q.mode==='week'?'주간정산':q.mode, q.summary||'', q.warn||'', q.worker||'']); });
    var ws3=XLSX.utils.aoa_to_sheet(r3);
    ws3['!cols']=[{wch:12},{wch:10},{wch:70},{wch:40},{wch:10}];
    XLSX.utils.book_append_sheet(wb, ws3, '정산이력');
  }
  var fn='주간정산_'+date+(withInput?'':'_실사양식')+'.xlsx';
  XLSX.writeFile(wb, fn);
  if(typeof logEvent==='function') logEvent('주간정산 엑셀 다운로드: '+fn);
  if(typeof toast==='function') toast('엑셀 다운로드: '+fn,'success');
};

window.commitWeek=function(){
  ensure();
  try{ if(typeof migrateLoc==='function') migrateLoc(); }catch(e){}
  var date=$('ql-date').value||TODAY();
  var cause=$('wk-cause').value;
  var log=[], warn=[];
  db.txn.T_BULK=db.txn.T_BULK||[]; db.txn.T_BATCH=db.txn.T_BATCH||[]; db.txn.T_SALE=db.txn.T_SALE||[];

  wkP.forEach(function(p,i){
    var prodQ=N(($('wk-prod-'+i)||{}).value);
    var mvL=N(($('wk-mvl-'+i)||{}).value), mvS=N(($('wk-mvs-'+i)||{}).value);
    var price=N(($('wk-pr-'+i)||{}).value)||p.price||0;
    var prod=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(p.pid); });

    /* 1) 생산 → 공장 입고 */
    if(prodQ>0 && prod){
      var matCost=0, rawUse=[], packUse=[], shortage=[];
      (prod.bom||[]).forEach(function(bm){
        var need=(typeof bomNeed==='function')?bomNeed(prod,bm,prodQ):N(bm.qty)*prodQ;
        var key=bm.type==='PACK'?'PACK_LOT':'RAW_LOT', idk=bm.type==='PACK'?'packId':'rawId';
        var lots=(db.stock[key]||[]).filter(function(x){ return String(x[idk])===String(bm.itemId)&&N(x.remaining)>0&&String(x.status||'OK').toUpperCase()!=='FAIL'; })
          .sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
        var rest=need, picked=[];
        lots.forEach(function(x){ if(rest<=0) return; var t=Math.min(N(x.remaining),rest); x.remaining=N(x.remaining)-t; matCost+=t*N(x.unitCost); rest-=t; picked.push({lotNo:x.lotNo,qty:t,take:t}); });
        if(picked.length){ var rec={type:bm.type||'RAW',itemId:bm.itemId,need:need,lots:picked}; if(bm.type==='PACK') packUse.push(rec); else rawUse.push(rec); }
        if(rest>0) shortage.push((bm.type==='PACK'?'포장재':'원료')+' 부족 '+Math.round(rest*100)/100);
      });
      var lotNo='LOT-'+String(date).replace(/-/g,'').slice(2)+'-'+String(i+1).padStart(2,'0');
      db.stock.FGT_LOT.push({id:genId('FGT'),lotNo:lotNo,productId:p.pid,qty:prodQ,remaining:prodQ,
        unitCost:Math.round(matCost/prodQ),status:'OK',location:'공장',dateIn:date,note:'주간정산 생산'});
      var bulkLot='BLK-'+lotNo.slice(4);
      if(rawUse.length) db.txn.T_BULK.push({id:genId('BULK'),date:date,lotNo:bulkLot,productId:p.pid,qty:prodQ,materials:rawUse,note:'주간정산'});
      db.txn.T_BATCH.push({id:genId('BATCH'),date:date,lotNo:lotNo,productId:p.pid,qty:prodQ,bulkLotNo:bulkLot,consumedLots:packUse,note:'주간정산'});
      db.txn.T_STOCK_MOVE.push({id:genId('MV'),date:date,lotNo:lotNo,productId:p.pid,qty:prodQ,from:'(생산)',to:'공장',note:'주간정산'});
      log.push(p.name+' 생산 '+prodQ);
      if(shortage.length) warn.push(p.name+': '+shortage.join(', '));
      if(!(prod.bom&&prod.bom.length)) warn.push(p.name+': BOM 미설정 — 원료 차감·원가 계산이 되지 않았습니다');
    }

    /* 2) 공장 → 물류센터 / 매장 */
    wkMove(p.pid, mvL, '물류센터', date, log, warn, p.name);
    wkMove(p.pid, mvS, '매장', date, log, warn, p.name);

    /* 3) 판매 수량 직접 입력분 먼저 반영 */
    var sellL=N(($('wk-sl-'+i)||{}).value), sellS=N(($('wk-ss-'+i)||{}).value);
    if(sellL>0) wkSell(p,'물류센터',sellL,price,date,log,warn);
    if(sellS>0) wkSell(p,'매장',sellS,price,date,log,warn);

    /* 4) 실물 대비 정산 — 판매를 직접 적었으면 나머지 차이는 손실·오차로 조정 */
    var cs=$('wk-cs-'+i), cl=$('wk-cl-'+i), cf=$('wk-cf-'+i);
    if(cs && cs.value!=='') wkReconcile(p,'매장',N(cs.value),price,(sellS>0?'조정':cause),date,log,warn);
    if(cl && cl.value!=='') wkReconcile(p,'물류센터',N(cl.value),price,(sellL>0?'조정':cause),date,log,warn);
    if(cf && cf.value!=='') wkReconcile(p,'공장',N(cf.value),price,'조정',date,log,warn);
  });

  /* 4) 원료 실물 조정 */
  wkR.forEach(function(r,i){
    var el=$('wk-raw-'+i); if(!el || el.value==='') return;
    var act=N(el.value);
    var book=(db.stock.RAW_LOT||[]).filter(function(l){ return String(l.rawId)===String(r.rid)&&String(l.status||'OK').toUpperCase()!=='FAIL'; })
      .reduce(function(s,l){ return s+N(l.remaining); },0);
    var d=book-act;
    if(Math.abs(d)<0.001) return;
    if(d>0){
      var lots=(db.stock.RAW_LOT||[]).filter(function(l){ return String(l.rawId)===String(r.rid)&&N(l.remaining)>0; })
        .sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
      var rest=d;
      lots.forEach(function(l){ if(rest<=0) return; var t=Math.min(N(l.remaining),rest); l.remaining=N(l.remaining)-t; rest-=t; });
      log.push(r.name+' 원료 조정 -'+Math.round(d*100)/100+'g');
    } else {
      db.stock.RAW_LOT.push({id:genId('RAW'),rawId:r.rid,lotNo:'ADJ-'+String(date).replace(/-/g,'').slice(2),qty:-d,remaining:-d,unitCost:0,status:'OK',dateIn:date,note:'주간정산 실사 증가'});
      log.push(r.name+' 원료 조정 +'+Math.round(-d*100)/100+'g');
    }
  });

  if(!log.length){
    var anyInput=false;
    wkP.forEach(function(p,i){ ['wk-prod-','wk-mvl-','wk-mvs-','wk-cf-','wk-cl-','wk-cs-','wk-sl-','wk-ss-'].forEach(function(k){ var e=$(k+i); if(e&&e.value!=='') anyInput=true; }); });
    warn.push(anyInput ? '입력값과 장부가 모두 같아 변동이 없습니다 (장부 배지 숫자와 비교해 보세요)' : '입력된 값이 없습니다 — 숫자를 넣고 다시 실행하세요');
  }
  db.txn.T_QUICK.push({id:genId('QL'),date:date,mode:'week',summary:log.join(' / '),warn:warn.join(' / '),worker:($('wk-worker')||{}).value||''});
  if(typeof logEvent==='function') logEvent('주간정산: '+log.length+'건 반영');
  var summaryHtml = (log.length?('✅ '+log.map(E).join('<br>✅ ')):'')
    + (log.length&&warn.length?'<br>':'')
    + (warn.length?('⚠️ '+warn.map(E).join('<br>⚠️ ')):'')
    || '변동 사항이 없습니다.';
  if(typeof toast==='function') toast('주간 정산 완료 — '+log.length+'건 반영'+(warn.length?' (확인 '+warn.length+')':''),'success');
  saveDB();
  var b=$('ql-body'); if(b) b.innerHTML=renderWeek();
  var m2=$('ql-msg');
  if(m2){ m2.style.color=warn.length?'#c2410c':'#0f766e'; m2.innerHTML=summaryHtml; }
  renderQlHistory();
};

function prodOpts(){
  return (db.master.M_PRODUCT||[]).map(function(p){ return '<option value="'+E(p.productId)+'">'+E(p.name)+'</option>'; }).join('');
}
function fgtStock(pid, loc){
  return (db.stock.FGT_LOT||[]).filter(function(l){
    return String(l.productId)===String(pid) && String(l.status||'OK').toUpperCase()!=='FAIL' && N(l.remaining)>0 && (!loc || (l.location||'공장')===loc);
  });
}

function renderQl(){
  var b=$('ql-body'), d=$('ql-desc'); if(!b) return;
  var opts = prodOpts();
  if(qlMode==='week'){
    try{ if(typeof migrateLoc==='function') migrateLoc(); }catch(e){}
    d.textContent='금요일 정산 — 세고, 넣고, 한 번에 반영합니다.';
    b.innerHTML = renderWeek();
    renderQlHistory();
    return;
  }
  if(qlMode==='prod'){
    d.textContent='이번 주에 만든 완제품을 적으세요. 원료는 BOM대로 자동 차감되고 LOT·원가가 자동 계산됩니다.';
    b.innerHTML = rowsUI('생산 수량(EA)') ;
  } else if(qlMode==='move'){
    d.textContent='보낼 위치를 고르고 수량을 적으세요. 공장에서 오래된 LOT부터 자동 이관됩니다.';
    b.innerHTML = '<select id="ql-mvto" class="input-field" style="margin-bottom:6px"><option value="물류센터">→ 물류센터 (택배 출고용)</option><option value="매장">→ 매장 (판매용)</option></select>' + rowsUI('보낸 수량(EA)');
  } else {
    d.textContent='팔린 수량을 적으세요. 위탁 정산서 기준으로 한 번에 입력하면 됩니다.';
    b.innerHTML =
      '<div class="grid grid-cols-2 gap-2" style="margin-bottom:6px">'+
        '<select id="ql-loc" class="input-field"><option value="매장">매장 판매</option><option value="물류센터">물류센터 택배 출고</option><option value="공장">공장 직접 출고</option></select>'+
        '<select id="ql-cust" class="input-field">'+
          '<option value="">고객 선택 (선택)</option>'+
          (db.master.M_CUSTOMER||[]).map(function(c){ return '<option value="'+E(c.customerId)+'">'+E(c.name)+'</option>'; }).join('')+
        '</select>'+
      '</div>'+ rowsUI('판매 수량(EA)', true);
  }
  function rowsUI(label, withPrice){
    var head = '<table style="width:100%;font-size:11.5px"><tr><th style="text-align:left">제품</th><th style="width:26%">'+label+'</th>'+(withPrice?'<th style="width:24%">판매단가</th>':'')+'</tr>';
    var rows = '';
    for(var i=0;i<8;i++){
      rows += '<tr style="border-top:1px solid #e2e8f0"><td><select id="ql-p-'+i+'" class="input-field" style="padding:3px 6px;font-size:11px"><option value="">— 선택 —</option>'+opts+'</select></td>'+
        '<td><input id="ql-q-'+i+'" type="number" min="0" class="input-field text-right" style="padding:3px 6px" placeholder="0"></td>'+
        (withPrice?'<td><input id="ql-c-'+i+'" type="number" class="input-field text-right" style="padding:3px 6px" placeholder="단가"></td>':'')+'</tr>';
    }
    return head+rows+'</table>'+
      '<button class="btn btn-primary w-full" style="margin-top:8px" onclick="commitQuick()">✅ 기록 저장 (자동 처리)</button>'+
      '<div id="ql-msg" style="font-size:13px;font-weight:800;margin-top:8px;line-height:1.7"></div>';
  }
  renderQlHistory();
}

window.commitQuick=function(){
  ensure();
  var date = $('ql-date').value || TODAY();
  var lines=[];
  for(var i=0;i<8;i++){
    var p=$('ql-p-'+i), q=$('ql-q-'+i);
    if(!p||!q||!p.value||N(q.value)<=0) continue;
    var price = $('ql-c-'+i) ? N($('ql-c-'+i).value) : 0;
    lines.push({ pid: isNaN(Number(p.value))?p.value:Number(p.value), qty:N(q.value), price:price });
  }
  if(!lines.length){ if(typeof toast==='function') toast('입력된 행이 없습니다','error'); return; }
  var msgs=[], warn=[];

  lines.forEach(function(l){
    var prod=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(l.pid); });
    var nm = prod?prod.name:l.pid;

    if(qlMode==='prod'){
      /* 원료 BOM 차감 + 거래기록(T_BULK/T_BATCH) 생성 → 수불부·추적성 자동 반영 */
      var matCost=0, shortage=[], rawUse=[], packUse=[];
      ((prod&&prod.bom)||[]).forEach(function(bm){
        var need = (typeof bomNeed==='function') ? bomNeed(prod, bm, l.qty) : N(bm.qty)*l.qty;
        var key = bm.type==='PACK'?'PACK_LOT':'RAW_LOT';
        var idk = bm.type==='PACK'?'packId':'rawId';
        var lots=(db.stock[key]||[]).filter(function(x){ return String(x[idk])===String(bm.itemId) && N(x.remaining)>0 && String(x.status||'OK').toUpperCase()!=='FAIL'; })
          .sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
        var rest=need, picked=[];
        lots.forEach(function(x){
          if(rest<=0) return;
          var take=Math.min(N(x.remaining), rest);
          x.remaining=N(x.remaining)-take; matCost += take*N(x.unitCost); rest-=take;
          picked.push({ lotNo:x.lotNo, qty:take, take:take });
        });
        if(picked.length){
          var rec={ type:bm.type||'RAW', itemId:bm.itemId, need:need, lots:picked };
          if(bm.type==='PACK') packUse.push(rec); else rawUse.push(rec);
        }
        if(rest>0){ shortage.push((bm.type==='PACK'?'포장재':'원료')+' 부족 '+Math.round(rest*100)/100); }
      });
      var lotNo='LOT-'+String(date).replace(/-/g,'').slice(2)+'-'+String(Math.floor(Math.random()*90+10));
      db.stock.FGT_LOT.push({ id:genId('FGT'), lotNo:lotNo, productId:l.pid, qty:l.qty, remaining:l.qty,
        unitCost: l.qty>0 ? Math.round(matCost/l.qty) : 0, status:'OK', location:'창고', dateIn:date, note:'간편 생산기록' });
      /* 거래기록: 벌크(원료 소모) + 충진(포장재 소모·생산) */
      db.txn.T_BULK = db.txn.T_BULK||[];
      db.txn.T_BATCH = db.txn.T_BATCH||[];
      var bulkLot = 'BLK-'+lotNo.slice(4);
      if(rawUse.length) db.txn.T_BULK.push({ id:genId('BULK'), date:date, lotNo:bulkLot, productId:l.pid, qty:l.qty, materials:rawUse, note:'간편 기록' });
      db.txn.T_BATCH.push({ id:genId('BATCH'), date:date, lotNo:lotNo, productId:l.pid, qty:l.qty, bulkLotNo:bulkLot, consumedLots:packUse, note:'간편 기록' });
      db.txn.T_STOCK_MOVE.push({ id:genId('MV'), date:date, lotNo:lotNo, productId:l.pid, qty:l.qty, from:'(생산)', to:'창고', note:'간편 기록' });
      msgs.push(nm+' '+l.qty+'EA 생산('+lotNo+')');
      if(shortage.length) warn.push(nm+': '+shortage.join(', '));

    } else if(qlMode==='move'){
      var mvTo=($('ql-mvto')||{}).value||'물류센터';
      var lots2=fgtStock(l.pid,'공장').sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
      var rest2=l.qty, moved=0;
      lots2.forEach(function(src){
        if(rest2<=0) return;
        var take=Math.min(N(src.remaining), rest2);
        src.remaining=N(src.remaining)-take; rest2-=take; moved+=take;
        var dest=(db.stock.FGT_LOT||[]).find(function(x){ return x.lotNo===src.lotNo && String(x.productId)===String(src.productId) && (x.location||'공장')===mvTo; });
        if(dest){ dest.remaining=N(dest.remaining)+take; dest.qty=N(dest.qty)+take; }
        else db.stock.FGT_LOT.push({ id:genId('FGT'), lotNo:src.lotNo, productId:src.productId, qty:take, remaining:take,
          unitCost:src.unitCost, expDate:src.expDate, status:'OK', location:mvTo, note:'간편 이관' });
        db.txn.T_STOCK_MOVE.push({ id:genId('MV'), date:date, lotNo:src.lotNo, productId:src.productId, qty:take, from:'공장', to:mvTo, note:'간편 기록' });
      });
      msgs.push(nm+' '+moved+'EA → '+mvTo);
      if(rest2>0) warn.push(nm+': 공장 재고 부족 '+rest2+'EA 미처리');

    } else {
      var loc=$('ql-loc')?$('ql-loc').value:'매장';
      var cust=$('ql-cust')?$('ql-cust').value:'';
      var lots3=fgtStock(l.pid,loc).sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); });
      var rest3=l.qty, sold=0;
      db.txn.T_SALE=db.txn.T_SALE||[];
      lots3.forEach(function(src){
        if(rest3<=0) return;
        var take=Math.min(N(src.remaining), rest3);
        src.remaining=N(src.remaining)-take; rest3-=take; sold+=take;
        db.txn.T_SALE.push({ id:genId('SALE'), date:date, customerId:cust||null, productId:l.pid, lotNo:src.lotNo,
          qty:take, unitPrice:l.price, amount:take*l.price, note:'간편 기록('+loc+')' });
      });
      msgs.push(nm+' '+sold+'EA 판매'+(l.price?' ₩'+F(sold*l.price):''));
      if(rest3>0) warn.push(nm+': '+loc+' 재고 부족 '+rest3+'EA 미처리');
    }
  });

  db.txn.T_QUICK.push({ id:genId('QL'), date:date, mode:qlMode, summary:msgs.join(' / '), warn:warn.join(' / ') });
  if(typeof logEvent==='function') logEvent('간편기록('+qlMode+'): '+msgs.join(', '));
  var m=$('ql-msg');
  if(m){
    m.style.color = warn.length?'#c2410c':'#0f766e';
    m.innerHTML = '✅ '+msgs.map(E).join('<br>✅ ') + (warn.length?'<br>⚠️ '+warn.map(E).join('<br>⚠️ '):'');
  }
  if(typeof toast==='function') toast('기록 저장 완료'+(warn.length?' (확인 필요 '+warn.length+'건)':''),'success');
  for(var j=0;j<8;j++){ var pp=$('ql-p-'+j), qq=$('ql-q-'+j); if(pp) pp.value=''; if(qq) qq.value=''; }
  saveDB();
  renderQlHistory();
};

function renderQlHistory(){
  var t=$('ql-history'); if(!t) return;
  var list=((db.txn&&db.txn.T_QUICK)||[]).slice(-15).reverse();
  t.innerHTML = list.map(function(q){
    return '<tr><td class="pl-3 text-xs">'+E(q.date)+'</td><td class="text-xs">'+(q.mode==='prod'?'🏭 생산':q.mode==='move'?'🚚 출고':'💰 판매')+'</td>'+
      '<td class="text-xs">'+E(q.summary)+'</td><td class="text-right pr-3 text-xs" style="color:#c2410c">'+E(q.warn||'')+'</td></tr>';
  }).join('') || '<tr><td colspan="4" class="text-center py-4 text-slate-400">기록 없음 — 이번 주 만든 것부터 적어보세요</td></tr>';
}

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  if(p==='quick-log'){ injectUI(); ensure(); renderQl(); }
};
function boot(){ injectUI(); ensure(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,1500);
var __qlKeep=setInterval(injectUI,3000);
setTimeout(function(){ clearInterval(__qlKeep); },90000);
})();

/* ═══════════ 모듈: 이름·LOT 정리 + 재고 정렬 v1.0 ═══════════ */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var N=function(v){var x=Number(v);return isFinite(x)?x:0;};
var E=function(v){return (typeof escH==='function')?escH(v):String(v==null?'':v);};
var F=function(v){return Math.round(N(v)).toLocaleString();};

function injectUI(){
  var host=$('page-loc-stock');
  if(!host || $('nm-card')) return;
  var card=document.createElement('div');
  card.id='nm-card'; card.className='card p-4 space-y-2';
  card.style.border='1.5px solid #c7b9e8';
  card.style.background='#fbfaff';
  card.innerHTML=
    '<h3 class="font-bold text-slate-700 text-sm">🏷 이름 · LOT 번호 정리</h3>'+
    '<div style="font-size:10px;color:#64748b">적용 전 반드시 미리보기로 확인하세요. LOT 번호는 판매·생산·이동 기록의 참조까지 함께 변경됩니다.</div>'+
    '<div style="font-size:11px;font-weight:800;color:#6d28d9;margin-top:4px">① 제품명 일괄 정리</div>'+
    '<div class="grid grid-cols-3 gap-2">'+
      '<input id="nm-find" class="input-field" placeholder="찾을 문자 (예: 시프트아이_)">'+
      '<input id="nm-repl" class="input-field" placeholder="바꿀 문자 (비우면 삭제)">'+
      '<button class="btn btn-secondary" onclick="previewRename()">미리보기</button>'+
    '</div>'+
    '<div id="nm-preview"></div>'+
    '<div style="font-size:11px;font-weight:800;color:#6d28d9;margin-top:8px">② LOT 번호 표준 재부여</div>'+
    '<div class="grid grid-cols-3 gap-2">'+
      '<select id="nm-lot-type" class="input-field"><option value="FGT_LOT">완제품</option><option value="RAW_LOT">원료</option><option value="PACK_LOT">포장재</option></select>'+
      '<input id="nm-prefix" class="input-field" placeholder="접두어 (비우면 제품코드)">'+
      '<button class="btn btn-secondary" onclick="previewLotRenumber()">미리보기</button>'+
    '</div>'+
    '<div style="font-size:9.5px;color:#94a3b8">형식: [접두어 또는 코드]-[YYMMDD]-[순번2자리] · 입고/제조일 순으로 부여</div>'+
    '<div style="font-size:11px;font-weight:800;color:#6d28d9;margin-top:8px">③ 잘못 등록된 항목 이동 (제품 → 포장재)</div>'+
    '<div style="font-size:10px;color:#64748b">일괄 등록 시 포장재를 제품으로 넣었다면 여기서 옮기세요. 재고 LOT도 함께 이동합니다.</div>'+
    '<div class="grid grid-cols-2 gap-2">'+
      '<select id="nm-mv-prod" class="input-field"></select>'+
      '<button class="btn btn-secondary" onclick="moveProdToPack()">포장재로 이동</button>'+
    '</div>'+
    '<div id="nm-lot-preview"></div>';
  host.appendChild(card);
  try{ fillMoveSel(); }catch(e){}
}

/* ── 제품명 정리 ── */
var renamePlan=[];
window.previewRename=function(){
  var find=($('nm-find').value||''), repl=($('nm-repl').value||'');
  if(!find){ if(typeof toast==='function') toast('찾을 문자를 입력하세요','error'); return; }
  renamePlan=[];
  (db.master.M_PRODUCT||[]).forEach(function(p){
    var nn=String(p.name||'').split(find).join(repl).replace(/\s{2,}/g,' ').trim();
    if(nn && nn!==p.name) renamePlan.push({pid:p.productId, from:p.name, to:nn});
  });
  var box=$('nm-preview');
  box.innerHTML = renamePlan.length
    ? '<table style="width:100%;font-size:11px;margin-top:4px"><tr><th style="text-align:left">현재</th><th style="text-align:left">변경 후</th></tr>'+
      renamePlan.map(function(r){ return '<tr style="border-top:1px solid #e2e8f0"><td style="color:#94a3b8">'+E(r.from)+'</td><td style="font-weight:700">'+E(r.to)+'</td></tr>'; }).join('')+
      '</table><button class="btn btn-primary w-full" style="margin-top:6px" onclick="applyRename()">'+renamePlan.length+'개 제품명 변경 적용</button>'
    : '<div style="font-size:11px;color:#94a3b8;padding:4px 0">변경될 제품이 없습니다.</div>';
};
window.applyRename=function(){
  if(!renamePlan.length) return;
  if(!window.confirm(renamePlan.length+'개 제품명을 변경합니다. 계속할까요?')) return;
  renamePlan.forEach(function(r){
    var p=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(r.pid); });
    if(p) p.name=r.to;
  });
  if(typeof logEvent==='function') logEvent('제품명 일괄 변경 '+renamePlan.length+'건');
  if(typeof toast==='function') toast(renamePlan.length+'개 제품명 변경 완료','success');
  renamePlan=[]; $('nm-preview').innerHTML='';
  saveDB();
  try{ renderLocPage(); renderLotManager(); }catch(e){}
};

/* ── 잘못 등록된 제품 → 포장재로 이동 ── */
function fillMoveSel(){
  var s=$('nm-mv-prod'); if(!s) return;
  s.innerHTML='<option value="">이동할 항목 선택 (제품 마스터)</option>'+
    (db.master.M_PRODUCT||[]).map(function(p){
      var st=(db.stock.FGT_LOT||[]).filter(function(l){return String(l.productId)===String(p.productId);}).reduce(function(a,l){return a+N(l.remaining);},0);
      return '<option value="'+E(p.productId)+'">'+E(p.name)+' (재고 '+F(st)+')</option>';
    }).join('');
}
window.moveProdToPack=function(){
  var id=($('nm-mv-prod')||{}).value;
  if(!id){ if(typeof toast==='function') toast('항목을 선택하세요','error'); return; }
  var p=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(id); });
  if(!p) return;
  var lots=(db.stock.FGT_LOT||[]).filter(function(l){ return String(l.productId)===String(id); });
  var tot=lots.reduce(function(s,l){ return s+N(l.remaining); },0);
  if(!window.confirm('"'+p.name+'"을(를) 포장재 마스터로 이동합니다.\n재고 LOT '+lots.length+'건 ('+F(tot)+') 도 함께 이동됩니다.\n계속할까요?')) return;
  var packId=Date.now();
  db.master.M_PACK=db.master.M_PACK||[];
  db.master.M_PACK.push({ packId:packId, code:p.code||'', name:p.name, unit:'ea', note:'제품 마스터에서 이동' });
  lots.forEach(function(l){
    l.packId=packId; delete l.productId;
    db.stock.PACK_LOT.push(l);
  });
  db.stock.FGT_LOT=(db.stock.FGT_LOT||[]).filter(function(l){ return !lots.some(function(x){ return String(x.id)===String(l.id); }); });
  db.master.M_PRODUCT=(db.master.M_PRODUCT||[]).filter(function(x){ return String(x.productId)!==String(id); });
  if(typeof logEvent==='function') logEvent('제품→포장재 이동: '+p.name+' (LOT '+lots.length+'건)');
  if(typeof toast==='function') toast(p.name+' 포장재로 이동 완료','success');
  saveDB();
  fillMoveSel();
  try{ renderLocPage(); renderLotManager(); if(typeof mpRender==='function'){ mpRender('PACK'); } }catch(e){}
};

/* ── LOT 번호 표준 재부여 ── */
var lotPlan=[], lotPlanKey='';
function itemOf(key,l){
  if(key==='RAW_LOT'){ var r=(db.master.M_RAW||[]).find(function(x){return String(x.rawId)===String(l.rawId);}); return r||{}; }
  if(key==='PACK_LOT'){ var p=(db.master.M_PACK||[]).find(function(x){return String(x.packId)===String(l.packId);}); return p||{}; }
  var q=(db.master.M_PRODUCT||[]).find(function(x){return String(x.productId)===String(l.productId);}); return q||{};
}
function codeOf(m){
  if(m.code) return String(m.code).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8) || 'ITEM';
  var nm=String(m.name||'ITEM');
  var eng=nm.replace(/[^A-Za-z0-9]/g,'');
  if(eng.length>=3) return eng.toUpperCase().slice(0,8);
  return 'ITEM';
}
window.previewLotRenumber=function(){
  var key=$('nm-lot-type').value, pre=($('nm-prefix').value||'').trim().toUpperCase();
  lotPlanKey=key; lotPlan=[];
  var lots=(db.stock[key]||[]).slice().sort(function(a,b){
    return String(a.dateIn||a.mfgDate||'').localeCompare(String(b.dateIn||b.mfgDate||''));
  });
  var seq={};
  lots.forEach(function(l){
    var m=itemOf(key,l);
    var base = pre || codeOf(m);
    var d = String(l.dateIn||l.mfgDate||'').replace(/-/g,'').slice(2) || '000000';
    var k = base+'-'+d;
    seq[k]=(seq[k]||0)+1;
    var nn = k+'-'+String(seq[k]).padStart(2,'0');
    if(nn!==l.lotNo) lotPlan.push({id:l.id, from:l.lotNo, to:nn, name:m.name||'', qty:N(l.remaining)});
  });
  var box=$('nm-lot-preview');
  box.innerHTML = lotPlan.length
    ? '<div style="max-height:220px;overflow-y:auto"><table style="width:100%;font-size:11px;margin-top:4px">'+
      '<tr><th style="text-align:left">품목</th><th style="text-align:left">현재 LOT</th><th style="text-align:left">변경 후</th><th style="width:14%">잔량</th></tr>'+
      lotPlan.map(function(r){ return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(r.name)+'</td><td style="color:#94a3b8" class="mono">'+E(r.from)+'</td><td style="font-weight:700" class="mono">'+E(r.to)+'</td><td style="text-align:right">'+F(r.qty)+'</td></tr>'; }).join('')+
      '</table></div><button class="btn btn-primary w-full" style="margin-top:6px" onclick="applyLotRenumber()">'+lotPlan.length+'개 LOT 번호 변경 적용 (참조 기록 포함)</button>'
    : '<div style="font-size:11px;color:#94a3b8;padding:4px 0">변경될 LOT이 없습니다.</div>';
};
window.applyLotRenumber=function(){
  if(!lotPlan.length) return;
  if(!window.confirm(lotPlan.length+'개 LOT 번호를 변경합니다.\n판매·생산·이동 기록의 LOT 참조도 함께 바뀝니다.\n계속할까요?')) return;
  var map={};
  lotPlan.forEach(function(r){
    var l=(db.stock[lotPlanKey]||[]).find(function(x){ return String(x.id)===String(r.id); });
    if(!l) return;
    map[r.from]=r.to;
    l.lotNo=r.to;
  });
  /* 참조 갱신 — 같은 번호를 쓰는 다른 위치 LOT, 거래·이력 기록 */
  (db.stock[lotPlanKey]||[]).forEach(function(l){ if(map[l.lotNo] && !lotPlan.some(function(r){return String(r.id)===String(l.id);})) l.lotNo=map[l.lotNo]; });
  var t=db.txn||{};
  (t.T_SALE||[]).forEach(function(s){ if(map[s.lotNo]) s.lotNo=map[s.lotNo]; });
  (t.T_STOCK_MOVE||[]).forEach(function(s){ if(map[s.lotNo]) s.lotNo=map[s.lotNo]; });
  (t.T_QC_PROD||[]).forEach(function(s){ if(map[s.lotNo]) s.lotNo=map[s.lotNo]; });
  (t.T_BATCH||[]).forEach(function(b){
    if(map[b.lotNo]) b.lotNo=map[b.lotNo];
    if(map[b.bulkLotNo]) b.bulkLotNo=map[b.bulkLotNo];
    (b.consumedLots||[]).forEach(function(u){ (u.lots||[]).forEach(function(x){ if(map[x.lotNo]) x.lotNo=map[x.lotNo]; }); });
  });
  (t.T_BULK||[]).forEach(function(b){
    if(map[b.lotNo]) b.lotNo=map[b.lotNo];
    (b.materials||[]).forEach(function(u){ (u.lots||[]).forEach(function(x){ if(map[x.lotNo]) x.lotNo=map[x.lotNo]; }); });
  });
  if(typeof logEvent==='function') logEvent('LOT 번호 표준화 '+lotPlan.length+'건 ('+lotPlanKey+')');
  if(typeof toast==='function') toast(lotPlan.length+'개 LOT 번호 변경 완료 (참조 기록 갱신)','success');
  lotPlan=[]; $('nm-lot-preview').innerHTML='';
  saveDB();
  try{ renderLocPage(); renderLotManager(); }catch(e){}
};

/* ── 재고 LOT 목록: 제품별 정렬 + 그룹 소계 ── */
function sortedLotManager(){
  var tb=$('lm-list'); if(!tb || typeof window.renderLotManager!=='function') return;
  var key=($('lm-type')||{}).value||'FGT_LOT';
  var arr=(db.stock[key]||[]).slice();
  var groups={};
  arr.forEach(function(l){
    var m=itemOf(key,l);
    var nm=m.name||String(l.rawId||l.packId||l.productId);
    (groups[nm]=groups[nm]||[]).push(l);
  });
  var names=Object.keys(groups).sort(function(a,b){ return a.localeCompare(b); });
  tb.innerHTML = names.map(function(nm){
    var lots=groups[nm].sort(function(a,b){ return String(a.dateIn||a.mfgDate||'').localeCompare(String(b.dateIn||b.mfgDate||'')); });
    var tot=lots.reduce(function(s,l){ return s+(String(l.status||'OK').toUpperCase()==='FAIL'?0:N(l.remaining)); },0);
    var head='<tr><td colspan="6" style="background:#f1f5f9;font-size:10.5px;font-weight:900;color:#334155;padding:4px 12px">'+E(nm)+' <span style="color:#0f766e">· 합계 '+F(tot)+'</span> <span style="color:#94a3b8;font-weight:600">('+lots.length+' LOT)</span></td></tr>';
    return head + lots.map(function(l){
      var st=String(l.status||'OK').toUpperCase();
      var stC=st==='OK'?'#059669':st==='FAIL'?'#dc2626':'#d97706';
      var extra=key==='FGT_LOT'?(l.location||'공장'):(l.expDate||l.matureUntil||'-');
      return '<tr><td class="pl-3 mono text-xs">'+E(l.lotNo)+'</td><td class="text-xs" style="color:#94a3b8">'+E(l.dateIn||l.mfgDate||'')+'</td>'+
        '<td class="text-right text-xs font-bold">'+F(l.remaining)+'</td>'+
        '<td class="text-xs" style="color:'+stC+';font-weight:800">'+E(st)+'</td>'+
        '<td class="text-xs">'+E(extra)+'</td>'+
        '<td class="text-right pr-3" style="white-space:nowrap">'+
          '<button class="btn btn-secondary btn-sm" onclick="openLotEdit(\''+key+'\',\''+E(l.id)+'\')">수정</button> '+
          '<button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;font-weight:800" onclick="deleteLot(\''+key+'\',\''+E(l.id)+'\')">삭제</button>'+
        '</td></tr>';
    }).join('');
  }).join('') || '<tr><td colspan="6" class="text-center py-4 text-slate-400">LOT 없음</td></tr>';
}
/* 기존 renderLotManager를 제품별 정렬판으로 교체 */
function hookSort(){
  if(typeof window.renderLotManager!=='function' || window.renderLotManager.__sorted) return;
  window.renderLotManager=function(){ try{ sortedLotManager(); }catch(e){} };
  window.renderLotManager.__sorted=true;
  var sel=$('lm-type'); if(sel) sel.onchange=window.renderLotManager;
  try{ window.renderLotManager(); }catch(e){}
}

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  if(p==='loc-stock'){ injectUI(); hookSort(); try{ fillMoveSel(); }catch(e){} }
};
function boot(){ injectUI(); hookSort(); try{ fillMoveSel(); }catch(e){} }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,1600);
var __nmKeep=setInterval(function(){ injectUI(); hookSort(); },3000);
setTimeout(function(){ clearInterval(__nmKeep); },90000);
})();

/* ═══════════ 모듈: 포장재 마스터 재고 관리 v1.0 ═══════════ */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var N=function(v){var x=Number(v);return isFinite(x)?x:0;};
var E=function(v){return (typeof escH==='function')?escH(v):String(v==null?'':v);};
var F=function(v){return Math.round(N(v)).toLocaleString();};
var TODAY=function(){return new Date().toISOString().split('T')[0];};
function genId(p){return (typeof generateId==='function')?generateId(p):p+'-'+Date.now()+Math.floor(Math.random()*999);}

var CFG={
  PACK:{page:'page-master-pack', boxId:'mp-stock-pack', key:'PACK_LOT', idk:'packId', master:'M_PACK', label:'포장재', unit:'EA', loc:true},
  RAW: {page:'page-master-raw',  boxId:'mp-stock-raw',  key:'RAW_LOT',  idk:'rawId',  master:'M_RAW',  label:'원료',   unit:'g',  loc:false}
};

function stockRows(t){
  var c=CFG[t];
  var agg={};
  (db.stock[c.key]||[]).forEach(function(l){
    if(String(l.status||'OK').toUpperCase()==='FAIL') return;
    var k=l[c.idk];
    if(!agg[k]) agg[k]={wh:0,st:0,lots:0,exp:''};
    if(c.loc && (l.location||'공장')!=='공장') agg[k].st+=N(l.remaining); else agg[k].wh+=N(l.remaining);
    if(N(l.remaining)>0) agg[k].lots++;
    if(l.expDate && (!agg[k].exp || l.expDate<agg[k].exp)) agg[k].exp=l.expDate;
  });
  return (db.master[c.master]||[]).map(function(m){
    var a=agg[m[c.idk]]||{wh:0,st:0,lots:0,exp:''};
    return {id:m[c.idk], name:m.name, code:m.code||'', wh:a.wh, st:a.st, tot:a.wh+a.st, lots:a.lots, exp:a.exp};
  }).sort(function(a,b){ return String(a.name).localeCompare(String(b.name)); });
}

function render(t){
  var c=CFG[t], page=$(c.page); if(!page) return;
  var box=$(c.boxId);
  if(!box){
    box=document.createElement('div');
    box.id=c.boxId; box.className='card';
    box.style.marginTop='14px';
    page.appendChild(box);
  }
  var rows=stockRows(t);
  var low=rows.filter(function(r){return r.tot<=0;}).length;
  box.innerHTML=
    '<div class="card-header"><h3 class="font-bold text-slate-700 text-sm">📦 '+c.label+' 재고 현황</h3>'+
      '<span class="badge-soft">'+rows.length+'품목'+(low?' · 재고0 '+low:'')+'</span>'+
      '<button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="mpRender(\''+t+'\')">🔄 새로고침</button></div>'+
    '<div class="scroll-card"><table><thead><tr>'+
      '<th class="pl-3">'+c.label+'명</th>'+
      (c.loc?'<th class="text-right">🏭 공장</th><th class="text-right">🏬 외부</th>':'')+
      '<th class="text-right">재고('+c.unit+')</th><th class="text-center">LOT</th>'+
      (c.loc?'':'<th class="text-center">최근 유통기한</th>')+
      '<th class="text-right pr-3">관리</th></tr></thead><tbody>'+
    (rows.map(function(r){
      var col=r.tot<=0?'#dc2626':'#0f172a';
      return '<tr><td class="pl-3 text-xs font-bold">'+E(r.name)+(r.code?' <span style="color:#94a3b8;font-weight:500">'+E(r.code)+'</span>':'')+'</td>'+
        (c.loc?'<td class="text-right text-xs">'+F(r.wh)+'</td><td class="text-right text-xs" style="color:#0f766e;font-weight:800">'+F(r.st)+'</td>':'')+
        '<td class="text-right text-xs font-bold" style="color:'+col+'">'+F(r.tot)+(r.tot<=0?' <span style="font-size:9px">없음</span>':'')+'</td>'+
        '<td class="text-center text-xs" style="color:#94a3b8">'+r.lots+'</td>'+
        (c.loc?'':'<td class="text-center text-xs" style="color:#94a3b8">'+E(r.exp||'-')+'</td>')+
        '<td class="text-right pr-3" style="white-space:nowrap">'+
          '<button class="btn btn-primary btn-sm" onclick="mpOpen(\''+t+'\',\''+E(r.id)+'\',\'in\')">입고</button> '+
          '<button class="btn btn-secondary btn-sm" onclick="mpOpen(\''+t+'\',\''+E(r.id)+'\',\'adj\')">조정</button>'+
        '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="text-center py-4 text-slate-400">등록된 '+c.label+'가 없습니다</td></tr>')+
    '</tbody></table></div>';
}
window.mpRender=render;

window.mpOpen=function(t,id,mode){
  var c=CFG[t];
  var m=(db.master[c.master]||[]).find(function(x){ return String(x[c.idk])===String(id); });
  if(!m) return;
  var cur=stockRows(t).find(function(x){ return String(x.id)===String(id); })||{tot:0,wh:0,st:0};
  var old=$('mp-modal'); if(old) old.remove();
  var bg=document.createElement('div');
  bg.id='mp-modal';
  bg.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:960;display:flex;align-items:center;justify-content:center;padding:16px';
  bg.innerHTML=
    '<div style="background:#fff;border-radius:14px;max-width:400px;width:100%;padding:20px" onclick="event.stopPropagation()">'+
      '<div style="font-weight:900;font-size:14px;color:#0f172a">'+(mode==='in'?'📥 '+c.label+' 입고':'⚖️ 재고 조정 (실사)')+'</div>'+
      '<div style="font-size:11.5px;color:#64748b;margin:3px 0 12px">'+E(m.name)+' · 현재 '+F(cur.tot)+' '+c.unit+
        (c.loc?' (공장 '+F(cur.wh)+' / 외부 '+F(cur.st)+')':'')+'</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">'+(mode==='in'?'입고 수량':'실물 수량')+' ('+c.unit+')</label>'+
          '<input id="mp-qty" type="number" step="0.01" min="0" class="input-field text-right" placeholder="'+(mode==='in'?'0':F(c.loc?cur.wh:cur.tot))+'"></div>'+
        (mode==='in'
          ? '<div><label style="font-size:10px;font-weight:800;color:#64748b">단가 ('+(t==='RAW'?'원/g':'원/EA')+')</label><input id="mp-cost" type="number" step="0.01" class="input-field text-right" placeholder="0"></div>'
          : '<div><label style="font-size:10px;font-weight:800;color:#64748b">조정 사유</label><select id="mp-reason" class="input-field"><option>실사 차이</option><option>파손·불량</option><option>사용(미기록)</option><option>기타</option></select></div>')+
        (c.loc?'<div><label style="font-size:10px;font-weight:800;color:#64748b">위치</label><select id="mp-loc" class="input-field">'+['공장','물류센터','매장'].map(function(x){return '<option>'+x+'</option>';}).join('')+'</select></div>':'')+
        '<div><label style="font-size:10px;font-weight:800;color:#64748b">'+(mode==='in'?'입고일':'기준일')+'</label><input id="mp-date" type="date" class="input-field" value="'+TODAY()+'"></div>'+
        (mode==='in'?'<div style="grid-column:1/3"><label style="font-size:10px;font-weight:800;color:#64748b">LOT 번호 (비우면 자동)</label><input id="mp-lot" class="input-field" placeholder="자동 생성"></div>':'')+
      '</div>'+
      '<div style="display:flex;gap:8px;margin-top:14px">'+
        '<button class="btn btn-primary flex-1" onclick="mpSave(\''+t+'\',\''+E(id)+'\',\''+mode+'\')">저장</button>'+
        '<button class="btn btn-secondary" onclick="document.getElementById(\'mp-modal\').remove()">취소</button>'+
      '</div>'+
    '</div>';
  bg.onclick=function(){bg.remove();};
  document.body.appendChild(bg);
};

window.mpSave=function(t,id,mode){
  var c=CFG[t];
  var qty=N(($('mp-qty')||{}).value);
  var date=($('mp-date')||{}).value||TODAY();
  var loc=c.loc?(($('mp-loc')||{}).value||'공장'):null;
  var itemId=isNaN(Number(id))?id:Number(id);
  if(mode==='in'){
    if(qty<=0){ if(typeof toast==='function') toast('수량을 입력하세요','error'); return; }
    var lotNo=(($('mp-lot')||{}).value||'').trim() || (String(t)+'-'+String(date).replace(/-/g,'').slice(2)+'-'+String(Math.floor(Math.random()*90+10)));
    var lot={ id:genId(t), lotNo:lotNo, qty:qty, remaining:qty, unitCost:N(($('mp-cost')||{}).value), status:'OK', dateIn:date, note:'마스터 입고' };
    lot[c.idk]=itemId;
    if(c.loc) lot.location=loc;
    db.stock[c.key].push(lot);
    if(typeof logEvent==='function') logEvent(c.label+' 입고: '+lotNo+' '+qty+c.unit);
    if(typeof toast==='function') toast('입고 완료: '+qty+' '+c.unit,'success');
  } else {
    var lots=(db.stock[c.key]||[]).filter(function(l){
      return String(l[c.idk])===String(itemId) && String(l.status||'OK').toUpperCase()!=='FAIL' && (!c.loc || (l.location||'공장')===loc);
    });
    var book=lots.reduce(function(s,l){ return s+N(l.remaining); },0);
    var diff=book-qty;
    if(Math.abs(diff)<0.001){ if(typeof toast==='function') toast('차이가 없습니다','success'); }
    else if(diff>0){
      var rest=diff;
      lots.sort(function(a,b){ return String(a.dateIn||'').localeCompare(String(b.dateIn||'')); })
        .forEach(function(l){ if(rest<=0) return; var take=Math.min(N(l.remaining),rest); l.remaining=N(l.remaining)-take; rest-=take; });
    } else {
      var q=0,v=0;
      lots.forEach(function(l){ q+=N(l.remaining); v+=N(l.remaining)*N(l.unitCost); });
      var nl={ id:genId(t), lotNo:'ADJ-'+String(date).replace(/-/g,'').slice(2), qty:-diff, remaining:-diff,
        unitCost: q>0?Math.round(v/q*100)/100:0, status:'OK', dateIn:date, note:'재고조정 증가' };
      nl[c.idk]=itemId;
      if(c.loc) nl.location=loc;
      db.stock[c.key].push(nl);
    }
    var reason=(($('mp-reason')||{}).value)||'실사 차이';
    if(Math.abs(diff)>=0.001){
      db.txn=db.txn||{}; db.txn.T_STOCK_MOVE=db.txn.T_STOCK_MOVE||[];
      db.txn.T_STOCK_MOVE.push({ id:genId('MV'), date:date, lotNo:'(조정)', productId:null, qty:Math.abs(diff),
        from: diff>0?(loc||'재고'):'(조정)', to: diff>0?'('+reason+')':(loc||'재고'), note:'['+c.label+'] '+reason });
      if(typeof logEvent==='function') logEvent(c.label+' 재고조정: '+(diff>0?'-':'+')+Math.abs(diff)+' ('+reason+')');
      if(typeof toast==='function') toast('조정 완료: '+(diff>0?'-':'+')+Math.abs(diff)+' '+c.unit,'success');
    }
  }
  var mo=$('mp-modal'); if(mo) mo.remove();
  saveDB();
  render(t);
  try{ if(typeof renderLocPage==='function') renderLocPage(); if(typeof renderLotManager==='function') renderLotManager(); }catch(e){}
};

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  if(p==='master-pack') render('PACK');
  if(p==='master-raw') render('RAW');
};
function boot(){ try{ render('PACK'); render('RAW'); }catch(e){} }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,1600);
var __mpKeep=setInterval(boot,3000);
setTimeout(function(){ clearInterval(__mpKeep); },90000);
})();

/* ═══════════ 모듈: 데이터 점검 v1.0 ═══════════ */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var N=function(v){var x=Number(v);return isFinite(x)?x:0;};
var E=function(v){return (typeof escH==='function')?escH(v):String(v==null?'':v);};
var F=function(v){return Math.round(N(v)).toLocaleString();};
var PACKWORD=/병|캡|박스|상자|백|펌프|라벨|스티커|튜브|용기|마개|카톤|파우치|리본|쇼핑/;

function scan(){
  var R=[];
  var M=db.master||{}, S=db.stock||{};
  function add(sev,title,items,impact,page,fix){
    if(!items.length) return;
    R.push({sev:sev,title:title,items:items,impact:impact,page:page,fix:fix});
  }
  /* 1. 원료·포장재 단가 0 */
  var noCostRaw=(M.M_RAW||[]).filter(function(r){
    var lots=(S.RAW_LOT||[]).filter(function(l){return String(l.rawId)===String(r.rawId)&&N(l.remaining)>0;});
    var hasLotCost=lots.some(function(l){return N(l.unitCost)>0;});
    return !hasLotCost && !N(r.stdCost);
  }).map(function(r){return r.name;});
  add('치명','원료 단가 미입력',noCostRaw,'제품 원가·조향 코파일럿 검증이 실제보다 낮게 계산됩니다','master-raw');

  var noCostPack=(M.M_PACK||[]).filter(function(p){
    var lots=(S.PACK_LOT||[]).filter(function(l){return String(l.packId)===String(p.packId)&&N(l.remaining)>0;});
    return lots.length>0 && !lots.some(function(l){return N(l.unitCost)>0;}) && !N(p.stdCost);
  }).map(function(p){return p.name;});
  add('주의','포장재 단가 미입력',noCostPack,'완제품 원가에 포장비가 빠집니다','master-pack');

  /* 2. BOM 미설정 / 배합비 합계 이상 */
  var noBom=(M.M_PRODUCT||[]).filter(function(p){return !(p.bom&&p.bom.length);}).map(function(p){return p.name;});
  add('치명','BOM 미설정 제품',noBom,'생산 기록 시 원료가 차감되지 않고 원가가 0이 됩니다','master-product');

  var badBom=(M.M_PRODUCT||[]).filter(function(p){
    if(!(p.bom&&p.bom.length)||!N(p.fillWeight)) return false;
    var sum=p.bom.filter(function(b){return b.type==='RAW';}).reduce(function(s,b){return s+N(b.qty);},0);
    return sum>0 && Math.abs(sum-100)>0.5;
  }).map(function(p){
    var sum=p.bom.filter(function(b){return b.type==='RAW';}).reduce(function(s,b){return s+N(b.qty);},0);
    return p.name+' ('+sum.toFixed(1)+'%)';
  });
  add('치명','BOM 배합비 합계 ≠ 100%',badBom,'충전량 기준 제품은 원료 소요량이 어긋납니다','master-product');

  /* 3. 판매단가 미설정 */
  var noPrice=(M.M_PRODUCT||[]).filter(function(p){
    var hasStock=(S.FGT_LOT||[]).some(function(l){return String(l.productId)===String(p.productId)&&N(l.remaining)>0;});
    return hasStock && !N(p.price);
  }).map(function(p){return p.name;});
  add('주의','판매단가 미설정',noPrice,'주간정산에서 매장 감소분이 매출 0원으로 기록됩니다','master-product');

  /* 4. 포장재로 의심되는 제품 */
  var suspect=(M.M_PRODUCT||[]).filter(function(p){return PACKWORD.test(String(p.name||''));}).map(function(p){return p.name;});
  add('주의','제품으로 등록된 포장재 의심',suspect,'완제품 재고·품절 알림이 부풀려집니다 (이름·LOT 정리에서 이동)','loc-stock');

  /* 5. 마스터 없는 재고(고아 LOT) */
  var orphan=[];
  (S.FGT_LOT||[]).forEach(function(l){ if(N(l.remaining)>0 && !(M.M_PRODUCT||[]).some(function(p){return String(p.productId)===String(l.productId);})) orphan.push('완제품 '+l.lotNo); });
  (S.RAW_LOT||[]).forEach(function(l){ if(N(l.remaining)>0 && !(M.M_RAW||[]).some(function(p){return String(p.rawId)===String(l.rawId);})) orphan.push('원료 '+l.lotNo); });
  (S.PACK_LOT||[]).forEach(function(l){ if(N(l.remaining)>0 && !(M.M_PACK||[]).some(function(p){return String(p.packId)===String(l.packId);})) orphan.push('포장재 '+l.lotNo); });
  add('치명','마스터에 없는 재고 LOT',orphan,'화면·수불부에서 이름이 표시되지 않고 집계가 어긋납니다','loc-stock');

  /* 6. 알레르겐 프로파일 미입력 */
  var noAlg=(M.M_RAW||[]).filter(function(r){
    return r.isAllergen && !(r.allergenProfile&&Object.keys(r.allergenProfile).length);
  }).map(function(r){return r.name;});
  add('치명','알레르겐 프로파일 미입력',noAlg,'전성분 표기 판정이 불완전해 표시 위반 위험이 있습니다','master-raw');

  /* 7. IFRA 한도 미설정 향료 */
  var noIfra=(M.M_RAW||[]).filter(function(r){
    return /fragrance|향료|오일|oil|HPD/i.test(String(r.name||'')+String(r.inci||'')) && !N(r.ifraLimit);
  }).map(function(r){return r.name;});
  add('주의','IFRA 사용한도 미설정',noIfra,'조향 코파일럿이 한도 초과를 잡아내지 못합니다','master-raw');

  /* 7-2. 원료 단위 kg (재고는 g 기준) */
  var kgUnit=(M.M_RAW||[]).filter(function(r){ return /^\s*(kg|킬로|킬로그램)\s*$/i.test(String(r.unit||'')); }).map(function(r){return r.name;});
  add('치명','원료 단위가 kg (재고는 g 기준)',kgUnit,'BOM 소요량·단가가 1,000배 어긋납니다 — 아래 [원료 단위 g 통일] 실행','data-check');

  /* 8. 유통기한 없는 원료 LOT */
  var noExp=(S.RAW_LOT||[]).filter(function(l){return N(l.remaining)>0 && !l.expDate;}).length;
  add('참고','유통기한 미입력 원료 LOT',noExp?[noExp+'건']:[],'유통기한 임박 알림이 작동하지 않습니다','master-raw');

  /* 9. 완제품 재고 0 (품절) */
  var zero=(M.M_PRODUCT||[]).filter(function(p){
    return !(S.FGT_LOT||[]).some(function(l){return String(l.productId)===String(p.productId)&&N(l.remaining)>0;});
  }).map(function(p){return p.name;});
  add('참고','재고 0 제품',zero,'생산 계획 또는 단종 검토가 필요합니다','quick-log');

  /* 10. LOT 번호 비표준 */
  var badLot=(S.FGT_LOT||[]).filter(function(l){ return N(l.remaining)>0 && !/^[A-Z0-9]+-\d{6}-\d{2}$/.test(String(l.lotNo||'')); }).length;
  add('참고','비표준 LOT 번호',badLot?[badLot+'건']:[],'추적 시 식별이 어렵습니다 (이름·LOT 정리에서 재부여)','loc-stock');

  return R;
}

var SEV={'치명':{c:'#dc2626',bg:'#fef2f2',bd:'#fca5a5'},'주의':{c:'#c2410c',bg:'#fff7ed',bd:'#fdba74'},'참고':{c:'#0f766e',bg:'#f0fdfa',bd:'#99f6e4'}};

window.runDataCheck=function(){
  var box=$('dq-result'); if(!box) return;
  var R=scan();
  var crit=R.filter(function(x){return x.sev==='치명';}).length;
  var warn=R.filter(function(x){return x.sev==='주의';}).length;
  if(!R.length){
    box.innerHTML='<div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:14px;font-size:13px;font-weight:800;color:#166534">✅ 점검 완료 — 발견된 문제가 없습니다. 데이터가 건강합니다.</div>';
    return;
  }
  box.innerHTML=
    '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">'+
      '<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:10px;padding:8px 14px"><div style="font-size:18px;font-weight:900;color:#dc2626">'+crit+'</div><div style="font-size:10px;font-weight:800;color:#7f1d1d">치명 (즉시 수정)</div></div>'+
      '<div style="background:#fff7ed;border:1.5px solid #fdba74;border-radius:10px;padding:8px 14px"><div style="font-size:18px;font-weight:900;color:#c2410c">'+warn+'</div><div style="font-size:10px;font-weight:800;color:#7c2d12">주의</div></div>'+
      '<div style="background:#f0fdfa;border:1.5px solid #99f6e4;border-radius:10px;padding:8px 14px"><div style="font-size:18px;font-weight:900;color:#0f766e">'+(R.length-crit-warn)+'</div><div style="font-size:10px;font-weight:800;color:#134e4a">참고</div></div>'+
    '</div>'+
    R.map(function(x,i){
      var s=SEV[x.sev];
      var shown=x.items.slice(0,8), more=x.items.length-shown.length;
      return '<div style="background:'+s.bg+';border:1.5px solid '+s.bd+';border-radius:12px;padding:10px 12px;margin-bottom:8px">'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
          '<span style="font-size:10px;font-weight:900;color:#fff;background:'+s.c+';border-radius:6px;padding:2px 8px">'+x.sev+'</span>'+
          '<span style="font-size:13px;font-weight:900;color:#0f172a">'+E(x.title)+'</span>'+
          '<span style="font-size:12px;font-weight:800;color:'+s.c+'">'+x.items.length+'건</span>'+
          '<button class="btn btn-secondary btn-sm" style="margin-left:auto" onclick="goPage(\''+x.page+'\')">수정하러 가기</button>'+
        '</div>'+
        '<div style="font-size:11.5px;color:#334155;margin-top:5px;font-weight:600">↳ '+E(x.impact)+'</div>'+
        '<div style="font-size:12px;color:#0f172a;margin-top:4px;font-weight:700;line-height:1.6">'+
          shown.map(E).join(' · ')+(more>0?' <span style="color:#64748b">외 '+more+'건</span>':'')+'</div>'+
      '</div>';
    }).join('')+
    '<div style="font-size:10.5px;color:#94a3b8;margin-top:4px">치명 항목부터 처리하세요. 수정 후 다시 점검하면 목록이 줄어듭니다.</div>';
};

/* ── 원료 단위 g 통일 (kg → g, 표준단가 ÷1000) ── */
function unitPlan(){
  return (db.master.M_RAW||[]).filter(function(r){
    return /^\s*(kg|킬로|킬로그램)\s*$/i.test(String(r.unit||''));
  }).map(function(r){
    return { id:r.rawId, name:r.name, cost:N(r.stdCost), newCost:Math.round(N(r.stdCost)/1000*10000)/10000 };
  });
}
window.previewUnitFix=function(){
  var plan=unitPlan(), box=$('dq-unitfix'); if(!box) return;
  if(!plan.length){ box.innerHTML='<div style="font-size:12px;color:#059669;font-weight:800;padding:6px 0">✅ kg 단위로 등록된 원료가 없습니다. 이미 g 기준으로 통일돼 있습니다.</div>'; return; }
  box.innerHTML=
    '<div style="max-height:210px;overflow-y:auto;margin-top:6px"><table style="width:100%;font-size:12px">'+
    '<tr><th style="text-align:left">원료</th><th style="width:18%">단위</th><th style="width:30%">표준단가</th></tr>'+
    plan.map(function(x){
      return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(x.name)+'</td>'+
        '<td style="text-align:center">kg → <b style="color:#0f766e">g</b></td>'+
        '<td style="text-align:right">'+(x.cost?F(x.cost)+'원/kg → <b style="color:#0f766e">'+x.newCost.toLocaleString()+'원/g</b>':'<span style="color:#94a3b8">미입력</span>')+'</td></tr>';
    }).join('')+'</table></div>'+
    '<div style="font-size:11.5px;color:#c2410c;font-weight:700;margin-top:5px">⚠ 재고 수량(RAW_LOT)은 이미 g 기준이므로 변경하지 않습니다. 단위 표기와 표준단가만 맞춥니다.</div>'+
    '<button class="btn btn-primary w-full" style="margin-top:6px" onclick="applyUnitFix()">'+plan.length+'개 원료 단위 g 통일</button>';
};
window.applyUnitFix=function(){
  var plan=unitPlan(); if(!plan.length) return;
  if(!window.confirm(plan.length+'개 원료의 단위를 g으로 바꾸고 표준단가를 1/1000로 환산합니다.\n(재고 수량은 변경되지 않습니다)\n계속할까요?')) return;
  plan.forEach(function(x){
    var r=(db.master.M_RAW||[]).find(function(y){ return String(y.rawId)===String(x.id); });
    if(!r) return;
    r.unit='g';
    if(N(r.stdCost)>0) r.stdCost=x.newCost;
  });
  if(typeof logEvent==='function') logEvent('원료 단위 g 통일 '+plan.length+'건');
  if(typeof toast==='function') toast(plan.length+'개 원료 단위 g 통일 완료','success');
  saveDB();
  try{ runDataCheck(); previewUnitFix(); if(typeof mpRender==='function') mpRender('RAW'); }catch(e){}
};

/* ── 단가 0원 LOT에 마스터 표준단가 채우기 ── */
function costPlan(){
  var out=[];
  function push(key, idk, master, unitAware){
    (db.stock[key]||[]).forEach(function(l){
      if(N(l.unitCost)>0 || N(l.remaining)<=0) return;
      var m=(db.master[master]||[]).find(function(x){ return String(x[idk])===String(l[idk]); });
      if(!m || !N(m.stdCost)) return;
      var c=N(m.stdCost);
      /* 마스터 단위가 kg이면 재고 기준(g)에 맞춰 환산 */
      if(unitAware && /kg/i.test(String(m.unit||''))) c=c/1000;
      out.push({key:key, id:l.id, lotNo:l.lotNo, name:m.name, qty:N(l.remaining), cost:Math.round(c*100)/100});
    });
  }
  push('RAW_LOT','rawId','M_RAW',true);
  push('PACK_LOT','packId','M_PACK',false);
  return out;
}
window.previewCostFill=function(){
  var plan=costPlan();
  var box=$('dq-costfix');
  if(!box) return;
  if(!plan.length){ box.innerHTML='<div style="font-size:12px;color:#059669;font-weight:800;padding:6px 0">✅ 단가가 비어 있는 LOT이 없습니다. (마스터 표준단가도 없는 품목은 제외)</div>'; return; }
  var amt=plan.reduce(function(s,x){ return s+x.qty*x.cost; },0);
  box.innerHTML=
    '<div style="max-height:200px;overflow-y:auto;margin-top:6px"><table style="width:100%;font-size:12px">'+
    '<tr><th style="text-align:left">품목</th><th style="text-align:left">LOT</th><th style="width:18%">잔량</th><th style="width:20%">적용 단가</th></tr>'+
    plan.map(function(x){ return '<tr style="border-top:1px solid #e2e8f0"><td>'+E(x.name)+'</td><td class="mono" style="color:#94a3b8">'+E(x.lotNo)+'</td>'+
      '<td style="text-align:right">'+F(x.qty)+'</td><td style="text-align:right;font-weight:800">'+x.cost.toLocaleString()+'</td></tr>'; }).join('')+
    '</table></div>'+
    '<div style="font-size:12px;font-weight:800;color:#0f766e;margin-top:4px">'+plan.length+'개 LOT · 평가금액 약 ₩'+F(amt)+' 반영 예정</div>'+
    '<button class="btn btn-primary w-full" style="margin-top:6px" onclick="applyCostFill()">단가 채우기 적용</button>';
};
window.applyCostFill=function(){
  var plan=costPlan();
  if(!plan.length) return;
  if(!window.confirm(plan.length+'개 LOT에 마스터 표준단가를 적용합니다. 계속할까요?')) return;
  plan.forEach(function(x){
    var l=(db.stock[x.key]||[]).find(function(y){ return String(y.id)===String(x.id); });
    if(l) l.unitCost=x.cost;
  });
  if(typeof logEvent==='function') logEvent('LOT 단가 일괄 적용 '+plan.length+'건');
  if(typeof toast==='function') toast(plan.length+'개 LOT 단가 적용 완료','success');
  saveDB();
  try{ runDataCheck(); previewCostFill(); if(typeof mpRender==='function'){ mpRender('RAW'); mpRender('PACK'); } }catch(e){}
};

function injectUI(){
  if($('page-data-check')) return;
  var anchor=$('page-doc-center')||$('page-loc-stock')||document.querySelector('.page-section');
  if(!anchor||!anchor.parentNode) return;
  var sec=document.createElement('section');
  sec.id='page-data-check'; sec.className='page-section space-y-4';
  sec.innerHTML=
    '<h2 class="text-lg font-black text-slate-800">🩺 데이터 점검</h2>'+
    '<div style="font-size:11.5px;color:#64748b;font-weight:600">마스터·재고·BOM·규제 데이터의 빈 곳을 한 번에 찾습니다. 원가·서류가 조용히 어긋나는 것을 막습니다.</div>'+
    '<button class="btn btn-primary w-full" onclick="runDataCheck()" style="font-size:14px;padding:12px">🔍 데이터 점검 실행</button>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #fdba74;background:#fffaf5">'+
      '<h3 class="font-bold text-slate-700 text-sm">⚖️ 원료 단위 g 통일 (kg 혼용 제거)</h3>'+
      '<div style="font-size:11.5px;color:#64748b">재고·BOM·MRP는 모두 <b>g 기준</b>으로 계산됩니다. 마스터 단위가 kg이면 표시와 단가가 1,000배 어긋납니다. (예: 30ml 향수에 24kg 표시)</div>'+
      '<button class="btn btn-secondary w-full" onclick="previewUnitFix()">대상 확인 (미리보기)</button>'+
      '<div id="dq-unitfix"></div>'+
    '</div>'+
    '<div class="card p-4 space-y-2" style="border:1.5px solid #7fb8a4;background:#f7fbfa">'+
      '<h3 class="font-bold text-slate-700 text-sm">💰 재고 단가 채우기 (평가금액 복구)</h3>'+
      '<div style="font-size:11.5px;color:#64748b">재고 현황의 단가·평가금액은 <b>LOT에 저장된 단가</b>로 계산됩니다. 일괄 기초재고로 넣은 LOT은 단가가 비어 0원으로 표시되니, 마스터 표준단가를 채워 넣으세요. (원료 마스터 단위가 kg이면 g 기준으로 자동 환산)</div>'+
      '<button class="btn btn-secondary w-full" onclick="previewCostFill()">대상 확인 (미리보기)</button>'+
      '<div id="dq-costfix"></div>'+
    '</div>'+
    '<div id="dq-result"></div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var nav=$('nav-doc-center')||$('nav-loc-stock');
  if(nav&&!$('nav-data-check')){
    var n=document.createElement('div');
    n.id='nav-data-check'; n.className='nav-item'; n.setAttribute('onclick',"goPage('data-check')");
    n.innerHTML='<i data-lucide="stethoscope" class="w-4 h-4 shrink-0"></i> 🩺 데이터 점검';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
}

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  if(p==='data-check'){ injectUI(); try{ runDataCheck(); }catch(e){} }
};
function boot(){ injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,1600);
var __dqKeep=setInterval(injectUI,3000);
setTimeout(function(){ clearInterval(__dqKeep); },90000);
})();

/* ═══════════ 모듈: 비색 테마 ═══════════ */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var N=function(v){var x=Number(v);return isFinite(x)?x:0;};
var E=function(v){return (typeof escH==='function')?escH(v):String(v==null?'':v);};
var F=function(v){return Math.round(N(v)).toLocaleString();};

/* ════════ 2단계: 비색 팔레트 ════════ */
function injectTheme(){
  if($('nose-theme')) return;
  var st=document.createElement('style');
  st.id='nose-theme';
  st.textContent=[
    ':root{--celadon:#5e7676;--celadon-soft:#e7efed;--ink:#172222;--muted:#6f7d7b;--line:#dfe6e4}',
    '.nav-label{cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px}',
    '.nav-label .nose-cnt{margin-left:auto;font-size:9px;opacity:.55;font-weight:700}',
    '.nav-label .nose-caret{font-size:8px;opacity:.6;transition:transform .15s}',
    '.nav-label.nose-collapsed .nose-caret{transform:rotate(-90deg)}',
    '.btn-primary,button.btn-primary{background:var(--celadon) !important;border-color:var(--celadon) !important;color:#fff !important}',
    '.btn-primary:hover{background:#4f6767 !important}',
    '.badge-soft{background:var(--celadon-soft) !important;color:#3e6960 !important}',
    '.nose-qa{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:14px}',
    '.nose-qa-item{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px;display:flex;align-items:center;gap:11px;cursor:pointer;box-shadow:0 3px 12px rgba(26,44,41,.025)}',
    '.nose-qa-item:hover{border-color:#b7c9c5;box-shadow:0 10px 30px rgba(26,44,41,.07)}',
    '.nose-qa-icon{width:36px;height:36px;border-radius:10px;background:var(--celadon-soft);display:grid;place-items:center;color:var(--celadon);font-size:17px;flex:none}',
    '.nose-qa-item strong{display:block;font-size:12.5px;color:var(--ink)}',
    '.nose-qa-item span{display:block;font-size:10.5px;color:var(--muted);margin-top:2px}',
    '.nose-alerts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;margin-bottom:14px}',
    '.nose-alert{border-radius:14px;padding:14px 16px;border:1px solid;display:flex;align-items:center;gap:12px;background:#fff;cursor:pointer}',
    '.nose-alert.red{border-color:#f0cfcf;background:#fff1f1}.nose-alert.amber{border-color:#f1dfb6;background:#fff8e8}.nose-alert.blue{border-color:#d3e3ed;background:#eef6fb}.nose-alert.green{border-color:#d5eadf;background:#edf8f3}',
    '.nose-alert-icon{width:38px;height:38px;border-radius:10px;background:#fff;display:grid;place-items:center;font-size:17px;flex:none}',
    '.nose-alert h3{font-size:12px;margin:0;color:var(--ink)}.nose-alert p{font-size:10px;color:var(--muted);margin:3px 0 0}',
    '.nose-alert-num{margin-left:auto;font-size:24px;font-weight:900}',
    '.red .nose-alert-num{color:#c94b4b}.amber .nose-alert-num{color:#b7791f}.blue .nose-alert-num{color:#3d6f91}.green .nose-alert-num{color:#2f7b61}',
    '.nose-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px}',
    '.nose-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px;cursor:pointer}',
    '.nose-kpi:hover{border-color:#b7c9c5}',
    '.nose-kpi-top{display:flex;justify-content:space-between;align-items:center;color:var(--muted);font-size:11px;font-weight:700}',
    '.nose-kpi-value{font-size:23px;font-weight:900;margin-top:10px;letter-spacing:-.03em;color:var(--ink)}',
    '.nose-kpi-foot{font-size:10px;color:#7f8c89;margin-top:5px}',
    '@media(max-width:760px){.nose-qa{grid-template-columns:1fr}.nose-kpi-value{font-size:20px}}'
  ].join('\n');
  document.head.appendChild(st);
}

/* ════════ 1단계: 본체 그룹 라벨 활용 ════════ */
/* 확장 메뉴를 어느 본체 그룹으로 보낼지 (라벨 텍스트 일부로 매칭) */
var PLACE=[
  {id:'nav-perfume-ai',     label:'연구개발'},
  {id:'nav-prod-schedule',  label:'생산'},
  {id:'nav-yield',          label:'생산'},
  {id:'nav-loc-stock',      label:'재고'},
  {id:'nav-doc-center',     label:'문서'},
  {id:'nav-data-check',     label:'설정'}
];
function labels(){
  return Array.prototype.slice.call(document.querySelectorAll('.nav-label'));
}
function membersOf(lab){
  var out=[], n=lab.nextElementSibling;
  while(n && !(n.classList && n.classList.contains('nav-label'))){
    if(n.classList && n.classList.contains('nav-item')) out.push(n);
    n=n.nextElementSibling;
  }
  return out;
}
function placeExtensions(){
  var labs=labels(); if(!labs.length) return;
  PLACE.forEach(function(p){
    var el=$(p.id); if(!el) return;
    var lab=labs.filter(function(l){ return l.textContent.indexOf(p.label)>=0; })[0];
    if(!lab) return;
    var ms=membersOf(lab);
    var last=ms.length?ms[ms.length-1]:lab;
    if(el.previousElementSibling===last || el===last) return;   /* 이미 제자리 */
    last.parentNode.insertBefore(el, last.nextSibling);
  });
  /* 간편 기록은 대시보드 바로 아래 고정 */
  var q=$('nav-quick-log'), d=$('nav-dashboard');
  if(q&&d&&d.nextElementSibling!==q) d.parentNode.insertBefore(q, d.nextSibling);
}
function decorateLabels(){
  labels().forEach(function(lab){
    var ms=membersOf(lab);
    if(!lab.dataset.noseInit){
      lab.dataset.noseInit='1';
      lab.addEventListener('click', function(){
        var on=lab.classList.toggle('nose-collapsed');
        membersOf(lab).forEach(function(m){ m.style.display=on?'none':''; });
      });
    }
    var cnt=lab.querySelector('.nose-cnt');
    if(!cnt){
      cnt=document.createElement('span'); cnt.className='nose-cnt';
      var car=document.createElement('span'); car.className='nose-caret'; car.textContent='▼';
      lab.appendChild(cnt); lab.appendChild(car);
    }
    cnt.textContent=ms.length;
  });
}
function fixNav(){
  if(!document.querySelector('.nav-label')) return;
  placeExtensions();
  decorateLabels();
}

/* ════════ 3단계: 대시보드 재구성 ════════ */
var QA=[
  {icon:'⚡', t:'주간 정산', s:'생산·출고·실사 한 번에', p:'quick-log'},
  {icon:'📅', t:'생산 일정', s:'캘린더·간트', p:'prod-schedule'},
  {icon:'🏬', t:'위치 재고', s:'공장·물류·매장·피킹', p:'loc-stock'},
  {icon:'📚', t:'문서센터', s:'서류 발행·기록', p:'doc-center'}
];
function metricsSafe(){
  try{
    var t=new Date().toISOString().split('T')[0];
    var soon=new Date(); soon.setDate(soon.getDate()+30); soon=soon.toISOString().split('T')[0];
    var S=db.stock||{}, T=db.txn||{}, M=db.master||{};
    var qc=(S.FGT_LOT||[]).filter(function(l){return String(l.status||'').toUpperCase()==='HOLD';}).length;
    var mat=(S.BULK_LOT||[]).filter(function(l){return String(l.status||'').toUpperCase()==='HOLD'&&l.matureUntil&&l.matureUntil<=t&&N(l.remaining)>0;}).length;
    var exp=[].concat(S.RAW_LOT||[],S.PACK_LOT||[]).filter(function(l){return N(l.remaining)>0&&l.expDate&&l.expDate<=soon&&String(l.status||'OK').toUpperCase()!=='FAIL';}).length;
    var th=N((db.meta&&db.meta.lowStockTh)!=null?db.meta.lowStockTh:10)||10;
    var agg={};
    (S.FGT_LOT||[]).forEach(function(l){ if(String(l.status||'OK').toUpperCase()==='FAIL') return; agg[l.productId]=(agg[l.productId]||0)+N(l.remaining); });
    (M.M_PRODUCT||[]).forEach(function(p){ if(agg[p.productId]==null) agg[p.productId]=0; });
    var low=Object.keys(agg).filter(function(k){return agg[k]<th;}).length;
    function val(k){ return (S[k]||[]).reduce(function(s,l){ return String(l.status||'OK').toUpperCase()==='FAIL'?s:s+N(l.remaining)*N(l.unitCost); },0); }
    var asset=val('RAW_LOT')+val('PACK_LOT')+val('BULK_LOT')+val('FGT_LOT');
    var fgtQty=(S.FGT_LOT||[]).reduce(function(s,l){return String(l.status||'OK').toUpperCase()==='FAIL'?s:s+N(l.remaining);},0);
    var ym=t.slice(0,7);
    var mSale=(T.T_SALE||[]).filter(function(s){return String(s.date||'').indexOf(ym)===0;}).reduce(function(s,x){return s+N(x.amount);},0);
    var mProd=(T.T_BATCH||[]).filter(function(b){return String(b.date||'').indexOf(ym)===0;}).reduce(function(s,b){return s+N(b.qty);},0);
    return {qc:qc,mat:mat,exp:exp,low:low,asset:asset,fgtQty:fgtQty,mSale:mSale,mProd:mProd,th:th};
  }catch(e){ return null; }
}
function renderDash(){
  var host=$('page-dashboard'); if(!host||!window.db) return;
  var m=metricsSafe(); if(!m) return;
  var box=$('nose-dash');
  if(!box){
    box=document.createElement('div'); box.id='nose-dash'; box.style.marginBottom='14px';
    host.insertBefore(box, host.firstChild);
  }
  var alerts=[
    {c:m.qc>0?'red':'green', i:'🧪', h:'품질검사 대기', p:'출하 전 판정 필요', n:m.qc, pg:'qc-prod'},
    {c:m.low>0?'amber':'green', i:'🔻', h:'품절 임박 완제품', p:m.th+'개 미만 품목', n:m.low, pg:'loc-stock'},
    {c:m.exp>0?'amber':'green', i:'⏰', h:'유통기한 30일 임박', p:'원료·포장재 LOT', n:m.exp, pg:'stock'},
    {c:m.mat>0?'blue':'green', i:'🫙', h:'숙성 완료 벌크', p:'충진 가능', n:m.mat, pg:'t-batch'}
  ];
  var kpis=[
    {t:'총 재고자산', v:'₩'+F(m.asset), f:'원료·부자재·벌크·완제품 합계', pg:'stock'},
    {t:'완제품 재고', v:F(m.fgtQty)+' EA', f:'공장 + 물류센터 + 매장', pg:'loc-stock'},
    {t:'이번 달 생산', v:F(m.mProd)+' EA', f:'충진 완료 기준', pg:'prod-schedule'},
    {t:'이번 달 매출', v:'₩'+F(m.mSale), f:'출고 등록 기준', pg:'t-sale'}
  ];
  box.innerHTML=
    '<div class="nose-qa">'+QA.map(function(q){
      return '<div class="nose-qa-item" onclick="goPage(\''+q.p+'\')"><div class="nose-qa-icon">'+q.icon+'</div>'+
        '<div><strong>'+E(q.t)+'</strong><span>'+E(q.s)+'</span></div></div>';
    }).join('')+'</div>'+
    '<div class="nose-alerts">'+alerts.map(function(a){
      return '<div class="nose-alert '+a.c+'" onclick="goPage(\''+a.pg+'\')"><div class="nose-alert-icon">'+a.i+'</div>'+
        '<div><h3>'+E(a.h)+'</h3><p>'+E(a.p)+'</p></div><div class="nose-alert-num">'+a.n+'</div></div>';
    }).join('')+'</div>'+
    '<div class="nose-kpis">'+kpis.map(function(k){
      return '<div class="nose-kpi" onclick="goPage(\''+k.pg+'\')"><div class="nose-kpi-top"><span>'+E(k.t)+'</span><span>›</span></div>'+
        '<div class="nose-kpi-value">'+k.v+'</div><div class="nose-kpi-foot">'+E(k.f)+'</div></div>';
    }).join('')+'</div>';
}
window.noseRenderDash=renderDash;
window.noseFixNav=fixNav;

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  injectTheme(); fixNav();
  if(p==='dashboard') setTimeout(renderDash,120);
};
function boot(){ injectTheme(); fixNav(); renderDash(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,2500);
setTimeout(function(){ fixNav(); renderDash(); },5000);
setInterval(function(){ try{ if($('page-dashboard')&&$('page-dashboard').classList.contains('active')) renderDash(); }catch(e){} },60000);
})();

/* ═══════════ 모듈: 향수 표준 BOM ═══════════ */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var N=function(v){var x=Number(v);return isFinite(x)?x:0;};
var E=function(v){return (typeof escH==='function')?escH(v):String(v==null?'':v);};
var EXCLUDE=/디퓨저|diffuser|디스커버리|discovery|set|세트|룸스프레이|캔들/i;

function norm(s){ return String(s||'').toLowerCase().replace(/[\s_\-·.]/g,''); }
function sizeOf(name){ var m=String(name||'').match(/(\d+)\s*ml/i); return m?N(m[1]):0; }
function perfumeProducts(){
  return (db.master.M_PRODUCT||[]).filter(function(p){
    return sizeOf(p.name)>0 && !EXCLUDE.test(String(p.name||''));
  });
}
/* 제품명 토큰으로 향료 원료 자동 매칭 */
function guessFragrance(pname){
  var raws=(db.master.M_RAW||[]).filter(function(r){
    return /fragrance|향료|oil|HPD|퍼퓸/i.test(String(r.name||'')+' '+String(r.inci||''));
  });
  var pn=norm(pname).replace(/\d+ml/,'').replace(/시프트아이|shifti/g,'');
  var best=null;
  raws.forEach(function(r){
    var rn=norm(r.name);
    var score=0;
    if(pn && rn.indexOf(pn)>=0) score=3;
    else if(pn && pn.length>2 && rn.indexOf(pn.slice(0,4))>=0) score=2;
    /* INCI에 제품명이 들어간 경우 (예: INCI AnnE) */
    if(norm(r.inci).indexOf(pn)>=0 && pn) score=Math.max(score,3);
    if(score && (!best||score>best.s)) best={r:r,s:score};
  });
  return best?best.r:null;
}
function packOpts(sel){
  return (db.master.M_PACK||[]).map(function(p){
    return '<option value="'+E(p.packId)+'"'+(String(sel)===String(p.packId)?' selected':'')+'>'+E(p.name)+'</option>';
  }).join('');
}
function rawOpts(sel, filter){
  return (db.master.M_RAW||[]).filter(function(r){ return !filter||filter(r); }).map(function(r){
    return '<option value="'+E(r.rawId)+'"'+(String(sel)===String(r.rawId)?' selected':'')+'>'+E(r.name)+'</option>';
  }).join('');
}

function sig(){ return ((db.master.M_PACK||[]).length)+'/'+((db.master.M_RAW||[]).length)+'/'+((db.master.M_PRODUCT||[]).length); }
function injectUI(){
  var host=$('page-master-product'); if(!host) return;
  var old=$('bt-card');
  if(old){
    /* 마스터가 변경되면 목록을 다시 그림 (신규 원료·포장재 반영) */
    if(old.dataset.sig===sig()) return;
    old.remove();
  }
  var card=document.createElement('div');
  card.id='bt-card'; card.className='card p-4 space-y-3';
  card.dataset.sig=sig();
  card.style.cssText='margin-top:14px;border:1.5px solid #7fb8a4;background:#f7fbfa';
  var eth=(db.master.M_RAW||[]).filter(function(r){ return /ethanol|주정|alcohol/i.test(String(r.name||'')); })[0];
  card.innerHTML=
    '<h3 class="font-bold text-slate-700 text-sm">🧪 향수 표준 BOM 일괄 적용</h3>'+
    '<div style="font-size:11px;color:#64748b">충진중량 기준 <b>배합비(%) 방식</b>으로 생성합니다. 절대량(kg) 입력 시 재고(g)와 1,000배 어긋나는 문제를 방지합니다. 디퓨저·디스커버리·세트는 자동 제외됩니다.</div>'+
    '<div style="font-size:11.5px;font-weight:800;color:#0f766e">① 원료</div>'+
    '<div class="grid grid-cols-3 gap-2">'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">베이스(주정)</label><select id="bt-eth" class="input-field">'+rawOpts(eth&&eth.rawId)+'</select></div>'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">주정 비율(%)</label><input id="bt-ethpct" type="number" class="input-field text-right" value="80"></div>'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">향료 비율(%)</label><input id="bt-frgpct" type="number" class="input-field text-right" value="20"></div>'+
    '</div>'+
    '<div style="font-size:11.5px;font-weight:800;color:#0f766e">② 용량별 포장재 (병·캡)</div>'+
    '<div class="grid grid-cols-2 gap-2">'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">30ml 병</label><select id="bt-b30" class="input-field"><option value="">— 없음 —</option>'+packOpts()+'</select></div>'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">30ml 캡</label><select id="bt-c30" class="input-field"><option value="">— 없음 —</option>'+packOpts()+'</select></div>'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">50ml 병</label><select id="bt-b50" class="input-field"><option value="">— 없음 —</option>'+packOpts()+'</select></div>'+
      '<div><label style="font-size:10px;font-weight:800;color:#64748b">50ml 캡</label><select id="bt-c50" class="input-field"><option value="">— 없음 —</option>'+packOpts()+'</select></div>'+
    '</div>'+
    '<div style="font-size:11.5px;font-weight:800;color:#0f766e">③ 공통 포장재 (전 용량 동일, 각 1개)</div>'+
    '<div id="bt-common" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:4px;max-height:150px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff">'+
      (db.master.M_PACK||[]).map(function(p){
        var auto=/box|박스|노즐|nozzle|펌프|pump|스트럿|쇼핑백|bag/i.test(String(p.name||''));
        return '<label style="font-size:11.5px;font-weight:700;display:flex;align-items:center;gap:6px"><input type="checkbox" class="bt-cm" value="'+E(p.packId)+'"'+(auto?' checked':'')+'> '+E(p.name)+'</label>';
      }).join('')+
    '</div>'+
    '<button class="btn btn-primary w-full" onclick="btPreview()">대상 제품 불러오기 (미리보기)</button>'+
    '<div id="bt-list"></div>';
  host.appendChild(card);
}

window.btPreview=function(){
  var ps=perfumeProducts();
  var box=$('bt-list'); if(!box) return;
  if(!ps.length){ box.innerHTML='<div style="font-size:12px;color:#c0392b;font-weight:700">대상 제품이 없습니다. 제품명에 30ml / 50ml 표기가 있어야 인식됩니다.</div>'; return; }
  box.innerHTML=
    '<div style="font-size:11.5px;font-weight:800;color:#0f766e;margin-top:8px">④ 적용 대상 · 제품별 향료 확인</div>'+
    '<div style="max-height:300px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;margin-top:4px">'+
    '<table style="width:100%;font-size:12px"><tr style="background:#eef5f2"><th style="width:8%"></th><th style="text-align:left">제품</th><th style="width:12%">용량</th><th style="text-align:left;width:42%">향료 원료</th></tr>'+
    ps.map(function(p,i){
      var g=guessFragrance(p.name);
      var sz=sizeOf(p.name);
      return '<tr style="border-top:1px solid #f1f5f9"><td style="text-align:center"><input type="checkbox" class="bt-p" data-i="'+i+'" data-pid="'+E(p.productId)+'"'+(g?' checked':'')+'></td>'+
        '<td style="font-weight:700">'+E(p.name)+'</td><td style="text-align:center">'+sz+'ml</td>'+
        '<td><select id="bt-f-'+i+'" class="input-field" style="padding:3px 6px;font-size:11.5px"><option value="">— 향료 선택 —</option>'+
          rawOpts(g&&g.rawId, function(r){ return /fragrance|향료|oil|HPD|퍼퓸/i.test(String(r.name||'')+' '+String(r.inci||'')); })+
        '</select></td></tr>';
    }).join('')+'</table></div>'+
    '<div style="font-size:10.5px;color:#94a3b8;margin-top:4px">향료가 자동 매칭된 제품만 체크되어 있습니다. 매칭이 틀리면 드롭다운에서 바꾸세요.</div>'+
    '<button class="btn btn-primary w-full" style="margin-top:6px" onclick="btApply()">체크한 제품에 BOM 일괄 적용</button>';
  window.__btProducts=ps;
};

window.btApply=function(){
  var ps=window.__btProducts||[];
  var ethId=$('bt-eth').value, ethPct=N($('bt-ethpct').value), frgPct=N($('bt-frgpct').value);
  if(!ethId){ if(typeof toast==='function') toast('베이스(주정)를 선택하세요','error'); return; }
  if(Math.abs(ethPct+frgPct-100)>0.01){ if(typeof toast==='function') toast('주정+향료 비율이 100%가 아닙니다 ('+(ethPct+frgPct)+'%)','error'); return; }
  var common=Array.prototype.slice.call(document.querySelectorAll('.bt-cm:checked')).map(function(c){ return c.value; });
  var size={30:{b:$('bt-b30').value,c:$('bt-c30').value},50:{b:$('bt-b50').value,c:$('bt-c50').value}};
  var checks=Array.prototype.slice.call(document.querySelectorAll('.bt-p:checked'));
  if(!checks.length){ if(typeof toast==='function') toast('적용할 제품을 선택하세요','error'); return; }
  var done=0, skip=[];
  checks.forEach(function(ch){
    var i=N(ch.dataset.i);
    var p=ps[i]; if(!p) return;
    var frgId=($('bt-f-'+i)||{}).value;
    if(!frgId){ skip.push(p.name+' (향료 미지정)'); return; }
    var sz=sizeOf(p.name);
    var bom=[
      {type:'RAW', itemId: isNaN(Number(ethId))?ethId:Number(ethId), qty: ethPct},
      {type:'RAW', itemId: isNaN(Number(frgId))?frgId:Number(frgId), qty: frgPct}
    ];
    var sp=size[sz]||{};
    [sp.b, sp.c].forEach(function(id){ if(id) bom.push({type:'PACK', itemId:isNaN(Number(id))?id:Number(id), qty:1}); });
    common.forEach(function(id){ bom.push({type:'PACK', itemId:isNaN(Number(id))?id:Number(id), qty:1}); });
    var target=(db.master.M_PRODUCT||[]).find(function(x){ return String(x.productId)===String(p.productId); });
    if(!target) return;
    target.fillWeight = sz;          /* 30ml→30g, 50ml→50g */
    target.bom = bom;
    done++;
  });
  if(typeof logEvent==='function') logEvent('향수 표준 BOM 일괄 적용 '+done+'개 제품');
  if(typeof toast==='function') toast(done+'개 제품 BOM 생성 완료'+(skip.length?' (제외 '+skip.length+'건)':''),'success');
  var box=$('bt-list');
  if(box) box.innerHTML='<div style="font-size:12.5px;font-weight:800;color:#0f766e;padding:8px 0">✅ '+done+'개 제품에 BOM을 적용했습니다. (충진중량 자동 설정 · 배합비 '+ethPct+':'+frgPct+')'+
    (skip.length?'<br><span style="color:#c2410c">⚠️ 제외: '+skip.map(E).join(', ')+'</span>':'')+
    '<br><span style="color:#64748b;font-weight:600">데이터 점검에서 BOM 항목이 사라졌는지 확인해 보세요.</span></div>';
  saveDB();
  try{ if(typeof renderProduct==='function') renderProduct(); }catch(e){}
};

var _init=window.initNewPage;
window.initNewPage=function(p){
  try{ if(typeof _init==='function') _init(p); }catch(e){}
  if(p==='master-product') injectUI();
};
function boot(){ injectUI(); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot,1800);
var __btKeep=setInterval(injectUI,3000);
setTimeout(function(){ clearInterval(__btKeep); },90000);
})();
