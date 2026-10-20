// SHIFTI ERP AI 서버 함수
// 액션: daily-production(오늘 생산 권장) · command(자연어 명령) · ocr(영수증 판독)
// - 로그인 사용자 토큰으로 erp_data를 읽는다(RLS 그대로 적용). 데이터는 읽기만 하고 쓰지 않는다.
// - Anthropic 키는 Supabase 비밀값 ANTHROPIC_API_KEY에만 둔다. 브라우저로 내려보내지 않는다.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MODEL_FAST = Deno.env.get("SHIFTI_AI_MODEL_FAST") ?? "claude-haiku-5-5";
const MODEL_VISION = Deno.env.get("SHIFTI_AI_MODEL_VISION") ?? "claude-sonnet-5-5";
const ROW_ID = Deno.env.get("SHIFTI_ERP_ROW") ?? "shifti_erp_main";
const HORIZON_DAYS = 14;
const SALES_WINDOW_DAYS = 30;

type Db = any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (d: number) => new Date(Date.now() + 9 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);

// ERPCore.blockReason과 같은 기준: 검사 OK · 사용기한 · 숙성 · 원가 확인
function usable(lot: any, today: string) {
  if (!lot || String(lot.status || "").toUpperCase() !== "OK") return false;
  if (lot.expDate && lot.expDate < today) return false;
  if (lot.matureUntil && lot.matureUntil > today) return false;
  if (lot.costStatus === "UNCONFIRMED") return false;
  return true;
}
function stockOf(db: Db, key: string, idField: string, id: unknown, today: string) {
  return (db?.stock?.[key] || [])
    .filter((l: any) => String(l[idField]) === String(id) && usable(l, today))
    .reduce((s: number, l: any) => s + n(l.remaining), 0);
}

function dailyProduction(db: Db, updatedAt: string | null) {
  const today = kstToday(), since = daysAgo(SALES_WINDOW_DAYS);
  const products = db?.master?.M_PRODUCT || [];
  const safety = db?.master?.M_SAFETY_STOCK || [];
  const openSO = (db?.txn?.T_SO || []).filter((s: any) => !["완료", "출고완료", "취소"].includes(s.status));
  const sales = (db?.txn?.T_SALE || []).filter((s: any) => (s.date || "") >= since);
  const warnings: string[] = [];

  const rows = products.map((p: any) => {
    const id = p.productId;
    const stockOk = stockOf(db, "FGT_LOT", "productId", id, today);
    const openOrders = openSO.reduce((s: number, so: any) =>
      s + (so.items || []).filter((it: any) => String(it.productId) === String(id)).reduce((a: number, it: any) => a + n(it.qty), 0), 0);
    const safetyStock = n((safety.find((x: any) => x.type === "FGT" && String(x.itemId) === String(id)) || {}).minQty);
    const recentSalesQty = sales.filter((s: any) => String(s.productId) === String(id)).reduce((a: number, s: any) => a + n(s.qty), 0);
    const forecastHorizonQty = Math.ceil((recentSalesQty / SALES_WINDOW_DAYS) * HORIZON_DAYS);
    const recommendedQty = Math.max(0, Math.ceil(openOrders + safetyStock + forecastHorizonQty - stockOk));
    const priority = stockOk < openOrders ? "긴급" : stockOk < safetyStock ? "우선" : recommendedQty > 0 ? "일반" : "-";
    if (recommendedQty > 0 && !(p.bom || []).length) warnings.push(`${p.name}: BOM이 없어 원료로 몇 개 만들 수 있는지 계산할 수 없습니다.`);
    return { productId: id, code: p.sku || p.code || "", name: p.name || String(id), stockOk, openOrders, safetyStock, recentSalesQty, forecastHorizonQty, recommendedQty, priority };
  }).filter((r: any) => r.recommendedQty > 0 || r.openOrders > 0 || r.safetyStock > 0 || r.recentSalesQty > 0);

  const rank: Record<string, number> = { "긴급": 0, "우선": 1, "일반": 2, "-": 3 };
  rows.sort((a: any, b: any) => rank[a.priority] - rank[b.priority] || b.recommendedQty - a.recommendedQty);
  const sourceAgeDays = updatedAt ? Math.floor((Date.parse(today) - Date.parse(new Date(Date.parse(updatedAt) + 9 * 3600e3).toISOString().slice(0, 10))) / 86400e3) : null;
  if (!products.length) warnings.push("제품 마스터가 비어 있습니다.");
  return {
    rows, warnings, sourceUpdatedAt: updatedAt, sourceAgeDays,
    totalRecommendedQty: rows.reduce((s: number, r: any) => s + r.recommendedQty, 0),
    basis: `권장 = 미출고 수주 + 안전재고 + 최근 ${SALES_WINDOW_DAYS}일 판매 기준 ${HORIZON_DAYS}일 예상 − 가용 완제품`,
  };
}

function shortage(db: Db) {
  const today = kstToday();
  const names: Record<string, [string, string, string]> = { RAW: ["M_RAW", "rawId", "RAW_LOT"], PACK: ["M_PACK", "packId", "PACK_LOT"], FGT: ["M_PRODUCT", "productId", "FGT_LOT"], BULK: ["M_PRODUCT", "productId", "BULK_LOT"] };
  const rows = (db?.master?.M_SAFETY_STOCK || []).map((s: any) => {
    const m = names[s.type]; if (!m) return null;
    const item = (db?.master?.[m[0]] || []).find((x: any) => String(x[m[1]]) === String(s.itemId));
    const current = stockOf(db, m[2], m[1], s.itemId, today);
    return { type: s.type, itemId: s.itemId, name: item?.name || String(s.itemId), current, minQty: n(s.minQty), shortage: Math.max(0, n(s.minQty) - current) };
  }).filter((r: any) => r && r.shortage > 0).sort((a: any, b: any) => b.shortage - a.shortage);
  return { rows };
}

function stockSummary(db: Db, productId: unknown) {
  const today = kstToday();
  const p = (db?.master?.M_PRODUCT || []).find((x: any) => String(x.productId) === String(productId));
  if (!p) return null;
  return { productId: p.productId, name: p.name, fgt: stockOf(db, "FGT_LOT", "productId", p.productId, today), bulk: stockOf(db, "BULK_LOT", "productId", p.productId, today) };
}

function salesSummary(db: Db, from: string, to: string) {
  const rows = (db?.txn?.T_SALE || []).filter((s: any) => (s.date || "") >= from && (s.date || "") <= to);
  const byProduct: Record<string, { name: string; qty: number; amount: number }> = {};
  for (const s of rows) {
    const p = (db?.master?.M_PRODUCT || []).find((x: any) => String(x.productId) === String(s.productId));
    const k = String(s.productId);
    byProduct[k] ??= { name: p?.name || k, qty: 0, amount: 0 };
    byProduct[k].qty += n(s.qty); byProduct[k].amount += n(s.amount) || n(s.qty) * n(s.unitPrice);
  }
  const list = Object.values(byProduct).sort((a, b) => b.amount - a.amount);
  return { from, to, count: rows.length, qty: list.reduce((a, r) => a + r.qty, 0), amount: list.reduce((a, r) => a + r.amount, 0), top: list.slice(0, 10) };
}

async function claude(body: Record<string, unknown>) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. (Supabase → Edge Functions → Secrets)");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("AI 호출 실패: " + (d?.error?.message || r.status));
  return d;
}
function toolInput(d: any) {
  const b = (d.content || []).find((x: any) => x.type === "tool_use");
  if (!b) throw new Error("AI 응답을 해석하지 못했습니다.");
  return b.input;
}

const PAGES: Record<string, string> = {
  dashboard: "대시보드", "master-raw": "원료 마스터", "master-pack": "포장재 마스터", "master-product": "제품 마스터", "master-cust": "고객", "master-supplier": "공급사",
  "t-goods-in": "입고", stock: "재고", "stock-adj": "재고 조정", "stock-ledger": "수불부", "stock-dead": "불용재고", "safety-stock": "안전재고",
  "t-bulk": "벌크 제조", "t-batch": "충진·배치", "bulk-maturation": "숙성", "t-qc": "품질검사", "qc-ncr": "부적합", "qc-capa": "CAPA", "qc-trace": "이력추적",
  "t-sale": "판매·출고", "sales-order": "수주관리", "sales-return": "반품", "sales-claim": "클레임", "channel-sales": "채널별 매출", report: "리포트", "annual-report": "연간보고",
  "prod-plan": "생산계획", "mrp-calc": "MRP 소요량", "work-order": "작업지시", "prod-result": "생산실적", "purchase-order": "발주", "purchase-log": "구매 이력",
  "doc-quote": "견적서", "doc-batch-record": "배치기록서", "doc-qc-report": "시험성적서", "doc-release": "출하승인", "doc-label": "라벨", "doc-pspec": "제품표준서",
  "formula-dev": "처방 개발", "allergen-report": "알레르기 성분", "dev-fullcomp": "전성분", sample: "샘플", "cfg-company": "회사 설정", "shifti-ai": "SHIFTI AI",
};

const COMMAND_TOOL = {
  name: "erp_command",
  description: "사용자의 한국어 업무 명령을 ERP 동작 하나로 바꾼다.",
  input_schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["daily_production", "shortage_report", "stock_query", "sales_summary", "navigate", "create_production_plan", "create_sales_order", "export_shipping_excel", "export_tax_excel", "backup", "open_quote", "unknown"] },
      productId: { type: ["string", "number", "null"], description: "제품 목록의 productId. 확실하지 않으면 null" },
      productName: { type: ["string", "null"], description: "사용자가 말한 제품명 그대로" },
      customerId: { type: ["string", "number", "null"] },
      customerName: { type: ["string", "null"] },
      qty: { type: ["number", "null"] },
      unitPrice: { type: ["number", "null"] },
      date: { type: ["string", "null"], description: "YYYY-MM-DD. 말하지 않았으면 null" },
      priority: { type: ["string", "null"], enum: ["일반", "우선", "긴급", null] },
      pageId: { type: ["string", "null"], description: "navigate일 때 화면 ID" },
      from: { type: ["string", "null"], description: "sales_summary 시작일 YYYY-MM-DD" },
      to: { type: ["string", "null"], description: "sales_summary 종료일 YYYY-MM-DD" },
      reply: { type: "string", description: "사용자에게 보여줄 한 문장 답(한국어). 숫자는 지어내지 말 것" },
    },
    required: ["intent", "reply"],
  },
};

async function command(db: Db, text: string, updatedAt: string | null) {
  const today = kstToday();
  const products = (db?.master?.M_PRODUCT || []).slice(0, 400).map((p: any) => `${p.productId}\t${p.name}\t${p.sku || p.code || ""}`).join("\n");
  const customers = (db?.master?.M_CUSTOMER || []).slice(0, 300).map((c: any) => `${c.customerId}\t${c.name}`).join("\n");
  const pages = Object.entries(PAGES).map(([k, v]) => `${k}\t${v}`).join("\n");
  const d = await claude({
    model: MODEL_FAST, max_tokens: 600,
    tool_choice: { type: "tool", name: "erp_command" }, tools: [COMMAND_TOOL],
    system: `너는 화장품 제조사 SHIFTI ERP의 명령 해석기다. 오늘은 ${today}(KST)다. 명령을 erp_command 하나로 바꾼다.
- "이번달" = 이번 달 1일~오늘, "지난달" = 지난 달 1일~말일.
- 제품·거래처는 아래 목록에서 가장 맞는 ID를 고른다. 애매하면 ID는 null, 이름만 채운다.
- 등록(create_*)은 수량이 없으면 qty를 null로 둔다. 숫자를 지어내지 않는다.
[제품 productId	이름	코드]
${products || "(없음)"}
[거래처 customerId	이름]
${customers || "(없음)"}
[화면 pageId	이름]
${pages}`,
    messages: [{ role: "user", content: text }],
  });
  const a = toolInput(d);
  const args: Record<string, unknown> = {
    productId: a.productId ?? null, productName: a.productName ?? null, customerId: a.customerId ?? null, customerName: a.customerName ?? null,
    qty: a.qty ?? null, unitPrice: a.unitPrice ?? null, date: a.date ?? today, priority: a.priority ?? "일반", pageId: a.pageId ?? null,
  };
  switch (a.intent) {
    case "daily_production": {
      const data = dailyProduction(db, updatedAt);
      return { intent: a.intent, message: `오늘 생산 권장 합계 ${data.totalRecommendedQty}개`, data };
    }
    case "shortage_report": {
      const data = shortage(db);
      return { intent: a.intent, message: data.rows.length ? `안전재고보다 부족한 품목 ${data.rows.length}개` : "안전재고보다 부족한 품목이 없습니다.", data };
    }
    case "stock_query": {
      const s = stockSummary(db, a.productId);
      return { intent: a.intent, message: s ? `${s.name} 가용 완제품 ${s.fgt}개 · 벌크 ${s.bulk}` : `제품을 찾지 못했습니다: ${a.productName || text}`, data: s };
    }
    case "sales_summary": {
      const s = salesSummary(db, a.from || today.slice(0, 8) + "01", a.to || today);
      return { intent: a.intent, message: `${s.from}~${s.to} 판매 ${s.count}건 · ${s.qty}개 · ${Math.round(s.amount).toLocaleString("ko-KR")}원`, data: s };
    }
    case "navigate":
      return { intent: a.intent, message: a.reply, clientAction: "navigate", args };
    case "create_production_plan":
    case "create_sales_order":
      return { intent: a.intent, message: a.reply, clientAction: a.intent, args, requiresConfirmation: true };
    case "export_shipping_excel": case "export_tax_excel": case "backup": case "open_quote":
      return { intent: a.intent, message: a.reply, clientAction: a.intent, args };
    default:
      return { intent: "unknown", message: a.reply || "이해하지 못했습니다. 예: 오늘 생산량 알려줘" };
  }
}

const OCR_TOOL = {
  name: "receipt",
  description: "판매 영수증·주문 내역에서 읽은 값",
  input_schema: {
    type: "object",
    properties: {
      date: { type: ["string", "null"], description: "YYYY-MM-DD" }, channel: { type: ["string", "null"] }, product: { type: ["string", "null"] },
      qty: { type: ["number", "null"] }, price: { type: ["number", "null"], description: "단가(원)" }, total: { type: ["number", "null"], description: "총액(원)" },
    },
    required: ["date", "channel", "product", "qty", "price", "total"],
  },
};

async function ocr(body: any) {
  const image = String(body?.image || "").replace(/^data:[^,]+,/, "");
  const mediaType = String(body?.mediaType || "image/jpeg");
  if (!image) throw new Error("이미지가 없습니다.");
  if (image.length > 7_000_000) throw new Error("이미지가 너무 큽니다(5MB 이하).");
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) throw new Error("JPG·PNG·WEBP 이미지만 읽을 수 있습니다.");
  const d = await claude({
    model: MODEL_VISION, max_tokens: 500,
    tool_choice: { type: "tool", name: "receipt" }, tools: [OCR_TOOL],
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
      { type: "text", text: "판매 영수증 또는 주문 내역이다. 보이는 값만 receipt로 채운다. 없는 값은 null. 금액은 쉼표 없는 원 단위 숫자." },
    ] }],
  });
  return { result: toolInput(d) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "";
    if (action === "ping") return json({ ok: true, models: { fast: MODEL_FAST, vision: MODEL_VISION }, keyConfigured: !!Deno.env.get("ANTHROPIC_API_KEY") });

    // 로그인 사용자만 허용. 공개 키만 들고 온 요청은 막는다.
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "로그인이 필요합니다. ERP에 다시 로그인해 주세요." }, 401);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (action === "ocr") return json(await ocr(body));

    const rowId = url.searchParams.get("row") || ROW_ID;
    const { data: row, error } = await sb.from("erp_data").select("data, updated_at").eq("id", rowId).maybeSingle();
    if (error) return json({ error: "ERP 데이터를 읽지 못했습니다: " + error.message }, 500);
    if (!row?.data) return json({ error: "ERP 데이터가 없습니다." }, 404);

    if (action === "daily-production") return json(dailyProduction(row.data, row.updated_at));
    if (action === "command") return json(await command(row.data, String(body?.text || "").slice(0, 500), row.updated_at));
    return json({ error: "알 수 없는 action: " + action }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
