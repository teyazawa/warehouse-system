import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leafletデフォルトアイコンの修正（Webpack/Vite対応）
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

// HEX色をRGB配列に変換
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [0, 0, 0];
}

// 吹き出し風カスタム倉庫アイコンを生成
function createWarehouseIcon(warehouse, isSelected = false) {
  const size = warehouse.iconSize || 48;
  const imageUrl = warehouse.iconImage;
  const pointerLength = warehouse.pointerLength || 10; // 吹き出しの尖り部分の長さ
  const pointerWidth = warehouse.pointerWidth || 8; // 吹き出しの尖り部分の幅
  const borderColor = isSelected ? "#2563eb" : "#333";
  const borderWidth = isSelected ? "3px" : "2px";
  const shadowColor = isSelected ? "rgba(37,99,235,0.4)" : "rgba(0,0,0,0.3)";

  let iconHtml;
  if (imageUrl) {
    // カスタム画像がある場合
    iconHtml = `
      <div style="position: relative;">
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 8px;
          border: ${borderWidth} solid ${borderColor};
          background: white;
          box-shadow: 0 2px 8px ${shadowColor};
          overflow: hidden;
        ">
          <img src="${imageUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
        <div style="
          position: absolute;
          bottom: -${pointerLength - 2}px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: ${pointerWidth}px solid transparent;
          border-right: ${pointerWidth}px solid transparent;
          border-top: ${pointerLength}px solid ${borderColor};
        "></div>
      </div>
    `;
  } else {
    // デフォルトアイコン
    iconHtml = `
      <div style="position: relative;">
        <div style="
          width: ${size}px;
          height: ${size}px;
          border-radius: 8px;
          border: ${borderWidth} solid ${borderColor};
          background: white;
          box-shadow: 0 2px 8px ${shadowColor};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${Math.max(16, size * 0.5)}px;
        ">🏭</div>
        <div style="
          position: absolute;
          bottom: -${pointerLength - 2}px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: ${pointerWidth}px solid transparent;
          border-right: ${pointerWidth}px solid transparent;
          border-top: ${pointerLength}px solid ${borderColor};
        "></div>
      </div>
    `;
  }

  return new L.DivIcon({
    className: "warehouse-marker",
    html: iconHtml,
    iconSize: [size, size + pointerLength],
    iconAnchor: [size / 2, size + pointerLength],
  });
}

// 地図の状態（位置・ズーム）を保存・復元するコンポーネント
function MapStateHandler({ storageKey }) {
  const map = useMap();

  // 初回マウント時に保存された状態を復元
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const { center, zoom } = JSON.parse(saved);
        if (center && zoom) {
          map.setView(center, zoom);
        }
      }
    } catch (e) {
      console.error("Failed to restore map state:", e);
    }
  }, [map, storageKey]);

  // 地図移動・ズーム時に状態を保存
  useMapEvents({
    moveend: () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          center: [center.lat, center.lng],
          zoom,
        }));
      } catch (e) {
        // ignore
      }
    },
  });

  return null;
}

// ドラッグ可能なマーカーコンポーネント（ポップアップなし、クリックで選択）
function DraggableMarker({ position, warehouse, isSelected, onPositionChange, onClick, onDoubleClick }) {
  const markerRef = useRef(null);

  const eventHandlers = useMemo(() => ({
    dragend() {
      const marker = markerRef.current;
      if (marker) {
        const { lat, lng } = marker.getLatLng();
        onPositionChange(warehouse.id, lat, lng);
      }
    },
    click: onClick,
    dblclick: onDoubleClick,
  }), [warehouse.id, onPositionChange, onClick, onDoubleClick]);

  const icon = useMemo(() => createWarehouseIcon(warehouse, isSelected), [warehouse, isSelected]);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={icon}
      draggable={true}
      eventHandlers={eventHandlers}
    />
  );
}

// 住所からジオコーディング（Nominatim API使用 - 無料）
async function geocodeAddress(address) {
  try {
    const encoded = encodeURIComponent(address);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      {
        headers: {
          "Accept-Language": "ja",
        },
      }
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
    return null;
  } catch (e) {
    console.error("Geocoding failed:", e);
    return null;
  }
}

// Single-file demo UI
// Features:
// - Map-like top screen with pan/zoom
// - Add / edit / delete warehouse rectangles
// - Drag to move, handle to resize
// - Click to enter a warehouse (internal screen)
// - Inside warehouse: floor grid + zones + racks + unit placement (DnD)
// - Toggle left/right panels

const uid = () => Math.random().toString(36).slice(2, 10);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "-";
  return new Intl.NumberFormat("ja-JP").format(Math.round(n));
}

// ステータスの色
function getStatusColor(status) {
  const map = {
    draft: "gray",
    planned_in: "blue",
    in_stock: "green",
    reserved: "yellow",
    planned_out: "purple",
    shipped: "gray",
  };
  return map[status] || "gray";
}

// ステータスのラベル
function getStatusLabel(status) {
  const map = {
    draft: "下書き",
    planned_in: "入荷予定",
    in_stock: "在庫中",
    reserved: "引当済",
    planned_out: "出荷予定",
    shipped: "出荷済",
  };
  return map[status] || status;
}

// 商品状態の色
function getConditionColor(condition) {
  const map = {
    good: "green",
    damaged: "red",
    returned: "yellow",
  };
  return map[condition] || "gray";
}

// 商品状態のラベル
function getConditionLabel(condition) {
  const map = {
    good: "良好",
    damaged: "破損",
    returned: "返品",
  };
  return map[condition] || condition;
}

// 温度ゾーンの色
function getTempZoneColor(zone) {
  const map = {
    ambient: "gray",
    chilled: "blue",
    frozen: "purple",
  };
  return map[zone] || "gray";
}

// 温度ゾーンのラベル
function getTempZoneLabel(zone) {
  const map = {
    ambient: "常温",
    chilled: "冷蔵",
    frozen: "冷凍",
  };
  return map[zone] || zone;
}


const SHELF_COLORS = {
  teal: { bg: "bg-teal-100/70", border: "border-teal-400", handle: "bg-teal-300", label: "ティール" },
  sky: { bg: "bg-sky-100/70", border: "border-sky-400", handle: "bg-sky-300", label: "スカイ" },
  warm: { bg: "bg-orange-50/80", border: "border-amber-300", handle: "bg-amber-200", label: "ウォーム" },
  wood: { bg: "bg-yellow-50/80", border: "border-yellow-600", handle: "bg-yellow-300", label: "木目" },
  mint: { bg: "bg-emerald-50/70", border: "border-emerald-300", handle: "bg-emerald-200", label: "ミント" },
  lavender: { bg: "bg-violet-100/70", border: "border-violet-300", handle: "bg-violet-200", label: "ラベンダー" },
};

function useSupabaseState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const [loaded, setLoaded] = useState(false);

  // Supabaseから読み込み（起動時1回）
  useEffect(() => {
    if (!supabase) { setLoaded(true); return; }
    supabase
      .from("app_state")
      .select("value")
      .eq("key", key)
      .maybeSingle()
      .then(({ data, error }) => {
        console.log("[Supabase] fetch", key, "data:", data, "error:", error);
        if (data?.value != null) {
          setValue(data.value);
          localStorage.setItem(key, JSON.stringify(data.value));
        }
        setLoaded(true);
      })
      .catch((err) => { console.error("[Supabase] fetch error", key, err); setLoaded(true); });
  }, [key]);

  // 変更時にSupabase + localStorageに保存（デバウンス）
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
    if (!supabase) return;
    const timer = setTimeout(() => {
      supabase
        .from("app_state")
        .upsert({ key, value, updated_at: new Date().toISOString() })
        .then(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  return [value, setValue];
}

function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "36rem",
          maxHeight: "90vh",
          overflow: "auto",
          borderRadius: "16px",
          backgroundColor: "white",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button
            className="rounded-xl px-3 py-1 text-sm hover:bg-gray-100"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Badge({ children, color = "gray" }) {
  const colors = {
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    red: "bg-red-100 text-red-700",
    purple: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

function IconButton({ children, onClick, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50 active:scale-[0.99]"
      type="button"
    >
      {children}
    </button>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="text-sm font-semibold text-gray-900">{children}</div>
      {right}
    </div>
  );
}

function CalendarStub({ selectedDate, onPick }) {
  // Very simple month grid (no locale edge cases)
  const d = new Date(selectedDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-2xl border bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">
          {year} / {month + 1}
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-lg px-2 py-1 text-sm hover:bg-gray-100"
            onClick={() => onPick(new Date(year, month - 1, 1))}
            type="button"
          >
            ←
          </button>
          <button
            className="rounded-lg px-2 py-1 text-sm hover:bg-gray-100"
            onClick={() => onPick(new Date(year, month + 1, 1))}
            type="button"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-gray-600">
        {"日月火水木金土".split("").map((w) => (
          <div key={w} className="py-1 text-center font-medium">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cd, idx) => {
          const isSelected =
            cd &&
            cd.getFullYear() === d.getFullYear() &&
            cd.getMonth() === d.getMonth() &&
            cd.getDate() === d.getDate();
          return (
            <button
              key={idx}
              type="button"
              disabled={!cd}
              onClick={() => cd && onPick(cd)}
              className={
                "h-8 rounded-lg text-sm " +
                (cd ? (isSelected ? "bg-black text-white" : "hover:bg-gray-100") : "opacity-0")
              }
            >
              {cd ? cd.getDate() : ""}
            </button>
          );
        })}
      </div>

      <div className="mt-3 text-xs text-gray-500">選択日: {d.toLocaleDateString("ja-JP")}</div>
    </div>
  );
}

function WarehouseView({ wh, onBack, onUpdateWarehouse }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  const defaultLayout = useMemo(
    () => ({
      floor: {
        cols: 34,
        rows: 22,
        cellPx: 32,
        // 1セル=何m (平置き課金の換算に使う)
        cell_m_w: 1.2,
        cell_m_d: 1.0,
        // 1坪グリッド表示
        showTsuboGrid: true,
        // グリッド透明度設定 (0-100)
        floorCellGridOpacity: 10,      // 床セルグリッド
        floorTsuboGridOpacity: 30,     // 床1坪グリッド
        shelfCellGridOpacity: 30,      // 棚セルグリッド
        shelfTsuboGridOpacity: 60,     // 棚1坪グリッド
        // 色設定
        floorBgColor: "#ffffff",       // 床背景色
        floorCellGridColor: "#000000", // 床セルグリッド色
        floorTsuboGridColor: "#3b82f6",// 床1坪グリッド色（青）
        shelfCellGridColor: "#000000", // 棚セルグリッド色
        shelfTsuboGridColor: "#3b82f6",// 棚1坪グリッド色（青）
        floorLabelColor: "#000000",    // 床ラベル色
        // 回転（度）
        rotation: 0,
        // 床の位置（セル座標）
        x: 0,
        y: 0,
      },
      zones: [
        { id: "z-" + uid(), name: "取引先A 専有区画", client: "取引先A", x: 2, y: 2, w: 10, h: 7, labelColor: "#000000", bgColor: "#d1fae5", bgOpacity: 90 },
        { id: "z-" + uid(), name: "取引先B 専有区画", client: "取引先B", x: 2, y: 10, w: 8, h: 6, labelColor: "#000000", bgColor: "#dbeafe", bgOpacity: 90 },
      ],
      racks: [
        { id: "r-" + uid(), name: "ラック1", x: 18, y: 3, w: 12, h: 7, rows: 3, cols: 6, labelColor: "#ffffff", bgColor: "#f1f5f9", bgOpacity: 95 },
        { id: "r-" + uid(), name: "ラック2", x: 18, y: 12, w: 10, h: 6, rows: 3, cols: 5, labelColor: "#ffffff", bgColor: "#f1f5f9", bgOpacity: 95 },
      ],
      shelves: [],
    }),
    []
  );

  const [layout, setLayout] = useSupabaseState(`wh_demo_layout_${wh.id}_v1`, defaultLayout);
  const [units, setUnits] = useSupabaseState(`wh_demo_units_${wh.id}_v1`, []);
  // units: {id, kind, client, name, w_m,d_m,h_m, qty, status, rot, loc:{kind:'unplaced'|'floor'|'rack', x?,y?, rackId?, slot?}}

  const [panels, setPanels] = useSupabaseState(`wh_demo_panels_${wh.id}_v1`, []);

  // マイグレーション: layout.panelsが存在する場合、新stateに移行
  useEffect(() => {
    if (layout.panels && layout.panels.length > 0) {
      setPanels((prev) => prev.length > 0 ? prev : layout.panels);
      setLayout((prev) => { const { panels: _, ...rest } = prev; return rest; });
    }
  }, []);

  const [mode, setMode] = useState("operate"); // operate | layout
  const [selected, setSelected] = useState(null); // {kind:'unit'|'zone'|'rack', id}
  const [multiSelected, setMultiSelected] = useState([]); // [{kind, id}, ...]

  function isItemSelected(kind, id) {
    if (selected?.kind === kind && selected?.id === id) return true;
    return multiSelected.some((s) => s.kind === kind && s.id === id);
  }

  const selectionSet = useMemo(() => {
    const set = [...multiSelected];
    if (selected && !set.some((s) => s.kind === selected.kind && s.id === selected.id)) {
      set.unshift(selected);
    }
    return set;
  }, [selected, multiSelected]);

  function clearSelection() {
    setSelected(null);
    setMultiSelected([]);
  }

  function toggleMultiSelect(kind, id) {
    const exists = multiSelected.some((s) => s.kind === kind && s.id === id);
    if (exists) {
      setMultiSelected((prev) => prev.filter((s) => !(s.kind === kind && s.id === id)));
      if (selected?.kind === kind && selected?.id === id) setSelected(null);
    } else {
      if (!selected) {
        setSelected({ kind, id });
      } else {
        setMultiSelected((prev) => [...prev, { kind, id }]);
      }
    }
  }

  function handleItemClick(e, kind, id) {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      toggleMultiSelect(kind, id);
    } else {
      setSelected({ kind, id });
      setMultiSelected([]);
    }
  }

  // Panel toggles (left: calendar/plan, right: creator/editor)
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const unitsRef = useRef(units);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const canvasRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
const [detailUnit, setDetailUnit] = useState(null);

// 配電盤詳細モーダル用State
const [detailPanelOpen, setDetailPanelOpen] = useState(false);
const [detailPanel, setDetailPanel] = useState(null);

function openDetailModal(unit) {
  setDetailUnit(unit);
  setDetailOpen(true);
}

function openPanelDetailModal(panel) {
  setDetailPanel(panel);
  setDetailPanelOpen(true);
}
  // Internal pan/zoom (kept simple)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Drag state (units + layout objects + pan)
  const [drag, setDrag] = useState(null);
  // drag variants:
  // {type:'pan', startX,startY, basePan}
  // {type:'move_unit', unitId, startX,startY, baseLoc}
  // {type:'place_new', draftUnit, startX,startY, pointerX,pointerY}
  // {type:'move_zone'|'resize_zone'|'move_rack'|'resize_rack', id, startX,startY, baseRect}

  // rAF-throttled mousemove for smoother drag
  const rafMoveRef = useRef(null);
  const pendingMoveRef = useRef(null);

  // Creation panel form
  const [template, setTemplate] = useState("パレット");
  const [form, setForm] = useState({
  client: "取引先A",
  name: "",
  qty: "1",
  w: "1.2",
  d: "1.0",
  h: "1.6",
  // ========== 新規フィールド ==========
  sku: "",
  barcode: "",
  batch_number: "",
  weight_kg: "",
  temperature_zone: "ambient",
  fragile: false,
  stackable: true,
  max_stack_height: "3",
  expires_at: "",
  notes: "",
});

  // Planned lists (stub)
  const inboundPlanned = useMemo(
    () => [
      {
        id: "pin1",
        template: "パレット",
        client: "取引先A",
        name: "入荷：パレット(取引先A)",
        w: 1.2,
        d: 1.0,
        h: 1.6,
        qty: 8,
        eta: "09:30",
      },
      {
        id: "pin2",
        template: "カゴ",
        client: "取引先B",
        name: "入荷：カゴ(取引先B)",
        w: 0.8,
        d: 0.6,
        h: 0.7,
        qty: 12,
        eta: "13:00",
      },
    ],
    []
  );
  const outboundPlanned = useMemo(
    () => [
      {
        id: "pout1",
        template: "単体荷物",
        client: "取引先A",
        name: "出荷：単体荷物(取引先A)",
        w: 0.4,
        d: 0.3,
        h: 0.25,
        qty: 20,
        eta: "10:00",
      },
      {
        id: "pout2",
        template: "パレット",
        client: "取引先C",
        name: "出荷：パレット(取引先C)",
        w: 1.2,
        d: 1.0,
        h: 1.4,
        qty: 4,
        eta: "16:00",
      },
    ],
    []
  );

  const cellPx = layout.floor.cellPx;

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 1600);
  }

  function toWorld(clientX, clientY) {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left - pan.x) / zoom;
    const y = (clientY - r.top - pan.y) / zoom;
    return { x, y };
  }

  function toCell(clientX, clientY) {
    const w = toWorld(clientX, clientY);
    return {
      cx: Math.floor(w.x / cellPx),
      cy: Math.floor(w.y / cellPx),
      wx: w.x,
      wy: w.y,
    };
  }

  function unitFootprintCells(u) {
    // w_cells/h_cellsが設定されている場合はそちらを優先（リサイズ対応）
    if (u.w_cells != null && u.h_cells != null) {
      const fw = Math.max(1, u.w_cells);
      const fd = Math.max(1, u.h_cells);
      return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
    }
    // 従来のメートル単位からの計算
    const fw = Math.max(1, Math.ceil(u.w_m / layout.floor.cell_m_w));
    const fd = Math.max(1, Math.ceil(u.d_m / layout.floor.cell_m_d));
    return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
  }

  function overlapsRect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function occupiedRectsFloor(excludeUnitId = null) {
    const rects = [];
    // racks block floor
    for (const r of layout.racks) rects.push({ x: r.x, y: r.y, w: r.w, h: r.h, kind: "rack", id: r.id });
    // shelves block floor (shelves are separate placement areas) - use visual rect for rotated shelves
    for (const s of (layout.shelves || [])) {
      const vr = getShelfVisualRect(s);
      rects.push({ x: vr.x, y: vr.y, w: vr.w, h: vr.h, kind: "shelf", id: s.id });
    }
    // placed units
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      const fp = unitFootprintCells(u);
      rects.push({ x: u.loc.x, y: u.loc.y, w: fp.w, h: fp.h, kind: "unit", id: u.id });
    }
    return rects;
  }

  function canPlaceOnFloor(u, x, y, excludeUnitId = null) {
    const fp = unitFootprintCells(u);
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;
    if (x < fx || y < fy) return false;
    if (x + fp.w > fx + layout.floor.cols) return false;
    if (y + fp.h > fy + layout.floor.rows) return false;

    const candidate = { x, y, w: fp.w, h: fp.h };
    for (const r of occupiedRectsFloor(excludeUnitId)) {
      if (overlapsRect(candidate, r)) return false;
    }
    return true;
  }

  function findRackSlotAtCell(cx, cy) {
    for (const rack of layout.racks) {
      if (cx < rack.x || cy < rack.y || cx >= rack.x + rack.w || cy >= rack.y + rack.h) continue;
      const localX = cx - rack.x;
      const localY = cy - rack.y;
      const slotW = rack.w / rack.cols;
      const slotH = rack.h / rack.rows;
      const col = Math.floor(localX / slotW);
      const row = Math.floor(localY / slotH);
      const slot = row * rack.cols + col;
      if (slot < 0 || slot >= rack.rows * rack.cols) return null;
      return { rackId: rack.id, slot, row, col };
    }
    return null;
  }

  function isRackSlotFree(rackId, slot, excludeUnitId = null) {
    return !units.some(
      (u) => u.id !== excludeUnitId && u.loc?.kind === "rack" && u.loc.rackId === rackId && u.loc.slot === slot
    );
  }

  // 回転を考慮した棚のワールド座標バウンディングボックス
  function getShelfVisualRect(shelf) {
    const rot = shelf.rotation || 0;
    if (rot === 0) return { x: shelf.x, y: shelf.y, w: shelf.w, h: shelf.h };
    const cx = shelf.x + shelf.w / 2;
    const cy = shelf.y + shelf.h / 2;
    return { x: cx - shelf.h / 2, y: cy - shelf.w / 2, w: shelf.h, h: shelf.w };
  }

  // ワールド座標 → 棚ローカル座標 (逆回転適用)
  function worldToShelfLocal(shelf, worldCx, worldCy) {
    const rot = shelf.rotation || 0;
    if (rot === 0) return { localX: worldCx - shelf.x, localY: worldCy - shelf.y };
    const cx = shelf.x + shelf.w / 2;
    const cy = shelf.y + shelf.h / 2;
    const dx = worldCx - cx, dy = worldCy - cy;
    return { localX: dy + shelf.w / 2, localY: -dx + shelf.h / 2 };
  }

  // 棚ローカル座標 → ワールド座標 (正回転適用)
  function shelfLocalToWorld(shelf, localX, localY) {
    const rot = shelf.rotation || 0;
    if (rot === 0) return { worldX: shelf.x + localX, worldY: shelf.y + localY };
    const dx = localX - shelf.w / 2, dy = localY - shelf.h / 2;
    const cx = shelf.x + shelf.w / 2;
    const cy = shelf.y + shelf.h / 2;
    return { worldX: cx - dy, worldY: cy + dx };
  }

  function findShelfAtCell(cx, cy) {
    for (const shelf of (layout.shelves || [])) {
      const vr = getShelfVisualRect(shelf);
      if (cx >= vr.x && cx < vr.x + vr.w && cy >= vr.y && cy < vr.y + vr.h) {
        return shelf;
      }
    }
    return null;
  }

  function occupiedRectsOnShelf(shelfId, excludeUnitId = null) {
    const rects = [];
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "shelf" || u.loc.shelfId !== shelfId) continue;
      const fp = unitFootprintCells(u);
      rects.push({ x: u.loc.x, y: u.loc.y, w: fp.w, h: fp.h, kind: "unit", id: u.id });
    }
    return rects;
  }

  function canPlaceOnShelf(shelfId, u, localX, localY, excludeUnitId = null) {
    const shelf = (layout.shelves || []).find((s) => s.id === shelfId);
    if (!shelf) return false;
    const fp = unitFootprintCells(u);
    if (localX < 0 || localY < 0) return false;
    if (localX + fp.w > shelf.w) return false;
    if (localY + fp.h > shelf.h) return false;

    const candidate = { x: localX, y: localY, w: fp.w, h: fp.h };
    for (const r of occupiedRectsOnShelf(shelfId, excludeUnitId)) {
      if (overlapsRect(candidate, r)) return false;
    }
    return true;
  }

  function beginPan(e) {
    setDrag({ type: "pan", startX: e.clientX, startY: e.clientY, basePan: { ...pan } });
  }

  function beginMoveUnit(e, unitId) {
    e.stopPropagation();
    const u = units.find((x) => x.id === unitId);
    if (!u) return;

    // If this unit is part of a multi-selection, start group move
    if (selectionSet.length > 1 && isItemSelected("unit", unitId)) {
      setDrag({
        type: "group_move",
        startX: e.clientX,
        startY: e.clientY,
        pointerX: e.clientX,
        pointerY: e.clientY,
      });
      return;
    }

    setSelected({ kind: "unit", id: unitId });
    setMultiSelected([]);
    // Calculate grab offset: where within the unit the user clicked (in cell coords)
    const { cx, cy } = toCell(e.clientX, e.clientY);
    let unitWorldX = 0, unitWorldY = 0;
    if (u.loc.kind === "floor") {
      unitWorldX = u.loc.x;
      unitWorldY = u.loc.y;
    } else if (u.loc.kind === "shelf") {
      const shelf = (layout.shelves || []).find((s) => s.id === u.loc.shelfId);
      if (shelf) {
        const wp = shelfLocalToWorld(shelf, u.loc.x, u.loc.y);
        unitWorldX = wp.worldX;
        unitWorldY = wp.worldY;
      }
    }
    const offsetCx = cx - unitWorldX;
    const offsetCy = cy - unitWorldY;
    setDrag({
      type: "move_unit",
      unitId,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      baseLoc: u.loc,
      offsetCx,
      offsetCy,
    });
  }

  function beginMoveFloor(e) {
    e.stopPropagation();
    setSelected({ kind: "floor" });
    setDrag({
      type: "move_floor",
      startX: e.clientX,
      startY: e.clientY,
      baseRect: { x: layout.floor.x || 0, y: layout.floor.y || 0 },
    });
  }

  function beginMoveZone(e, id) {
    e.stopPropagation();
    const z = layout.zones.find((x) => x.id === id);
    if (!z) return;
    if (selectionSet.length > 1 && isItemSelected("zone", id)) {
      setDrag({ type: "group_move", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
      return;
    }
    setSelected({ kind: "zone", id });
    setMultiSelected([]);
    setDrag({ type: "move_zone", id, startX: e.clientX, startY: e.clientY, baseRect: { ...z } });
  }

  function beginResizeZone(e, id, corner = "se") {
    e.stopPropagation();
    const z = layout.zones.find((x) => x.id === id);
    if (!z) return;
    setSelected({ kind: "zone", id });
    setDrag({ type: "resize_zone", id, corner, startX: e.clientX, startY: e.clientY, baseRect: { ...z } });
  }

  function beginMoveRack(e, id) {
    e.stopPropagation();
    const r = layout.racks.find((x) => x.id === id);
    if (!r) return;
    if (selectionSet.length > 1 && isItemSelected("rack", id)) {
      setDrag({ type: "group_move", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
      return;
    }
    setSelected({ kind: "rack", id });
    setMultiSelected([]);
    setDrag({ type: "move_rack", id, startX: e.clientX, startY: e.clientY, baseRect: { ...r } });
  }

  function beginResizeRack(e, id, corner = "se") {
    e.stopPropagation();
    const r = layout.racks.find((x) => x.id === id);
    if (!r) return;
    setSelected({ kind: "rack", id });
    setDrag({ type: "resize_rack", id, corner, startX: e.clientX, startY: e.clientY, baseRect: { ...r } });
  }

  function beginMoveShelf(e, id) {
    e.stopPropagation();
    const s = (layout.shelves || []).find((x) => x.id === id);
    if (!s) return;
    if (selectionSet.length > 1 && isItemSelected("shelf", id)) {
      setDrag({ type: "group_move", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
      return;
    }
    setSelected({ kind: "shelf", id });
    setMultiSelected([]);
    setDrag({ type: "move_shelf", id, startX: e.clientX, startY: e.clientY, baseRect: { ...s } });
  }

  function beginResizeShelf(e, id, corner = "se") {
    e.stopPropagation();
    const s = (layout.shelves || []).find((x) => x.id === id);
    if (!s) return;
    setSelected({ kind: "shelf", id });
    setDrag({ type: "resize_shelf", id, corner, startX: e.clientX, startY: e.clientY, baseRect: { ...s } });
  }

  function beginMovePanel(e, id) {
    e.stopPropagation();
    const p = panels.find((x) => x.id === id);
    if (!p) return;
    if (selectionSet.length > 1 && isItemSelected("panel", id)) {
      setDrag({ type: "group_move", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
      return;
    }
    setSelected({ kind: "panel", id });
    setMultiSelected([]);
    setDrag({ type: "move_panel", id, startX: e.clientX, startY: e.clientY, baseRect: { ...p } });
  }

  function beginResizePanel(e, id, corner = "se") {
    e.stopPropagation();
    const p = panels.find((x) => x.id === id);
    if (!p) return;
    setSelected({ kind: "panel", id });
    setDrag({ type: "resize_panel", id, corner, startX: e.clientX, startY: e.clientY, baseRect: { ...p } });
  }

  function beginResizeFloor(e, corner) {
    e.stopPropagation();
    setDrag({
      type: "resize_floor",
      corner,
      startX: e.clientX,
      startY: e.clientY,
      baseRect: { cols: layout.floor.cols, rows: layout.floor.rows },
    });
  }

  function rotateFloor() {
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;
    const cols = layout.floor.cols;
    const rows = layout.floor.rows;
    // 床中心を基準に90度時計回り回転
    const centerX = fx + cols / 2;
    const centerY = fy + rows / 2;

    function rotatePoint(x, y, w, h) {
      const itemCx = x + w / 2;
      const itemCy = y + h / 2;
      const dx = itemCx - centerX;
      const dy = itemCy - centerY;
      const newCx = centerX - dy;
      const newCy = centerY + dx;
      return { x: Math.round(newCx - h / 2), y: Math.round(newCy - w / 2) };
    }

    // 床のcols/rows入れ替え、中心を維持するためにx/y調整
    const newFx = Math.round(centerX - rows / 2);
    const newFy = Math.round(centerY - cols / 2);

    setLayout((prev) => ({
      ...prev,
      floor: {
        ...prev.floor,
        cols: rows,
        rows: cols,
        x: newFx,
        y: newFy,
        rotation: 0,
      },
      zones: prev.zones.map((z) => {
        const p = rotatePoint(z.x, z.y, z.w, z.h);
        return { ...z, x: p.x, y: p.y, w: z.h, h: z.w };
      }),
      racks: prev.racks.map((r) => {
        const p = rotatePoint(r.x, r.y, r.w, r.h);
        return { ...r, x: p.x, y: p.y, w: r.h, h: r.w };
      }),
    }));

    // 床上ユニットの回転
    setUnits((prev) => prev.map((u) => {
      if (u.loc?.kind !== "floor") return u;
      const fp = unitFootprintCells(u);
      const p = rotatePoint(u.loc.x, u.loc.y, fp.w, fp.h);
      return { ...u, loc: { ...u.loc, x: p.x, y: p.y }, rot: !u.rot };
    }));

    // 配電盤の回転
    setPanels((prev) => prev.map((p) => {
      const rp = rotatePoint(p.x, p.y, p.w, p.h);
      return { ...p, x: rp.x, y: rp.y, w: p.h, h: p.w };
    }));
  }

  function rotateShelf(id) {
    setLayout((prev) => ({
      ...prev,
      shelves: (prev.shelves || []).map((s) =>
        s.id === id ? { ...s, rotation: (s.rotation || 0) === 0 ? 90 : 0 } : s
      ),
    }));
  }

  function beginPlaceNew(e, draftUnit) {
    e.stopPropagation();
    clearSelection();
    setDrag({
      type: "place_new",
      draftUnit,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
    });
  }

  function beginResizeUnit(e, unitId) {
    e.stopPropagation();
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    setSelected({ kind: "unit", id: unitId });
    const fp = unitFootprintCells(u);
    setDrag({
      type: "resize_unit",
      unitId,
      startX: e.clientX,
      startY: e.clientY,
      baseSize: { w: fp.w, h: fp.h },
      baseLoc: u.loc,
    });
  }

  function updateDrag(e) {
    if (!drag) return;

    if (drag.type === "pan") {
      setPan({
        x: drag.basePan.x + (e.clientX - drag.startX),
        y: drag.basePan.y + (e.clientY - drag.startY),
      });
      return;
    }

    if (drag.type === "place_new") {
      setDrag((d) => (d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d));
      return;
    }

    if (drag.type === "rubber_band") {
      setDrag((d) => (d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d));
      return;
    }

    if (drag.type === "group_move") {
      setDrag((d) => (d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d));
      return;
    }

    const dx = Math.round((e.clientX - drag.startX) / zoom / cellPx);
    const dy = Math.round((e.clientY - drag.startY) / zoom / cellPx);

    if (drag.type === "move_unit") {
      // ドラッグ中はワールド座標で位置を更新（床・棚間の移動に対応）
      setDrag((d) => d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d);
      return;
    }

    if (drag.type === "resize_unit") {
      const newW = Math.max(1, drag.baseSize.w + dx);
      const newH = Math.max(1, drag.baseSize.h + dy);
      setUnits((prev) =>
        prev.map((u) =>
          u.id === drag.unitId ? { ...u, w_cells: newW, h_cells: newH } : u
        )
      );
      return;
    }

    if (drag.type === "move_floor") {
      setLayout((prev) => ({
        ...prev,
        floor: {
          ...prev.floor,
          x: drag.baseRect.x + dx,
          y: drag.baseRect.y + dy,
        },
      }));
      return;
    }

    if (drag.type === "move_zone" || drag.type === "resize_zone") {
      setLayout((prev) => {
        const zones = prev.zones.map((z) => {
          if (z.id !== drag.id) return z;
          if (drag.type === "move_zone") {
            return {
              ...z,
              x: drag.baseRect.x + dx,
              y: drag.baseRect.y + dy,
            };
          }
          // 4隅リサイズ対応
          const corner = drag.corner || "se";
          let newX = drag.baseRect.x;
          let newY = drag.baseRect.y;
          let newW = drag.baseRect.w;
          let newH = drag.baseRect.h;

          if (corner.includes("e")) newW = Math.max(2, drag.baseRect.w + dx);
          if (corner.includes("w")) {
            newW = Math.max(2, drag.baseRect.w - dx);
            newX = drag.baseRect.x + drag.baseRect.w - newW;
          }
          if (corner.includes("s")) newH = Math.max(2, drag.baseRect.h + dy);
          if (corner.includes("n")) {
            newH = Math.max(2, drag.baseRect.h - dy);
            newY = drag.baseRect.y + drag.baseRect.h - newH;
          }

          return { ...z, x: newX, y: newY, w: newW, h: newH };
        });
        return { ...prev, zones };
      });
      return;
    }

    if (drag.type === "move_rack" || drag.type === "resize_rack") {
      setLayout((prev) => {
        const racks = prev.racks.map((r) => {
          if (r.id !== drag.id) return r;
          if (drag.type === "move_rack") {
            return {
              ...r,
              x: drag.baseRect.x + dx,
              y: drag.baseRect.y + dy,
            };
          }
          // 4隅リサイズ対応
          const corner = drag.corner || "se";
          let newX = drag.baseRect.x;
          let newY = drag.baseRect.y;
          let newW = drag.baseRect.w;
          let newH = drag.baseRect.h;

          if (corner.includes("e")) newW = Math.max(4, drag.baseRect.w + dx);
          if (corner.includes("w")) {
            newW = Math.max(4, drag.baseRect.w - dx);
            newX = drag.baseRect.x + drag.baseRect.w - newW;
          }
          if (corner.includes("s")) newH = Math.max(3, drag.baseRect.h + dy);
          if (corner.includes("n")) {
            newH = Math.max(3, drag.baseRect.h - dy);
            newY = drag.baseRect.y + drag.baseRect.h - newH;
          }

          return { ...r, x: newX, y: newY, w: newW, h: newH };
        });
        return { ...prev, racks };
      });
      return;
    }

    if (drag.type === "move_shelf" || drag.type === "resize_shelf") {
      setLayout((prev) => {
        const shelves = (prev.shelves || []).map((s) => {
          if (s.id !== drag.id) return s;
          if (drag.type === "move_shelf") {
            return {
              ...s,
              x: drag.baseRect.x + dx,
              y: drag.baseRect.y + dy,
            };
          }
          // 4隅リサイズ対応
          const corner = drag.corner || "se";
          let newX = drag.baseRect.x;
          let newY = drag.baseRect.y;
          let newW = drag.baseRect.w;
          let newH = drag.baseRect.h;

          if (corner.includes("e")) newW = Math.max(2, drag.baseRect.w + dx);
          if (corner.includes("w")) {
            newW = Math.max(2, drag.baseRect.w - dx);
            newX = drag.baseRect.x + drag.baseRect.w - newW;
          }
          if (corner.includes("s")) newH = Math.max(2, drag.baseRect.h + dy);
          if (corner.includes("n")) {
            newH = Math.max(2, drag.baseRect.h - dy);
            newY = drag.baseRect.y + drag.baseRect.h - newH;
          }

          const autoArea = newW * prev.floor.cell_m_w * newH * prev.floor.cell_m_d;
          return {
            ...s,
            x: newX,
            y: newY,
            w: newW,
            h: newH,
            area_m2: s.area_m2_manual ? s.area_m2 : autoArea,
          };
        });
        return { ...prev, shelves };
      });
      return;
    }

    if (drag.type === "move_panel" || drag.type === "resize_panel") {
      setPanels((prev) =>
        prev.map((p) => {
          if (p.id !== drag.id) return p;
          if (drag.type === "move_panel") {
            return {
              ...p,
              x: clamp(drag.baseRect.x + dx, layout.floor.x || 0, (layout.floor.x || 0) + layout.floor.cols - p.w),
              y: clamp(drag.baseRect.y + dy, layout.floor.y || 0, (layout.floor.y || 0) + layout.floor.rows - p.h),
            };
          }
          // 4隅リサイズ対応
          const corner = drag.corner || "se";
          let newX = drag.baseRect.x;
          let newY = drag.baseRect.y;
          let newW = drag.baseRect.w;
          let newH = drag.baseRect.h;

          if (corner.includes("e")) newW = Math.max(1, drag.baseRect.w + dx);
          if (corner.includes("w")) {
            newW = Math.max(1, drag.baseRect.w - dx);
            newX = drag.baseRect.x + drag.baseRect.w - newW;
          }
          if (corner.includes("s")) newH = Math.max(1, drag.baseRect.h + dy);
          if (corner.includes("n")) {
            newH = Math.max(1, drag.baseRect.h - dy);
            newY = drag.baseRect.y + drag.baseRect.h - newH;
          }

          // Clamp resize within floor bounds
          const pfx = layout.floor.x || 0;
          const pfy = layout.floor.y || 0;
          newX = clamp(newX, pfx, pfx + layout.floor.cols - 1);
          newY = clamp(newY, pfy, pfy + layout.floor.rows - 1);
          newW = Math.min(newW, pfx + layout.floor.cols - newX);
          newH = Math.min(newH, pfy + layout.floor.rows - newY);

          return { ...p, x: newX, y: newY, w: newW, h: newH };
        })
      );
      return;
    }

    if (drag.type === "resize_floor") {
      const corner = drag.corner || "se";
      setLayout((prev) => {
        let newCols = drag.baseRect.cols;
        let newRows = drag.baseRect.rows;

        if (corner.includes("e")) newCols = Math.max(10, drag.baseRect.cols + dx);
        if (corner.includes("w")) newCols = Math.max(10, drag.baseRect.cols - dx);
        if (corner.includes("s")) newRows = Math.max(10, drag.baseRect.rows + dy);
        if (corner.includes("n")) newRows = Math.max(10, drag.baseRect.rows - dy);

        return {
          ...prev,
          floor: { ...prev.floor, cols: Math.round(newCols), rows: Math.round(newRows) },
        };
      });
      return;
    }
  }

  function endDrag() {
    if (!drag) return;

    if (drag.type === "rubber_band") {
      // Calculate world-space rectangle from screen coords
      const c1 = toCell(drag.startX, drag.startY);
      const c2 = toCell(drag.pointerX, drag.pointerY);
      const minCx = Math.min(c1.cx, c2.cx);
      const maxCx = Math.max(c1.cx, c2.cx);
      const minCy = Math.min(c1.cy, c2.cy);
      const maxCy = Math.max(c1.cy, c2.cy);

      const newSelection = [];
      // Check floor units
      for (const u of units) {
        if (u.loc?.kind === "floor") {
          const fp = unitFootprintCells(u);
          if (u.loc.x < maxCx + 1 && u.loc.x + fp.w > minCx && u.loc.y < maxCy + 1 && u.loc.y + fp.h > minCy) {
            newSelection.push({ kind: "unit", id: u.id });
          }
        }
      }
      // Check panels
      for (const p of panels) {
        if (p.x < maxCx + 1 && p.x + p.w > minCx && p.y < maxCy + 1 && p.y + p.h > minCy) {
          newSelection.push({ kind: "panel", id: p.id });
        }
      }
      // Check zones (layout mode)
      if (mode === "layout") {
        for (const z of layout.zones) {
          if (z.x < maxCx + 1 && z.x + z.w > minCx && z.y < maxCy + 1 && z.y + z.h > minCy) {
            newSelection.push({ kind: "zone", id: z.id });
          }
        }
        for (const r of layout.racks) {
          if (r.x < maxCx + 1 && r.x + r.w > minCx && r.y < maxCy + 1 && r.y + r.h > minCy) {
            newSelection.push({ kind: "rack", id: r.id });
          }
        }
        for (const s of (layout.shelves || [])) {
          const vr = getShelfVisualRect(s);
          if (vr.x < maxCx + 1 && vr.x + vr.w > minCx && vr.y < maxCy + 1 && vr.y + vr.h > minCy) {
            newSelection.push({ kind: "shelf", id: s.id });
          }
        }
      }

      if (newSelection.length > 0) {
        setSelected(newSelection[0]);
        setMultiSelected(newSelection.slice(1));
      }
      setDrag(null);
      return;
    }

    if (drag.type === "group_move") {
      const dx = Math.round((drag.pointerX - drag.startX) / zoom / cellPx);
      const dy = Math.round((drag.pointerY - drag.startY) / zoom / cellPx);
      if (dx !== 0 || dy !== 0) {
        const items = selectionSet;
        // Move units (floor only for simplicity)
        const unitIds = new Set(items.filter((s) => s.kind === "unit").map((s) => s.id));
        if (unitIds.size > 0) {
          setUnits((prev) => prev.map((u) => {
            if (!unitIds.has(u.id)) return u;
            if (u.loc?.kind === "floor") {
              return { ...u, loc: { ...u.loc, x: u.loc.x + dx, y: u.loc.y + dy } };
            }
            return u;
          }));
        }
        // Move panels
        const panelIds = new Set(items.filter((s) => s.kind === "panel").map((s) => s.id));
        if (panelIds.size > 0) {
          setPanels((prev) => prev.map((p) => {
            if (!panelIds.has(p.id)) return p;
            const gfx = layout.floor.x || 0; const gfy = layout.floor.y || 0;
            return { ...p, x: clamp(p.x + dx, gfx, gfx + layout.floor.cols - p.w), y: clamp(p.y + dy, gfy, gfy + layout.floor.rows - p.h) };
          }));
        }
        // Move layout items (layout mode)
        if (mode === "layout") {
          setLayout((prev) => {
            let zones = prev.zones;
            let racks = prev.racks;
            let shelves = prev.shelves || [];
            const zoneIds = new Set(items.filter((s) => s.kind === "zone").map((s) => s.id));
            const rackIds = new Set(items.filter((s) => s.kind === "rack").map((s) => s.id));
            const shelfIds = new Set(items.filter((s) => s.kind === "shelf").map((s) => s.id));
            if (zoneIds.size > 0) zones = zones.map((z) => zoneIds.has(z.id) ? { ...z, x: z.x + dx, y: z.y + dy } : z);
            if (rackIds.size > 0) racks = racks.map((r) => rackIds.has(r.id) ? { ...r, x: r.x + dx, y: r.y + dy } : r);
            if (shelfIds.size > 0) shelves = shelves.map((s) => shelfIds.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s);
            return { ...prev, zones, racks, shelves };
          });
        }
      }
      setDrag(null);
      return;
    }

    if (drag.type === "move_floor") {
      // 床移動完了時、床上の全オブジェクトも同じ距離だけ移動
      const totalDx = (layout.floor.x || 0) - (drag.baseRect.x || 0);
      const totalDy = (layout.floor.y || 0) - (drag.baseRect.y || 0);
      if (totalDx !== 0 || totalDy !== 0) {
        setUnits((prev) => prev.map((u) => {
          if (u.loc?.kind !== "floor") return u;
          return { ...u, loc: { ...u.loc, x: u.loc.x + totalDx, y: u.loc.y + totalDy } };
        }));
        setLayout((prev) => ({
          ...prev,
          zones: prev.zones.map((z) => ({ ...z, x: z.x + totalDx, y: z.y + totalDy })),
          racks: prev.racks.map((r) => ({ ...r, x: r.x + totalDx, y: r.y + totalDy })),
        }));
        setPanels((prev) => prev.map((p) => ({ ...p, x: p.x + totalDx, y: p.y + totalDy })));
      }
      setDrag(null);
      return;
    }

    if (drag.type === "place_new") {
      const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
      const u = drag.draftUnit;

      // Try rack slot first if hovering rack
      const slot = findRackSlotAtCell(cx, cy);
      if (slot && isRackSlotFree(slot.rackId, slot.slot)) {
        const created = {
          ...u,
          id: "u-" + uid(),
          loc: { kind: "rack", rackId: slot.rackId, slot: slot.slot },
        };
        setUnits((prev) => [...prev, created]);
        setDrag(null);
        return;
      }

      // Try shelf placement if hovering shelf
      const shelf = findShelfAtCell(cx, cy);
      if (shelf) {
        const local = worldToShelfLocal(shelf, cx, cy);
        const fp = unitFootprintCells(u);
        const clampedX = clamp(Math.floor(local.localX), 0, shelf.w - fp.w);
        const clampedY = clamp(Math.floor(local.localY), 0, shelf.h - fp.h);
        if (canPlaceOnShelf(shelf.id, u, clampedX, clampedY)) {
          const created = {
            ...u,
            id: "u-" + uid(),
            loc: { kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY },
          };
          setUnits((prev) => [...prev, created]);
          setDrag(null);
          return;
        } else {
          showToast("棚上のこの位置には置けません");
          setDrag(null);
          return;
        }
      }

      // Floor place
      const fp = unitFootprintCells(u);
      const fx = layout.floor.x || 0;
      const fy = layout.floor.y || 0;
      const px = clamp(cx, fx, fx + layout.floor.cols - fp.w);
      const py = clamp(cy, fy, fy + layout.floor.rows - fp.h);
      if (!canPlaceOnFloor(u, px, py)) {
        showToast("ここには置けません（他の荷物/棚と重なっています）");
        setDrag(null);
        return;
      }
      const created = {
        ...u,
        id: "u-" + uid(),
        loc: { kind: "floor", x: px, y: py },
      };
      setUnits((prev) => [...prev, created]);
      setDrag(null);
      return;
    }

    if (drag.type === "move_unit") {
      const u = unitsRef.current.find((x) => x.id === drag.unitId);
      if (!u) {
        setDrag(null);
        return;
      }

      const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
      const fp = unitFootprintCells(u);
      // Apply grab offset so the unit's top-left aligns consistently with visual position
      const dropX = cx - (drag.offsetCx || 0);
      const dropY = cy - (drag.offsetCy || 0);

      // Check if dropped on a shelf (detect at pointer position)
      const shelf = findShelfAtCell(cx, cy);
      if (shelf) {
        const local = worldToShelfLocal(shelf, dropX, dropY);
        const clampedX = clamp(Math.floor(local.localX), 0, shelf.w - fp.w);
        const clampedY = clamp(Math.floor(local.localY), 0, shelf.h - fp.h);

        if (canPlaceOnShelf(shelf.id, u, clampedX, clampedY, u.id)) {
          setUnits((prev) => prev.map((x) =>
            x.id === u.id ? { ...x, loc: { kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY } } : x
          ));
          setDrag(null);
          return;
        } else {
          showToast("棚上のこの位置には置けません");
          setDrag(null);
          return;
        }
      }

      // Check if dropped on floor
      const fx = layout.floor.x || 0;
      const fy = layout.floor.y || 0;
      const floorX = clamp(dropX, fx, fx + layout.floor.cols - fp.w);
      const floorY = clamp(dropY, fy, fy + layout.floor.rows - fp.h);

      // Check if unit's target area overlaps with floor
      if (floorX + fp.w > fx && floorY + fp.h > fy && floorX < fx + layout.floor.cols && floorY < fy + layout.floor.rows) {
        if (canPlaceOnFloor(u, floorX, floorY, u.id)) {
          setUnits((prev) => prev.map((x) =>
            x.id === u.id ? { ...x, loc: { kind: "floor", x: floorX, y: floorY } } : x
          ));
          setDrag(null);
          return;
        }
      }

      // Can't place, revert to original location
      showToast("ここには置けません");
      setDrag(null);
      return;
    }

    setDrag(null);
  }

  useEffect(() => {
    const onMove = (e) => {
      pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (rafMoveRef.current) return;
      rafMoveRef.current = window.requestAnimationFrame(() => {
        const p = pendingMoveRef.current;
        pendingMoveRef.current = null;
        rafMoveRef.current = null;
        if (p) updateDrag(p);
      });
    };

    const onUp = () => {
      if (rafMoveRef.current) {
        window.cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
        pendingMoveRef.current = null;
      }
      endDrag();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafMoveRef.current) {
        window.cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
        pendingMoveRef.current = null;
      }
    };
  }, [drag, zoom, cellPx, layout, selectionSet, mode, panels]);

  // Recompute & push stats to top map
  useEffect(() => {
    const placed = units.filter((u) => u.loc?.kind === "floor" || u.loc?.kind === "rack");
    const occupancy_m2 = placed.reduce((s, u) => s + u.w_m * u.d_m * (u.qty || 1), 0);
    const occupancy_m3 = placed.reduce((s, u) => s + u.w_m * u.d_m * u.h_m * (u.qty || 1), 0);
    onUpdateWarehouse?.(wh.id, {
      rack_count: layout.racks.length,
      occupancy_m2: Math.round(occupancy_m2),
      occupancy_m3: Math.round(occupancy_m3),
    });
  }, [units, layout.racks.length, onUpdateWarehouse, wh.id]);

  const selectedEntity = useMemo(() => {
    if (!selected) return null;
    if (selected.kind === "unit") return units.find((u) => u.id === selected.id) || null;
    if (selected.kind === "zone") return layout.zones.find((z) => z.id === selected.id) || null;
    if (selected.kind === "rack") return layout.racks.find((r) => r.id === selected.id) || null;
    if (selected.kind === "shelf") return (layout.shelves || []).find((s) => s.id === selected.id) || null;
    if (selected.kind === "panel") return panels.find((p) => p.id === selected.id) || null;
    if (selected.kind === "floor") return layout.floor;
    return null;
  }, [selected, units, layout, panels]);

  const clientUsage = useMemo(() => {
    const acc = new Map();
    for (const u of units) {
      if (!(u.loc?.kind === "floor" || u.loc?.kind === "rack")) continue;
      const k = u.client || "(未設定)";
      const prev = acc.get(k) || { m2: 0, m3: 0, count: 0 };
      prev.m2 += u.w_m * u.d_m * (u.qty || 1);
      prev.m3 += u.w_m * u.d_m * u.h_m * (u.qty || 1);
      prev.count += 1;
      acc.set(k, prev);
    }
    return [...acc.entries()]
      .map(([client, v]) => ({ client, ...v }))
      .sort((a, b) => b.m2 - a.m2);
  }, [units]);

  function addZone() {
    const defaultBgColors = ["#d1fae5", "#fef3c7", "#cffafe", "#fce7f3", "#ede9fe", "#ecfccb", "#dbeafe", "#fee2e2"];
    const bgColor = defaultBgColors[layout.zones.length % defaultBgColors.length];
    const zfx = layout.floor.x || 0;
    const zfy = layout.floor.y || 0;
    setLayout((prev) => ({
      ...prev,
      zones: [...prev.zones, { id: "z-" + uid(), name: "新規区画", client: "取引先A", x: zfx + 3, y: zfy + 3, w: 8, h: 5, labelColor: "#000000", bgColor, bgOpacity: 90 }],
    }));
  }

  function addRack() {
    const defaultBgColors = ["#f1f5f9", "#e2e8f0", "#f5f5f4", "#fef3c7", "#ecfccb", "#cffafe"];
    const bgColor = defaultBgColors[layout.racks.length % defaultBgColors.length];
    const rfx = layout.floor.x || 0;
    const rfy = layout.floor.y || 0;
    setLayout((prev) => ({
      ...prev,
      racks: [
        ...prev.racks,
        { id: "r-" + uid(), name: `ラック${prev.racks.length + 1}`, x: rfx + 20, y: rfy + 4, w: 10, h: 6, rows: 3, cols: 5, labelColor: "#ffffff", bgColor, bgOpacity: 95 },
      ],
    }));
  }

  function addShelf() {
    const colors = Object.keys(SHELF_COLORS);
    const shelvesLen = (layout.shelves || []).length;
    const nextColor = colors[shelvesLen % colors.length];
    const area_m2 = 6 * layout.floor.cell_m_w * 4 * layout.floor.cell_m_d;
    const sfx = layout.floor.x || 0;
    const sfy = layout.floor.y || 0;
    setLayout((prev) => ({
      ...prev,
      shelves: [
        ...(prev.shelves || []),
        {
          id: "s-" + uid(),
          name: `棚${shelvesLen + 1}`,
          x: sfx + 14,
          y: sfy + 4,
          w: 6,
          h: 4,
          area_m2: area_m2,
          area_m2_manual: false,
          color: nextColor,
          bgColor: "#f0fdfa",
          cellGridColor: "#000000",
          cellGridOpacity: 30,
          tsuboGridColor: "#3b82f6",
          tsuboGridOpacity: 60,
          labelColor: "#000000",
        },
      ],
    }));
  }

  function addPanel() {
    const panelW = 2, panelH = 2;
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;
    const panelX = clamp(fx + 5, fx, fx + layout.floor.cols - panelW);
    const panelY = clamp(fy + 5, fy, fy + layout.floor.rows - panelH);
    setPanels((prev) => [
      ...prev,
      {
        id: "p-" + uid(),
        name: `配電盤${prev.length + 1}`,
        x: panelX,
        y: panelY,
        w: panelW,
        h: panelH,
        bgColor: "#fef3c7",
        bgOpacity: 90,
        labelColor: "#000000",
        // 詳細情報
        kintoneRecordId: "",
        client: "",
        projectName: "",
        arrivalDate: null,
        departureDate: null,
        departureHistory: [],
        contents: [],
        notes: "",
      },
    ]);
  }

  function removeSelected() {
    const items = selectionSet;
    if (items.length === 0) return;

    const unitIds = new Set(items.filter((s) => s.kind === "unit").map((s) => s.id));
    const zoneIds = new Set(items.filter((s) => s.kind === "zone").map((s) => s.id));
    const rackIds = new Set(items.filter((s) => s.kind === "rack").map((s) => s.id));
    const shelfIds = new Set(items.filter((s) => s.kind === "shelf").map((s) => s.id));
    const panelIds = new Set(items.filter((s) => s.kind === "panel").map((s) => s.id));

    if (unitIds.size > 0) {
      setUnits((prev) => prev.filter((u) => !unitIds.has(u.id)));
    }
    if (rackIds.size > 0) {
      // Move units in deleted racks to unplaced
      setUnits((prev) =>
        prev.map((u) => (u.loc?.kind === "rack" && rackIds.has(u.loc.rackId) ? { ...u, loc: { kind: "unplaced" } } : u))
      );
    }
    if (zoneIds.size > 0 || rackIds.size > 0 || shelfIds.size > 0) {
      setLayout((prev) => ({
        ...prev,
        zones: zoneIds.size > 0 ? prev.zones.filter((z) => !zoneIds.has(z.id)) : prev.zones,
        racks: rackIds.size > 0 ? prev.racks.filter((r) => !rackIds.has(r.id)) : prev.racks,
        shelves: shelfIds.size > 0 ? (prev.shelves || []).filter((s) => !shelfIds.has(s.id)) : (prev.shelves || []),
      }));
    }
    if (panelIds.size > 0) {
      setPanels((prev) => prev.filter((p) => !panelIds.has(p.id)));
    }
    clearSelection();
  }

  function rotateSelectedGroup() {
    const items = selectionSet;
    if (items.length === 0) return;

    // Calculate bounding box center of all selected items
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of items) {
      if (item.kind === "zone") {
        const z = layout.zones.find((x) => x.id === item.id);
        if (z) { minX = Math.min(minX, z.x); minY = Math.min(minY, z.y); maxX = Math.max(maxX, z.x + z.w); maxY = Math.max(maxY, z.y + z.h); }
      } else if (item.kind === "rack") {
        const r = layout.racks.find((x) => x.id === item.id);
        if (r) { minX = Math.min(minX, r.x); minY = Math.min(minY, r.y); maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h); }
      } else if (item.kind === "shelf") {
        const s = (layout.shelves || []).find((x) => x.id === item.id);
        if (s) {
          const vr = getShelfVisualRect(s);
          minX = Math.min(minX, vr.x); minY = Math.min(minY, vr.y); maxX = Math.max(maxX, vr.x + vr.w); maxY = Math.max(maxY, vr.y + vr.h);
        }
      } else if (item.kind === "unit") {
        const u = units.find((x) => x.id === item.id);
        if (u?.loc?.kind === "floor") {
          const fp = unitFootprintCells(u);
          minX = Math.min(minX, u.loc.x); minY = Math.min(minY, u.loc.y); maxX = Math.max(maxX, u.loc.x + fp.w); maxY = Math.max(maxY, u.loc.y + fp.h);
        }
      } else if (item.kind === "panel") {
        const p = panels.find((x) => x.id === item.id);
        if (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); }
      }
    }

    if (!isFinite(minX)) return;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // Rotate each item 90 degrees clockwise around the center
    function rotatePoint(x, y, w, h) {
      const itemCx = x + w / 2;
      const itemCy = y + h / 2;
      const dx = itemCx - centerX;
      const dy = itemCy - centerY;
      const newCx = centerX - dy;
      const newCy = centerY + dx;
      return { x: Math.round(newCx - h / 2), y: Math.round(newCy - w / 2) };
    }

    const zoneIds = new Set(items.filter((s) => s.kind === "zone").map((s) => s.id));
    const rackIds = new Set(items.filter((s) => s.kind === "rack").map((s) => s.id));
    const shelfIds = new Set(items.filter((s) => s.kind === "shelf").map((s) => s.id));

    if (zoneIds.size > 0 || rackIds.size > 0 || shelfIds.size > 0) {
      setLayout((prev) => ({
        ...prev,
        zones: prev.zones.map((z) => {
          if (!zoneIds.has(z.id)) return z;
          const p = rotatePoint(z.x, z.y, z.w, z.h);
          return { ...z, x: p.x, y: p.y, w: z.h, h: z.w };
        }),
        racks: prev.racks.map((r) => {
          if (!rackIds.has(r.id)) return r;
          const p = rotatePoint(r.x, r.y, r.w, r.h);
          return { ...r, x: p.x, y: p.y, w: r.h, h: r.w };
        }),
        shelves: (prev.shelves || []).map((s) => {
          if (!shelfIds.has(s.id)) return s;
          const vr = getShelfVisualRect(s);
          const p = rotatePoint(vr.x, vr.y, vr.w, vr.h);
          const newRot = (s.rotation || 0) === 0 ? 90 : 0;
          return { ...s, x: p.x, y: p.y, rotation: newRot };
        }),
      }));
    }

    // Rotate floor units
    const unitIds = new Set(items.filter((s) => s.kind === "unit").map((s) => s.id));
    if (unitIds.size > 0) {
      setUnits((prev) => prev.map((u) => {
        if (!unitIds.has(u.id)) return u;
        if (u.loc?.kind !== "floor") return u;
        const fp = unitFootprintCells(u);
        const p = rotatePoint(u.loc.x, u.loc.y, fp.w, fp.h);
        return { ...u, loc: { ...u.loc, x: p.x, y: p.y }, rot: !u.rot };
      }));
    }

    // Rotate panels
    const panelIds = new Set(items.filter((s) => s.kind === "panel").map((s) => s.id));
    if (panelIds.size > 0) {
      setPanels((prev) => prev.map((p) => {
        if (!panelIds.has(p.id)) return p;
        const rp = rotatePoint(p.x, p.y, p.w, p.h);
        return { ...p, x: rp.x, y: rp.y, w: p.h, h: p.w };
      }));
    }
  }

  function createUnitFromForm() {
    const w = Number(form.w);
    const d = Number(form.d);
    const h = Number(form.h);
    const qty = Math.max(1, Number(form.qty) || 1);
    const name = form.name || `${template}（${form.client || "取引先"}）`;
    if (!Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h)) {
      showToast("サイズ（W/D/H）を数値で入力してください");
      return;
    }
    const u = {
  id: "u-" + uid(),
  kind: template,
  client: form.client || "(未設定)",
  name,
  w_m: w,
  d_m: d,
  h_m: h,
  qty,
  status: "draft",
  condition: "good",
  rot: false,
  loc: { kind: "unplaced" },

  // ========== 基本情報 ==========
  sku: form.sku || "",
  barcode: form.barcode || "",
  batch_number: form.batch_number || "",
  weight_kg: Number(form.weight_kg) || 0,
  temperature_zone: form.temperature_zone || "ambient",
  fragile: form.fragile || false,
  stackable: form.stackable !== false,
  max_stack_height: Number(form.max_stack_height) || 1,
  expires_at: form.expires_at || null,
  notes: form.notes || "",
  arrived_at: null,
  moves: [],
  tags: [],

  // ========== 拡張フィールド ==========
  kintoneRecordId: "",
  projectName: "",
  arrivalDate: null,
  departureDate: null,
  departureHistory: [],  // [{date, quantity, destination, notes}]
  contents: [],          // [{name, quantity}]

  // ========== 見た目 ==========
  bgColor: "",
  bgOpacity: 100,
  labelColor: "",
};
    setUnits((prev) => [u, ...prev]);
    setSelected({ kind: "unit", id: u.id });
    showToast("右の一覧に作成しました（ドラッグで配置）");
  }

  function startDragExistingUnitFromList(e, unitId) {
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const draft = { ...u, id: "__draft__", loc: { kind: "unplaced" } };
    beginPlaceNew(e, draft);
  }

  function startDragPlanned(e, p, status) {
    const draft = {
      id: "__draft__",
      kind: p.template,
      client: p.client,
      name: p.name,
      w_m: p.w,
      d_m: p.d,
      h_m: p.h,
      qty: p.qty,
      status,
      rot: false,
      loc: { kind: "unplaced" },
    };
    beginPlaceNew(e, draft);
  }

  // Wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.08 : 0.92;
      setZoom((prevZoom) => {
        const nextZoom = clamp(prevZoom * factor, 0.6, 2.2);
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        setPan((prevPan) => {
          const wx = (cx - prevPan.x) / prevZoom;
          const wy = (cy - prevPan.y) / prevZoom;
          return { x: cx - wx * nextZoom, y: cy - wy * nextZoom };
        });
        return nextZoom;
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const placedOnFloor = units.filter((u) => u.loc?.kind === "floor");
  const placedInRack = units.filter((u) => u.loc?.kind === "rack");
  const placedOnShelf = units.filter((u) => u.loc?.kind === "shelf");
  const unplaced = units.filter((u) => u.loc?.kind === "unplaced");

  // Group move visual offset (in screen px, not zoomed)
  const groupMoveDx = drag?.type === "group_move" ? (drag.pointerX - drag.startX) / zoom : 0;
  const groupMoveDy = drag?.type === "group_move" ? (drag.pointerY - drag.startY) / zoom : 0;
  const groupMoveTransform = drag?.type === "group_move" ? `translate(${groupMoveDx}px, ${groupMoveDy}px)` : undefined;

  // Calculate world bounds including floor and all shelves
  const worldBounds = useMemo(() => {
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;
    let minX = fx;
    let minY = fy;
    let maxX = fx + layout.floor.cols;
    let maxY = fy + layout.floor.rows;

    for (const s of (layout.shelves || [])) {
      const vr = getShelfVisualRect(s);
      minX = Math.min(minX, vr.x);
      minY = Math.min(minY, vr.y);
      maxX = Math.max(maxX, vr.x + vr.w);
      maxY = Math.max(maxY, vr.y + vr.h);
    }

    // Add padding around all objects
    const padding = 10;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    };
  }, [layout.floor.cols, layout.floor.rows, layout.floor.x, layout.floor.y, layout.shelves]);

  return (
    <div className="h-screen w-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
            onClick={onBack}
            type="button"
          >
            ← TOPへ戻る
          </button>
          <div>
            <div className="text-sm text-gray-500">倉庫内部（ドラッグ&ドロップ簡易デモ）</div>
            <div className="text-lg font-semibold">{wh.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm">ズーム {Math.round(zoom * 100)}%</div>
          <button
            className={
              "rounded-xl border px-3 py-2 text-sm shadow-sm " +
              (mode === "operate" ? "bg-black text-white" : "bg-white hover:bg-gray-50")
            }
            onClick={() => setMode("operate")}
            type="button"
          >
            運用
          </button>
          <button
            className={
              "rounded-xl border px-3 py-2 text-sm shadow-sm " +
              (mode === "layout" ? "bg-black text-white" : "bg-white hover:bg-gray-50")
            }
            onClick={() => setMode("layout")}
            type="button"
          >
            レイアウト編集
          </button>
          <button
            className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            type="button"
          >
            表示リセット
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-2xl bg-black px-4 py-2 text-sm text-white shadow">
          {toast}
        </div>
      )}

      {/* Body */}
      <div
        className="flex h-[calc(100vh-64px)] p-4 gap-0"
      >
        {/* Left: Calendar & planned */}
        <div
          className="flex flex-col gap-3 overflow-auto pr-2"
          style={{
            width: leftOpen ? "320px" : "0px",
            minWidth: leftOpen ? "320px" : "0px",
            opacity: leftOpen ? 1 : 0,
            pointerEvents: leftOpen ? "auto" : "none",
            transition: "width 200ms ease, min-width 200ms ease, opacity 150ms ease",
          }}
        >
          <CalendarStub selectedDate={selectedDate} onPick={setSelectedDate} />

          <div className="rounded-2xl border bg-white p-3 shadow-sm">
            <SectionTitle
              right={
                <div className="flex gap-2">
                  <Badge>ドラッグで配置</Badge>
                </div>
              }
            >
              入出荷予定（サンプル）
            </SectionTitle>

            <div className="mb-2 text-xs font-semibold text-gray-500">入荷予定</div>
            <div className="space-y-2">
              {inboundPlanned.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border p-2 text-sm hover:bg-gray-50"
                  onMouseDown={(e) => startDragPlanned(e, p, "planned_in")}
                  role="button"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{p.client}</Badge>
                    <Badge>
                      {p.w}×{p.d}×{p.h}m / qty {p.qty}
                    </Badge>
                    <Badge>予定 {p.eta}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">（押したままドラッグして倉庫に配置）</div>
                </div>
              ))}
            </div>

            <div className="mt-3 mb-2 text-xs font-semibold text-gray-500">出荷予定</div>
            <div className="space-y-2">
              {outboundPlanned.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border p-2 text-sm hover:bg-gray-50"
                  onMouseDown={(e) => startDragPlanned(e, p, "planned_out")}
                  role="button"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge>{p.client}</Badge>
                    <Badge>
                      {p.w}×{p.d}×{p.h}m / qty {p.qty}
                    </Badge>
                    <Badge>予定 {p.eta}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">（押したままドラッグして倉庫に配置）</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-3 shadow-sm">
            <SectionTitle>取引先別 占有（概算）</SectionTitle>
            <div className="space-y-2">
              {clientUsage.length === 0 && <div className="text-sm text-gray-600">まだ配置された荷物がありません。</div>}
              {clientUsage.map((c) => (
                <div key={c.client} className="rounded-xl border p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{c.client}</div>
                    <Badge>{c.count} 件</Badge>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {c.m2.toFixed(2)} m² / {c.m3.toFixed(2)} m³
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Left panel toggle button */}
        <div className="flex items-center justify-center px-1">
          <button
            type="button"
            className="flex items-center justify-center w-6 h-16 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-800 transition-colors shadow-sm border border-gray-300"
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? "左パネルを閉じる" : "左パネルを開く"}
          >
            <span className="text-xs font-bold">{leftOpen ? "«" : "»"}</span>
          </button>
        </div>

        {/* Center: Warehouse canvas */}
        <div className="flex-1 rounded-2xl border bg-white p-3 shadow-sm min-w-0">
          <SectionTitle
            right={
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Shift+ドラッグ: パン</Badge>
                <Badge>ホイール: ズーム</Badge>
                {mode === "layout" ? <Badge>編集: 区画/ラックをドラッグ・リサイズ</Badge> : <Badge>運用: 荷物をドラッグ</Badge>}
              </div>
            }
          >
            倉庫キャンバス
          </SectionTitle>

          <div
            ref={canvasRef}
            className="relative h-full min-h-[640px] w-full overflow-hidden rounded-2xl border bg-gray-50"
            onMouseDown={(e) => {
              if (e.shiftKey) beginPan(e);
              else if (e.ctrlKey || e.metaKey) {
                // Start rubber band selection
                setDrag({ type: "rubber_band", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
              }
              else clearSelection();
            }}
          >
            {/* Grid background */}
            <div
              className="absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)",
                backgroundSize: `${cellPx}px ${cellPx}px`,
              }}
            />

            {/* World layer - large enough to contain all objects including negative coords */}
            <div
              className="absolute"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              {/* Floor boundary - the main floor area - z-index: 1 */}
              <div
                className={`absolute rounded-2xl border-2 border-gray-400 ${mode === "layout" ? "cursor-move" : "cursor-pointer"} ${isItemSelected("floor", undefined) ? "ring-2 ring-black" : ""}`}
                style={{
                  left: (layout.floor.x || 0) * cellPx,
                  top: (layout.floor.y || 0) * cellPx,
                  width: layout.floor.cols * cellPx,
                  height: layout.floor.rows * cellPx,
                  zIndex: 1,
                  backgroundColor: `${layout.floor.floorBgColor || "#ffffff"}80`,
                }}
                onMouseDown={(e) => mode === "layout" && beginMoveFloor(e)}
                onClick={(e) => handleItemClick(e, "floor", undefined)}
              >
                {/* Floor label - large watermark style */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 50,
                  }}
                >
                  {(() => {
                    const labelRgb = hexToRgb(layout.floor.floorLabelColor || "#000000");
                    return (
                      <div
                        style={{
                          fontSize: "6rem",
                          fontWeight: 900,
                          color: `rgba(${labelRgb.join(",")}, 0.08)`,
                          userSelect: "none",
                        }}
                      >
                        床
                      </div>
                    );
                  })()}
                </div>

                {/* 右下リサイズハンドル（三角形）- 回転しても視覚的な右下に維持 */}
                {mode === "layout" && (
                  <div
                    className="absolute cursor-se-resize"
                    style={{
                      bottom: 0,
                      right: 0,
                      width: 0,
                      height: 0,
                      borderStyle: "solid",
                      borderWidth: "0 0 24px 24px",
                      borderColor: "transparent transparent #374151 transparent",
                      zIndex: 100,
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      beginResizeFloor(e, "se");
                    }}
                    title="リサイズ"
                  />
                )}
              </div>


              {/* Floor grid lines */}
              {(() => {
                const floorX = (layout.floor.x || 0) * cellPx;
                const floorY = (layout.floor.y || 0) * cellPx;
                const floorW = layout.floor.cols * cellPx;
                const floorH = layout.floor.rows * cellPx;
                const cellOpacity = (layout.floor.floorCellGridOpacity ?? 10) / 100;
                const cellRgb = hexToRgb(layout.floor.floorCellGridColor || "#000000");
                return (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      left: floorX,
                      top: floorY,
                      width: floorW,
                      height: floorH,
                      backgroundImage:
                        `linear-gradient(to right, rgba(${cellRgb.join(",")},${cellOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${cellRgb.join(",")},${cellOpacity}) 1px, transparent 1px)`,
                      backgroundSize: `${cellPx}px ${cellPx}px`,
                      zIndex: 1,
                    }}
                  />
                );
              })()}

              {/* 1坪グリッド (1坪 ≒ 1.82m × 1.82m) */}
              {layout.floor.showTsuboGrid && (() => {
                const tsuboM = 1.82;
                const tsuboPxW = (tsuboM / layout.floor.cell_m_w) * cellPx;
                const tsuboPxH = (tsuboM / layout.floor.cell_m_d) * cellPx;
                const floorX = (layout.floor.x || 0) * cellPx;
                const floorY = (layout.floor.y || 0) * cellPx;
                const floorW = layout.floor.cols * cellPx;
                const floorH = layout.floor.rows * cellPx;
                const tsuboOpacity = (layout.floor.floorTsuboGridOpacity ?? 30) / 100;
                const tsuboRgb = hexToRgb(layout.floor.floorTsuboGridColor || "#3b82f6");
                return (
                  <div
                    className="pointer-events-none absolute"
                    style={{
                      left: floorX,
                      top: floorY,
                      width: floorW,
                      height: floorH,
                      backgroundImage:
                        `linear-gradient(to right, rgba(${tsuboRgb.join(",")},${tsuboOpacity}) 2px, transparent 2px), linear-gradient(to bottom, rgba(${tsuboRgb.join(",")},${tsuboOpacity}) 2px, transparent 2px)`,
                      backgroundSize: `${tsuboPxW}px ${tsuboPxH}px`,
                      zIndex: 1,
                    }}
                  />
                );
              })()}

              {/* Zones */}
              {layout.zones.map((z) => {
                const labelRgb = hexToRgb(z.labelColor || "#000000");
                const bgRgb = hexToRgb(z.bgColor || "#d1fae5");
                const bgOpacity = (z.bgOpacity ?? 90) / 100;
                const zSel = isItemSelected("zone", z.id);
                return (
                  <div
                    key={z.id}
                    className={
                      `absolute rounded-2xl border-2 ` +
                      (zSel ? "ring-2 ring-black" : "")
                    }
                    style={{
                      left: z.x * cellPx,
                      top: z.y * cellPx,
                      width: z.w * cellPx,
                      height: z.h * cellPx,
                      zIndex: zSel && drag?.type === "group_move" ? 50 : 3,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: z.bgColor || "#10b981",
                      transform: zSel && groupMoveTransform ? groupMoveTransform : undefined,
                      transition: drag?.type === "group_move" ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "layout" && beginMoveZone(e, z.id)}
                    onClick={(e) => handleItemClick(e, "zone", z.id)}
                  >
                    {/* Zone label - watermark style */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: 900,
                          color: `rgba(${labelRgb.join(",")}, 0.15)`,
                          userSelect: "none",
                          textAlign: "center",
                          lineHeight: 1.2,
                        }}
                      >
                        {z.name}
                      </div>
                    </div>
                    {/* 右下リサイズハンドル（三角形） */}
                    {mode === "layout" && (
                      <div
                        className="absolute cursor-se-resize"
                        style={{
                          bottom: 0,
                          right: 0,
                          width: 0,
                          height: 0,
                          borderStyle: "solid",
                          borderWidth: "0 0 20px 20px",
                          borderColor: "transparent transparent #1f2937 transparent",
                          zIndex: 100,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          beginResizeZone(e, z.id, "se");
                        }}
                        title="リサイズ"
                      />
                    )}
                  </div>
                );
              })}

              {/* Racks - improved styling */}
              {layout.racks.map((r) => {
                const isSel = isItemSelected("rack", r.id);
                const slotW = (r.w * cellPx) / r.cols;
                const slotH = (r.h * cellPx) / r.rows;
                const labelRgb = hexToRgb(r.labelColor || "#ffffff");
                const bgRgb = hexToRgb(r.bgColor || "#f1f5f9");
                const bgOpacity = (r.bgOpacity ?? 95) / 100;
                return (
                  <div
                    key={r.id}
                    className={`absolute rounded-2xl border-2 ` + (isSel ? "ring-2 ring-black" : "")}
                    style={{
                      left: r.x * cellPx,
                      top: r.y * cellPx,
                      width: r.w * cellPx,
                      height: r.h * cellPx,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: r.bgColor || "#94a3b8",
                      boxShadow: isSel
                        ? "0 8px 20px -4px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.5)"
                        : "0 4px 12px -2px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)",
                      zIndex: isSel && drag?.type === "group_move" ? 50 : 4,
                      transform: isSel && groupMoveTransform ? groupMoveTransform : undefined,
                      transition: drag?.type === "group_move" ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "layout" && beginMoveRack(e, r.id)}
                    onClick={(e) => handleItemClick(e, "rack", r.id)}
                  >
                    {/* Rack label - watermark style */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: 900,
                          color: `rgba(${labelRgb.join(",")}, 0.2)`,
                          userSelect: "none",
                        }}
                      >
                        {r.name}
                      </div>
                    </div>

                    {/* Slot grid - improved */}
                    <div className="relative h-full w-full overflow-hidden rounded-xl p-1">
                      {Array.from({ length: r.rows * r.cols }).map((_, i) => {
                        const row = Math.floor(i / r.cols);
                        const col = i % r.cols;
                        const occupant = placedInRack.find(
                          (u) => u.loc?.kind === "rack" && u.loc.rackId === r.id && u.loc.slot === i
                        );
                        return (
                          <div
                            key={i}
                            className="absolute rounded-lg border"
                            style={{
                              left: col * slotW + 2,
                              top: row * slotH + 2,
                              width: slotW - 4,
                              height: slotH - 4,
                              background: occupant
                                ? "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)"
                                : "rgba(255,255,255,0.6)",
                              borderColor: occupant ? "#cbd5e1" : "rgba(203,213,225,0.5)",
                              boxShadow: occupant
                                ? "0 2px 4px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.8)"
                                : "inset 0 1px 2px rgba(0,0,0,0.04)",
                            }}
                          >
                            {occupant ? (
                              <div
                                className="h-full w-full rounded-lg p-1 text-[10px] cursor-pointer transition-shadow hover:shadow-md"
                                onMouseDown={(e) => beginMoveUnit(e, occupant.id)}
                                onClick={(e) => handleItemClick(e, "unit", occupant.id)}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  openDetailModal(occupant);
                                }}
                              >
                                <div className="truncate font-bold text-gray-800">{occupant.kind}</div>
                                <div className="truncate text-gray-600">{occupant.client}</div>
                                {occupant.sku && <div className="truncate text-gray-500 text-[9px]">{occupant.sku}</div>}
                              </div>
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-400">
                                {i + 1}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 右下リサイズハンドル（三角形） */}
                    {mode === "layout" && (
                      <div
                        className="absolute cursor-se-resize"
                        style={{
                          bottom: 0,
                          right: 0,
                          width: 0,
                          height: 0,
                          borderStyle: "solid",
                          borderWidth: "0 0 20px 20px",
                          borderColor: "transparent transparent #1f2937 transparent",
                          zIndex: 100,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          beginResizeRack(e, r.id, "se");
                        }}
                        title="リサイズ"
                      />
                    )}
                  </div>
                );
              })}

              {/* Shelves - floor-like grid areas - z-index: 2 */}
              {(layout.shelves || []).map((s) => {
                const isSel = isItemSelected("shelf", s.id);
                const shelfUnits = placedOnShelf.filter((u) => u.loc?.shelfId === s.id);
                const shelfRotation = s.rotation || 0;
                const shelfBgColor = s.bgColor || "#f0fdfa";
                return (
                  <React.Fragment key={s.id}>
                  <div
                    className={
                      `absolute rounded-xl border-2 border-gray-400 ` +
                      (isSel ? "ring-2 ring-black" : "")
                    }
                    style={{
                      left: s.x * cellPx,
                      top: s.y * cellPx,
                      width: s.w * cellPx,
                      height: s.h * cellPx,
                      backgroundColor: `${shelfBgColor}e6`,
                      transform: `${isSel && groupMoveTransform ? groupMoveTransform + " " : ""}rotate(${shelfRotation}deg)`,
                      transformOrigin: "center center",
                      zIndex: isSel && drag?.type === "group_move" ? 50 : 2,
                      transition: drag?.type === "group_move" ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "layout" && beginMoveShelf(e, s.id)}
                    onClick={(e) => handleItemClick(e, "shelf", s.id)}
                  >
                    {/* Grid lines inside shelf (gray cell grid) */}
                    {(() => {
                      const shelfCellOpacity = (s.cellGridOpacity ?? 30) / 100;
                      const shelfCellRgb = hexToRgb(s.cellGridColor || "#000000");
                      return (
                        <div
                          className="absolute pointer-events-none rounded-xl"
                          style={{
                            left: 0,
                            top: 0,
                            right: 0,
                            bottom: 0,
                            backgroundImage:
                              `linear-gradient(to right, rgba(${shelfCellRgb.join(",")},${shelfCellOpacity}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${shelfCellRgb.join(",")},${shelfCellOpacity}) 1px, transparent 1px)`,
                            backgroundSize: `${cellPx}px ${cellPx}px`,
                            zIndex: 10,
                          }}
                        />
                      );
                    })()}

                    {/* 1坪グリッド on shelf (blue) */}
                    {layout.floor.showTsuboGrid && (() => {
                      const tsuboM = 1.82;
                      const tsuboPxW = (tsuboM / layout.floor.cell_m_w) * cellPx;
                      const tsuboPxH = (tsuboM / layout.floor.cell_m_d) * cellPx;
                      const shelfTsuboOpacity = (s.tsuboGridOpacity ?? 60) / 100;
                      const shelfTsuboRgb = hexToRgb(s.tsuboGridColor || "#3b82f6");
                      return (
                        <div
                          className="absolute pointer-events-none rounded-xl"
                          style={{
                            left: 0,
                            top: 0,
                            right: 0,
                            bottom: 0,
                            backgroundImage:
                              `linear-gradient(to right, rgba(${shelfTsuboRgb.join(",")},${shelfTsuboOpacity}) 2px, transparent 2px), linear-gradient(to bottom, rgba(${shelfTsuboRgb.join(",")},${shelfTsuboOpacity}) 2px, transparent 2px)`,
                            backgroundSize: `${tsuboPxW}px ${tsuboPxH}px`,
                            zIndex: 11,
                          }}
                        />
                      );
                    })()}

                    {/* Shelf label overlay - large watermark style */}
                    {(() => {
                      const labelRgb = hexToRgb(s.labelColor || "#000000");
                      return (
                        <div
                          className="absolute pointer-events-none"
                          style={{
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transform: `rotate(${-shelfRotation}deg)`,
                            zIndex: 50,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: 900,
                              color: `rgba(${labelRgb.join(",")}, 0.12)`,
                              userSelect: "none",
                            }}
                          >
                            {s.name}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Units on shelf - positioned relative to shelf grid */}
                    {shelfUnits.map((u) => {
                      const fp = unitFootprintCells(u);
                      const isUnitSel = isItemSelected("unit", u.id);
                      const kindIcon = u.kind === "パレット" ? "📦" : u.kind === "カゴ" ? "🧺" : "📋";
                      const shelfUnitBgRgb = hexToRgb(u.bgColor || "#ffffff");
                      const shelfUnitBgOpacity = (u.bgOpacity ?? 100) / 100;
                      const isDraggingShelfUnit = drag?.type === "move_unit" && drag.unitId === u.id;
                      const shelfDragTransform = isDraggingShelfUnit
                        ? (() => {
                            const sdx = (drag.pointerX - drag.startX) / zoom;
                            const sdy = (drag.pointerY - drag.startY) / zoom;
                            // 回転した棚の子要素内ではtranslateを逆回転
                            if (shelfRotation === 90) return `translate(${sdy}px, ${-sdx}px)`;
                            return `translate(${sdx}px, ${sdy}px)`;
                          })()
                        : undefined;
                      return (
                        <div
                          key={u.id}
                          className={
                            "absolute rounded-xl border-2 cursor-pointer " +
                            (isDraggingShelfUnit ? "" : "transition-all duration-150 ") +
                            (isUnitSel ? "ring-2 ring-black shadow-lg z-20" : "hover:shadow-lg")
                          }
                          style={{
                            left: u.loc.x * cellPx + 1,
                            top: u.loc.y * cellPx + 1,
                            width: fp.w * cellPx - 2,
                            height: fp.h * cellPx - 2,
                            background: u.bgColor
                              ? `rgba(${shelfUnitBgRgb.join(",")}, ${shelfUnitBgOpacity})`
                              : "linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)",
                            borderColor: isUnitSel ? "#1e293b" : (u.bgColor || "#e2e8f0"),
                            boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                            zIndex: isDraggingShelfUnit ? 50 : 5,
                            transform: shelfDragTransform,
                            opacity: isDraggingShelfUnit ? 0.7 : undefined,
                            pointerEvents: isDraggingShelfUnit ? "none" : undefined,
                            transition: isDraggingShelfUnit ? "none" : undefined,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (mode === "operate") beginMoveUnit(e, u.id);
                          }}
                          onClick={(e) => handleItemClick(e, "unit", u.id)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(u);
                          }}
                        >
                          <div className="p-1 h-full flex flex-col" style={{ color: u.labelColor || "#1f2937" }}>
                            <div className="flex items-center gap-1">
                              <span className="text-sm">{kindIcon}</span>
                              <div className="truncate text-[10px] font-bold">{u.kind}</div>
                            </div>
                            <div className="truncate text-[9px]" style={{ opacity: 0.7 }}>{u.client}</div>
                          </div>
                          {/* 右下リサイズハンドル（三角形） */}
                          {mode === "operate" && (
                            <div
                              className="absolute cursor-se-resize"
                              style={{
                                bottom: 0,
                                right: 0,
                                width: 0,
                                height: 0,
                                borderStyle: "solid",
                                borderWidth: "0 0 12px 12px",
                                borderColor: "transparent transparent #64748b transparent",
                                zIndex: 100,
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                beginResizeUnit(e, u.id);
                              }}
                              title="リサイズ"
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* 右下リサイズハンドル（三角形）- 回転しても視覚的な右下に維持 */}
                    {mode === "layout" && (() => {
                      // 回転角度に応じて位置と三角形の形状を調整
                      // 0度: CSS右下に◢、90度: CSS右上に◥（回転後に視覚的な右下で◢に見える）
                      const pos = shelfRotation === 90
                        ? { top: 0, right: 0 }
                        : { bottom: 0, right: 0 };
                      const borderConfig = shelfRotation === 90
                        ? { borderWidth: "0 20px 20px 0", borderColor: "transparent #4b5563 transparent transparent" }
                        : { borderWidth: "0 0 20px 20px", borderColor: "transparent transparent #4b5563 transparent" };
                      return (
                        <div
                          className="absolute cursor-se-resize"
                          style={{
                            ...pos,
                            width: 0,
                            height: 0,
                            borderStyle: "solid",
                            ...borderConfig,
                            zIndex: 100,
                          }}
                          onMouseDown={(e) => beginResizeShelf(e, s.id, "se")}
                          title="リサイズ"
                        />
                      );
                    })()}
                  </div>

                  </React.Fragment>
                );
              })}

              {/* Units on floor - improved styling */}
              {placedOnFloor.map((u) => {
                const fp = unitFootprintCells(u);
                const isSel = isItemSelected("unit", u.id);
                const kindIcon = u.kind === "パレット" ? "📦" : u.kind === "カゴ" ? "🧺" : "📋";
                const unitBgRgb = hexToRgb(u.bgColor || "#ffffff");
                const unitBgOpacity = (u.bgOpacity ?? 100) / 100;
                const unitLabelRgb = hexToRgb(u.labelColor || "#000000");
                const isDragging = drag?.type === "move_unit" && drag.unitId === u.id;
                const isGroupMoving = isSel && drag?.type === "group_move";
                const dragTransform = isDragging
                  ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                  : isGroupMoving ? groupMoveTransform : undefined;
                return (
                  <div
                    key={u.id}
                    className={
                      "absolute rounded-3xl border-2 cursor-pointer " +
                      ((isDragging || isGroupMoving) ? "" : "transition-all duration-150 ") +
                      (isSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-xl hover:-translate-y-0.5")
                    }
                    style={{
                      left: u.loc.x * cellPx,
                      top: u.loc.y * cellPx,
                      width: fp.w * cellPx,
                      height: fp.h * cellPx,
                      background: u.bgColor
                        ? `rgba(${unitBgRgb.join(",")}, ${unitBgOpacity})`
                        : "linear-gradient(145deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)",
                      borderColor: isSel ? "#1e293b" : (u.bgColor || "#e2e8f0"),
                      boxShadow: isSel
                        ? "0 10px 25px -5px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.1)"
                        : "0 4px 12px -2px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)",
                      zIndex: (isDragging || isGroupMoving) ? 50 : 5,
                      transform: dragTransform,
                      opacity: isDragging ? 0.7 : undefined,
                      pointerEvents: isDragging ? "none" : undefined,
                      transition: isDragging ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "operate" && beginMoveUnit(e, u.id)}
                    onClick={(e) => handleItemClick(e, "unit", u.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openDetailModal(u);
                    }}
                  >
                    <div className="p-2 h-full flex flex-col" style={{ color: u.labelColor || "#1f2937" }}>
                      <div className="flex items-start gap-2">
                        <div className="text-lg flex-shrink-0">{kindIcon}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold">{u.kind}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            <Badge>{u.client}</Badge>
                            <Badge color={getStatusColor(u.status)}>
                              {getStatusLabel(u.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="mt-auto pt-1">
                        <div className="truncate text-[11px] text-gray-600 font-medium">{u.name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {u.temperature_zone && u.temperature_zone !== "ambient" && (
                            <Badge color={getTempZoneColor(u.temperature_zone)}>
                              {getTempZoneLabel(u.temperature_zone)}
                            </Badge>
                          )}
                          {u.fragile && <Badge color="red">壊れやすい</Badge>}
                          {u.weight_kg > 0 && <span className="text-[10px] text-gray-500">{u.weight_kg}kg</span>}
                        </div>
                      </div>
                    </div>
                    {/* 右下リサイズハンドル（三角形） */}
                    {mode === "operate" && (
                      <div
                        className="absolute cursor-se-resize"
                        style={{
                          bottom: 0,
                          right: 0,
                          width: 0,
                          height: 0,
                          borderStyle: "solid",
                          borderWidth: "0 0 16px 16px",
                          borderColor: "transparent transparent #64748b transparent",
                          zIndex: 100,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          beginResizeUnit(e, u.id);
                        }}
                        title="リサイズ"
                      />
                    )}
                  </div>
                );
              })}

              {/* Panels (配電盤) - z-index: 6 */}
              {panels.map((p) => {
                const isSel = isItemSelected("panel", p.id);
                const labelRgb = hexToRgb(p.labelColor || "#000000");
                const bgRgb = hexToRgb(p.bgColor || "#fef3c7");
                const bgOpacity = (p.bgOpacity ?? 90) / 100;
                return (
                  <div
                    key={p.id}
                    className={
                      `absolute rounded-xl border-2 cursor-pointer ` +
                      (isSel && drag?.type === "group_move" ? "" : "transition-all duration-150 ") +
                      (isSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-lg")
                    }
                    style={{
                      left: p.x * cellPx,
                      top: p.y * cellPx,
                      width: p.w * cellPx,
                      height: p.h * cellPx,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: p.bgColor || "#f59e0b",
                      zIndex: isSel && drag?.type === "group_move" ? 50 : 6,
                      transform: isSel && groupMoveTransform ? groupMoveTransform : undefined,
                      transition: drag?.type === "group_move" ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "operate" && beginMovePanel(e, p.id)}
                    onClick={(e) => handleItemClick(e, "panel", p.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openPanelDetailModal(p);
                    }}
                  >
                    {/* Panel label - watermark style */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: `rgba(${labelRgb.join(",")}, 0.7)`,
                          userSelect: "none",
                          textAlign: "center",
                          lineHeight: 1.2,
                        }}
                      >
                        {p.name}
                      </div>
                    </div>
                    {/* 右下リサイズハンドル（三角形） */}
                    {mode === "operate" && (
                      <div
                        className="absolute cursor-se-resize"
                        style={{
                          bottom: 0,
                          right: 0,
                          width: 0,
                          height: 0,
                          borderStyle: "solid",
                          borderWidth: "0 0 16px 16px",
                          borderColor: "transparent transparent #92400e transparent",
                          zIndex: 100,
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          beginResizePanel(e, p.id, "se");
                        }}
                        title="リサイズ"
                      />
                    )}
                  </div>
                );
              })}

              {/* Drop preview ghost for move_unit drag */}
              {drag?.type === "move_unit" && (() => {
                const u = unitsRef.current.find((x) => x.id === drag.unitId);
                if (!u) return null;
                const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
                const fp = unitFootprintCells(u);
                const dropX = cx - (drag.offsetCx || 0);
                const dropY = cy - (drag.offsetCy || 0);

                // Check if pointer is over a shelf
                const shelf = findShelfAtCell(cx, cy);
                if (shelf) {
                  const local = worldToShelfLocal(shelf, dropX, dropY);
                  const localX = clamp(Math.floor(local.localX), 0, shelf.w - fp.w);
                  const localY = clamp(Math.floor(local.localY), 0, shelf.h - fp.h);
                  const wp = shelfLocalToWorld(shelf, localX, localY);
                  return (
                    <div
                      className="absolute pointer-events-none rounded-xl"
                      style={{
                        left: wp.worldX * cellPx,
                        top: wp.worldY * cellPx,
                        width: fp.w * cellPx,
                        height: fp.h * cellPx,
                        border: "2px dashed #10b981",
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        transform: `rotate(${shelf.rotation || 0}deg)`,
                        transformOrigin: "0 0",
                        zIndex: 49,
                      }}
                    />
                  );
                }

                // Floor preview
                const pfx = layout.floor.x || 0;
                const pfy = layout.floor.y || 0;
                const previewX = clamp(dropX, pfx, pfx + layout.floor.cols - fp.w);
                const previewY = clamp(dropY, pfy, pfy + layout.floor.rows - fp.h);
                return (
                  <div
                    className="absolute pointer-events-none rounded-3xl"
                    style={{
                      left: previewX * cellPx,
                      top: previewY * cellPx,
                      width: fp.w * cellPx,
                      height: fp.h * cellPx,
                      border: "2px dashed #3b82f6",
                      backgroundColor: "rgba(59, 130, 246, 0.1)",
                      zIndex: 4,
                    }}
                  />
                );
              })()}
            </div>

            {/* Ghost for new placement */}
            {drag?.type === "place_new" && (
              <div
                className="pointer-events-none fixed z-50 rounded-2xl border bg-white/90 p-2 text-xs shadow-lg"
                style={{ left: drag.pointerX + 10, top: drag.pointerY + 10 }}
              >
                <div className="font-semibold">{drag.draftUnit.kind}</div>
                <div className="text-gray-600">{drag.draftUnit.client}</div>
              </div>
            )}

            {/* Rubber band selection rectangle */}
            {drag?.type === "rubber_band" && (() => {
              const left = Math.min(drag.startX, drag.pointerX);
              const top = Math.min(drag.startY, drag.pointerY);
              const width = Math.abs(drag.pointerX - drag.startX);
              const height = Math.abs(drag.pointerY - drag.startY);
              return (
                <div
                  className="pointer-events-none fixed z-50"
                  style={{
                    left,
                    top,
                    width,
                    height,
                    border: "2px dashed #3b82f6",
                    backgroundColor: "rgba(59, 130, 246, 0.08)",
                  }}
                />
              );
            })()}
          </div>
        </div>

        {/* Right panel toggle button */}
        <div className="flex items-center justify-center px-1">
          <button
            type="button"
            className="flex items-center justify-center w-6 h-16 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 hover:text-gray-800 transition-colors shadow-sm border border-gray-300"
            onClick={() => setRightOpen((v) => !v)}
            title={rightOpen ? "右パネルを閉じる" : "右パネルを開く"}
          >
            <span className="text-xs font-bold">{rightOpen ? "»" : "«"}</span>
          </button>
        </div>

        {/* Right: creator / layout editor */}
        <div
          className="flex flex-col gap-3 overflow-auto pl-2"
          style={{
            width: rightOpen ? "380px" : "0px",
            minWidth: rightOpen ? "380px" : "0px",
            opacity: rightOpen ? 1 : 0,
            pointerEvents: rightOpen ? "auto" : "none",
            transition: "width 200ms ease, min-width 200ms ease, opacity 150ms ease",
          }}
        >
          {mode === "layout" ? (
            <div className="rounded-2xl border bg-white p-3 shadow-sm">
              <SectionTitle
                right={
                  <div className="flex gap-2">
                    <button
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={addZone}
                      type="button"
                    >
                      ＋区画
                    </button>
                    <button
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={addRack}
                      type="button"
                    >
                      ＋ラック
                    </button>
                    <button
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 bg-teal-50 border-teal-300"
                      onClick={addShelf}
                      type="button"
                    >
                      ＋棚
                    </button>
                  </div>
                }
              >
                レイアウト編集
              </SectionTitle>

              <div className="rounded-2xl border bg-gray-50 p-3 text-xs text-gray-700">
                区画/ラック/棚を<strong>ドラッグで移動</strong>、右下ハンドルでリサイズできます。
              </div>

              <div className="mt-3 space-y-3">
                <div className="rounded-2xl border p-3">
                  <div className="text-sm font-semibold">床設定</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-gray-500">横セル数</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={layout.floor.cols}
                        onChange={(e) =>
                          setLayout((p) => ({
                            ...p,
                            floor: { ...p.floor, cols: clamp(Number(e.target.value) || 1, 1, 500) },
                          }))
                        }
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">縦セル数</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={layout.floor.rows}
                        onChange={(e) =>
                          setLayout((p) => ({
                            ...p,
                            floor: { ...p.floor, rows: clamp(Number(e.target.value) || 1, 1, 500) },
                          }))
                        }
                        inputMode="numeric"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">セル幅(m)</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={layout.floor.cell_m_w}
                        onChange={(e) =>
                          setLayout((p) => ({
                            ...p,
                            floor: { ...p.floor, cell_m_w: Number(e.target.value) || p.floor.cell_m_w },
                          }))
                        }
                        inputMode="decimal"
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">セル奥行(m)</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={layout.floor.cell_m_d}
                        onChange={(e) =>
                          setLayout((p) => ({
                            ...p,
                            floor: { ...p.floor, cell_m_d: Number(e.target.value) || p.floor.cell_m_d },
                          }))
                        }
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="showTsuboGrid"
                      checked={layout.floor.showTsuboGrid || false}
                      onChange={(e) =>
                        setLayout((p) => ({
                          ...p,
                          floor: { ...p.floor, showTsuboGrid: e.target.checked },
                        }))
                      }
                      className="rounded"
                    />
                    <label htmlFor="showTsuboGrid" className="text-xs text-gray-600">
                      1坪グリッド表示（青線）
                    </label>
                  </div>
                </div>

                <div className="rounded-2xl border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">選択中{selectionSet.length > 1 ? ` (${selectionSet.length}件)` : ""}</div>
                    <div className="flex gap-1">
                      {selectionSet.length > 1 && (
                        <button
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-blue-50 bg-blue-50 text-blue-700 border-blue-300"
                          onClick={rotateSelectedGroup}
                          type="button"
                        >
                          一括回転
                        </button>
                      )}
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={removeSelected}
                        type="button"
                        disabled={selectionSet.length === 0}
                      >
                        {selectionSet.length > 1 ? "一括削除" : "削除"}
                      </button>
                    </div>
                  </div>

                  {selectionSet.length > 1 ? (
                    <div className="mt-2 space-y-1 text-sm text-gray-600">
                      <div>Ctrl+クリックで追加選択 / Ctrl+ドラッグで矩形選択</div>
                      <div className="text-xs text-gray-500">
                        {(() => {
                          const counts = {};
                          for (const s of selectionSet) counts[s.kind] = (counts[s.kind] || 0) + 1;
                          return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
                        })()}
                      </div>
                      <div className="text-xs text-gray-500">選択中のアイテムをドラッグでグループ移動できます。</div>
                    </div>
                  ) : !selectedEntity ? (
                    <div className="mt-2 text-sm text-gray-600">床/区画/ラック/棚/配電盤をクリックすると編集できます。Ctrl+クリックで複数選択。</div>
                  ) : selected.kind === "floor" ? (
                    /* 床が選択された場合 */
                    <div className="mt-3 space-y-3 text-sm">
                      <div className="text-xs text-gray-500">種別: 床</div>

                      {/* 床の回転 */}
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium"
                          onClick={() => rotateFloor()}
                        >
                          <span>↻</span>
                          <span>90度回転（全体）</span>
                        </button>
                        <span className="text-xs text-gray-500">
                          床上の全アイテムも回転します
                        </span>
                      </div>

                      {/* 床の色設定 */}
                      <div className="border-t pt-2">
                        <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={layout.floor.floorBgColor || "#ffffff"}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorBgColor: e.target.value },
                                }))
                              }
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-xs text-gray-600">背景色</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={layout.floor.floorCellGridColor || "#000000"}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorCellGridColor: e.target.value },
                                }))
                              }
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-xs text-gray-600">セルグリッド</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={layout.floor.floorTsuboGridColor || "#3b82f6"}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorTsuboGridColor: e.target.value },
                                }))
                              }
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-xs text-gray-600">1坪グリッド</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={layout.floor.floorLabelColor || "#000000"}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorLabelColor: e.target.value },
                                }))
                              }
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-xs text-gray-600">ラベル</span>
                          </div>
                        </div>
                      </div>

                      {/* 床の透明度設定 */}
                      <div className="border-t pt-2">
                        <div className="text-xs font-semibold text-gray-700 mb-2">グリッド透明度</div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[10px] text-gray-500">セル: {layout.floor.floorCellGridOpacity ?? 10}%</label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={layout.floor.floorCellGridOpacity ?? 10}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorCellGridOpacity: Number(e.target.value) },
                                }))
                              }
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">1坪: {layout.floor.floorTsuboGridOpacity ?? 30}%</label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={layout.floor.floorTsuboGridOpacity ?? 30}
                              onChange={(e) =>
                                setLayout((p) => ({
                                  ...p,
                                  floor: { ...p.floor, floorTsuboGridOpacity: Number(e.target.value) },
                                }))
                              }
                              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="text-xs text-gray-500">種別: {selected.kind === "shelf" ? "棚" : selected.kind === "rack" ? "ラック" : selected.kind === "zone" ? "区画" : selected.kind === "panel" ? "配電盤" : selected.kind}</div>
                      <div>
                        <div className="text-xs text-gray-500">名前</div>
                        <input
                          className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                          value={selectedEntity.name || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (selected.kind === "zone")
                              setLayout((p) => ({
                                ...p,
                                zones: p.zones.map((z) => (z.id === selected.id ? { ...z, name: v } : z)),
                              }));
                            if (selected.kind === "rack")
                              setLayout((p) => ({
                                ...p,
                                racks: p.racks.map((r) => (r.id === selected.id ? { ...r, name: v } : r)),
                              }));
                            if (selected.kind === "shelf")
                              setLayout((p) => ({
                                ...p,
                                shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, name: v } : s)),
                              }));
                            if (selected.kind === "panel")
                              setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, name: v } : pn)));
                          }}
                        />
                      </div>

                      {selected.kind === "zone" && (
                        <>
                          <div>
                            <div className="text-xs text-gray-500">取引先</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.client || ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => (z.id === selected.id ? { ...z, client: v } : z)),
                                }));
                              }}
                            />
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.bgColor || "#d1fae5"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      zones: p.zones.map((z) =>
                                        z.id === selected.id ? { ...z, bgColor: e.target.value } : z
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">背景色</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.labelColor || "#000000"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      zones: p.zones.map((z) =>
                                        z.id === selected.id ? { ...z, labelColor: e.target.value } : z
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">ラベル</span>
                              </div>
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">透明度</div>
                            <div>
                              <label className="text-[10px] text-gray-500">背景: {selectedEntity.bgOpacity ?? 90}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={selectedEntity.bgOpacity ?? 90}
                                onChange={(e) =>
                                  setLayout((p) => ({
                                    ...p,
                                    zones: p.zones.map((z) =>
                                      z.id === selected.id ? { ...z, bgOpacity: Number(e.target.value) } : z
                                    ),
                                  }))
                                }
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {selected.kind === "rack" && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-xs text-gray-500">段数(rows)</div>
                              <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                value={selectedEntity.rows}
                                onChange={(e) => {
                                  const v = clamp(Number(e.target.value) || 1, 1, 20);
                                  setLayout((p) => ({
                                    ...p,
                                    racks: p.racks.map((r) => (r.id === selected.id ? { ...r, rows: v } : r)),
                                  }));
                                }}
                                inputMode="numeric"
                              />
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">列数(cols)</div>
                              <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                value={selectedEntity.cols}
                                onChange={(e) => {
                                  const v = clamp(Number(e.target.value) || 1, 1, 30);
                                  setLayout((p) => ({
                                    ...p,
                                    racks: p.racks.map((r) => (r.id === selected.id ? { ...r, cols: v } : r)),
                                  }));
                                }}
                                inputMode="numeric"
                              />
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.bgColor || "#f1f5f9"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      racks: p.racks.map((r) =>
                                        r.id === selected.id ? { ...r, bgColor: e.target.value } : r
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">背景色</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.labelColor || "#ffffff"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      racks: p.racks.map((r) =>
                                        r.id === selected.id ? { ...r, labelColor: e.target.value } : r
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">ラベル</span>
                              </div>
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">透明度</div>
                            <div>
                              <label className="text-[10px] text-gray-500">背景: {selectedEntity.bgOpacity ?? 95}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={selectedEntity.bgOpacity ?? 95}
                                onChange={(e) =>
                                  setLayout((p) => ({
                                    ...p,
                                    racks: p.racks.map((r) =>
                                      r.id === selected.id ? { ...r, bgOpacity: Number(e.target.value) } : r
                                    ),
                                  }))
                                }
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {/* 座標・サイズ編集 */}
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <div className="text-xs text-gray-500">X</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                            value={selectedEntity.x}
                            onChange={(e) => {
                              const v = clamp(Number(e.target.value) || 0, 0, layout.floor.cols - 1);
                              if (selected.kind === "zone")
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => (z.id === selected.id ? { ...z, x: v } : z)),
                                }));
                              if (selected.kind === "rack")
                                setLayout((p) => ({
                                  ...p,
                                  racks: p.racks.map((r) => (r.id === selected.id ? { ...r, x: v } : r)),
                                }));
                              if (selected.kind === "shelf")
                                setLayout((p) => ({
                                  ...p,
                                  shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, x: v } : s)),
                                }));
                              if (selected.kind === "panel")
                                setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, x: v } : pn)));
                            }}
                            inputMode="numeric"
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Y</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                            value={selectedEntity.y}
                            onChange={(e) => {
                              const v = clamp(Number(e.target.value) || 0, 0, layout.floor.rows - 1);
                              if (selected.kind === "zone")
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => (z.id === selected.id ? { ...z, y: v } : z)),
                                }));
                              if (selected.kind === "rack")
                                setLayout((p) => ({
                                  ...p,
                                  racks: p.racks.map((r) => (r.id === selected.id ? { ...r, y: v } : r)),
                                }));
                              if (selected.kind === "shelf")
                                setLayout((p) => ({
                                  ...p,
                                  shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, y: v } : s)),
                                }));
                              if (selected.kind === "panel")
                                setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, y: v } : pn)));
                            }}
                            inputMode="numeric"
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">幅(W)</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                            value={selectedEntity.w}
                            onChange={(e) => {
                              const v = clamp(Number(e.target.value) || 1, 1, layout.floor.cols);
                              if (selected.kind === "zone")
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => (z.id === selected.id ? { ...z, w: v } : z)),
                                }));
                              if (selected.kind === "rack")
                                setLayout((p) => ({
                                  ...p,
                                  racks: p.racks.map((r) => (r.id === selected.id ? { ...r, w: v } : r)),
                                }));
                              if (selected.kind === "shelf") {
                                const autoArea = v * layout.floor.cell_m_w * selectedEntity.h * layout.floor.cell_m_d;
                                setLayout((p) => ({
                                  ...p,
                                  shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, w: v, area_m2: s.area_m2_manual ? s.area_m2 : autoArea } : s)),
                                }));
                              }
                              if (selected.kind === "panel")
                                setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, w: v } : pn)));
                            }}
                            inputMode="numeric"
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">高さ(H)</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                            value={selectedEntity.h}
                            onChange={(e) => {
                              const v = clamp(Number(e.target.value) || 1, 1, layout.floor.rows);
                              if (selected.kind === "zone")
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => (z.id === selected.id ? { ...z, h: v } : z)),
                                }));
                              if (selected.kind === "rack")
                                setLayout((p) => ({
                                  ...p,
                                  racks: p.racks.map((r) => (r.id === selected.id ? { ...r, h: v } : r)),
                                }));
                              if (selected.kind === "shelf") {
                                const autoArea = selectedEntity.w * layout.floor.cell_m_w * v * layout.floor.cell_m_d;
                                setLayout((p) => ({
                                  ...p,
                                  shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, h: v, area_m2: s.area_m2_manual ? s.area_m2 : autoArea } : s)),
                                }));
                              }
                              if (selected.kind === "panel")
                                setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, h: v } : pn)));
                            }}
                            inputMode="numeric"
                          />
                        </div>
                      </div>

                      {/* 棚専用: 面積編集 */}
                      {selected.kind === "shelf" && (
                        <div className="rounded-xl border bg-teal-50 p-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-xs text-gray-500">面積(m²)</div>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={selectedEntity.area_m2_manual || false}
                                onChange={(e) => {
                                  const manual = e.target.checked;
                                  const autoArea = selectedEntity.w * layout.floor.cell_m_w * selectedEntity.h * layout.floor.cell_m_d;
                                  setLayout((p) => ({
                                    ...p,
                                    shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, area_m2_manual: manual, area_m2: manual ? s.area_m2 : autoArea } : s)),
                                  }));
                                }}
                                className="rounded"
                              />
                              <span>手動入力</span>
                            </label>
                          </div>
                          <input
                            className="mt-1 w-full rounded-xl border px-2 py-1 text-sm"
                            value={selectedEntity.area_m2?.toFixed(2) || "0"}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setLayout((p) => ({
                                ...p,
                                shelves: (p.shelves || []).map((s) => (s.id === selected.id ? { ...s, area_m2: v, area_m2_manual: true } : s)),
                              }));
                            }}
                            disabled={!selectedEntity.area_m2_manual}
                            inputMode="decimal"
                          />
                          {!selectedEntity.area_m2_manual && (
                            <div className="mt-1 text-xs text-gray-500">
                              自動計算: {selectedEntity.w} × {layout.floor.cell_m_w}m × {selectedEntity.h} × {layout.floor.cell_m_d}m = {(selectedEntity.w * layout.floor.cell_m_w * selectedEntity.h * layout.floor.cell_m_d).toFixed(2)}m²
                            </div>
                          )}
                        </div>
                      )}

                      {/* 棚専用: 回転とカラーピッカーとグリッド設定 */}
                      {selected.kind === "shelf" && (
                        <>
                          {/* 棚の回転 */}
                          <div className="border-t pt-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium"
                                onClick={() => rotateShelf(selected.id)}
                              >
                                <span>↻</span>
                                <span>{(selectedEntity.rotation || 0) === 0 ? "90度回転" : "元に戻す"}</span>
                              </button>
                              <span className="text-xs text-gray-500">
                                現在: {selectedEntity.rotation || 0}°
                              </span>
                            </div>
                          </div>

                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.bgColor || "#f0fdfa"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, bgColor: e.target.value } : s
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">背景色</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.cellGridColor || "#000000"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, cellGridColor: e.target.value } : s
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">セルグリッド</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.tsuboGridColor || "#3b82f6"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, tsuboGridColor: e.target.value } : s
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">1坪グリッド</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={selectedEntity.labelColor || "#000000"}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, labelColor: e.target.value } : s
                                      ),
                                    }))
                                  }
                                  className="w-8 h-8 rounded cursor-pointer border"
                                />
                                <span className="text-xs text-gray-600">ラベル</span>
                              </div>
                            </div>
                          </div>

                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">グリッド透明度</div>
                            <div className="space-y-2">
                              <div>
                                <label className="text-[10px] text-gray-500">セル: {selectedEntity.cellGridOpacity ?? 30}%</label>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={selectedEntity.cellGridOpacity ?? 30}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, cellGridOpacity: Number(e.target.value) } : s
                                      ),
                                    }))
                                  }
                                  className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500">1坪: {selectedEntity.tsuboGridOpacity ?? 60}%</label>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={selectedEntity.tsuboGridOpacity ?? 60}
                                  onChange={(e) =>
                                    setLayout((p) => ({
                                      ...p,
                                      shelves: (p.shelves || []).map((s) =>
                                        s.id === selected.id ? { ...s, tsuboGridOpacity: Number(e.target.value) } : s
                                      ),
                                    }))
                                  }
                                  className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border bg-white p-3 shadow-sm">
              <SectionTitle>オブジェクト作成</SectionTitle>

              <div className="rounded-xl border p-3">
                <div className="text-sm font-semibold">テンプレ</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[{ k: "パレット", w: "1.2", d: "1.0", h: "1.6" }, { k: "カゴ", w: "0.8", d: "0.6", h: "0.7" }, { k: "単体荷物", w: "0.4", d: "0.3", h: "0.25" }].map(
                    (t) => (
                      <button
                        key={t.k}
                        className={
                          "rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 " +
                          (template === t.k ? "bg-black text-white hover:bg-black/90" : "")
                        }
                        type="button"
                        onClick={() => {
                          setTemplate(t.k);
                          setForm((s) => ({ ...s, w: t.w, d: t.d, h: t.h }));
                        }}
                      >
                        {t.k}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-xl border p-3">
                <div className="text-sm font-semibold">情報</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-gray-500">取引先</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.client}
                      onChange={(e) => setForm((s) => ({ ...s, client: e.target.value }))}
                      placeholder="取引先A"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">数量</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.qty}
                      onChange={(e) => setForm((s) => ({ ...s, qty: e.target.value }))}
                      inputMode="numeric"
                      placeholder="1"
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500">名称（任意）</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.name}
                      onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                      placeholder="品目や伝票番号など"
                    />
                  </div>
                </div>

                <div className="mt-3 text-sm font-semibold">サイズ</div>
                <div className="mt-3 text-sm font-semibold">追加情報（新規）</div>
<div className="mt-2 grid grid-cols-2 gap-2">
  <div>
    <div className="text-xs text-gray-500">SKU</div>
    <input
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.sku}
      onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))}
      placeholder="商品コード"
    />
  </div>
  <div>
    <div className="text-xs text-gray-500">バーコード</div>
    <input
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.barcode}
      onChange={(e) => setForm((s) => ({ ...s, barcode: e.target.value }))}
      placeholder="JAN等"
    />
  </div>
  <div>
    <div className="text-xs text-gray-500">ロット番号</div>
    <input
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.batch_number}
      onChange={(e) => setForm((s) => ({ ...s, batch_number: e.target.value }))}
      placeholder="LOT-001"
    />
  </div>
  <div>
    <div className="text-xs text-gray-500">重量(kg)</div>
    <input
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.weight_kg}
      onChange={(e) => setForm((s) => ({ ...s, weight_kg: e.target.value }))}
      inputMode="decimal"
      placeholder="0"
    />
  </div>
  <div>
    <div className="text-xs text-gray-500">温度ゾーン</div>
    <select
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.temperature_zone}
      onChange={(e) => setForm((s) => ({ ...s, temperature_zone: e.target.value }))}
    >
      <option value="ambient">常温</option>
      <option value="chilled">冷蔵</option>
      <option value="frozen">冷凍</option>
    </select>
  </div>
  <div>
    <div className="text-xs text-gray-500">最大積み段数</div>
    <input
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.max_stack_height}
      onChange={(e) => setForm((s) => ({ ...s, max_stack_height: e.target.value }))}
      inputMode="numeric"
      placeholder="1"
    />
  </div>
  <div>
    <div className="text-xs text-gray-500">賞味期限</div>
    <input
      type="date"
      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
      value={form.expires_at}
      onChange={(e) => setForm((s) => ({ ...s, expires_at: e.target.value }))}
    />
  </div>
</div>

<div className="mt-2 flex gap-2">
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={form.fragile}
      onChange={(e) => setForm((s) => ({ ...s, fragile: e.target.checked }))}
      className="rounded"
    />
    <span className="text-xs">壊れやすい</span>
  </label>
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={form.stackable}
      onChange={(e) => setForm((s) => ({ ...s, stackable: e.target.checked }))}
      className="rounded"
    />
    <span className="text-xs">積み重ね可能</span>
  </label>
</div>

<div className="mt-2">
  <div className="text-xs text-gray-500">メモ</div>
  <textarea
    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
    value={form.notes}
    onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
    placeholder="特記事項など"
    rows={2}
  />
</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-gray-500">W(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.w}
                      onChange={(e) => setForm((s) => ({ ...s, w: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">D(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.d}
                      onChange={(e) => setForm((s) => ({ ...s, d: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">H(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={form.h}
                      onChange={(e) => setForm((s) => ({ ...s, h: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <button
                  className="mt-3 w-full rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90"
                  type="button"
                  onClick={createUnitFromForm}
                >
                  作成（右の一覧に追加）
                </button>
                <button
                  className="mt-2 w-full rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-gray-50 bg-amber-50 border-amber-300"
                  type="button"
                  onClick={addPanel}
                >
                  ＋配電盤
                </button>
              </div>

              <div className="mt-3 rounded-2xl border bg-gray-50 p-3 text-xs text-gray-700">
                作成した荷物は「未配置」一覧に出ます。カードを<strong>押したままドラッグ</strong>して中央へ配置できます。
              </div>

              <div className="mt-3 rounded-2xl border p-3">
                <SectionTitle>未配置（ドラッグで配置）</SectionTitle>
                <div className="space-y-2">
                  {unplaced.length === 0 && <div className="text-sm text-gray-600">未配置の荷物はありません。</div>}
                  {unplaced.map((u) => {
                    const isSel = isItemSelected("unit", u.id);
                    return (
                    <div
  key={u.id}
className={
  "rounded-2xl border bg-white shadow-sm hover:shadow-md cursor-pointer p-2 " +
  (isSel ? "ring-2 ring-black" : "")
}
  onMouseDown={(e) => mode === "operate" && beginMoveUnit(e, u.id)}
  onClick={(e) => handleItemClick(e, "unit", u.id)}
  onDoubleClick={(e) => {
    e.stopPropagation();
    openDetailModal(u);
  }}
                      role="button"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{u.kind}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
  {/* ↓↓↓ 新しいコード ↓↓↓ */}
  <Badge>{u.client}</Badge>
  <Badge color={getStatusColor(u.status)}>
    {getStatusLabel(u.status)}
  </Badge>
  {u.sku && <Badge>SKU: {u.sku}</Badge>}
  {u.weight_kg > 0 && <Badge>{u.weight_kg}kg</Badge>}
  {u.temperature_zone && u.temperature_zone !== "ambient" && (
    <Badge color={getTempZoneColor(u.temperature_zone)}>
      {getTempZoneLabel(u.temperature_zone)}
    </Badge>
  )}
  {/* ↑↑↑ 新しいコード終わり ↑↑↑ */}
</div>
                        </div>
                        <button
                          type="button"
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUnits((prev) => prev.filter((x) => x.id !== u.id));
                            showToast("削除しました");
                          }}
                        >
                          削除
                        </button>
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-600">{u.name}</div>
                      <div className="mt-1 text-xs text-gray-500">（押したままドラッグ）</div>
                    </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-3 shadow-sm">
                <SectionTitle>選択中{selectionSet.length > 1 ? ` (${selectionSet.length}件)` : ""}</SectionTitle>
                {selectionSet.length > 1 ? (
                  <div className="space-y-2">
                    <div className="text-sm text-gray-600">
                      {(() => {
                        const counts = {};
                        for (const s of selectionSet) counts[s.kind] = (counts[s.kind] || 0) + 1;
                        return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
                      })()}
                    </div>
                    <div className="text-xs text-gray-500">選択中のアイテムをドラッグでグループ移動できます。</div>
                    <button
                      className="rounded-xl border px-3 py-2 text-sm hover:bg-red-50 text-red-600 border-red-300 w-full"
                      onClick={() => { removeSelected(); showToast("一括削除しました"); }}
                      type="button"
                    >
                      一括削除 ({selectionSet.length}件)
                    </button>
                  </div>
                ) : !selectedEntity || (selected.kind !== "unit" && selected.kind !== "panel") ? (
                  <div className="text-sm text-gray-600">荷物または配電盤をクリックすると詳細が出ます。Ctrl+クリックで複数選択。</div>
                ) : selected.kind === "panel" ? (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">配電盤: {selectedEntity.name}</div>
                    <div>
                      <div className="text-xs text-gray-500">名前</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={selectedEntity.name || ""}
                        onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, name: e.target.value } : pn)))}
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <div className="text-xs text-gray-500">X</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.x} onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, layout.floor.cols - 1); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, x: v } : pn))); }} inputMode="numeric" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Y</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.y} onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, layout.floor.rows - 1); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, y: v } : pn))); }} inputMode="numeric" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">幅(W)</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.w} onChange={(e) => { const v = clamp(Number(e.target.value) || 1, 1, layout.floor.cols); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, w: v } : pn))); }} inputMode="numeric" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">高さ(H)</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.h} onChange={(e) => { const v = clamp(Number(e.target.value) || 1, 1, layout.floor.rows); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, h: v } : pn))); }} inputMode="numeric" />
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="color" value={selectedEntity.bgColor || "#fef3c7"} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, bgColor: e.target.value } : pn)))} className="w-8 h-8 rounded cursor-pointer border" />
                          <span className="text-xs text-gray-600">背景色</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="color" value={selectedEntity.labelColor || "#000000"} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, labelColor: e.target.value } : pn)))} className="w-8 h-8 rounded cursor-pointer border" />
                          <span className="text-xs text-gray-600">ラベル</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">透明度</div>
                      <div>
                        <label className="text-[10px] text-gray-500">背景: {selectedEntity.bgOpacity ?? 90}%</label>
                        <input type="range" min="0" max="100" value={selectedEntity.bgOpacity ?? 90} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, bgOpacity: Number(e.target.value) } : pn)))} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">詳細情報</div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] text-gray-500">kintoneレコードID</label>
                          <input type="text" className="w-full rounded border px-2 py-1 text-xs" value={selectedEntity.kintoneRecordId || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, kintoneRecordId: e.target.value } : pn)))} placeholder="kintoneレコードID" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">取引先（荷主）</label>
                          <input type="text" className="w-full rounded border px-2 py-1 text-xs" value={selectedEntity.client || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, client: e.target.value } : pn)))} placeholder="取引先名" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">案件名</label>
                          <input type="text" className="w-full rounded border px-2 py-1 text-xs" value={selectedEntity.projectName || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, projectName: e.target.value } : pn)))} placeholder="案件名" />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] text-gray-500">入庫日</label>
                            <input type="date" className="w-full rounded border px-2 py-1 text-xs" value={selectedEntity.arrivalDate || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, arrivalDate: e.target.value || null } : pn)))} />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">出庫日</label>
                            <input type="date" className="w-full rounded border px-2 py-1 text-xs" value={selectedEntity.departureDate || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, departureDate: e.target.value || null } : pn)))} />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500">備考</label>
                          <textarea className="w-full rounded border px-2 py-1 text-xs resize-none" rows={2} value={selectedEntity.notes || ""} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, notes: e.target.value } : pn)))} placeholder="備考を入力" />
                        </div>
                      </div>
                      <button type="button" className="mt-2 w-full rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200" onClick={() => openPanelDetailModal(selectedEntity)}>
                        詳細モーダルを開く
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" type="button" onClick={() => { setPanels((prev) => prev.filter((p) => p.id !== selectedEntity.id)); clearSelection(); showToast("削除しました"); }}>
                        削除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">{selectedEntity.kind}</div>
                    <div className="text-xs text-gray-600">{selectedEntity.name}</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{selectedEntity.client}</Badge>
                      <Badge>qty {selectedEntity.qty}</Badge>
                      <Badge>
                        {selectedEntity.w_m}×{selectedEntity.d_m}×{selectedEntity.h_m}m
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => {
                          setUnits((prev) => prev.map((u) => (u.id === selectedEntity.id ? { ...u, rot: !u.rot } : u)));
                        }}
                      >
                        回転
                      </button>
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => {
                          setUnits((prev) => prev.map((u) => (u.id === selectedEntity.id ? { ...u, loc: { kind: "unplaced" } } : u)));
                          showToast("未配置に戻しました");
                        }}
                      >
                        未配置へ
                      </button>
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => {
                          setUnits((prev) => prev.filter((u) => u.id !== selectedEntity.id));
                          clearSelection();
                          showToast("削除しました");
                        }}
                      >
                        削除
                      </button>
                    </div>

                    {/* サイズ変更UI（セル単位） */}
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">サイズ（セル単位）</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-xs text-gray-500">幅（セル）</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            type="number"
                            min="1"
                            value={selectedEntity.w_cells ?? unitFootprintCells(selectedEntity).w}
                            onChange={(e) => {
                              const v = Math.max(1, Number(e.target.value) || 1);
                              setUnits((prev) =>
                                prev.map((u) =>
                                  u.id === selectedEntity.id ? { ...u, w_cells: v } : u
                                )
                              );
                            }}
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">奥行（セル）</div>
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            type="number"
                            min="1"
                            value={selectedEntity.h_cells ?? unitFootprintCells(selectedEntity).h}
                            onChange={(e) => {
                              const v = Math.max(1, Number(e.target.value) || 1);
                              setUnits((prev) =>
                                prev.map((u) =>
                                  u.id === selectedEntity.id ? { ...u, h_cells: v } : u
                                )
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        右下の三角ハンドルでもリサイズ可能
                      </div>
                    </div>

                    {/* 荷物の色設定 */}
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">色設定</div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={selectedEntity.bgColor || "#ffffff"}
                            onChange={(e) =>
                              setUnits((prev) =>
                                prev.map((u) =>
                                  u.id === selectedEntity.id ? { ...u, bgColor: e.target.value } : u
                                )
                              )
                            }
                            className="w-8 h-8 rounded cursor-pointer border"
                          />
                          <span className="text-xs text-gray-600">背景色</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={selectedEntity.labelColor || "#000000"}
                            onChange={(e) =>
                              setUnits((prev) =>
                                prev.map((u) =>
                                  u.id === selectedEntity.id ? { ...u, labelColor: e.target.value } : u
                                )
                              )
                            }
                            className="w-8 h-8 rounded cursor-pointer border"
                          />
                          <span className="text-xs text-gray-600">ラベル色</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">透明度</div>
                      <div>
                        <label className="text-[10px] text-gray-500">背景: {selectedEntity.bgOpacity ?? 100}%</label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={selectedEntity.bgOpacity ?? 100}
                          onChange={(e) =>
                            setUnits((prev) =>
                              prev.map((u) =>
                                u.id === selectedEntity.id ? { ...u, bgOpacity: Number(e.target.value) } : u
                              )
                            )
                          }
                          className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-3 shadow-sm">
            <SectionTitle>料金（将来）</SectionTitle>
            <div className="text-sm text-gray-700">m²・日 / m³・日 / 場所貸し（ゾーン契約）を組み合わせて請求。</div>
            <div className="mt-2 text-xs text-gray-500">※この画面の占有集計（概算）を土台に、日次スナップショットへ拡張。</div>
          </div>
        </div>
      </div>
      {/* 詳細モーダル */}
      <Modal
        title="荷物詳細"
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailUnit(null);
        }}
      >
        {detailUnit && (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold">{detailUnit.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{detailUnit.client}</Badge>
                <Badge color={getStatusColor(detailUnit.status)}>
                  {getStatusLabel(detailUnit.status)}
                </Badge>
                <Badge color={getConditionColor(detailUnit.condition)}>
                  {getConditionLabel(detailUnit.condition)}
                </Badge>
                {detailUnit.temperature_zone && detailUnit.temperature_zone !== "ambient" && (
                  <Badge color={getTempZoneColor(detailUnit.temperature_zone)}>
                    {getTempZoneLabel(detailUnit.temperature_zone)}
                  </Badge>
                )}
                {detailUnit.fragile && <Badge color="red">壊れやすい</Badge>}
                {detailUnit.stackable && <Badge color="green">積重可</Badge>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">種別</div>
                <div className="text-sm">{detailUnit.kind}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">数量</div>
                <div className="text-sm">{detailUnit.qty}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">SKU</div>
                <div className="text-sm">{detailUnit.sku || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">バーコード</div>
                <div className="text-sm">{detailUnit.barcode || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">ロット番号</div>
                <div className="text-sm">{detailUnit.batch_number || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">重量</div>
                <div className="text-sm">{detailUnit.weight_kg}kg</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">サイズ(W×D×H)</div>
                <div className="text-sm">
                  {detailUnit.w_m}×{detailUnit.d_m}×{detailUnit.h_m}m
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">体積</div>
                <div className="text-sm">
                  {(detailUnit.w_m * detailUnit.d_m * detailUnit.h_m).toFixed(3)}m³
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">入荷日時</div>
                <div className="text-sm">
                  {detailUnit.arrived_at
                    ? new Date(detailUnit.arrived_at).toLocaleString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">賞味期限</div>
                <div className="text-sm">
                  {detailUnit.expires_at
                    ? new Date(detailUnit.expires_at).toLocaleDateString("ja-JP")
                    : "-"}
                </div>
              </div>
            </div>

            {detailUnit.notes && (
              <div>
                <div className="text-xs text-gray-500">メモ</div>
                <div className="mt-1 rounded-xl border bg-gray-50 p-3 text-sm">
                  {detailUnit.notes}
                </div>
              </div>
            )}

            {/* 拡張フィールド */}
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div>
                <div className="text-xs text-gray-500">kintoneレコードID</div>
                <div className="text-sm">{detailUnit.kintoneRecordId || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">案件名</div>
                <div className="text-sm">{detailUnit.projectName || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">入庫日</div>
                <div className="text-sm">
                  {detailUnit.arrivalDate
                    ? new Date(detailUnit.arrivalDate).toLocaleDateString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">出庫日</div>
                <div className="text-sm">
                  {detailUnit.departureDate
                    ? new Date(detailUnit.departureDate).toLocaleDateString("ja-JP")
                    : "-"}
                </div>
              </div>
            </div>

            {/* 内容物 */}
            {detailUnit.contents && detailUnit.contents.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">内容物</div>
                <div className="space-y-1">
                  {detailUnit.contents.map((c, idx) => (
                    <div key={idx} className="flex justify-between rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                      <span>{c.name}</span>
                      <span className="text-gray-600">× {c.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 出庫履歴 */}
            {detailUnit.departureHistory && detailUnit.departureHistory.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">出庫履歴</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {detailUnit.departureHistory.map((dh, idx) => (
                    <div key={idx} className="rounded-xl border p-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {dh.date ? new Date(dh.date).toLocaleDateString("ja-JP") : "-"}
                        </span>
                        <span className="font-semibold">数量: {dh.quantity}</span>
                      </div>
                      <div className="mt-1 text-gray-700">
                        出庫先: {dh.destination || "-"}
                      </div>
                      {dh.notes && (
                        <div className="mt-1 text-gray-500">{dh.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 移動履歴 */}
            {detailUnit.moves && detailUnit.moves.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">移動履歴</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {detailUnit.moves.map((m, idx) => (
                    <div key={idx} className="rounded-xl border p-2 text-xs">
                      <div className="text-gray-500">
                        {new Date(m.timestamp).toLocaleString("ja-JP")}
                      </div>
                      <div className="mt-1">
                        {JSON.stringify(m.from)} → {JSON.stringify(m.to)}
                      </div>
                      <div className="text-gray-600">理由: {m.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="flex-1 rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50"
                type="button"
                onClick={() => {
                  setDetailOpen(false);
                  setDetailUnit(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 配電盤詳細モーダル */}
      <Modal
        title="配電盤詳細"
        open={detailPanelOpen}
        onClose={() => {
          setDetailPanelOpen(false);
          setDetailPanel(null);
        }}
      >
        {detailPanel && (
          <div className="space-y-4">
            {/* ヘッダー */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-lg font-semibold">{detailPanel.name}</div>
              {detailPanel.client && <Badge>{detailPanel.client}</Badge>}
            </div>

            {/* 基本情報 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">kintoneレコードID</div>
                <div className="text-sm">{detailPanel.kintoneRecordId || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">案件名</div>
                <div className="text-sm">{detailPanel.projectName || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">入庫日</div>
                <div className="text-sm">
                  {detailPanel.arrivalDate
                    ? new Date(detailPanel.arrivalDate).toLocaleDateString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">出庫日</div>
                <div className="text-sm">
                  {detailPanel.departureDate
                    ? new Date(detailPanel.departureDate).toLocaleDateString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">位置 (X, Y)</div>
                <div className="text-sm">({detailPanel.x}, {detailPanel.y})</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">サイズ (W × H)</div>
                <div className="text-sm">{detailPanel.w} × {detailPanel.h} セル</div>
              </div>
            </div>

            {/* 備考 */}
            {detailPanel.notes && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-1">備考</div>
                <div className="rounded-xl border p-3 text-sm bg-gray-50 whitespace-pre-wrap">
                  {detailPanel.notes}
                </div>
              </div>
            )}

            {/* 内容物 */}
            {detailPanel.contents && detailPanel.contents.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">内容物</div>
                <div className="space-y-1">
                  {detailPanel.contents.map((c, idx) => (
                    <div key={idx} className="flex justify-between rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                      <span>{c.name}</span>
                      <span className="text-gray-600">× {c.quantity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 出庫履歴 */}
            {detailPanel.departureHistory && detailPanel.departureHistory.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">出庫履歴</div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {detailPanel.departureHistory.map((dh, idx) => (
                    <div key={idx} className="rounded-xl border p-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">
                          {dh.date ? new Date(dh.date).toLocaleDateString("ja-JP") : "-"}
                        </span>
                        <span className="font-semibold">数量: {dh.quantity}</span>
                      </div>
                      <div className="mt-1 text-gray-700">
                        出庫先: {dh.destination || "-"}
                      </div>
                      {dh.notes && (
                        <div className="mt-1 text-gray-500">{dh.notes}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 内容物追加フォーム */}
            <div className="border-t pt-4">
              <div className="text-sm font-semibold mb-2">内容物を追加</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="panel-content-name"
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  placeholder="品名"
                />
                <input
                  type="number"
                  id="panel-content-qty"
                  className="w-20 rounded border px-2 py-1 text-sm"
                  placeholder="数量"
                  min="1"
                  defaultValue="1"
                />
                <button
                  type="button"
                  className="rounded bg-black px-3 py-1 text-sm text-white hover:bg-gray-800"
                  onClick={() => {
                    const nameInput = document.getElementById("panel-content-name");
                    const qtyInput = document.getElementById("panel-content-qty");
                    const name = nameInput?.value?.trim();
                    const qty = Number(qtyInput?.value) || 1;
                    if (!name) return;
                    setPanels((p) =>
                      p.map((pn) =>
                        pn.id === detailPanel.id
                          ? { ...pn, contents: [...(pn.contents || []), { name, quantity: qty }] }
                          : pn
                      )
                    );
                    setDetailPanel((prev) =>
                      prev ? { ...prev, contents: [...(prev.contents || []), { name, quantity: qty }] } : prev
                    );
                    if (nameInput) nameInput.value = "";
                    if (qtyInput) qtyInput.value = "1";
                  }}
                >
                  追加
                </button>
              </div>
            </div>

            {/* 閉じるボタン */}
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50"
                type="button"
                onClick={() => {
                  setDetailPanelOpen(false);
                  setDetailPanel(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function runSelfTests() {
  // Minimal internal tests (run only when ?selftest=1)
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`SelfTest failed: ${msg}`);
  };

  assert(clamp(5, 0, 10) === 5, "clamp within");
  assert(clamp(-1, 0, 10) === 0, "clamp low");
  assert(clamp(11, 0, 10) === 10, "clamp high");

  // overlapsRect sanity
  const overlapsRect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert(overlapsRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 }) === true, "overlap true");
  assert(overlapsRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }) === false, "overlap false");
}

export default function App() {
  const [view, setView] = useState("map"); // map | warehouse
  const [activeWarehouseId, setActiveWarehouseId] = useState(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(null); // 地図上で選択中の倉庫

  const [site, setSite] = useSupabaseState("wh_demo_site_v1", {
    id: "site-1",
    name: "共有ワークスペース 倉庫群",
    map_scale_mode: "ui", // ui | scaled
  });

  const [warehouses, setWarehouses] = useSupabaseState("wh_demo_warehouses_v3", [
    {
      id: "wh-" + uid(),
      name: "第1倉庫",
      area_m2: 1200,
      rack_count: 18,
      lat: 35.6812,
      lng: 139.7671,
      address: "",
      iconImage: "",
      iconSize: 48,
      map_x: 140,
      map_y: 110,
      map_w: 220,
      map_h: 140,
      rotation: 0,
      shape_type: "rect",
      inbound_today: 6,
      outbound_today: 4,
      occupancy_m2: 640,
      occupancy_m3: 980,
    },
    {
      id: "wh-" + uid(),
      name: "第2倉庫",
      area_m2: 800,
      rack_count: 10,
      lat: 35.6895,
      lng: 139.6917,
      address: "",
      iconImage: "",
      iconSize: 48,
      map_x: 420,
      map_y: 220,
      map_w: 190,
      map_h: 120,
      rotation: 0,
      shape_type: "rect",
      inbound_today: 2,
      outbound_today: 7,
      occupancy_m2: 380,
      occupancy_m3: 520,
    },
  ]);

  const activeWarehouse = useMemo(() => warehouses.find((w) => w.id === activeWarehouseId) || null, [
    warehouses,
    activeWarehouseId,
  ]);

  const selectedWarehouse = useMemo(() => warehouses.find((w) => w.id === selectedWarehouseId) || null, [
    warehouses,
    selectedWarehouseId,
  ]);

  // Map pan/zoom
  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Interactions
  const [drag, setDrag] = useState(null);
  // drag: { type: 'pan'|'move'|'resize', id?, startX, startY, basePan?, baseRect? }

  // rAF throttle for map drag
  const rafMoveRef = useRef(null);
  const pendingMoveRef = useRef(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);

  const editTarget = useMemo(() => warehouses.find((w) => w.id === editId) || null, [warehouses, editId]);
  const [editForm, setEditForm] = useState({
    name: "",
    area_m2: "",
    rack_count: "",
    inbound_today: "",
    outbound_today: "",
    occupancy_m2: "",
    occupancy_m3: "",
    address: "",
    lat: "",
    lng: "",
    iconImage: "",
    iconSize: "48",
    pointerLength: "10",
    pointerWidth: "8",
  });
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    if (!editTarget) return;
    setEditForm({
      name: editTarget.name ?? "",
      area_m2: String(editTarget.area_m2 ?? ""),
      rack_count: String(editTarget.rack_count ?? ""),
      inbound_today: String(editTarget.inbound_today ?? ""),
      outbound_today: String(editTarget.outbound_today ?? ""),
      occupancy_m2: String(editTarget.occupancy_m2 ?? ""),
      occupancy_m3: String(editTarget.occupancy_m3 ?? ""),
      address: editTarget.address ?? "",
      lat: String(editTarget.lat ?? "35.68"),
      lng: String(editTarget.lng ?? "139.75"),
      iconImage: editTarget.iconImage ?? "",
      iconSize: String(editTarget.iconSize ?? "48"),
      pointerLength: String(editTarget.pointerLength ?? "10"),
      pointerWidth: String(editTarget.pointerWidth ?? "8"),
    });
  }, [editTarget]);

  async function handleGeocode() {
    if (!editForm.address.trim()) return;
    setGeocoding(true);
    const result = await geocodeAddress(editForm.address);
    setGeocoding(false);
    if (result) {
      setEditForm((s) => ({
        ...s,
        lat: String(result.lat),
        lng: String(result.lng),
      }));
    } else {
      alert("住所が見つかりませんでした。より詳しい住所を入力してください。");
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.location?.search?.includes("selftest=1")) runSelfTests();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }, []);

  function openEdit(id) {
    console.log("openEdit called with id:", id);
    setEditId(id);
    setEditOpen(true);
    console.log("editOpen set to true");
  }

  function saveEdit() {
    if (!editTarget) return;
    const next = warehouses.map((w) => {
      if (w.id !== editTarget.id) return w;
      return {
        ...w,
        name: editForm.name || w.name,
        area_m2: Number(editForm.area_m2) || 0,
        rack_count: Number(editForm.rack_count) || 0,
        inbound_today: Number(editForm.inbound_today) || 0,
        outbound_today: Number(editForm.outbound_today) || 0,
        occupancy_m2: Number(editForm.occupancy_m2) || 0,
        occupancy_m3: Number(editForm.occupancy_m3) || 0,
        address: editForm.address || "",
        lat: Number(editForm.lat) || 35.68,
        lng: Number(editForm.lng) || 139.75,
        iconImage: editForm.iconImage || "",
        iconSize: Number(editForm.iconSize) || 48,
        pointerLength: Number(editForm.pointerLength) || 10,
        pointerWidth: Number(editForm.pointerWidth) || 8,
      };
    });
    setWarehouses(next);
    setEditOpen(false);
  }

  function deleteWarehouse(id) {
    setWarehouses((prev) => prev.filter((w) => w.id !== id));
    if (editId === id) {
      setEditOpen(false);
      setEditId(null);
    }
  }

  function addWarehouse() {
    const id = "wh-" + uid();
    // 地図の中央付近に新規倉庫を配置（少しずらす）
    const baseLat = 35.68 + (warehouses.length * 0.005);
    const baseLng = 139.75 + (warehouses.length * 0.008);
    const nw = {
      id,
      name: `新規倉庫 ${warehouses.length + 1}`,
      area_m2: 500,
      rack_count: 0,
      lat: baseLat,
      lng: baseLng,
      address: "",
      iconImage: "",
      iconSize: 48,
      map_x: 160 + warehouses.length * 24,
      map_y: 140 + warehouses.length * 24,
      map_w: 180,
      map_h: 110,
      rotation: 0,
      shape_type: "rect",
      inbound_today: 0,
      outbound_today: 0,
      occupancy_m2: 0,
      occupancy_m3: 0,
    };
    setWarehouses((prev) => [...prev, nw]);
    setSelectedWarehouseId(id);
    openEdit(id);
  }

  function onWheel(e) {
    // Zoom to cursor
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    const nextZoom = clamp(zoom * factor, 0.5, 2.5);

    const el = containerRef.current;
    if (!el) {
      setZoom(nextZoom);
      return;
    }

    const r = el.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;

    // Keep point under cursor stable
    const wx = (cx - pan.x) / zoom;
    const wy = (cy - pan.y) / zoom;
    const nextPanX = cx - wx * nextZoom;
    const nextPanY = cy - wy * nextZoom;

    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
  }

  function beginPan(e) {
    setDrag({
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      basePan: { ...pan },
    });
  }

  function beginMove(e, id) {
    e.stopPropagation();
    const w = warehouses.find((x) => x.id === id);
    if (!w) return;
    setDrag({
      type: "move",
      id,
      startX: e.clientX,
      startY: e.clientY,
      baseRect: { x: w.map_x, y: w.map_y, w: w.map_w, h: w.map_h },
    });
  }

  function beginResize(e, id) {
    e.stopPropagation();
    const w = warehouses.find((x) => x.id === id);
    if (!w) return;
    setDrag({
      type: "resize",
      id,
      startX: e.clientX,
      startY: e.clientY,
      baseRect: { x: w.map_x, y: w.map_y, w: w.map_w, h: w.map_h },
    });
  }

  function updateByDrag(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;

    if (drag.type === "pan") {
      setPan({
        x: drag.basePan.x + (e.clientX - drag.startX),
        y: drag.basePan.y + (e.clientY - drag.startY),
      });
      return;
    }

    if (drag.type === "move") {
      setWarehouses((prev) =>
        prev.map((w) =>
          w.id === drag.id
            ? {
                ...w,
                map_x: Math.round(drag.baseRect.x + dx),
                map_y: Math.round(drag.baseRect.y + dy),
              }
            : w
        )
      );
      return;
    }

    if (drag.type === "resize") {
      setWarehouses((prev) =>
        prev.map((w) =>
          w.id === drag.id
            ? {
                ...w,
                map_w: Math.round(clamp(drag.baseRect.w + dx, 90, 520)),
                map_h: Math.round(clamp(drag.baseRect.h + dy, 70, 420)),
              }
            : w
        )
      );
    }
  }

  function endDrag() {
    setDrag(null);
  }

  useEffect(() => {
    const onMove = (e) => {
      pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (rafMoveRef.current) return;
      rafMoveRef.current = window.requestAnimationFrame(() => {
        const p = pendingMoveRef.current;
        pendingMoveRef.current = null;
        rafMoveRef.current = null;
        if (p) updateByDrag(p);
      });
    };

    const onUp = () => {
      if (rafMoveRef.current) {
        window.cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
        pendingMoveRef.current = null;
      }
      endDrag();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafMoveRef.current) {
        window.cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
        pendingMoveRef.current = null;
      }
    };
  }, [drag, zoom]);

  const updateWarehouse = useCallback((id, patch) => {
    setWarehouses((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, []);

  if (view === "warehouse" && activeWarehouse) {
    return (
      <WarehouseView
        wh={activeWarehouse}
        onBack={() => {
          setView("map");
          setActiveWarehouseId(null);
        }}
        onUpdateWarehouse={updateWarehouse}
      />
    );
  }

  return (
    <div className="h-screen w-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div>
          <div className="text-sm text-gray-500">TOP（マップ風配置 / 簡易デモ）</div>
          <div className="text-lg font-semibold">{site.name}</div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton title="倉庫を追加" onClick={addWarehouse}>
            ＋ 倉庫追加
          </IconButton>
          <IconButton title="ズームアウト" onClick={() => setZoom((z) => clamp(z * 0.9, 0.5, 2.5))}>
            −
          </IconButton>
          <div className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm">{Math.round(zoom * 100)}%</div>
          <IconButton title="ズームイン" onClick={() => setZoom((z) => clamp(z * 1.1, 0.5, 2.5))}>
            ＋
          </IconButton>
          <IconButton
            title="リセット"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            リセット
          </IconButton>
        </div>
      </div>

      {/* Body */}
      <div className="grid h-[calc(100vh-64px)] grid-cols-[1fr_380px] gap-4 p-4">
        {/* Map */}
        <div className="relative overflow-hidden rounded-2xl border bg-white shadow-sm">
          {/* Hint */}
          <div className="absolute left-4 top-4 z-[1000] rounded-2xl bg-white/90 px-4 py-3 text-sm shadow">
            <div className="font-semibold">操作</div>
            <div className="mt-1 text-xs text-gray-600">
              <ul className="list-disc space-y-1 pl-4">
                <li>マーカー：ドラッグで位置調整</li>
                <li>マーカー：クリックで情報表示</li>
                <li>マーカー：ダブルクリックで倉庫に入る</li>
                <li>マップ：ドラッグで移動 / ホイールでズーム</li>
              </ul>
            </div>
          </div>

          {/* OpenStreetMap */}
          <MapContainer
            center={[35.68, 139.75]}
            zoom={12}
            className="h-full w-full"
            style={{ height: "100%", width: "100%" }}
          >
            <MapStateHandler storageKey="wh_demo_map_state_v1" />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {warehouses.map((w) => (
              <DraggableMarker
                key={w.id}
                position={[w.lat || 35.68, w.lng || 139.75]}
                warehouse={w}
                isSelected={selectedWarehouseId === w.id}
                onPositionChange={(id, lat, lng) => {
                  setWarehouses((prev) =>
                    prev.map((wh) => (wh.id === id ? { ...wh, lat, lng } : wh))
                  );
                }}
                onClick={() => setSelectedWarehouseId(w.id)}
                onDoubleClick={() => {
                  setActiveWarehouseId(w.id);
                  setView("warehouse");
                }}
              />
            ))}
          </MapContainer>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-4 overflow-auto">
          {/* 選択中の倉庫情報 */}
          {selectedWarehouse && (
            <div className="rounded-2xl border bg-blue-50 p-4 shadow-sm">
              <SectionTitle>選択中の倉庫</SectionTitle>
              <div className="flex items-start gap-3">
                {selectedWarehouse.iconImage ? (
                  <img
                    src={selectedWarehouse.iconImage}
                    alt={selectedWarehouse.name}
                    className="h-16 w-16 rounded-lg border object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-white text-2xl">
                    🏭
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-lg font-semibold">{selectedWarehouse.name}</div>
                  {selectedWarehouse.address && (
                    <div className="mt-1 text-xs text-gray-600 truncate">{selectedWarehouse.address}</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge>{fmt(selectedWarehouse.area_m2)} m²</Badge>
                    <Badge>棚 {fmt(selectedWarehouse.rack_count)} 台</Badge>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-600 space-y-1">
                <div>占有: {fmt(selectedWarehouse.occupancy_m2)} m² / {fmt(selectedWarehouse.occupancy_m3)} m³</div>
                <div>今日: 入荷 {fmt(selectedWarehouse.inbound_today)} / 出荷 {fmt(selectedWarehouse.outbound_today)}</div>
                <div className="text-gray-400">
                  位置: {selectedWarehouse.lat?.toFixed(4)}, {selectedWarehouse.lng?.toFixed(4)}
                </div>
              </div>
              <div className="mt-4 flex gap-2 relative z-10">
                <button
                  type="button"
                  className="flex-1 rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-100 active:bg-gray-200 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log("編集ボタンクリック", selectedWarehouse.id);
                    openEdit(selectedWarehouse.id);
                  }}
                >
                  編集
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveWarehouseId(selectedWarehouse.id);
                    setView("warehouse");
                  }}
                >
                  開く
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <SectionTitle
              right={
                <button
                  type="button"
                  className="rounded-xl border bg-white px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
                  onClick={addWarehouse}
                >
                  ＋追加
                </button>
              }
            >
              倉庫一覧
            </SectionTitle>
            <div className="space-y-2">
              {warehouses.map((w) => (
                <div
                  key={w.id}
                  className={`rounded-2xl border p-3 cursor-pointer transition-colors ${
                    selectedWarehouseId === w.id ? "border-blue-500 bg-blue-50" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedWarehouseId(w.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{w.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{fmt(w.area_m2)} m²</Badge>
                        <Badge>棚 {fmt(w.rack_count)} 台</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rounded-xl border bg-blue-500 text-white px-2 py-1 text-xs hover:bg-blue-600 active:bg-blue-700 cursor-pointer"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          console.log("編集mousedown", w.id);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          console.log("倉庫一覧 編集クリック", w.id);
                          openEdit(w.id);
                        }}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border px-2 py-1 text-xs hover:bg-gray-100 active:bg-gray-200 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveWarehouseId(w.id);
                          setView("warehouse");
                        }}
                      >
                        開く
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-gray-600">
                    占有 {fmt(w.occupancy_m2)} m² / {fmt(w.occupancy_m3)} m³
                  </div>
                </div>
              ))}
              {warehouses.length === 0 && (
                <div className="rounded-2xl border bg-gray-50 p-4 text-sm text-gray-600">
                  倉庫がありません。右上の「＋ 倉庫追加」から作成できます。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <SectionTitle>次に実装するところ（このデモの続き）</SectionTitle>
            <div className="space-y-2 text-sm text-gray-700">
              <div className="rounded-xl border p-3">
                <div className="font-semibold">倉庫内部</div>
                <div className="mt-1 text-xs text-gray-600">床グリッド（ゾーン）＋棚ラック（スロット）＋荷物DnD＋入出荷カレンダー連動</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="font-semibold">スプレッドシート連携</div>
                <div className="mt-1 text-xs text-gray-600">予定（Sheets）→表示（アプリ）→実績（アプリ）→書き戻し（Sheets）</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="font-semibold">料金</div>
                <div className="mt-1 text-xs text-gray-600">日次スナップショット生成 → 取引先別 m²・日 / m³・日 + 場所貸しを計算</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* デバッグ: editOpen={String(editOpen)}, editId={editId}, editTarget={editTarget?.name} */}
      {editOpen && console.log("Modal should render: editOpen=", editOpen, "editTarget=", editTarget)}
      <Modal title={editTarget ? `倉庫設定：${editTarget.name}` : "倉庫設定"} open={editOpen} onClose={() => setEditOpen(false)}>
        {!editTarget ? (
          <div className="text-sm text-gray-600">対象が見つかりません。editId: {editId}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">倉庫名</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.name}
                  onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">面積（m²）</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.area_m2}
                  onChange={(e) => setEditForm((s) => ({ ...s, area_m2: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">棚台数</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.rack_count}
                  onChange={(e) => setEditForm((s) => ({ ...s, rack_count: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">今日 入荷</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.inbound_today}
                  onChange={(e) => setEditForm((s) => ({ ...s, inbound_today: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">今日 出荷</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.outbound_today}
                  onChange={(e) => setEditForm((s) => ({ ...s, outbound_today: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">占有（m²）</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.occupancy_m2}
                  onChange={(e) => setEditForm((s) => ({ ...s, occupancy_m2: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">占有（m³）</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.occupancy_m3}
                  onChange={(e) => setEditForm((s) => ({ ...s, occupancy_m3: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
            </div>

            {/* 住所入力とジオコーディング */}
            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500 mb-1">住所（地図上の位置を設定）</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border px-3 py-2 text-sm"
                  value={editForm.address}
                  onChange={(e) => setEditForm((s) => ({ ...s, address: e.target.value }))}
                  placeholder="例: 東京都千代田区丸の内1-1-1"
                />
                <button
                  type="button"
                  className="rounded-xl border bg-blue-500 text-white px-4 py-2 text-sm hover:bg-blue-600 disabled:opacity-50"
                  onClick={handleGeocode}
                  disabled={geocoding || !editForm.address.trim()}
                >
                  {geocoding ? "検索中..." : "検索"}
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                住所を入力して「検索」を押すと、緯度・経度が自動設定されます。マーカーをドラッグして微調整も可能です。
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-500">緯度（lat）</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.lat}
                  onChange={(e) => setEditForm((s) => ({ ...s, lat: e.target.value }))}
                  inputMode="decimal"
                  placeholder="35.6812"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">経度（lng）</div>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={editForm.lng}
                  onChange={(e) => setEditForm((s) => ({ ...s, lng: e.target.value }))}
                  inputMode="decimal"
                  placeholder="139.7671"
                />
              </div>
            </div>

            {/* アイコン設定 */}
            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500 mb-2 font-semibold">地図アイコン設定</div>
              <div className="flex gap-3 items-start">
                {/* プレビュー */}
                <div className="flex-shrink-0">
                  {editForm.iconImage ? (
                    <img
                      src={editForm.iconImage}
                      alt="アイコンプレビュー"
                      className="rounded-lg border object-cover"
                      style={{ width: Number(editForm.iconSize) || 48, height: Number(editForm.iconSize) || 48 }}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center rounded-lg border bg-gray-100"
                      style={{ width: Number(editForm.iconSize) || 48, height: Number(editForm.iconSize) || 48 }}
                    >
                      <span style={{ fontSize: Math.max(16, (Number(editForm.iconSize) || 48) * 0.5) }}>🏭</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-xs text-gray-500">画像URL（空欄で絵文字アイコン）</div>
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                      value={editForm.iconImage}
                      onChange={(e) => setEditForm((s) => ({ ...s, iconImage: e.target.value }))}
                      placeholder="https://example.com/image.png"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">アイコンサイズ（px）: {editForm.iconSize}</div>
                    <input
                      type="range"
                      min="32"
                      max="96"
                      step="8"
                      value={editForm.iconSize}
                      onChange={(e) => setEditForm((s) => ({ ...s, iconSize: e.target.value }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">吹き出しの長さ（px）: {editForm.pointerLength}</div>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="2"
                      value={editForm.pointerLength}
                      onChange={(e) => setEditForm((s) => ({ ...s, pointerLength: e.target.value }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">吹き出しの幅（px）: {editForm.pointerWidth}</div>
                    <input
                      type="range"
                      min="4"
                      max="24"
                      step="2"
                      value={editForm.pointerWidth}
                      onChange={(e) => setEditForm((s) => ({ ...s, pointerWidth: e.target.value }))}
                      className="mt-1 w-full"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-gray-50 p-3 text-xs text-gray-700">
              <div className="font-semibold">この画面で想定していること</div>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>ここは「倉庫メタ設定（名前/面積/課金設定/床グリッド/棚構成）」の入口</li>
                <li>床グリッドや棚構成の詳細編集は倉庫内部の「レイアウト編集モード」で拡張</li>
                <li>縮小などの衝突は「退避エリア」or「影響リスト」で安全に適用</li>
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50"
                onClick={() => deleteWarehouse(editTarget.id)}
              >
                削除
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setEditOpen(false)}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  className="rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90"
                  onClick={saveEdit}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
