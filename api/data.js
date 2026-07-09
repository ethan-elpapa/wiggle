/**
 * /api/data — 구글 시트를 읽어 대시보드용 JSON을 반환하는 서버리스 함수
 *
 * 필요한 환경 변수 (Vercel 프로젝트 Settings > Environment Variables):
 *   SHEET_ID                      구글 시트 URL 중간의 긴 ID
 *                                 (https://docs.google.com/spreadsheets/d/【이부분】/edit)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  서비스 계정 이메일 (...@...iam.gserviceaccount.com)
 *   GOOGLE_PRIVATE_KEY            서비스 계정 JSON 키 파일의 private_key 값 전체
 *                                 ("-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n")
 *
 * 시트는 서비스 계정 이메일에 "뷰어"로 공유되어 있어야 합니다.
 */

const { JWT } = require("google-auth-library");

const TABS = [
  "META", "LINKS", "KPI", "TREND", "DEALS", "PBDD",
  "FOCUS", "DECISIONS", "OPS_LOG", "CURRICULUM", "SOP"
];

/* 시트의 2차원 배열 → [{헤더:값}] 객체 배열. 빈 행과 ※ 안내 행은 제외 */
function toRows(values) {
  if (!values || values.length < 2) return [];
  const head = values[0].map(h => String(h ?? "").trim());
  return values.slice(1)
    .filter(r => {
      const first = String(r?.[0] ?? "").trim();
      return first !== "" && !first.startsWith("※");
    })
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const bool = (x) => x === true || String(x).trim().toUpperCase() === "TRUE";
const str = (x) => (x === null || x === undefined) ? "" : String(x).trim();

module.exports = async (req, res) => {
  try {
    const { SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
    if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      return res.status(500).json({ error: "환경 변수 미설정 (SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)" });
    }

    const auth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?` +
      TABS.map(t => `ranges=${encodeURIComponent(t)}`).join("&");

    const { data } = await auth.request({ url });
    const sheet = {};
    TABS.forEach((t, i) => { sheet[t] = toRows(data.valueRanges?.[i]?.values); });

    /* ---- META ---- */
    const metaRaw = {};
    sheet.META.forEach(r => { metaRaw[str(r.key)] = r.value; });
    const meta = {
      week: Number(metaRaw.week) || 0,
      updated: str(metaRaw.updated).slice(0, 10),
      phase: str(metaRaw.phase),
      pbddDate: str(metaRaw.pbddDate).slice(0, 10),
      pbddConfirmed: bool(metaRaw.pbddConfirmed)
    };

    /* ---- LINKS ---- */
    const links = {};
    sheet.LINKS.forEach(r => { links[str(r.key)] = str(r.url); });

    /* ---- KPI ---- */
    const kpi = sheet.KPI.map(r => ({
      label: str(r.label), value: str(r.value), baseline: str(r.baseline),
      delta: Number(r.delta) || 0, unit: str(r.unit), note: str(r.note),
      invert: bool(r.invert)
    }));

    /* ---- TREND ---- */
    const revenueTrend = {
      labels: sheet.TREND.map(r => str(r.label)),
      values: sheet.TREND.map(r => Number(String(r.value).replace(/[$,]/g, "")) || 0)
    };

    /* ---- DEALS ---- */
    const deals = sheet.DEALS.map(r => ({
      asin: str(r.asin), name: str(r.name), type: str(r.type),
      price: str(r.price), qty: str(r.qty), status: str(r.status)
    }));

    /* ---- PBDD: month별 그룹핑 ---- */
    const phaseMap = new Map();
    sheet.PBDD.forEach(r => {
      const m = str(r.month);
      if (!phaseMap.has(m)) phaseMap.set(m, { month: m, title: str(r.title), items: [] });
      phaseMap.get(m).items.push({ t: str(r.item), done: bool(r.done), urgent: bool(r.urgent) });
    });
    const phases = [...phaseMap.values()];

    /* ---- FOCUS: track별 그룹핑 ---- */
    const focus = { ops: [], edu: [] };
    sheet.FOCUS.forEach(r => {
      const item = { t: str(r.item), status: str(r.status) };
      (str(r.track) === "교육" ? focus.edu : focus.ops).push(item);
    });

    /* ---- 나머지 ---- */
    const decisions = sheet.DECISIONS.map(r => ({
      t: str(r.title), due: str(r.due), detail: str(r.detail)
    }));
    const opsLog = sheet.OPS_LOG.map(r => ({
      week: str(r.week), cat: str(r.cat), item: str(r.item),
      result: str(r.result), status: str(r.status)
    }));
    const curriculum = sheet.CURRICULUM.map(r => ({
      w: Number(r.w) || 0, topic: str(r.topic), hw: str(r.hw), status: str(r.status)
    }));
    const sop = sheet.SOP.map(r => ({
      name: str(r.name), from: str(r.from), status: str(r.status)
    }));

    /* 엣지 캐시: 5분간 캐시, 이후 24시간은 이전 응답을 먼저 주고 뒤에서 갱신 */
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.status(200).json({
      meta, links, kpi, revenueTrend,
      pbdd: { deals, phases },
      focus, decisions, opsLog, curriculum, sop
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "시트 로드 실패", detail: String(err.message || err) });
  }
};
