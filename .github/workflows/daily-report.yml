name: SHIFTI Daily Report

on:
  schedule:
    - cron: '0 23 * * *'   # 23:00 UTC = 다음날 08:00 KST
  workflow_dispatch:         # Actions 탭에서 수동 실행(테스트)용

jobs:
  send-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install nodemailer@6.9.16
      - name: Build and send report
        env:
          SB_SERVICE_KEY: ${{ secrets.SB_SERVICE_KEY }}
          GMAIL_USER: ${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: ${{ secrets.GMAIL_APP_PASSWORD }}
        run: |
          cat > report.mjs << 'NOSE_SCRIPT_EOF'
          // SHIFTI ERP 일일 아침 리포트 — 노즈 (2026-07-10)
          // GitHub Actions에서 매일 08:00 KST에 실행되어 Gmail로 발송됩니다.
          import nodemailer from 'nodemailer';

          const SB_URL = 'https://foctzlqkspneznevbkmp.supabase.co';
          const KEY = process.env.SB_SERVICE_KEY;
          const TO = 'justina0726@gmail.com';

          const n = v => Number(v) || 0;
          const fmt = v => Math.round(n(v)).toLocaleString('ko-KR');
          const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
          const iso = d => d.toISOString().split('T')[0];

          async function loadDB(){
            if (process.env.MOCK_DB) return JSON.parse(process.env.MOCK_DB);
            const r = await fetch(`${SB_URL}/rest/v1/erp_data?id=eq.shifti_erp_main&select=data`, {
              headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
            });
            if (!r.ok) throw new Error('Supabase 조회 실패: ' + r.status);
            const rows = await r.json();
            if (!rows.length) throw new Error('erp_data 행이 없습니다');
            return rows[0].data;
          }

          function analyze(db){
            const M = db.master || {}, S = db.stock || {}, T = db.txn || {};
            const findRaw = id => (M.M_RAW||[]).find(r => r.rawId === id);
            const findPack = id => (M.M_PACK||[]).find(r => r.packId === id);
            const findProduct = id => (M.M_PRODUCT||[]).find(r => String(r.productId) === String(id));

            const allLots = [
              ...(S.RAW_LOT||[]).map(l => ({...l, _t:'원료', _name:findRaw(l.rawId)?.name})),
              ...(S.PACK_LOT||[]).map(l => ({...l, _t:'포장재', _name:findPack(l.packId)?.name})),
              ...(S.BULK_LOT||[]).map(l => ({...l, _t:'벌크', _name:findProduct(l.productId)?.name})),
              ...(S.FGT_LOT||[]).map(l => ({...l, _t:'완제품', _name:findProduct(l.productId)?.name})),
            ];
            const invTotal = allLots.reduce((s,l) => s + n(l.remaining) * n(l.unitCost), 0);

            const now = kstNow();
            const yesterday = iso(new Date(now.getTime() - 86400000));
            const yBatch = (T.T_BATCH||[]).filter(t => t.date === yesterday);
            const ySale = (T.T_SALE||[]).filter(t => t.date === yesterday);
            const ySaleQty = ySale.reduce((s,t) => s + n(t.qty), 0);
            const ySaleRev = ySale.reduce((s,t) => s + n(t.qty) * n(findProduct(t.productId)?.price), 0);

            const expiring = [...(S.RAW_LOT||[]), ...(S.PACK_LOT||[])]
              .filter(l => l.expDate && n(l.remaining) > 0 && l.status !== 'EXPIRED' && l.status !== 'FAIL')
              .map(l => ({...l, _name:(l.rawId ? findRaw(l.rawId) : findPack(l.packId))?.name, _days: Math.ceil((new Date(l.expDate) - now) / 86400000)}))
              .filter(l => l._days >= 0 && l._days <= 30)
              .sort((a,b) => a._days - b._days);

            const qcHold = allLots.filter(l => l.status === 'HOLD' && n(l.remaining) > 0);

            const fgtByProduct = {};
            (S.FGT_LOT||[]).forEach(l => {
              if(l.status !== 'OK' && l.status !== 'HOLD') return;
              const k = String(l.productId);
              fgtByProduct[k] = (fgtByProduct[k]||0) + n(l.remaining);
            });
            const topStock = Object.entries(fgtByProduct)
              .map(([id, q]) => ({ name: findProduct(id)?.name || ('#'+id), qty: q }))
              .sort((a,b) => b.qty - a.qty).slice(0, 5);
            const lowStock = Object.entries(fgtByProduct)
              .map(([id, q]) => ({ name: findProduct(id)?.name || ('#'+id), qty: q }))
              .filter(x => x.qty > 0 && x.qty <= 15)
              .sort((a,b) => a.qty - b.qty).slice(0, 5);

            const matureReady = (S.BULK_LOT||[]).filter(l =>
              n(l.remaining) > 0 && l.matureUntil && l.matureUntil <= iso(now) && l.status === 'HOLD');

            return { invTotal, yesterday, yBatchCnt: yBatch.length,
              yBatchQty: yBatch.reduce((s,t)=>s+n(t.qty),0), ySaleQty, ySaleRev,
              expiring, qcHold, topStock, lowStock, matureReady };
          }

          function buildHtml(a){
            const now = kstNow();
            const dateStr = now.toLocaleDateString('ko-KR', { timeZone:'UTC', year:'numeric', month:'long', day:'numeric', weekday:'long' });
            const row = (l, r) => `<tr><td style="padding:6px 10px;font-size:13px;color:#334155">${l}</td><td style="padding:6px 10px;font-size:13px;font-weight:700;color:#0f172a;text-align:right">${r}</td></tr>`;
            const section = (title, inner) => `<div style="margin-top:18px"><div style="font-size:12px;font-weight:800;color:#0f766e;letter-spacing:.05em;margin-bottom:6px">${title}</div>${inner}</div>`;
            const list = items => items.length
              ? `<table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px">${items.join('')}</table>`
              : `<div style="font-size:12px;color:#94a3b8;padding:8px 4px">해당 없음 ✓</div>`;

            const alerts = [];
            if (a.qcHold.length) alerts.push(`⚠️ QC 검사 대기 <b>${a.qcHold.length}건</b>`);
            if (a.expiring.length) alerts.push(`⏰ 유통기한 30일 이내 <b>${a.expiring.length}건</b>`);
            if (a.matureReady.length) alerts.push(`🧪 숙성 완료 벌크 <b>${a.matureReady.length}건</b> — 충진 가능`);
            if (a.lowStock.length) alerts.push(`📉 완제품 저재고(15개 이하) <b>${a.lowStock.length}종</b>`);

            return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
            <div style="max-width:560px;margin:0 auto;padding:20px 14px">
              <div style="background:linear-gradient(135deg,#0f172a,#134e4a 62%,#0d9488);border-radius:16px;padding:22px 24px;color:#fff">
                <div style="font-size:10px;font-weight:800;letter-spacing:.14em;color:#5eead4">MEDISCENT · SHIFTI FACTORY ERP</div>
                <div style="font-size:17px;font-weight:900;margin-top:4px">☀️ 일일 아침 리포트</div>
                <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px">${dateStr}</div>
                <div style="margin-top:14px;font-size:11px;color:#5eead4;font-weight:700">재고 자산 평가액</div>
                <div style="font-size:28px;font-weight:900">${fmt(a.invTotal)}원</div>
              </div>

              ${alerts.length ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 16px;margin-top:14px;font-size:13px;color:#7f1d1d;line-height:1.9">${alerts.join('<br>')}</div>`
                : `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:12px 16px;margin-top:14px;font-size:13px;color:#065f46">✅ 오늘 아침 특이 알림이 없습니다</div>`}

              ${section('전일 실적 (' + a.yesterday + ')', list([
                row('생산배치', a.yBatchCnt + '건 · ' + fmt(a.yBatchQty) + 'ea'),
                row('출고', fmt(a.ySaleQty) + 'ea'),
                row('출고 매출(판매가 기준)', fmt(a.ySaleRev) + '원'),
              ]))}

              ${section('⏰ 유통기한 임박 TOP 5', list(a.expiring.slice(0,5).map(l => row(`${l._name||''} <span style="color:#94a3b8">${l.lotNo}</span>`, `D-${l._days} · 잔량 ${fmt(l.remaining)}`))))}

              ${section('🧪 QC 대기 LOT', list(a.qcHold.slice(0,5).map(l => row(`[${l._t}] ${l._name||''} <span style="color:#94a3b8">${l.lotNo}</span>`, '잔량 ' + fmt(l.remaining)))))}

              ${section('📦 완제품 재고 TOP 5', list(a.topStock.map(x => row(x.name, fmt(x.qty) + 'ea'))))}

              ${a.lowStock.length ? section('📉 저재고 주의 (15개 이하)', list(a.lowStock.map(x => row(x.name, fmt(x.qty) + 'ea')))) : ''}

              <div style="text-align:center;margin-top:20px">
                <a href="https://mediscent01-lang.github.io/erp/" style="display:inline-block;background:#0d9488;color:#fff;font-size:13px;font-weight:800;text-decoration:none;padding:11px 26px;border-radius:10px">ERP 대시보드 열기 →</a>
                <div style="font-size:10px;color:#94a3b8;margin-top:12px">SHIFTI ERP 자동 발송 · 매일 08:00 KST · by 노즈</div>
              </div>
            </div></body></html>`;
          }

          const db = await loadDB();
          const a = analyze(db);
          const html = buildHtml(a);

          if (process.env.DRY_RUN) {
            const fs = await import('fs');
            fs.writeFileSync('preview.html', html);
            console.log('DRY_RUN: preview.html 생성 완료');
            console.log(JSON.stringify({ inv: a.invTotal, alerts: { qc: a.qcHold.length, exp: a.expiring.length, low: a.lowStock.length } }));
          } else {
            const transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
            });
            const today = iso(kstNow());
            await transporter.sendMail({
              from: `"SHIFTI ERP 노즈" <${process.env.GMAIL_USER}>`,
              to: TO,
              subject: `☀️ [SHIFTI ERP] ${today} 일일 리포트 — 재고자산 ${fmt(a.invTotal)}원`,
              html
            });
            console.log('발송 완료 →', TO);
          }

          NOSE_SCRIPT_EOF
          node report.mjs
