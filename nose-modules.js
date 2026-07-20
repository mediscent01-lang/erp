/* ╔══════════════════════════════════════════════════════════╗
   SHIFTI ERP 확장 모듈 nose-modules.js v1.0 — 노즈 (2026-07-17)
   포함: ① MES(작업지시·수율·캘린더·간트) ② 알레르겐 프로파일
         ③ 규제문서 출력 ④ 거래명세서·부가세·QR라벨 ⑤ 문서센터
   설치: index.html의 </body> 바로 위에 아래 "한 줄"만 추가
     <script src="nose-modules.js"></script>
   업데이트: 이 파일만 새 버전으로 통째 교체 (index.html은 다시 안 건드림)
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
/* 클라우드 로드가 늦게 끝나는 경우 대비 재시도 */
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
    '<h2 class="text-lg font-black text-slate-800">규제문서 출력 (식약처 의무기록)</h2>'+
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

  var nav = $('nav-allergen-report');
  if(nav && !$('nav-mfds-docs')){
    var n = document.createElement('div');
    n.id='nav-mfds-docs'; n.className='nav-item'; n.setAttribute('onclick',"goPage('mfds-docs')");
    n.innerHTML='<i data-lucide="file-check-2" class="w-4 h-4 shrink-0"></i> 규제문서 출력 🆕';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
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
    '<h2 class="text-lg font-black text-slate-800">거래서류 발행 (명세서 · 부가세 기초)</h2>'+
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

  var nav = $('nav-mfds-docs') || $('nav-allergen-report');
  if(nav && !$('nav-trade-docs')){
    var n = document.createElement('div');
    n.id='nav-trade-docs'; n.className='nav-item'; n.setAttribute('onclick',"goPage('trade-docs')");
    n.innerHTML='<i data-lucide="receipt-text" class="w-4 h-4 shrink-0"></i> 거래서류 발행 🆕';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
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
      '<button class="btn btn-secondary w-full" style="margin-top:14px" onclick="document.getElementById(\'lot-qv-modal\').remove()">닫기</button>'+
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
var CATALOG = [
  {icon:'📦', title:'월간 원자재 수불부', desc:'기초·입고·사용·기말 자동 집계 (원료/포장재)', act:'openLedgerReport()'},
  {icon:'🏭', title:'생산월보', desc:'배합·충진·QC 실적 월간 요약', act:'openProdMonthly()'},
  {icon:'📅', title:'연간 생산실적 집계표', desc:'식약처 생산실적 보고(매년 2월) 기초자료', act:'openAnnualReport()'},
  {icon:'🔍', title:'LOT 추적성 패키지', desc:'제조기록+QC+원료CoA+알레르겐 일괄 출력 (감사·리콜)', act:'openTracePack()'},
  {icon:'🧼', title:'위생점검일지', desc:'일일 위생점검 입력 + 월별 일지 출력', act:"openCheckLog('위생')"},
  {icon:'⚙️', title:'설비점검일지', desc:'월 1회 설비점검 입력 + 일지 출력 (기준서 3항 근거)', act:"openCheckLog('설비')"},
  {icon:'🎓', title:'교육이수 대장', desc:'법정·사내 교육 기록 + 대장 출력', act:"openCheckLog('교육')"}
];
function injectUI(){
  if($('page-doc-center')) return;
  var anchor = $('page-trade-docs') || $('page-mfds-docs') || document.querySelector('.page-section');
  if(!anchor || !anchor.parentNode) return;
  var sec = document.createElement('section');
  sec.id='page-doc-center'; sec.className='page-section space-y-4';
  sec.innerHTML =
    '<h2 class="text-lg font-black text-slate-800">문서센터 (기간 일지 · 추적성 · 점검기록)</h2>'+
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">'+
    CATALOG.map(function(c){
      return '<div class="card p-4" style="cursor:pointer" onclick="'+c.act+'">'+
        '<div style="font-size:22px">'+c.icon+'</div>'+
        '<div style="font-weight:900;font-size:13px;color:#0f172a;margin:4px 0 2px">'+c.title+'</div>'+
        '<div style="font-size:10.5px;color:#64748b;line-height:1.5">'+c.desc+'</div></div>';
    }).join('')+'</div>'+
    '<div id="dc-panel"></div>';
  anchor.parentNode.insertBefore(sec, anchor.nextSibling);

  var nav = $('nav-trade-docs') || $('nav-mfds-docs') || $('nav-allergen-report');
  if(nav && !$('nav-doc-center')){
    var n = document.createElement('div');
    n.id='nav-doc-center'; n.className='nav-item'; n.setAttribute('onclick',"goPage('doc-center')");
    n.innerHTML='<i data-lucide="library-big" class="w-4 h-4 shrink-0"></i> 문서센터 🆕';
    nav.parentNode.insertBefore(n, nav.nextSibling);
    try{ if(window.lucide) lucide.createIcons(); }catch(e){}
  }
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
  ((bulk&&bulk.materials)||[]).forEach(function(m,i){
    var raw = m.type!=='PACK' && (typeof findRaw==='function') && findRaw(m.itemId);
    var pk  = m.type==='PACK' && (typeof findPack==='function') && findPack(m.itemId);
    var nm = (raw&&raw.name)||(pk&&pk.name)||m.itemId;
    (m.lots||[{lotNo:'-',take:m.need}]).forEach(function(l){
      matRows+='<tr><td class="c">'+(++i,'')+E(m.type||'RAW')+'</td><td>'+E(nm)+'</td><td class="c">'+E(l.lotNo)+'</td><td class="r">'+F2(l.take)+'</td><td class="c">□ 보관확인</td></tr>';
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
})();