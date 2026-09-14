import { Router } from "express";
import type { Config } from "../config.js";
import { fetchEarnings, type Earnings } from "../lib/earnings.js";
import { authorizeStats } from "../lib/stats-auth.js";
import type { Metrics, MetricsSnapshot } from "../x402/metrics.js";

/**
 * GET /stats — one-page answer to "did anyone pay, and how much?"
 * JSON for machines; a small HTML dashboard when a browser asks (Accept: text/html).
 *
 * Operator-only: guarded by STATS_TOKEN (see lib/stats-auth.ts). The on-chain figures are public
 * anyway, but the per-route traffic breakdown describes other people's use of the service, so the
 * route stays closed unless the secret is configured and presented.
 */

interface Stats {
  service: string;
  payTo: string;
  earnings: Earnings | { error: string };
  sinceBoot: MetricsSnapshot;
  links: { basescan: string; x402scan: string };
}

const X402SCAN_PAGE = "https://www.x402scan.com/server/ea7f4b23-0617-434e-b917-5869c9f18398";

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const usd = (n: number): string => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function renderHtml(s: Stats): string {
  const e = "error" in s.earnings ? null : s.earnings;
  const m = s.sinceBoot;
  const big = (label: string, value: string, sub = "") =>
    `<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
  const rows = (e?.latest ?? [])
    .map((r) => `<tr><td>${esc(r.at.replace("T", " ").slice(0, 19))}</td><td>${esc(usd(r.usdc))}</td><td class="mono">${esc(r.from.slice(0, 10))}…</td><td><a href="https://basescan.org/tx/${esc(r.tx)}" target="_blank" rel="noopener">${esc(r.tx.slice(0, 12))}…</a></td></tr>`)
    .join("");
  const routeRows = Object.entries(m.routes)
    .map(([route, c]) => `<tr><td class="mono">${esc(route)}</td><td>${c.paid}</td><td>${esc(usd(c.paidMicroUsdc / 1e6))}</td><td>${c.free}</td><td>${c.challenged}</td></tr>`)
    .join("");
  const days = (e?.byDay ?? []).slice(0, 14).map((d) => `<tr><td>${esc(d.day)}</td><td>${d.count}</td><td>${esc(usd(d.usdc))}</td></tr>`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.service)} — 売上</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;background:#0f1320;color:#e8ecf5}
h1{font-size:20px;margin:0 0 4px}.muted{color:#8b93a7;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.card{background:#1a2033;border-radius:12px;padding:16px}.label{font-size:12px;color:#8b93a7}.value{font-size:28px;font-weight:700;margin-top:4px}.sub{font-size:12px;color:#8b93a7;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #2a3147}th{color:#8b93a7;font-weight:600}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}h2{font-size:15px;margin:24px 0 4px}a{color:#7aa2ff}
</style></head><body>
<h1>${esc(s.service)} — 売上ダッシュボード</h1>
<div class="muted">受取先 <span class="mono">${esc(s.payTo)}</span> · 更新 ${esc(e?.asOf ?? "-")} · <a href="${esc(s.links.basescan)}" target="_blank" rel="noopener">BaseScan</a> · <a href="${esc(s.links.x402scan)}" target="_blank" rel="noopener">x402scan</a> · <a href="/stats?format=json">JSON</a></div>
${e ? `<div class="grid">
${big("累計受取", usd(e.totalUsdc), `${e.count}件 / 支払元 ${e.payers}アドレス`)}
${big("今日", usd(e.todayUsdc))}
${big("直近7日", usd(e.last7dUsdc))}
${big("直近30日", usd(e.last30dUsdc))}
${big("ウォレット残高", e.balanceUsdc === null ? "-" : usd(e.balanceUsdc), "USDC on Base")}
</div>` : `<p class="muted">オンチェーン集計を取得できませんでした: ${esc((s.earnings as { error: string }).error)}</p>`}
<h2>直近の入金（オンチェーン）</h2>
${rows ? `<table><tr><th>日時 (UTC)</th><th>金額</th><th>支払元</th><th>Tx</th></tr>${rows}</table>` : `<p class="muted">まだ入金はありません。</p>`}
<h2>日別</h2>
${days ? `<table><tr><th>日</th><th>件数</th><th>金額</th></tr>${days}</table>` : `<p class="muted">-</p>`}
<h2>エンドポイント別（サーバー起動 ${esc(m.since.replace("T", " ").slice(0, 16))} UTC 以降）</h2>
<div class="muted">paid = 決済成立、free = 無料枠、402 = 未払いで止まった（巡回ボット含む）</div>
${routeRows ? `<table><tr><th>ルート</th><th>paid</th><th>paid USDC</th><th>free</th><th>402</th></tr>${routeRows}</table>` : `<p class="muted">起動後のアクセスはまだありません。</p>`}
</body></html>`;
}

export function statsRouter(cfg: Config, metrics: Metrics): Router {
  const router = Router();
  router.get("/stats", async (req, res) => {
    const auth = authorizeStats(req, cfg.STATS_TOKEN);
    if (auth === "unconfigured") {
      res.status(503).json({
        error: "stats_disabled",
        message: "STATS_TOKEN is not configured, so the dashboard is disabled.",
      });
      return;
    }
    if (auth === "denied") {
      res.set("WWW-Authenticate", 'Basic realm="ja-normalize stats", charset="UTF-8"');
      res.status(401).json({ error: "unauthorized", message: "Present STATS_TOKEN to read /stats." });
      return;
    }

    let earnings: Stats["earnings"];
    try {
      earnings = await fetchEarnings(cfg.PAY_TO_ADDRESS);
    } catch (err) {
      earnings = { error: err instanceof Error ? err.message : String(err) };
    }
    const stats: Stats = {
      service: cfg.SERVICE_NAME,
      payTo: cfg.PAY_TO_ADDRESS,
      earnings,
      sinceBoot: metrics.snapshot(),
      links: { basescan: `https://basescan.org/address/${cfg.PAY_TO_ADDRESS}#tokentxns`, x402scan: X402SCAN_PAGE },
    };
    res.set("Cache-Control", "no-store");
    const wantsHtml = req.query.format !== "json" && (req.headers.accept ?? "").includes("text/html");
    if (wantsHtml) res.type("html").send(renderHtml(stats));
    else res.json(stats);
  });
  return router;
}
