# 引継ぎドキュメント — 倉庫管理システム (warehouse-system)

> **⚠ Claude/開発者へ**: このプロジェクトの引継ぎ情報は **必ずこの HANDOVER.md を単一の起点** とする。
> 作業を始めたら真っ先にこのファイルを読むこと。作業を終えたらこのファイルの「最新の作業状況」を更新すること。
> より詳細な履歴は `~/.claude/projects/C--Users-yazawa/memory/handover_YYYYMMDD_warehouse_*.md` に残っている。

---

## 最終更新: 2026-07-23
## 最新コミット: (このコミット直前) `afaea5a` feat: 出庫予定日超過で自動出庫リスト移動+棚のグループ化機能

---

## 最新の作業状況 (2026-07-23)

2026-07-22 の未commit分をブラウザで動作確認→追加バグ発見→修正→全テスト合格→1コミットにまとめる、という流れ。

### 2026-07-23 追加で修正した項目

#### A. グループ結合詳細モーダル - Tailwind `z-[9998]` 不発 & 閲覧専用問題

**症状**: グループ化された棚をダブルクリックしてもモーダルが表示されない。診断で内部の render は実行されているのに visible にならない。

**真因**: モーダルの outer div が Tailwind `className="fixed inset-0 z-[9998] bg-black/50 flex items-center justify-center p-4"`。他モーダル (zoneDetail / rackDetail) は **インライン `zIndex: 99998`** を使用しており、Tailwind の arbitrary z-index が期待通りに効いていない or 別要素に隠れていた。

**修正**: 全てインラインスタイルに統一 (src/App.jsx:11342付近):
```js
style={{
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  zIndex: 99998,
  display: "flex", alignItems: "center", justifyContent: "center",
  backgroundColor: "rgba(0, 0, 0, 0.6)",
}}
```

さらにユーザー要求で **zoneDetailModal と同じデザインに統一** + **モーダル内で荷物ドラッグ移動可能に**:
- ヘッダー: `flex items-center justify-between border-b px-5 py-4 gap-3` の統一デザイン
- 2Dビュー: サブグリッド (0.25セル刻み) + 荷物を実寸描画
- 荷物ドラッグ:
  - `shelfGroupDetailDrag` state 新設 (`{ unitId, startX, startY, pointerX, pointerY, baseLocalX, baseLocalY, baseShelfId, baseShelfOffsetX }`)
  - outer div に `onMouseMove`/`onMouseUp`
  - `startGroupDragUnit`, `calcGroupDragTarget`, `handleGroupDrop` 実装
  - 棚をまたぐ移動対応 (ギャップに落ちても最寄り棚に自動吸着)
  - ドラッグゴースト (緑=OK/赤=NG) 表示
  - 重ね置きスナップ (距離1.2セル+stackable) 対応
- 3Dビュー: `Iso3DView` に `onUnitMouseDown`/`draggingId`/`hasDragMoved`/`ghostBox`/`stackTargetId` を渡してドラッグ有効化

#### B. 下段撤去時の上段 stackZ 宙浮きバグ

**症状**: 荷物を重ねた後、下段を移動 or 未配置に戻す → 上に乗っていた荷物が古い stackZ のまま宙に浮く。

**真因**: 各ドロップハンドラは移動先の unit の stackZ だけ計算し、移動元 loc の残った units は再計算していなかった。

**修正**: `recalcStackZOnLoc(unitsList, locSpec)` を新設 (src/App.jsx:3031付近)。
- 対象 loc (`"floor"` | `{ shelfId }`) の全ユニットの `stackZ` を再計算
- **既存 stackZ 昇順で処理** (下から上へ) し、containers は「自分より前に処理済み」のユニットに限定 → **循環参照による高さ暴走を防止**
- 同サイズ荷物同士は `containsRectLoose` (tol=0.3) で相互包含判定になるが、この順序ルールで安定化

**適用箇所**:
- メインキャンバスのユニットドロップ (棚 / 床) — 移動元 + 移動先の両方 (src/App.jsx:4344付近)
- zoneDetailModal のドロップ — 同上 (src/App.jsx:10971付近)
- グループ結合モーダルのドロップ — 棚跨ぎ対応 (src/App.jsx:11460付近)
- 矢印キー移動 — 影響を受けた全 loc (src/App.jsx:2475付近)
- `wh:units-external-update` (未配置に戻す) — 床+全棚 (src/App.jsx:1852付近)

### テスト結果 (全合格)

- [x] ①端数セル: セル幅と合わない実寸荷物を棚に複数配置できる
- [x] ②裏側配置バグ解消: 隣接配置される (スタックされない)
- [x] ③棚境目: 箱矩形の重なり面積最大の棚を採用
- [x] ④吸着: 隣接では吸われず、半分以上重ねると吸着スタック
- [x] ⑤救出: 「未配置に戻す」ボタン+リアルタイム反映
- [x] ⑥グループ結合詳細モーダル: 2D/3D+ドラッグ移動+棚跨ぎ
- [x] ⑦単独棚 / 1メンバーグループ: 従来の単棚詳細モーダル

---

## 2026-07-22 作業内容 (参考、当時未commit → 本日 2026-07-23 のコミットに包含)

詳細: `handover_20260722_warehouse_fractional_cell_group_modal_rescue.md`

### 修正した4トピック(未commit)

#### ① 端数セル対応 `unitFootprintCells` (src/App.jsx:2922)

**症状**: 棚内に収まるはずの荷物が「置けません」／棚に置いたら裏側に隠れる／3Dで宙に浮く。

**真因**: `unitFootprintCells` が `Math.ceil(u.w_m / cell_m_w)` で切り上げ → 視覚フットプリントが実寸より膨張 → clamp で棚端に押し戻され、`containsRectLoose` (tol=0.3) で "包含" 扱い → stackable 荷物への強制スタックで裏側配置。

**修正方針**: `w_m` を authoritative に、`w_cells` は fallback のみ。`Math.ceil` 撤廃、素の除算に変更。

**派生修正**:
- 矢印キー移動 `fpFor` (~2404) → `unitFootprintCells` に統一
- 矢印キー後のスタック計算 `containing` 内の fpFor → `unitFootprintCells` に統一
- 詳細モーダル `w_m`/`d_m` 入力時の `w_cells` 計算 (~9679, ~9693) → `Math.ceil` → 素の除算

#### ② 棚境目 + 吸着スナップ改善

**症状 A**: 隣接する2棚の境目に箱を落とすと、どちらに入るか不定 (ポインタ位置依存)。

**修正**: `findShelfForBox(boxX, boxY, boxW, boxH, fallbackCx, fallbackCy)` 新設 (src/App.jsx:3252)
- 箱矩形と各棚の**重なり面積が最大**の棚を採用
- 全く重ならなければ従来の `findShelfAtCell(fallbackCx, fallbackCy)` にフォールバック
- 同値時は zOrder降順 → 配列末尾優先 (DOM描画順の最前面)
- 荷物ドロップ2箇所 (`place_new` @ 4168, `move_unit` @ 4272) で置換

**症状 B**: 荷物をギリギリ隣に寄せようとすると吸い込まれて重なる。

**修正**: `snapToStackTarget` / `snapToStackTargetOnShelf` (src/App.jsx:3049, 3312)
- スナップ発火条件を Manhattan 1.5セル → 「候補矩形の**面積の 50% 以上が対象と重なる**」に変更
- 隣接や1セルめり込む程度では吸着しない → 明確に上に乗せる意図の時だけスナップ

#### ③ 動かない荷物の救出 (UnitSearchModal「未配置に戻す」ボタン)

- `releaseUnitToUnplaced(unit)` 新設 (src/App.jsx:~11662)
  - 対象倉庫の `wh_demo_units_${whId}_v1` を localStorage + Supabase (`app_state`) 直接更新
  - `loc = { kind: "unplaced" }` + `stackZ = 0` + editHistory に "未配置に戻す (救出)" 追記
- `UnitSearchModal` (src/App.jsx:1307) に `onReleaseToUnplaced` prop 追加
  - 各行に赤い「未配置に戻す」ボタン (未配置以外の荷物のみ表示)

**★ 同期の落とし穴と対応**:
- `useSupabaseState` は起動時に1回だけ Supabase を読むだけで、storage/realtime を購読していない
- App レベルで localStorage を書き換えても、開いている WarehouseView の `units` state は更新されない
- **対応**: `window.dispatchEvent(new CustomEvent("wh:units-external-update", { detail: { whId } }))` で通知
- WarehouseView 側 (src/App.jsx:~1851) に受信 useEffect を追加 → localStorage 再読込 → `_setUnitsRaw`
- **今後 units を外部書換する機能を追加する時は同じイベントを dispatch すること**

#### ④ グループ結合詳細モーダル (棚ダブルクリック)

**仕様**: 棚ダブルクリック時、その棚がグループに属していれば新モーダルを開く。全メンバーを1セル空きで並列表示 (2D + 3D)。

- state (src/App.jsx:~2555): `shelfGroupDetailOpen`, `shelfGroupDetailData: { groupId, memberIds }`, `shelfGroupDetail3D`, `shelfGroupDetailRotStep`, `shelfGroupDetailZoom`
- 開閉: `openShelfGroupDetailModal(groupId, memberIds)` / `closeShelfGroupDetailModal()`
- 棚ダブルクリック分岐 (src/App.jsx:~7247): `s.groupId` && `memberIds.length > 1` → 新モーダル。単独は従来の単棚詳細モーダル
- モーダル本体 (src/App.jsx:~11239, 既存 zoneDetailModal 直後):
  - `GROUP_GAP = 1` セル、元位置順ソートで `_offsetX` 割当
  - `totalW = 全メンバーw + gap*(n-1)`, `maxH = max(members.h)` を仮想キャンバス寸法
  - 2D は zone detail 2D と同じスタイル、3D は `Iso3DView` に viewCols/viewRows で渡す
  - 閲覧専用 (position 編集はしない)

---

## 本日 (2026-07-23) のテスト観点

1. **端数セル**: セル幅と合わない実寸荷物 (例 1.2m × 1.0m) を作成 → 表示サイズが実寸忠実。以前置けなかった棚に複数配置できる
2. **裏側配置バグ**: 棚に荷物 A → 隣に B → A の上にスタックされず隣接配置できる
3. **棚境目**: 隣接2棚の境目に大きめの荷物を落とす → 重なりが多い棚に入る (ポインタ位置に依存しない)
4. **吸着**: 既存荷物のすぐ隣 (触れる/わずかにめり込む) に置く → 吸われずそのまま隣接。半分以上重ねると吸着してスタック
5. **救出**: 第4倉庫 → 荷物検索 → 棚6の該当荷物 → 赤「未配置に戻す」 → 未配置リストに即反映 (リロード不要)
6. **グループ結合モーダル**: 複数棚をグループ化 → ダブルクリック → 新モーダル (全メンバー並列, gap) → 3D ボタン → 荷物ダブルクリックで詳細
7. **単独棚 / 1メンバーグループ**: 従来通り単棚詳細モーダル (memberIds.length > 1 分岐)

### commit 案 (全テスト OK 時)

```
fix: 荷物フットプリントを実寸化+棚境目/吸着改善+救出ボタン+グループ結合詳細モーダル

- unitFootprintCells: Math.ceil撤廃、w_mをauthoritativeに (棚に置けない/裏側配置バグ解消)
- findShelfForBox: 箱の重なり面積最大の棚を採用 (境目のあいまいさ解消)
- スナップ吸着: Manhattan距離ではなく重なり50%以上で発火 (隣接配置が吸われない)
- 荷物検索モーダルに「未配置に戻す」ボタン (棚下に隠れて動かせない荷物の救出)
- CustomEvent "wh:units-external-update" で外部書換時の WarehouseView 同期
- 棚グループ化された棚をダブルクリック → グループ結合詳細モーダル (2D/3D並列表示)
```

---

## プロジェクト概要

- React 18 + Vite 7、Tailwind CSS
- LocalStorage + Supabase (`app_state`) でデータ永続化
- **モノリシック構成**: `src/App.jsx` に約 10,900行(現在は12,000行前後)集約
- GitHub: `teyazawa/warehouse-system` / ブランチ: `master`

## 開発環境

```bash
cd C:\Users\yazawa\work\warehouse-system
npm install
npm run dev     # localhost:5173  (HMR で src/App.jsx の変更が即反映)
npm run build   # dist/ に出力
```

---

## 主要関数マップ (現時点の目安、grep で確認)

| 関数/変数 | 行目安 | 役割 |
|-----------|--------|------|
| `unitFootprintCells(u)` | 2922 | 荷物の視覚フットプリント (実寸ベース、真実の source of truth) |
| `overlapsRect(a, b)` | ~2225 | AABB衝突判定 |
| `containsRectLoose(outer, inner)` | ~2241 | 緩い包含判定 (tol 0.3、スタック用) |
| `snapToStackTarget(x, y, fp, excludeId)` | ~3049 | 床/メインのスナップ (重なり50%以上で発火) |
| `snapToStackTargetOnShelf(...)` | ~3312 | 棚内のスナップ (同上) |
| `findShelfForBox(bx,by,bw,bh,fx,fy)` | ~3252 | 箱矩形と重なり最大の棚を返す |
| `findShelfAtCell(cx, cy)` | ~- | セル位置の棚を返す (zOrder降順) |
| `canPlaceOnFloor(u, x, y, excludeId)` | ~2335 | 床配置可否 |
| `canPlaceInZone(zone, u, lx, ly, excludeId)` | ~2390 | 区画/棚内配置可否 |
| `getContainingStackItems(rect, excludeId)` | ~2288 | スタック下の荷物取得 |
| `releaseUnitToUnplaced(unit)` | ~11662 | 荷物を「未配置」に戻す (localStorage+Supabase 直接更新) |
| `openShelfGroupDetailModal(groupId, memberIds)` | ~2555 | グループ結合詳細モーダルを開く |
| `Iso3DView` | ~741 | 3Dアイソメトリック表示 (グループモーダルでも再利用) |
| `calcZoneBillingForPeriod(zone, start, end)` | ~3628 | 期間指定版区画料金 |
| `calcUnitBillingForPeriod(unit, start, end)` | ~3645 | 期間指定版荷物料金 |
| `getFilteredBillingData(start, end, filters)` | ~3703 | フィルタ付き請求データ |
| `generateInvoiceForPeriod(clientData, start, end)` | ~3740 | 請求書HTML生成 |

## データ構造(ユニット)

```js
{
  id, name, kind, client, department, personInCharge, clientContact,
  w_m, d_m, h_m,           // メートル寸法 (authoritative)
  w_cells, h_cells,         // セル数 (legacy fallback、極力使わない)
  rot: boolean,             // 90度回転
  stackable: boolean,       // 下の荷物として重ね置き可
  max_stack_height: number, // 現在は判定未使用 (制限撤廃済)
  stackZ: number,           // スタック高さ (下の荷物の高さの合計)
  loc: { kind: "floor"|"shelf"|"rack"|"unplaced", x, y, shelfId?, ... },
  billingType: "daily"|"monthly",
  arrivalDate, departureDate,
  bgColor, labelColor, bgOpacity,
  status: "in_stock"|"in_transit"|...,
  editHistory: [...]
}
```

- 棚上ユニットの `loc.x/y` は **棚内のローカル座標** (0〜shelf.w)
- 床/区画のユニットの `loc.x/y` は **フロア上のグローバル座標**
- 区画詳細モーダルの `zoneUnits` 計算では棚仮想ゾーンの場合のみ減算しない (棚バグ修正済 @~9117)

---

## 既知の課題・今後の検討

1. **モノリシック構成** — App.jsx が 12,000行前後。コンポーネント分割の検討時期。
2. **`max_stack_height`** — UI設定は残っているが判定では使用していない。将来復活可能。
3. **請求書の税計算** — 現在は税抜のみ。消費税対応は `generateInvoiceForPeriod` に追加。
4. **請求書PDF** — `window.open` + `window.print()` のブラウザ印刷のみ。
5. **スナップ距離** — 50% しきい値はハードコード。ユーザーの使い勝手で調整。
6. **仮想ゾーン (床/棚)** — `canPlaceInZone` を使うためゾーン外への移動はブロック。
7. **useSupabaseState は realtime 未購読** — 外部書換時は必ず `wh:units-external-update` を dispatch。

---

## 過去の主な引継ぎ(memory 側に詳細)

- `handover_20260722_warehouse_fractional_cell_group_modal_rescue.md` — 端数セル/棚境目/救出/グループモーダル (現在)
- `handover_20260721_warehouse_ship_list_shelf_group.md` — 出庫リスト自動化+棚グループ化 初版
- `handover_20260708_warehouse_shelf_stacking.md` — 棚上多段積み・findShelfAtCell zOrder 降順化
- `handover_20260707_warehouse_zindex_layers.md` — 3層 z-index構造 (床<区画/棚/ラック<荷物)
- `handover_20260703_warehouse_overview.md` — 3日連続修正の総括
- `handover_20260703_warehouse_unit_precision_duplicate_presets.md` — 実寸精度+複製+プリセット
- `handover_20260703_warehouse_click_position_drift_fix.md` — クリック位置ズレ修正
- `handover_20260702_warehouse_border_layer_zorder.md` — 枠線レイヤー zOrder
- `handover_20260701_warehouse_rack_modal_and_decimal.md` — ラック詳細モーダル+小数
- `handover_20260630_warehouse_decimal_rack_view.md` — 小数対応+ラックビュー
- `handover_20260319_warehouse_customer_sheet.md` — 顧客シート
- `handover_20260302_warehouse_zonedetail.md` — 区画詳細
- `handover_20260227_warehouse_pricing.md` — 料金計算初版
- `warehouse-handover.md` — プロジェクト初期の全体像
- `handover_20260226_warehouse_maplibre.md` — マップ表示
- `handover_20260225_warehouse_auth.md` — 認証
- `handover_20260224_warehouse_image.md` — 画像アップロード
