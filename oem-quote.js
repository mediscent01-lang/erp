/* =========================================================================
 * OEM 원가 견적 모듈 (ERP 「8 · 문서 / 보고」 > OEM 원가 견적) — 2026-11-17
 * - 단가표: 구글시트 「20261117_OEM_단가표」(공유드라이브 시프트아이 2026 > 프로그램)
 *   탭 FRAGRANCES·BOTTLES·CAPS·BOXES·EXTRAS·SETTINGS. 시트를 못 읽으면 아래 FALLBACK 사용.
 * - 계산식은 07_RnD_시스템개발\OEM_견적프로그램\20261012_OEM2.html(v3)과 같다.
 * - ERP DB(Supabase)를 읽거나 쓰지 않는다. 화면·계산만 한다.
 * - 원가가 담긴 화면이므로 고객에게는 [고객용 견적서 인쇄]로 만든 문서만 보낸다.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.OEMQ) return;

  var SHEET_ID = '1IqQ1H44UDK-UyM7kaRcgttiEbqSG3AQMVqS47ubxnBE';
  var TABS = ['FRAGRANCES', 'BOTTLES', 'CAPS', 'BOXES', 'EXTRAS', 'SETTINGS'];
  var TIER_QTYS = [500, 1000, 2000, 3000, 5000];

  var FALLBACK = {
    FRAGRANCES: [
      { code: 'F-SUN', name: '선릿윈도우 · YELLOW ACHILLEA', pricePerKg: 230000, ratio: 0.15, moqKg: 0, note: '거래처원장 09-23 실거래' },
      { code: 'F-NEW', name: '뉴리프 · WHITE TEA MUSK', pricePerKg: 260000, ratio: 0.15, moqKg: 0, note: '샘플시트 06-26' },
      { code: 'F-GRT', name: '더그레잇 · AQUA ORANGE', pricePerKg: 295000, ratio: 0.15, moqKg: 0, note: '납품리스트 06-26' },
      { code: 'F-ANN', name: '앤 · CITRUS WOODY', pricePerKg: 350000, ratio: 0.15, moqKg: 0, note: '납품리스트 06-26' },
      { code: 'F-ARI', name: '아리랑 · LOTUS SERENITY F', pricePerKg: 350000, ratio: 0.15, moqKg: 0, note: '거래처원장 06-15 실거래' },
      { code: 'F-BRJ', name: '말괄량이 · BRIGHT JOY', pricePerKg: 365000, ratio: 0.15, moqKg: 0, note: '거래처원장 07-09 실거래' },
      { code: 'F-WHO', name: '후엠아이 · BLUE HINOKI', pricePerKg: 380000, ratio: 0.15, moqKg: 0, note: '거래처원장 06-22 실거래(단가표 430,000)' },
      { code: 'F-FOG', name: '포기스터디 · SUPER CEDAR', pricePerKg: 455000, ratio: 0.15, moqKg: 0, note: '납품리스트 06-26' },
      { code: 'F-RED', name: '레드타라 · PORTRAIT LADY', pricePerKg: 480000, ratio: 0.15, moqKg: 0, note: '납품리스트 06-26' },
      { code: 'F-URB', name: '어반포레스트 · GLOAM WOOD', pricePerKg: 480000, ratio: 0.15, moqKg: 0, note: '샘플시트 09-16 (코드 확인 필요)' },
      { code: 'F-SEC', name: '시크릿가든 · POETIC NARCISSUS', pricePerKg: 520000, ratio: 0.15, moqKg: 0, note: '샘플시트 09-16' },
      { code: 'F-JAN', name: '제인 · YUJA FORET', pricePerKg: 520000, ratio: 0.15, moqKg: 0, note: '샘플시트 06-26' },
      { code: 'F-VIO', name: '바이올릿힐 · PURPLE MALLOW', pricePerKg: 850000, ratio: 0.15, moqKg: 0, note: '샘플시트 09-16' },
      { code: 'F-GLM', name: 'OEM 후보 · SUN GLEAM', pricePerKg: 95000, ratio: 0.15, moqKg: 4, note: '견적 10-28 · MOQ 4kg · 재고 없음' },
      { code: 'F-CUS', name: '신규 조향 (커스텀)', pricePerKg: 450000, ratio: 0.15, moqKg: 3, note: '추정 · 12종 평균 436,250 반올림 · MOQ 3kg' }
    ],
    BOTTLES: [
      { code: 'B10', name: '10ml 스톡 공병+펌프', volume: 10, unitPrice: 550, moq: 0, setupFee: 0, note: '추정 · 10ml 단가 자료 없음' },
      { code: 'B30', name: '30ml 스톡 공병+펌프', volume: 30, unitPrice: 780, moq: 0, setupFee: 0, note: '원가모델 09-02 · ERP 공병 762+노즐·펌프 20' },
      { code: 'B50', name: '50ml 스톡 공병+펌프', volume: 50, unitPrice: 1410, moq: 0, setupFee: 0, note: 'ERP 공병 1,390+노즐·펌프 20 · 확인 필요' }
    ],
    CAPS: [
      { code: 'C-STD', name: '일반 캡 (플라스틱·메탈 숄더캡)', unitPrice: 400, moq: 0, setupFee: 0, note: '추정 · ERP 표준단가(50ml 은색 숄더캡 400 · 업체 미정) · 견적 필요' },
      { code: 'C-10', name: '10ml 기본캡', unitPrice: 300, moq: 0, setupFee: 0, note: '추정 · 자료 없음' },
      { code: 'C-WOOD', name: '우드캡 (고급 옵션)', unitPrice: 2000, moq: 0, setupFee: 0, note: 'ERP 입고가(채운패키지) · 원가모델은 1,000 · 확인 필요' },
      { code: 'C-GAT', name: '갓캡 (GAT 디자인)', unitPrice: 1130, moq: 1000, setupFee: 0, note: '사출 350 + 끈비즈 680 + 조립 100(추정) · 자사 등록 디자인 → 제공 여부 대표 결정' }
    ],
    BOXES: [
      { code: 'BX-NONE', name: '단상자 없음 (벌크·어메니티)', volume: 0, unitPrice: 0, tiers: '', moq: 0, setupFee: 0, note: '' },
      { code: 'BX10', name: '10ml 맞춤 단상자', volume: 10, unitPrice: 800, tiers: '1000:800;2000:550', moq: 1000, setupFee: 75000, note: '추정 · 10ml 견적 없음' },
      { code: 'BX30', name: '30ml 맞춤 단상자 45×45×92', volume: 30, unitPrice: 890, tiers: '1000:890;2000:627', moq: 1000, setupFee: 75000, note: '1,000개 890(팩스트리트 견적 25-11) · 2,000개~ 627(06-22 실발주) · 목판비 75,000' },
      { code: 'BX50', name: '50ml 맞춤 단상자 45×45×111', volume: 50, unitPrice: 890, tiers: '1000:890;2000:682', moq: 1000, setupFee: 75000, note: '1,000개 890(팩스트리트 견적 25-11) · 2,000개~ 682(06-22 실발주) · 목판비 75,000' }
    ],
    EXTRAS: [
      { code: 'X-LABEL', name: '용기 라벨 스티커', type: '부자재', price: 100, unit: 'EA', setupFee: 0, def: 'Y', note: '원가모델 09-02' },
      { code: 'X-LEAF', name: '리플렛', type: '부자재', price: 30, unit: 'EA', setupFee: 0, def: 'N', note: '원가모델 09-02' },
      { code: 'X-INSERT', name: '단상자 속지(선대)', type: '부자재', price: 270, unit: 'EA', setupFee: 100000, def: 'N', note: '팩스트리트 견적 25-11 · 목판비 100,000' },
      { code: 'X-BAG', name: '쇼핑백', type: '부자재', price: 1150, unit: 'EA', setupFee: 100000, def: 'N', note: 'ERP 입고 1,150 · 목형 100,000' },
      { code: 'X-DESIGN', name: '라벨·단상자 디자인', type: '디자인', price: 300000, unit: '프로젝트', setupFee: 0, def: 'N', note: '추정 · 고객이 인쇄 데이터를 주면 제외' },
      { code: 'X-DEV', name: '향 조정·재견본 (세미 커스텀)', type: 'R&D', price: 500000, unit: '프로젝트', setupFee: 0, def: 'N', note: '추정 · 수정 2회' }
    ],
    SETTINGS: [
      { key: 'density', value: 0.85 }, { key: 'ethanolPerKg', value: 4200 }, { key: 'laborPerEa', value: 300 },
      { key: 'defectRate', value: 3 }, { key: 'defaultMargin', value: 40 }, { key: 'minMargin', value: 30 },
      { key: 'targetCostRatio', value: 25 }, { key: 'quoteValidDays', value: 30 }
    ]
  };

  var DATA = null, SET = {}, loaded = false, loading = null, fromSheet = false;
  var fmt = new Intl.NumberFormat('ko-KR');
  function won(n) { return fmt.format(Math.round(n)) + '원'; }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- 시트 읽기 (gviz JSONP) ---------- */
  var seq = 0;
  function loadTab(tab) {
    return new Promise(function (resolve, reject) {
      var cb = '__oemqCb' + (++seq);
      var s = document.createElement('script');
      var timer = setTimeout(function () { done(); reject(new Error(tab + ' 응답 없음')); }, 8000);
      function done() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
      window[cb] = function (resp) {
        done();
        if (!resp || resp.status === 'error' || !resp.table) { reject(new Error(tab + ' 읽기 실패')); return; }
        var heads = resp.table.cols.map(function (c) { return (c.label || '').trim(); });
        var rows = resp.table.rows.map(function (r) {
          var o = {};
          heads.forEach(function (h, i) { var c = r.c[i]; o[h] = (c == null || c.v == null) ? '' : c.v; });
          return o;
        }).filter(function (o) { return String(o[heads[0]] || '').trim() !== ''; });
        resolve(rows);
      };
      s.onerror = function () { done(); reject(new Error(tab + ' 요청 실패')); };
      s.src = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?headers=1&tqx=responseHandler:' + cb + ';out:json&sheet=' + encodeURIComponent(tab);
      document.head.appendChild(s);
    });
  }

  function normalize(raw) {
    var S = function (v) { return String(v == null ? '' : v); };
    return {
      FRAGRANCES: raw.FRAGRANCES.map(function (r) { return { code: S(r.code), name: S(r.name), pricePerKg: num(r.pricePerKg), ratio: num(r.ratio, 0.15), moqKg: num(r.moqKg), note: S(r.note) }; }),
      BOTTLES: raw.BOTTLES.map(function (r) { return { code: S(r.code), name: S(r.name), volume: num(r.volume), unitPrice: num(r.unitPrice), moq: num(r.moq), setupFee: num(r.setupFee), note: S(r.note) }; }),
      CAPS: raw.CAPS.map(function (r) { return { code: S(r.code), name: S(r.name), unitPrice: num(r.unitPrice), moq: num(r.moq), setupFee: num(r.setupFee), note: S(r.note) }; }),
      BOXES: raw.BOXES.map(function (r) { return { code: S(r.code), name: S(r.name), volume: num(r.volume), unitPrice: num(r.unitPrice), tiers: S(r.tiers), moq: num(r.moq), setupFee: num(r.setupFee), note: S(r.note) }; }),
      EXTRAS: raw.EXTRAS.map(function (r) { return { code: S(r.code), name: S(r.name), type: S(r.type), price: num(r.price), unit: S(r.unit) || '프로젝트', setupFee: num(r.setupFee), def: S(r.def || 'N').toUpperCase(), note: S(r.note) }; }),
      SETTINGS: raw.SETTINGS.map(function (r) { return { key: S(r.key), value: num(r.value) }; })
    };
  }

  function loadData() {
    if (loading) return loading;
    loading = Promise.all(TABS.map(loadTab)).then(function (lists) {
      var raw = {}; TABS.forEach(function (t, i) { raw[t] = lists[i]; });
      var d = normalize(raw);
      if (!(d.FRAGRANCES.length && d.BOTTLES.length && d.CAPS.length && d.BOXES.length && d.SETTINGS.length)) throw new Error('시트 탭이 비어 있음');
      DATA = d; fromSheet = true;
    }).catch(function (e) {
      console.warn('[OEM 원가 견적] 시트 대신 내장 단가 사용:', e);
      DATA = FALLBACK; fromSheet = false;
    }).then(function () {
      SET = {}; DATA.SETTINGS.forEach(function (s) { SET[s.key] = s.value; });
      loaded = true;
    });
    return loading;
  }

  /* ---------- 계산 ---------- */
  function find(tab, code) { return DATA[tab].filter(function (x) { return x.code === code; })[0]; }

  function tierPrice(box, effQty) {
    if (!box.tiers) return box.unitPrice;
    var tiers = box.tiers.split(';').map(function (t) { return t.split(':').map(Number); })
      .filter(function (t) { return t.length === 2 && !isNaN(t[0]) && !isNaN(t[1]); })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!tiers.length) return box.unitPrice;
    var p = tiers[0][1];
    tiers.forEach(function (t) { if (effQty >= t[0]) p = t[1]; });
    return p;
  }

  function computeCost(qty, o) {
    var density = SET.density || 0.85, ethPerKg = SET.ethanolPerKg || 4200;
    var liquidG = o.bottle.volume * density, fragG = liquidG * o.ratio, ethG = liquidG - fragG;
    var needKg = qty * fragG / 1000;
    var buyKg = o.frag.moqKg > 0 ? Math.max(needKg, o.frag.moqKg) : needKg;
    var cFrag = buyKg * o.frag.pricePerKg / qty;
    var cEth = ethG * ethPerKg / 1000;
    function comp(unit, moq, setup) { return (Math.max(qty, moq) * unit + (setup || 0)) / qty; }
    var cBottle = comp(o.bottle.unitPrice, o.bottle.moq, o.bottle.setupFee);
    var cCap = comp(o.cap.unitPrice, o.cap.moq, o.cap.setupFee);
    var boxEff = Math.max(qty, o.box.moq), boxUnit = tierPrice(o.box, boxEff);
    var cBox = o.box.code === 'BX-NONE' ? 0 : (boxEff * boxUnit + o.box.setupFee) / qty;
    var cExtraEa = 0, cExtraProject = 0;
    o.extras.forEach(function (x) {
      if (x.unit === 'EA') cExtraEa += (qty * x.price + x.setupFee) / qty;
      else cExtraProject += (x.price + x.setupFee) / qty;
    });
    var materials = cFrag + cEth + cBottle + cCap + cBox + cExtraEa + o.labor;
    var cDefect = materials * o.defectPct / 100;
    return { liquidG: liquidG, fragG: fragG, cFrag: cFrag, cEth: cEth, cBottle: cBottle, cCap: cCap, cBox: cBox, boxUnit: boxUnit,
      cExtraEa: cExtraEa, cExtraProject: cExtraProject, labor: o.labor, cDefect: cDefect,
      unitCost: materials + cDefect + cExtraProject, fragLeftKg: buyKg - needKg };
  }
  function priceFrom(cost, m) { return Math.ceil(cost / (1 - m / 100) / 10) * 10; }

  /* ---------- 화면 ---------- */
  var L = 'block text-[10.5px] font-bold text-slate-500 mb-1';
  function field(label, inner) { return '<div><label class="' + L + '">' + label + '</label>' + inner + '</div>'; }

  // 메뉴·문서센터 카드 넣기. nose-modules.js가 문서 메뉴를 「📚 문서센터」로 모으므로
  // 왼쪽 메뉴는 문서센터 바로 아래에, 문서센터 화면은 「견적서 (OEM)」 카드 옆에 둔다.
  function ensureEntry() {
    if (!$('nav-oem-quote')) {
      var ref = $('nav-doc-center') || $('nav-doc-quote') || $('nav-allergen-report');
      if (ref && ref.parentNode) {
        var nav = document.createElement('div');
        nav.id = 'nav-oem-quote'; nav.className = 'nav-item';
        nav.setAttribute('onclick', "goPage('oem-quote')");
        nav.innerHTML = '<i data-lucide="calculator" class="w-4 h-4 shrink-0"></i> 💰 OEM 원가 견적';
        ref.parentNode.insertBefore(nav, ref.nextSibling);
        try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (e) {}
      }
    }
    var center = $('page-doc-center');
    if (center && !$('oq-dc-card')) {
      var qcard = [].filter.call(center.querySelectorAll('.card'), function (c) { return /doc-quote/.test(c.getAttribute('onclick') || ''); })[0];
      if (qcard && qcard.parentNode) {
        var card = document.createElement('div');
        card.id = 'oq-dc-card'; card.className = 'card p-4'; card.style.cursor = 'pointer';
        card.setAttribute('onclick', "goPage('oem-quote')");
        card.innerHTML = '<div style="font-size:20px">🧮</div><div style="font-weight:900;font-size:12.5px;color:#0f172a;margin:3px 0 2px">OEM 원가 견적</div>' +
          '<div style="font-size:10.5px;color:#64748b;line-height:1.5">향료·용기·단상자 실단가로 원가 계산 → 수량별 단가표·고객용 견적서</div>';
        qcard.parentNode.insertBefore(card, qcard.nextSibling);
      }
    }
  }

  function buildDom() {
    ensureEntry();
    if ($('page-oem-quote')) return;

    var sec = document.createElement('section');
    sec.id = 'page-oem-quote'; sec.className = 'page-section space-y-4';
    sec.innerHTML =
      '<h2 class="text-lg font-black text-slate-800 flex items-center gap-2">OEM 원가 견적 <span class="badge-teal">향료·용기·단상자 실단가 기준</span></h2>' +
      '<div id="oq-src" class="text-[11px] text-slate-500">단가표 불러오는 중…</div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5">' +
        '<div class="card p-4 space-y-3 self-start">' +
          '<div class="grid grid-cols-2 gap-2">' +
            field('고객사·브랜드', '<input id="oq-brand" class="input-field" placeholder="예) ○○호텔">') +
            field('프로젝트명', '<input id="oq-project" class="input-field" placeholder="예) 30ml 객실용 EDP">') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-2">' +
            field('주문 수량 (EA) <span id="oq-qtyhint" class="text-amber-600"></span>', '<input id="oq-qty" type="number" min="1" value="1000" class="input-field text-right">') +
            field('목표 마진율 <span id="oq-mlabel">40%</span>', '<input id="oq-margin" type="range" min="10" max="70" step="1" value="40" class="w-full">') +
          '</div>' +
          field('향 (Fragrance)', '<select id="oq-frag" class="input-field"></select><div id="oq-fraginfo" class="text-[10px] text-slate-400 mt-0.5"></div>') +
          '<div class="grid grid-cols-2 gap-2">' +
            field('부향률', '<select id="oq-conc" class="input-field"><option value="sheet">기본값(시트)</option><option value="0.08">EDT 8%</option><option value="0.12">12%</option><option value="0.15">EDP 15%</option><option value="0.20">EDP 20%</option></select>') +
            field('용기 (공병+펌프)', '<select id="oq-bottle" class="input-field"></select>') +
          '</div>' +
          field('캡', '<select id="oq-cap" class="input-field"></select><div id="oq-capinfo" class="text-[10px] text-slate-400 mt-0.5"></div>') +
          field('단상자 (고객 디자인 인쇄)', '<select id="oq-box" class="input-field"></select><div id="oq-boxinfo" class="text-[10px] text-slate-400 mt-0.5"></div>') +
          '<div><label class="' + L + '">부자재 · 서비스</label><div id="oq-extras" class="space-y-1"></div></div>' +
          '<div class="grid grid-cols-2 gap-2">' +
            field('공임 (원/EA)', '<input id="oq-labor" type="number" value="300" class="input-field text-right">') +
            field('불량·손실률 (%)', '<input id="oq-defect" type="number" step="0.5" value="3" class="input-field text-right">') +
          '</div>' +
          field('고객 희망 소비자가 (VAT 포함, 원가율 점검용)', '<input id="oq-retail" type="number" placeholder="예) 39000" class="input-field text-right">') +
          '<div class="flex gap-2 pt-1">' +
            '<button class="btn btn-primary flex-1" onclick="OEMQ.printCustomer()">🖨 고객용 견적서 인쇄 / PDF</button>' +
            '<button class="btn btn-secondary px-3" onclick="OEMQ.reload()">단가표 새로고침</button>' +
          '</div>' +
          '<div class="text-[10px] text-slate-400">이 화면에는 원가·마진이 보입니다. 고객에게는 [고객용 견적서]만 보내세요. 단가는 구글시트 「20261117_OEM_단가표」에서 고칩니다.</div>' +
        '</div>' +
        '<div class="space-y-4">' +
          '<div class="card p-4">' +
            '<div class="flex items-end justify-between flex-wrap gap-2">' +
              '<div><div class="text-[11px] text-slate-500" id="oq-spec"></div><div class="text-2xl font-black text-slate-800" id="oq-unitprice">-</div><div class="text-[11px] text-slate-500">1EA 공급단가 (VAT 별도)</div></div>' +
              '<div class="text-right"><div class="text-[11px] text-slate-500">총액 (VAT 별도 / 포함)</div><div class="text-lg font-bold text-slate-800" id="oq-total">-</div><div class="text-[11px] text-slate-500" id="oq-totalvat"></div></div>' +
            '</div>' +
            '<div class="grid grid-cols-3 gap-2 mt-3 text-center">' +
              '<div class="bg-slate-50 rounded p-2"><div class="text-[10px] text-slate-500">1EA 원가</div><div class="font-bold" id="oq-cost">-</div></div>' +
              '<div class="bg-slate-50 rounded p-2"><div class="text-[10px] text-slate-500">마진</div><div class="font-bold" id="oq-mval">-</div></div>' +
              '<div class="bg-slate-50 rounded p-2"><div class="text-[10px] text-slate-500">고객 원가율</div><div class="font-bold" id="oq-ratio">-</div></div>' +
            '</div>' +
          '</div>' +
          '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">수량별 1EA 공급단가</h3></div><div class="p-0"><table><thead><tr><th class="pl-4">수량</th><th class="text-right">공급단가</th><th class="text-right">총액(VAT 별도)</th><th class="text-right">원가</th><th class="text-right pr-4">마진</th></tr></thead><tbody id="oq-tiers"></tbody></table></div></div>' +
          '<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">' +
            '<div class="card"><div class="card-header"><h3 class="font-bold text-slate-700 text-sm">1EA 원가 상세</h3></div><table><tbody id="oq-breakdown"></tbody></table></div>' +
            '<div class="card p-4 space-y-2"><h3 class="font-bold text-slate-700 text-sm">고객 수용성 · 경고</h3><div id="oq-accept" class="text-[12px] space-y-1"></div><div id="oq-warn" class="space-y-1.5"></div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var anchor = $('page-doc-quote');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor.nextSibling);
    else document.body.appendChild(sec);

    sec.addEventListener('input', calc);
    sec.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'oq-bottle') onBottle(false);
      calc();
    });
    try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (e) {}
  }

  function fill(id, list, label) {
    var el = $(id); el.innerHTML = '';
    list.forEach(function (x) { var o = document.createElement('option'); o.value = x.code; o.textContent = label(x); el.appendChild(o); });
  }
  function selectCode(id, code) { var el = $(id); if ([].some.call(el.options, function (o) { return o.value === code; })) el.value = code; }

  function onBottle(initial) {
    var b = find('BOTTLES', $('oq-bottle').value); if (!b) return;
    var box = DATA.BOXES.filter(function (x) { return x.volume === b.volume; })[0];
    if (box) selectCode('oq-box', box.code);
    if (b.volume === 10) selectCode('oq-cap', 'C-10');
    else if (initial || $('oq-cap').value === 'C-10') selectCode('oq-cap', 'C-STD');
  }

  function initForm() {
    fill('oq-frag', DATA.FRAGRANCES, function (f) { return f.name + ' · ' + fmt.format(f.pricePerKg) + '원/kg' + (f.moqKg ? ' · MOQ ' + f.moqKg + 'kg' : ''); });
    fill('oq-bottle', DATA.BOTTLES, function (b) { return b.name; });
    fill('oq-cap', DATA.CAPS, function (c) { return c.name + ' · ' + fmt.format(c.unitPrice) + '원'; });
    fill('oq-box', DATA.BOXES, function (b) { return b.name + (b.moq ? ' · MOQ ' + fmt.format(b.moq) : ''); });
    $('oq-extras').innerHTML = DATA.EXTRAS.map(function (x) {
      return '<label class="flex items-center justify-between text-[11.5px] gap-2"><span><input type="checkbox" class="mr-1" id="oq-x-' + esc(x.code) + '"' + (x.def === 'Y' ? ' checked' : '') + '>' + esc(x.name) + '</span>' +
        '<span class="text-slate-400">' + esc(x.unit) + ' ' + fmt.format(x.price) + '원' + (x.setupFee ? ' + 셋업 ' + fmt.format(x.setupFee) : '') + '</span></label>';
    }).join('');
    $('oq-margin').value = SET.defaultMargin || 40;
    $('oq-labor').value = SET.laborPerEa != null ? SET.laborPerEa : 300;
    $('oq-defect').value = SET.defectRate != null ? SET.defectRate : 3;
    selectCode('oq-bottle', 'B30');
    onBottle(true);
    var src = $('oq-src');
    src.textContent = fromSheet ? '✓ 단가표: 구글시트 「20261117_OEM_단가표」 최신값' : '※ 구글시트를 불러오지 못해 내장된 2026-11-17 단가로 계산 중입니다. 실제 견적 전에 시트를 확인하세요.';
    src.className = 'text-[11px] ' + (fromSheet ? 'text-emerald-700' : 'text-amber-700');
  }

  var last = null;
  function opts() {
    var frag = find('FRAGRANCES', $('oq-frag').value), conc = $('oq-conc').value;
    return {
      frag: frag, bottle: find('BOTTLES', $('oq-bottle').value), cap: find('CAPS', $('oq-cap').value), box: find('BOXES', $('oq-box').value),
      extras: DATA.EXTRAS.filter(function (x) { var c = $('oq-x-' + x.code); return c && c.checked; }),
      ratio: conc === 'sheet' ? frag.ratio : num(conc, 0.15), labor: num($('oq-labor').value), defectPct: num($('oq-defect').value)
    };
  }

  function calc() {
    if (!loaded || !$('oq-frag') || !$('oq-frag').options.length) return;
    var qty = parseInt($('oq-qty').value, 10) || 0;
    var m = num($('oq-margin').value, 40);
    $('oq-mlabel').textContent = m + '%';
    var o = opts();
    $('oq-fraginfo').textContent = o.frag.note;
    $('oq-capinfo').textContent = o.cap.note;
    $('oq-boxinfo').textContent = o.box.note;
    $('oq-qtyhint').textContent = o.box.moq ? '· 단상자 MOQ ' + fmt.format(o.box.moq) : '';
    $('oq-spec').textContent = o.bottle.volume + 'ml · 부향률 ' + Math.round(o.ratio * 100) + '% · ' + o.frag.name.split(' · ')[0] + ' · ' + o.cap.name + ' · ' + o.box.name;
    if (!qty) return;

    var c = computeCost(qty, o), price = priceFrom(c.unitCost, m), total = price * qty;
    $('oq-unitprice').textContent = won(price);
    $('oq-total').textContent = won(total);
    $('oq-totalvat').textContent = 'VAT 포함 ' + won(total * 1.1);
    $('oq-cost').textContent = won(c.unitCost);
    $('oq-mval').textContent = Math.round((1 - c.unitCost / price) * 100) + '%';

    var rows = [
      ['향료 ' + c.fragG.toFixed(1) + 'g (' + fmt.format(o.frag.pricePerKg) + '원/kg)' + (c.fragLeftKg > 0.001 ? ' · MOQ로 ' + c.fragLeftKg.toFixed(2) + 'kg 남음' : ''), c.cFrag],
      ['에탄올 ' + (c.liquidG - c.fragG).toFixed(1) + 'g', c.cEth],
      ['용기 ' + o.bottle.name, c.cBottle],
      ['캡 ' + o.cap.name, c.cCap],
      ['단상자 (' + fmt.format(c.boxUnit) + '원 구간' + (o.box.setupFee ? ' + 목판비 ' + fmt.format(o.box.setupFee) : '') + (qty < o.box.moq ? ' · MOQ ' + fmt.format(o.box.moq) + '개분' : '') + ')', c.cBox],
      ['부자재 (EA 항목)', c.cExtraEa],
      ['충전·조립·라벨 공임', c.labor],
      ['불량·손실 ' + o.defectPct + '%', c.cDefect],
      ['프로젝트 비용 ÷ 수량', c.cExtraProject],
      ['<b>1EA 제조원가</b>', c.unitCost]
    ];
    $('oq-breakdown').innerHTML = rows.map(function (r) { return '<tr><td class="pl-4 text-[11.5px]">' + r[0] + '</td><td class="text-right pr-4 text-[11.5px]">' + won(r[1]) + '</td></tr>'; }).join('');

    var qtys = TIER_QTYS.concat([qty]).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var tiers = qtys.map(function (q) {
      var cq = computeCost(q, o), pq = priceFrom(cq.unitCost, m);
      return { q: q, price: pq, cost: cq.unitCost, below: o.box.moq && q < o.box.moq };
    });
    $('oq-tiers').innerHTML = tiers.map(function (t) {
      return '<tr' + (t.q === qty ? ' style="background:#f0fdfa;font-weight:700"' : '') + '><td class="pl-4">' + fmt.format(t.q) + ' EA' + (t.below ? ' <span class="text-amber-600 text-[10px]">MOQ 미만</span>' : '') + '</td>' +
        '<td class="text-right">' + won(t.price) + '</td><td class="text-right">' + won(t.price * t.q) + '</td><td class="text-right">' + won(t.cost) + '</td><td class="text-right pr-4">' + Math.round((1 - t.cost / t.price) * 100) + '%</td></tr>';
    }).join('');

    var retail = num($('oq-retail').value), target = SET.targetCostRatio || 25, acc = [];
    if (retail > 0) {
      var r = price * 1.1 / retail * 100;
      var cls = r <= target ? 'text-emerald-700' : r <= target + 10 ? 'text-amber-700' : 'text-red-700';
      var verdict = r <= target ? '적정 — 고객이 유통 마진을 남길 수 있음' : r <= target + 10 ? '빠듯함 — 수량 상향·사양 조정 제안' : '높음 — 사양·수량 조정 없이는 수용 어려움';
      var maxP = Math.floor(retail * target / 100 / 1.1 / 10) * 10;
      $('oq-ratio').innerHTML = '<span class="' + cls + '">' + r.toFixed(1) + '%</span>';
      acc.push('<div class="' + cls + ' font-bold">고객 소비자가 대비 공급가(VAT 포함) ' + r.toFixed(1) + '% · ' + verdict + '</div>');
      acc.push('<div>적정선 ' + target + '%에 맞는 최대 공급단가 ' + won(maxP) + ' (VAT 별도) · 이때 마진 ' + Math.round((1 - c.unitCost / maxP) * 100) + '%</div>');
    } else {
      $('oq-ratio').textContent = '-';
      acc.push('<div class="text-slate-400">고객 희망 소비자가를 넣으면 원가율을 점검합니다 (적정선 ' + target + '%).</div>');
    }
    var ref = { 10: 32000, 30: 58000, 50: 90000 }[o.bottle.volume];
    if (ref) acc.push('<div class="text-slate-500">참고: SHIFTI ' + o.bottle.volume + 'ml 소비자가 ' + fmt.format(ref) + '원 · 국내 도매 40% ' + fmt.format(ref * 0.4) + '원 · 수출(터키) 27% ' + fmt.format(ref * 0.27) + '원</div>');
    $('oq-accept').innerHTML = acc.join('');

    var w = [];
    if (o.box.moq && qty < o.box.moq) w.push(['bg-red-50 text-red-800 border-red-200', '주문 ' + fmt.format(qty) + '개는 단상자 MOQ ' + fmt.format(o.box.moq) + '개 미만입니다. 남는 ' + fmt.format(o.box.moq - qty) + '개 값이 단가에 들어갔습니다. ' + fmt.format(o.box.moq) + '개 단가를 함께 제시하세요.']);
    if (o.cap.moq && qty < o.cap.moq) w.push(['bg-red-50 text-red-800 border-red-200', '캡 MOQ ' + fmt.format(o.cap.moq) + '개 미만입니다.']);
    if (c.fragLeftKg > 0.001) w.push(['bg-amber-50 text-amber-800 border-amber-200', o.frag.name.split(' · ')[0] + ' 향료는 MOQ ' + o.frag.moqKg + 'kg라 ' + c.fragLeftKg.toFixed(2) + 'kg가 남습니다(' + won(c.fragLeftKg * o.frag.pricePerKg) + '). 단가에 포함했습니다.']);
    if (m < (SET.minMargin || 30)) w.push(['bg-red-50 text-red-800 border-red-200', '마진 ' + m + '%는 하한 ' + (SET.minMargin || 30) + '% 미만입니다. 대표 승인이 필요합니다.']);
    var est = [o.frag, o.bottle, o.cap, o.box].concat(o.extras).filter(function (x) { return /추정|확인 필요/.test(x.note); }).map(function (x) { return x.name; });
    if (est.length) w.push(['bg-amber-50 text-amber-800 border-amber-200', '추정·확인 필요 단가 포함: ' + est.join(', ')]);
    if (o.cap.code === 'C-GAT') w.push(['bg-amber-50 text-amber-800 border-amber-200', '갓캡은 자사 등록 디자인입니다. OEM 제공 여부는 대표 결정 사항입니다.']);
    $('oq-warn').innerHTML = w.map(function (x) { return '<div class="text-[11px] border rounded px-2 py-1.5 ' + x[0] + '">' + esc(x[1]) + '</div>'; }).join('');

    last = { qty: qty, price: price, total: total, tiers: tiers, o: o };
  }

  /* ---------- 고객용 견적서 (원가·마진 제외) ---------- */
  function printCustomer() {
    if (!last) { alert('먼저 견적을 계산하세요.'); return; }
    var o = last.o, today = new Date(), until = new Date(today.getTime() + (SET.quoteValidDays || 30) * 86400000);
    var d = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    var brand = esc(($('oq-brand').value || '').trim() || '고객사'), project = esc(($('oq-project').value || '').trim());
    var extras = o.extras.map(function (x) { return esc(x.name); }).join(', ') || '없음';
    var rows = last.tiers.map(function (t) {
      return '<tr' + (t.q === last.qty ? ' class="cur"' : '') + '><td>' + fmt.format(t.q) + ' EA' + (t.below ? ' (최소 생산수량 미만)' : '') + '</td><td>' + won(t.price) + '</td><td>' + won(t.price * t.q) + '</td></tr>';
    }).join('');
    var html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>메디센츠 OEM 견적서 - ' + brand + '</title>' +
      '<style>body{font-family:"Pretendard","Noto Sans KR",sans-serif;color:#111827;margin:32px;font-size:12px}h1{font-size:20px;margin:0 0 4px}.sub{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #e5e7eb;padding:7px 6px;text-align:right}th:first-child,td:first-child{text-align:left}tr.cur td{font-weight:700;background:#f0fdfa}.box{border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-top:14px}.big{font-size:22px;font-weight:800}.terms{color:#4b5563;line-height:1.7;margin-top:14px}</style></head><body>' +
      '<h1>OEM 견적서</h1><div class="sub">㈜메디센츠 · 견적일 ' + d(today) + ' · 유효기간 ' + d(until) + '까지 · 부가세 별도</div>' +
      '<div class="box"><div><b>' + brand + '</b>' + (project ? ' · ' + project : '') + '</div>' +
      '<div class="sub" style="margin-top:4px">사양: ' + o.bottle.volume + 'ml · 부향률 ' + Math.round(o.ratio * 100) + '% · ' + esc(o.frag.name.split(' · ')[0]) + ' · ' + esc(o.cap.name) + ' · ' + esc(o.box.name) + ' · 포함: ' + extras + '</div>' +
      '<div style="margin-top:10px">요청 수량 ' + fmt.format(last.qty) + ' EA · 1EA 공급단가 <span class="big">' + won(last.price) + '</span></div>' +
      '<div>총액 ' + won(last.total) + ' (VAT 포함 ' + won(last.total * 1.1) + ')</div></div>' +
      '<h3 style="margin-top:18px">수량별 1EA 공급단가 (VAT 별도)</h3><table><thead><tr><th>수량</th><th>1EA 공급단가</th><th>총액</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="terms">· 결제: 계약금 50% 입금 후 부자재 발주, 출고 전 잔금 50%<br>· 납기: 디자인·표시사항 확정 후 약 4~6주 (신규 조향·전용 부자재는 별도 협의)<br>· 단상자 최소 생산수량 ' + (o.box.moq ? fmt.format(o.box.moq) + '개' : '해당 없음') + '. 샘플은 유료이며 본주문 시 차감합니다.<br>· 운임·통관·시험성적서·해외 인증 비용은 별도입니다. 원료·부자재 가격 변동 시 재견적할 수 있습니다.</div>' +
      '<script>window.onload=function(){window.print()}<\/script></body></html>';
    var wdw = window.open('', '_blank');
    if (!wdw) { alert('팝업이 막혀 있습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
    wdw.document.open(); wdw.document.write(html); wdw.document.close();
  }

  /* ---------- 진입 ---------- */
  function open() {
    buildDom();
    loadData().then(function () {
      if (!$('oq-frag').options.length) initForm();
      calc();
    });
  }
  function reload() {
    loading = null; loaded = false;
    loadData().then(function () { initForm(); calc(); });
  }

  function hookGoPage() {
    var prev = window.goPage;
    if (typeof prev !== 'function' || prev.__oemq) return;
    var wrapped = function (p) { var r = prev.apply(this, arguments); if (p === 'oem-quote') open(); if (p === 'doc-center') ensureEntry(); return r; };
    wrapped.__oemq = true;
    window.goPage = wrapped;
  }

  window.OEMQ = { open: open, reload: reload, printCustomer: printCustomer, _compute: function (q) { return computeCost(q, opts()); } };

  function boot() {
    buildDom();
    hookGoPage();
    // 다른 스크립트가 나중에 goPage를 덮어써도 다시 연결
    [800, 2000, 4000, 8000].forEach(function (ms) { setTimeout(function () { ensureEntry(); hookGoPage(); }, ms); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
