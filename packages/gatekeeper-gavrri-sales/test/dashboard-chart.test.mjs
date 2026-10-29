import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../../plans/gavrri-revenue-slice/gadget/client.js', import.meta.url), 'utf8');
const trend = source.slice(source.indexOf('function trendMarkup()'), source.indexOf('function trendScopes('));
function draw(rows) {
  return runInNewContext(`${trend}; trendMarkup()`, { state: { trend: rows, scope: { currency: 'JPY' } }, esc: String, label: v => v == null ? "未確認" : String(v) });
}
test('monthly charts show values, separate units, zero, and unknown', () => {
  const html = draw([{ month: '2026-09', metrics: { revenue: '0', payment: null, mrr: '120', activeCompanies: 1, activeContracts: 2, newContracts: 1, cancellations: null } }]);
  assert.match(html, /2026-09/);
  assert.match(html, /有料顧客と契約の推移/);
  assert.match(html, /顧客（社）/);
  assert.match(html, /契約（件）/);
  assert.match(html, /新規契約と解約/);
  assert.match(html, /height="0"/);
  assert.match(html, /月次の売上・入金の比較棒グラフ/);
  assert.match(html, /未確認/);
  assert.match(html, /単位 社・件/);
});
test('all missing values and absent months do not become zero', () => {
  assert.match(draw([{ month: '2026-09', metrics: {} }]), /各月は未確認です/);
  assert.match(draw([]), /表示できる月がありません/);
});

test('line chart does not connect across an unconfirmed month', () => {
  const html = draw([
    { month: '2026-08', metrics: { mrr: 100 } },
    { month: '2026-09', metrics: { mrr: null } },
    { month: '2026-10', metrics: { mrr: 0 } },
  ]);
  const svg = html.match(/<svg role="img" aria-label="MRR[^]*?<\/svg>/)[0];
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.equal((svg.match(/stroke-width="3"/g) || []).length, 0);
});
test('chart labels retain 12px at the 600px minimum width', () => {
  const html = draw([{ month: '2026-09', metrics: { revenue: 100, payment: 0, mrr: 50, activeCompanies: 1, activeContracts: 2 } }]);
  assert.match(source, /\.chartPlot\{overflow-x:auto\}/);
  assert.match(source, /min-width:600px/);
  assert.doesNotMatch(source, /\.trendChart svg\{max-height/);
  assert.doesNotMatch(html, /font-size="(?:10|11)"/);
  assert.match(html, /font-size="12"/);
});
