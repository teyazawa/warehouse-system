# 引継ぎドキュメント — 倉庫管理システム (warehouse-system)

## 最終更新: 2026-02-27
## コミット: 7f07a5d `fix: 棚ダブルクリック3Dビューで荷物が表示されないバグ修正`

---

## プロジェクト概要

React (Vite) のSPAで、倉庫内の荷物配置・管理を行うシステム。
`src/App.jsx` にほぼ全ロジックが集約されたモノリシック構成（約10,500行）。

### 技術スタック
- React 18 + Vite 7
- Tailwind CSS
- LocalStorage でデータ永続化
- GitHub Pages / Vercel でデプロイ可能

---

## 今回の変更内容

### 1. 請求書モーダル再設計

**背景**: 従来は右パネルの請求サマリー内にある取引先ごとの「請求書を生成」ボタンから即時生成していた。月次請求など期間指定に対応するためモーダル化した。

**変更箇所**:

| 変更 | 場所 (line目安) | 内容 |
|------|----------------|------|
| State追加 | ~1885 | `invoiceModalOpen`, `invoicePeriod`, `invoiceFilters` |
| ヘッダーボタン | ~4665 | 緑グラデの「請求書」ボタン（今月1日〜末日を初期値セット） |
| 期間版計算関数 | ~3628 | `calcZoneBillingForPeriod()`, `calcUnitBillingForPeriod()` |
| フィルタ付きデータ | ~3703 | `getFilteredBillingData()` — 顧客/部署/担当者フィルタ対応 |
| モーダルUI | ~8620 | `<Modal title="請求書作成">` — 期間入力・連動プルダウン・プレビュー・生成ボタン |
| 生成関数 | ~3740 | `generateInvoiceForPeriod()` — 旧`generateInvoice`を期間対応に改名 |
| ボタン削除 | 右パネル | 取引先別「請求書を生成」ボタンを削除（サマリー表示は残存） |

**料金計算ロジック**:
- 区画（月額）: `ceil(periodDays / 30)` × 坪数 × 坪単価/月
- 荷物（日額/月額）: 保管期間と請求期間のoverlap部分のみ計算
  - `effectiveStart = max(arrivalDate, periodStart)`
  - `effectiveEnd = min(departureDate || today, periodEnd)`

### 2. 重ね置き（スタッキング）ロジック改善

**背景**: 重ね置きチェックが入っていても重ならない・3Dで重ならない・重ねた荷物が2Dで見えなくなる等の問題があった。

#### 変更一覧

| 問題 | 修正内容 | 場所 |
|------|---------|------|
| 両方stackable必要だった | 下の荷物のみstackable必要に変更 | `canPlaceOnFloor` (~2351), `canPlaceInZone` (~2436) |
| 3段制限 | `max_stack_height`制限を撤廃 | 同上 |
| 3Dで位置ずれ | `containsRectLoose` (tolerance 0.3) を新設 | ~2241 |
| スナップなし | `snapToStackTarget()` 追加（距離1.5セル以内で自動吸着） | ~2301, endDrag内 (~3309, ~3369) |
| 2Dで背面に隠れる | `zIndex: 8 + (u.stackZ \|\| 0)` に変更 | メイン ~6280, 区画詳細 ~9344 |
| 3D視覚フィードバック | ドラッグ中にスナップ先を青い光で表示 | メイン2D ~6272, 区画詳細2D ~9334, Iso3DView ~926 |
| 区画詳細3Dスナップ | `snapToZoneStackTarget()` + `calcDragTarget`統合 | ~9083 |

#### スタッキングの仕組み（現在）

```
1. ユーザーが荷物をドラッグ
2. snapToStackTarget() → 1.5セル以内にstackable荷物があればスナップ
3. canPlaceOnFloor/canPlaceInZone() → 配置可否判定
   - overlapsRect → containsRectLoose → stackItemsにstackableがあればOK
4. getContainingStackItems() → stackZ計算（下の荷物の高さの合計）
5. 配置 + stackZ設定 → z-indexに反映されて2Dで正しく描画
```

---

## アーキテクチャ要点

### 主要な関数・変数

| 関数/変数 | 行目安 | 役割 |
|-----------|--------|------|
| `overlapsRect(a, b)` | ~2225 | AABB衝突判定 |
| `containsRect(outer, inner)` | ~2230 | 厳密包含判定 (tol 0.001) |
| `containsRectLoose(outer, inner)` | ~2241 | 緩い包含判定 (tol 0.3、スタック用) |
| `snapToStackTarget(x, y, fp, excludeId)` | ~2301 | スナップ先検索 |
| `canPlaceOnFloor(u, x, y, excludeId)` | ~2335 | 床配置可否 |
| `canPlaceInZone(zone, u, lx, ly, excludeId)` | ~2390 | 区画内配置可否 |
| `getContainingStackItems(rect, excludeId)` | ~2288 | スタック下の荷物取得 |
| `calcZoneBilling(zone)` | ~3585 | 区画料金（右パネル表示用、従来版） |
| `calcUnitBilling(unit)` | ~3595 | 荷物料金（右パネル表示用、従来版） |
| `calcZoneBillingForPeriod(zone, start, end)` | ~3628 | 期間指定版区画料金 |
| `calcUnitBillingForPeriod(unit, start, end)` | ~3645 | 期間指定版荷物料金 |
| `getFilteredBillingData(start, end, filters)` | ~3703 | フィルタ付き請求データ |
| `generateInvoiceForPeriod(clientData, start, end)` | ~3740 | 請求書HTML生成 |
| `clientBillingSummary` (useMemo) | ~3680 | 右パネル用サマリー |
| `mainStackTargetId` (useMemo) | ~4546 | メインキャンバスのスナップ先ID |
| `Iso3DView` | ~741 | 3Dアイソメトリック表示コンポーネント |

### データ構造（ユニット）

```js
{
  id, name, kind, client, department, personInCharge,
  w_m, d_m, h_m,       // メートル寸法
  w_cells, h_cells,     // セル数（リサイズ後）
  rot: boolean,         // 90度回転
  stackable: boolean,   // 重ね置き可（下の荷物として）
  max_stack_height: number, // 現在は未使用（制限撤廃済）
  stackZ: number,       // スタック高さ（下の荷物の高さの合計）
  loc: { kind: "floor"|"shelf"|"rack"|"unplaced", x, y, ... },
  billingType: "daily"|"monthly",
  arrivalDate, departureDate,
  bgColor, labelColor, bgOpacity,
  status: "in_stock"|"in_transit"|...,
  // ...
}
```

---

## 追加変更: 床・棚ダブルクリック拡大 + 3D回転修正

### 床・棚ダブルクリックで拡大モーダル

- **床(floor)**: ダブルクリックで仮想ゾーン `{ id: "__floor__", ... }` を生成し、既存の区画詳細モーダルを再利用
- **棚(shelf)**: ダブルクリックで仮想ゾーン `{ id: "__shelf_{shelfId}__", loc: { kind: "shelf", shelfId }, ... }` を生成
- 仮想ゾーンは `layout.zones` には存在しないため、9073行のフォールバック `|| zoneDetailZone` で直接使用される
- `_isVirtual` フラグ: `"floor"` / `"shelf"` で識別可能（将来の条件分岐用）

### 3D回転時のセンタリング修正 (Iso3DView)

- **修正前**: `useEffect(() => setPan({x:0, y:0}), [rotStep])` — 回転するとビューが左上にジャンプ
- **修正後**: グリッド中央のスクリーン座標を `isoCenterRef` に保存し、回転時にコンテナ中央にセンタリング
  - `isoCenterRef.current = { cx: gridCenter.sx + offX, cy: gridCenter.sy + offY - maxStackH * heightScale / 2 }`
  - パンを `containerWidth/2 - cx*zoom, containerHeight/2 - cy*zoom` に設定

---

## バグ修正: 棚ダブルクリック3Dビューで荷物が表示されない

**原因**: 棚ユニットの `loc.x/y` は棚内のローカル座標（0〜shelf.w）で保存されているが、仮想ゾーンの `z.loc.x/y` はフロア上のグローバル座標（棚の位置）。区画詳細モーダルの `zoneUnits` 計算で `(u.loc.x - z.loc.x)` を行うと負値になり、境界チェック `_localX >= -0.01` で全ユニットが除外されていた。

**修正箇所**: `src/App.jsx` ~9117

```diff
- const zx = z.loc.x || 0, zy = z.loc.y || 0;
- return { ...u, _localX: (u.loc.x || 0) - zx, _localY: (u.loc.y || 0) - zy, ... };
+ return { ...u, _localX: (u.loc.x || 0), _localY: (u.loc.y || 0), ... };
```

棚ユニットの `loc.x/y` は既にローカル座標なので減算不要。床ユニット（`else`分岐）はグローバル座標なので従来通り `z.x` を減算。

---

## 既知の課題・今後の検討事項

1. **`containsRect` は現在未使用** — 全スタック判定が `containsRectLoose` に移行済み。非スタック用途が今後あれば残しておく価値あり。
2. **`max_stack_height` プロパティ** — UIでは設定可能だが判定では使用していない。将来的に再度制限を入れる場合はここを復活させる。
3. **請求書の税計算** — 現在は税抜のみ。消費税対応が必要な場合は `generateInvoiceForPeriod` に追加。
4. **請求書PDF** — 現在は `window.open` + `window.print()` でのブラウザ印刷。PDF直接出力が必要ならライブラリ導入を検討。
5. **スナップ距離の調整** — `SNAP_DIST = 1.5`（メイン）/ `1.2`（区画詳細）はハードコード。ユーザーの使い勝手に応じて調整。
6. **仮想ゾーンの制約** — 床/棚の仮想ゾーンではドラッグ移動が `canPlaceInZone` を使用。床全体を1つの区画として扱うため、区画外への移動はブロックされる。
7. **モノリシック構成** — App.jsx が10,500行超。コンポーネント分割の検討時期。

---

## 開発環境

```bash
cd warehouse-system
npm install
npm run dev     # localhost:5173
npm run build   # dist/ に出力
```

## リポジトリ

- GitHub: `teyazawa/warehouse-system`
- ブランチ: `master`
