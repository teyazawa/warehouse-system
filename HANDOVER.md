# 引継ぎドキュメント — 倉庫管理システム (warehouse-system)

> **⚠ Claude/開発者へ**: このプロジェクトの引継ぎ情報は **必ずこの HANDOVER.md を単一の起点** とする。
> 作業を始めたら真っ先にこのファイルを読むこと。作業を終えたらこのファイルの「最新の作業状況」を更新すること。
> より詳細な履歴は `~/.claude/projects/C--Users-yazawa/memory/handover_YYYYMMDD_warehouse_*.md` に残っている。

---

## 最終更新: 2026-08-06
## 最新コミット (push済): `75c15fd` fix: 数値入力ドラフト化+リサイズ0.1m化+棚/荷物の相互境界制約
## 前回コミット: `a3b5e95` feat: 予定に種別(通常/未定/長期予定)+日付を全種別で任意化

---

## 最新の作業状況 (2026-08-06) — 数値入力ドラフト化・リサイズ精度・境界制約

ユーザー報告:
1. **F12 でモバイル表示** → DevTools が縦占有 or デバイスツールバー ON。F12 再押下 / `Ctrl+Shift+M` / DevTools 別ウィンドウ切り離し で対処 (コード変更なし)。
2. **3棚グループのうち2つに 1×1 荷物が置けない** → 真因は「棚1枚の短辺が 0.9m で 1m 荷物より短い」。**グループ化は色分け+一括移動のためのタグに過ぎず、配置判定は棚1枚単位**なので、短辺 ≥ 荷物辺 でないと入らない。棚を 1m 以上に手動修正で解決。
3. **棚 W/H 入力で「0.2」が入らない** → 修正 (下記)
4. **荷物右下△リサイズで 1.2×1m より小さくできない** → 修正
5. **リサイズで棚/荷物の境界を割り込める** → 修正

### 修正1: DimensionInput 共通コンポーネント (src/App.jsx:867)

**症状**: 棚/荷物の W/H (`type="number"` + `Math.round(raw*10)/10` を毎キーストロークで即 setState) で、`0` タイプ時点で clamp により 0.1 に即確定 → 続く `.` は number 入力の二重ドット制約で無視 → `2` を打っても `0.12→round(1.2)/10=0.1` で戻る。`5〜9` だけ丸めが上に転がり 0.1 刻みで進む挙動。

**修正**: ドラフト状態を保持する共通コンポーネント `DimensionInput` を新設。
- `type="text"` + `inputMode="decimal"`
- 途中入力は `draft` state に保存 (即座に親 state を更新しない)
- 確定は **blur / Enter** のタイミングでのみ → `parseFloat` → `Math.round(raw/step)*step` → `clamp(min, max)` → `onCommit(v)`
- focus 中は `value` prop の変化を無視 (typing 中の再レンダーで書き換わらないよう `focusedRef` でガード)

**適用箇所**:
- 棚/区画/ラック/配電盤の W/H (src/App.jsx:~9029, ~9075)
- 荷物 w_m/d_m/h_m (src/App.jsx:~10108, ~10131, ~10160)
- 配電盤 w_m/d_m/h_m (src/App.jsx:~9700 付近)

### 修正2: 荷物右下△リサイズを 0.1m 刻みに (src/App.jsx:3926)

旧: `Math.round(baseSize.w + dx)` + `Math.max(1, ...)` → 整数セル・最低1セル(1.2×1m)固定。
新: 0.1 セル刻みで小数保持。最小は `Math.max(0.1, 0.1/cellW)` セル ≒ 0.1m。

### 修正3: 棚/荷物リサイズの相互境界制約

| 操作 | 制約 | 実装 |
|------|------|------|
| 棚上の荷物を△でリサイズ | `newW ≤ shelf.w - loc.x`, `newH ≤ shelf.h - loc.y` で上限クランプ | src/App.jsx:3945 (`resize_unit`) |
| 棚を△でリサイズ | 載っている全荷物の `loc+fp` を集計した最大値で下限クランプ。w/n-corner は `newX/newY` も右下固定で再計算 | src/App.jsx:4053 (`resize_shelf`) |
| 棚をサイドバー W/H で数値入力 | 同上、下限を超える場合 Toast で通知 | src/App.jsx:9047, 9093 |
| 荷物をサイドバー 幅/奥行 で数値入力 | 棚境界を超える場合 Toast 通知して切上げ、`rot` を考慮 | src/App.jsx:10114, 10137 |

### rot 考慮の注意

荷物 `unitFootprintCells` は `rot=true` のとき `{w: d_m/cellD, h: w_m/cellW}` を返す。サイドバー数値入力側の境界クランプは rot 分岐して正しく計算しているが、**△ハンドル drag_resize の `newWm = newW * cellW` は rot 未考慮** (`baseSize` は rot 適用後 fp)。→ rot=true の荷物のドラッグリサイズは 旧来同様やや不正確なままだが、rot 使用頻度が低いので保留。

### 未実装(将来)

- ピル→バー ドラッグ昇格 (前回積み残し)
- 種別「未定」変更時の日付消失に確認ダイアログ (前回積み残し)
- 入庫予定日到達で自動的にその倉庫の未配置に荷物レコード生成 (前々回積み残し)
- 棚グループ化を「1枚の仮想大棚として配置判定する」機能 (荷物が棚跨ぎで置けるように) — 今回議論したが未着手

---

## 前回の作業状況 (2026-07-27 夜) — 予定種別と日付任意化

前段の予定表(1358d06)への機能追加。日付未確定の予定を扱えるよう、種別3択と日付全任意化を導入。

### スキーマ拡張
`schedule.scheduleType: "normal" | "undecided" | "long_term"` を追加 (デフォルト "normal", 既存データは `|| "normal"` で後方互換)。

### バリデーション (全種別共通に緩和)

| 項目 | 必須 |
|------|------|
| 顧客名 | ✅ |
| 案件名 | ✅ |
| 入庫予定日 | ❌ 任意 |
| 出庫予定日 | ❌ 任意 |

両方入力時のみ「出庫日 ≥ 入庫日」チェック。

### モーダル
- 最上部に予定種別3ボタン (通常=紫 / 未定=灰 / 長期予定=橙, 選択中は色付き, 説明文つき)
- **種別ボタンで日付動的切替** (`handleTypeChange` @ src/App.jsx:~12250):
  - undecided/long_term に切替 → inboundDate/outboundDate クリア
  - normal に切替 → 空欄なら today/+7 で復元、値ありなら保持
- 日付ラベルは全て `(任意)` 表記

### 予定表ビュー (`SchedulePlanView`)

**未定ピルセクション** (~src/App.jsx:12490) — 対象: `scheduleType === "undecided"` OR `!inboundDate`
- ツールバー直下・日付ヘッダの上に配置
- ダッシュ枠ピル、色ドット、案件名／顧客名、長期バッジ(該当時)、部分日付表示

**日付ありバー**
- 長期予定: 45°縞模様(`repeating-linear-gradient`) + 左端「長期」ラベル
- 出庫日欠落: `inbound+30日`を暫定終端、右端破線 + `→ 未定`
- 通常: 従来通り

### 倉庫側 (WarehouseView) 連動
- `scheduledUndecidedForThisWh` (~src/App.jsx:5895): この倉庫を受入先とする undecided or 入庫日なしを抽出
- 「未定予定」セクション新設 (ダッシュ枠、灰「未定」バッジ、ダブルクリック編集)
- 既存「入出庫予定表」セクションの入庫/出庫カードに「長期」バッジ追加、欠落日付は `(未定)` 表示

### 分類ロジックまとめ

| 種別 | 入庫日あり | 入庫日なし |
|------|-----------|-----------|
| normal | バー表示 | 未定ピル |
| undecided | 未定ピル (常に) | 未定ピル |
| long_term | 縞模様バー | 未定ピル (長期バッジ) |

### 未実装(将来)
- ピル→バー ドラッグ昇格(日付確定を直感操作) は未実装。編集モーダル経由のみ
- 種別を「未定」に変えると入力済み日付が消える。将来的に確認ダイアログが必要かも

---

## 前回の作業状況 (2026-07-27 朝) — 入出庫予定表初版

トップ画面に「入出庫予定表」タブ(ガントチャート)を新設。受入先倉庫を指定すると、その倉庫を開いたときにカレンダーの入庫予定=青ドット/出庫予定=赤ドットで表示され、選択日に一致する予定が左サイドの「入出庫予定表」セクションに出る。予定カードはダブルクリックで編集モーダル起動。

### 追加コンポーネント (src/App.jsx)

| 場所 | 内容 |
|------|------|
| ~12160 | 日付ヘルパー `toYmd/parseYmd/addDaysYmd/daysDiff` |
| ~12175 | `SCHEDULE_QUICK_COLORS` (10色プリセット) |
| ~12193 | `ScheduleEditModal` — 顧客名/案件名/必要坪数/荷姿/入庫日/出庫日/担当者/受入先倉庫/バー色/備考 |
| ~12290 | `SchedulePlanView` — ガントチャート本体 (縦=顧客名, 横=日付) |

### 予定オブジェクト
```js
{
  id: "sch-xxxxx",
  client, caseName, requiredTsubo, packageForm,
  inboundDate, outboundDate,     // "YYYY-MM-DD"
  personInCharge, color, warehouseId, notes,
  createdAt, updatedAt,
}
```
`useSupabaseState("wh_schedules_v1", [])` で永続化。

### バーカラー
`<input type="color">` (OSカラーピッカー) + HEX直接入力 + プレビュー + クイックプリセット10色。荷物と同スタイル、実質無限色選択。

### 受入先倉庫連動 (WarehouseView)
- `CalendarStub` に `markedInbound`/`markedOutbound` prop 追加 (src/App.jsx:~1201)。セル下部に青/赤ドット表示、凡例つき
- `scheduledInboundDates`/`OutboundDates` は **schedules + units.arrivalDate/departureDate 両方**を集約 (src/App.jsx:~5854)
- 「入庫予定」セクションの下に「入出庫予定表」セクションを追加 (src/App.jsx:~6857)。予定カード ダブルクリック → 編集モーダル

### ⚠ 重要な発見
**モーダルは App の view 分岐(map/warehouse)両方に配置が必要**。`view === "warehouse"` 分岐で ScheduleEditModal を配置し忘れていて倉庫内でダブルクリック→編集が発火しなかった。今後モーダル追加時は必ず両分岐 (src/App.jsx:~13154 warehouse分岐 と ~13390 map分岐) に配置。

### 未実装(将来)
- 入庫予定日到達で自動的にその倉庫の未配置(unplaced)に荷物レコード生成
- `warehouseId` フィールドと UI は既に用意済み。あとは検知+生成ロジックのみ

### テスト結果 (全合格)
- [x] 予定表タブ切替、予定作成→ガントチャート表示、重複期間の自動段積み
- [x] バーダブルクリック→編集/削除、色ピッカー(ネイティブ+プリセット+HEX)
- [x] 受入先倉庫指定→CalendarStubドット、選択日一致→予定リスト表示
- [x] 予定カードダブルクリック→編集モーダル (両分岐配置後)
- [x] units.arrivalDate/departureDate もカレンダードットに反映

---

## 2026-07-23 の作業状況 (前回)

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

- `handover_20260723_warehouse_group_modal_stackz.md` — グループモーダル・zoneDetail 化+ドラッグ+stackZ再計算 (現在)
- `handover_20260722_warehouse_fractional_cell_group_modal_rescue.md` — 端数セル/棚境目/救出/グループモーダル (前日、本日コミットに包含)
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
