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
      .then(({ data }) => {
        if (data?.value != null) {
          setValue(data.value);
          localStorage.setItem(key, JSON.stringify(data.value));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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

// ─── CSS 2.5D アイソメトリックビュー ───
function IsometricView({ units, layout, panels, onClose }) {
  const [viewTarget, setViewTarget] = useState("floor"); // "floor" | "zone-<id>" | "rack-<id>" | "shelf-<id>"
  const [rotStep, setRotStep] = useState(0); // 0=default, 1=90°, 2=180°, 3=270°
  const [zoomLevel, setZoomLevel] = useState(1);

  const fx = layout.floor.x || 0;
  const fy = layout.floor.y || 0;
  const cellMW = layout.floor.cell_m_w || 1.2;
  const cellMD = layout.floor.cell_m_d || 1.0;

  // Compute footprint in cells (same logic as WarehouseView.unitFootprintCells)
  function footprint(u) {
    if (u.w_cells != null && u.h_cells != null) {
      const fw = Math.max(1, u.w_cells); const fd = Math.max(1, u.h_cells);
      return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
    }
    const fw = Math.max(1, Math.ceil(u.w_m / cellMW));
    const fd = Math.max(1, Math.ceil(u.d_m / cellMD));
    return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
  }

  // Real-world size in fractional cell units (for 3D rendering with actual dimensions)
  function realFootprint(u) {
    const fw = Math.max(0.2, (u.w_m || cellMW) / cellMW);
    const fd = Math.max(0.2, (u.d_m || cellMD) / cellMD);
    return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
  }

  // Convert a panel to a unit-like object for 3D rendering
  function panelAsUnit(p) {
    return {
      id: p.id,
      kind: "配電盤",
      name: p.name || "配電盤",
      w_m: p.w_m || (p.w || 2) * cellMW,
      d_m: p.d_m || (p.h || 2) * cellMD,
      h_m: p.h_m || 1.8,
      rot: false,
      bgColor: p.bgColor || "#fef3c7",
      fragile: false,
      loc: p.loc?.kind === "shelf"
        ? { kind: "shelf", shelfId: p.loc.shelfId, x: p.loc.x, y: p.loc.y }
        : { kind: "floor", x: p.x, y: p.y },
    };
  }

  // Determine visible area & items based on viewTarget
  let viewCols, viewRows, viewLabel, viewItems, viewRacks, viewZones, viewBgColor;
  if (viewTarget === "floor") {
    viewCols = layout.floor.cols;
    viewRows = layout.floor.rows;
    viewLabel = "床全体";
    viewBgColor = layout.floor.floorBgColor || "#ffffff";
    viewItems = units.filter((u) => u.loc?.kind === "floor").map((u) => {
      const fp = realFootprint(u);
      return { ...u, gx: (u.loc.x || 0) - fx, gy: (u.loc.y || 0) - fy, fw: fp.w, fh: fp.h };
    });
    // Add floor panels
    for (const p of (panels || [])) {
      if (p.loc?.kind === "shelf") continue;
      const pu = panelAsUnit(p);
      const fp = realFootprint(pu);
      viewItems.push({ ...pu, gx: (p.x || 0) - fx, gy: (p.y || 0) - fy, fw: fp.w, fh: fp.h });
    }
    viewRacks = layout.racks.map((r) => ({ ...r, gx: r.x - fx, gy: r.y - fy }));
    viewZones = layout.zones.filter((z) => !z.loc || z.loc.kind === "floor").map((z) => ({ ...z, gx: z.x - fx, gy: z.y - fy }));
  } else if (viewTarget.startsWith("zone-")) {
    const zoneId = viewTarget.slice(5);
    const zone = layout.zones.find((z) => z.id === zoneId);
    if (zone) {
      viewCols = zone.w; viewRows = zone.h;
      viewLabel = zone.name;
      viewBgColor = zone.bgColor || "#d1fae5";
      if (zone.loc?.kind === "shelf") {
        // Zone is on a shelf - show shelf units within the zone area
        const shelfId = zone.loc.shelfId;
        const zx = zone.loc.x || 0, zy = zone.loc.y || 0;
        viewItems = units.filter((u) => u.loc?.kind === "shelf" && u.loc.shelfId === shelfId).map((u) => {
          const fp = realFootprint(u);
          return { ...u, gx: (u.loc.x || 0) - zx, gy: (u.loc.y || 0) - zy, fw: fp.w, fh: fp.h };
        }).filter((u) => u.gx >= 0 && u.gy >= 0 && u.gx < zone.w && u.gy < zone.h);
        // Add shelf panels within zone
        for (const p of (panels || [])) {
          if (p.loc?.kind !== "shelf" || p.loc.shelfId !== shelfId) continue;
          const pgx = (p.loc.x || 0) - zx, pgy = (p.loc.y || 0) - zy;
          if (pgx < 0 || pgy < 0 || pgx >= zone.w || pgy >= zone.h) continue;
          const pu = panelAsUnit(p);
          const fp = realFootprint(pu);
          viewItems.push({ ...pu, gx: pgx, gy: pgy, fw: fp.w, fh: fp.h });
        }
      } else {
        // Zone is on the floor - show floor units within the zone area
        viewItems = units.filter((u) => u.loc?.kind === "floor").map((u) => {
          const fp = realFootprint(u);
          return { ...u, gx: (u.loc.x||0) - zone.x, gy: (u.loc.y||0) - zone.y, fw: fp.w, fh: fp.h };
        }).filter((u) => u.gx >= 0 && u.gy >= 0 && u.gx < zone.w && u.gy < zone.h);
        // Add floor panels within zone
        for (const p of (panels || [])) {
          if (p.loc?.kind === "shelf") continue;
          const pgx = (p.x || 0) - zone.x, pgy = (p.y || 0) - zone.y;
          if (pgx < 0 || pgy < 0 || pgx >= zone.w || pgy >= zone.h) continue;
          const pu = panelAsUnit(p);
          const fp = realFootprint(pu);
          viewItems.push({ ...pu, gx: pgx, gy: pgy, fw: fp.w, fh: fp.h });
        }
      }
      viewRacks = []; viewZones = [];
    } else { viewCols = 1; viewRows = 1; viewLabel = "?"; viewItems = []; viewRacks = []; viewZones = []; }
  } else if (viewTarget.startsWith("rack-")) {
    const rackId = viewTarget.slice(5);
    const rack = layout.racks.find((r) => r.id === rackId);
    if (rack) {
      viewCols = rack.w; viewRows = rack.h;
      viewLabel = rack.name;
      viewBgColor = rack.bgColor || "#f1f5f9";
      const rackUnits = units.filter((u) => u.loc?.kind === "rack" && u.loc.rackId === rackId);
      viewItems = rackUnits.map((u) => {
        const slot = u.loc.slot || 0;
        const rCols = rack.cols || 1;
        const col = slot % rCols;
        const row = Math.floor(slot / rCols);
        const slotW = Math.floor(rack.w / rCols);
        const slotH = Math.floor(rack.h / (rack.rows || 1));
        return { ...u, gx: col * slotW, gy: row * slotH, fw: slotW, fh: slotH };
      });
      viewRacks = []; viewZones = [];
    } else { viewCols = 1; viewRows = 1; viewLabel = "?"; viewItems = []; viewRacks = []; viewZones = []; }
  } else if (viewTarget.startsWith("shelf-")) {
    const shelfId = viewTarget.slice(6);
    const shelf = (layout.shelves || []).find((s) => s.id === shelfId);
    if (shelf) {
      viewCols = shelf.w; viewRows = shelf.h;
      viewLabel = shelf.name || "棚";
      viewBgColor = shelf.bgColor || "#f0fdfa";
      const shelfUnits = units.filter((u) => u.loc?.kind === "shelf" && u.loc.shelfId === shelfId);
      viewItems = shelfUnits.map((u) => {
        const fp = realFootprint(u);
        return { ...u, gx: u.loc.x || 0, gy: u.loc.y || 0, fw: fp.w, fh: fp.h };
      });
      // Add shelf panels
      for (const p of (panels || [])) {
        if (p.loc?.kind !== "shelf" || p.loc.shelfId !== shelfId) continue;
        const pu = panelAsUnit(p);
        const fp = realFootprint(pu);
        viewItems.push({ ...pu, gx: p.loc.x || 0, gy: p.loc.y || 0, fw: fp.w, fh: fp.h });
      }
      viewRacks = [];
      viewZones = layout.zones.filter((z) => z.loc?.kind === "shelf" && z.loc.shelfId === shelfId).map((z) => ({ ...z, gx: z.loc.x || 0, gy: z.loc.y || 0 }));
    } else { viewCols = 1; viewRows = 1; viewLabel = "?"; viewItems = []; viewRacks = []; viewZones = []; }
  } else {
    viewCols = layout.floor.cols; viewRows = layout.floor.rows;
    viewLabel = "床全体"; viewItems = []; viewRacks = []; viewZones = [];
  }

  // Apply rotation to a single point (for stacking grouping)
  function rotateGxGy(gx, gy) {
    const step = rotStep % 4;
    if (step === 0) return { rx: gx, ry: gy };
    if (step === 1) return { rx: viewRows - 1 - gy, ry: gx }; // 90° CW
    if (step === 2) return { rx: viewCols - 1 - gx, ry: viewRows - 1 - gy }; // 180°
    return { rx: gy, ry: viewCols - 1 - gx }; // 270° CW
  }

  // Rotate a rectangle: correctly computes the new top-left anchor + swapped dimensions
  function rotateRect(gx, gy, w, h) {
    const step = rotStep % 4;
    if (step === 0) return { rx: gx, ry: gy, rw: w, rh: h };
    if (step === 1) return { rx: viewRows - gy - h, ry: gx, rw: h, rh: w };
    if (step === 2) return { rx: viewCols - gx - w, ry: viewRows - gy - h, rw: w, rh: h };
    return { rx: gy, ry: viewCols - gx - w, rw: h, rh: w };
  }
  const effectiveCols = (rotStep % 2 === 0) ? viewCols : viewRows;
  const effectiveRows = (rotStep % 2 === 0) ? viewRows : viewCols;

  // Group stacks by position (after rotation)
  const stacks = {};
  for (const u of viewItems) {
    const { rx, ry } = rotateGxGy(u.gx, u.gy);
    const key = `${rx},${ry}`;
    if (!stacks[key]) stacks[key] = [];
    stacks[key].push({ ...u, rx, ry });
  }
  for (const k of Object.keys(stacks)) stacks[k].sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));

  // Isometric settings - scale based on view size
  const baseTile = Math.max(16, Math.min(50, Math.floor(600 / Math.max(effectiveCols, effectiveRows))));
  const tileW = baseTile;
  const tileH = baseTile / 2;
  const heightScale = baseTile * 0.6;

  // Convert grid to isometric screen
  const toIso = (gx, gy) => ({
    sx: (gx - gy) * (tileW / 2),
    sy: (gx + gy) * (tileH / 2),
  });

  // Canvas bounds
  const allCorners = [
    toIso(0, 0), toIso(effectiveCols, 0), toIso(0, effectiveRows), toIso(effectiveCols, effectiveRows),
  ];
  const maxStackH = viewItems.reduce((m, u) => Math.max(m, (u.stackZ || 0) + (u.h_m || 1)), 0);
  const minSx = Math.min(...allCorners.map((c) => c.sx)) - 60;
  const maxSx = Math.max(...allCorners.map((c) => c.sx)) + 60;
  const minSy = Math.min(...allCorners.map((c) => c.sy)) - Math.max(200, maxStackH * heightScale + 80);
  const maxSy = Math.max(...allCorners.map((c) => c.sy)) + 60;
  const svgW = maxSx - minSx;
  const svgH = maxSy - minSy;
  const offX = -minSx;
  const offY = -minSy;

  const boxColors = [
    "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa",
    "#fb923c", "#38bdf8", "#4ade80", "#facc15", "#f472b6",
  ];

  // Stable hash from string → consistent color index regardless of sort order
  function stableColorIndex(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return ((h % boxColors.length) + boxColors.length) % boxColors.length;
  }

  // Kind-specific colors (fallback uses stable hash of item id)
  function kindColor(kind, id) {
    if (kind === "配電盤") return "#fbbf24";
    if (kind === "パレット") return "#60a5fa";
    if (kind === "カゴ") return "#34d399";
    return boxColors[stableColorIndex(id || "")];
  }

  // Render order: back to front
  const renderItems = [];
  for (const [key, stack] of Object.entries(stacks)) {
    for (const u of stack) {
      const fw_orig = u.fw || 1;
      const fh_orig = u.fh || 1;
      const isPanel = u.kind === "配電盤";
      // Use rotateRect to get the correct bounding box anchor + swapped dimensions
      const { rx: renderGx, ry: renderGy, rw: fw, rh: fh } = rotateRect(u.gx, u.gy, fw_orig, fh_orig);
      renderItems.push({ u, gx: renderGx, gy: renderGy, fw, fh, zOff: isPanel ? 0 : (u.stackZ || 0), h: u.h_m || 1 });
    }
  }
  renderItems.sort((a, b) => {
    const depthA = a.gx + a.gy;
    const depthB = b.gx + b.gy;
    if (depthA !== depthB) return depthA - depthB;
    return a.zOff - b.zOff;
  });

  // Draw an isometric box (proper corner-based projection)
  function IsoBox({ gx, gy, w, d, zOff, h, color, label, isFragile }) {
    // Compute the 4 corners of the base rectangle using toIso for correct projection
    const p0 = toIso(gx, gy);           // back corner (top in screen)
    const p1 = toIso(gx + w, gy);       // right corner
    const p2 = toIso(gx + w, gy + d);   // front corner (bottom in screen)
    const p3 = toIso(gx, gy + d);       // left corner

    const lift = zOff * heightScale;
    const bH = h * heightScale;

    // Screen coordinates with offset
    const ox = (p) => p.sx + offX;
    const oy = (p, up) => p.sy + offY - up;

    // Top face (at height lift + bH)
    const topH = lift + bH;
    const topPoints = [
      `${ox(p0)}px ${oy(p0, topH)}px`, `${ox(p1)}px ${oy(p1, topH)}px`,
      `${ox(p2)}px ${oy(p2, topH)}px`, `${ox(p3)}px ${oy(p3, topH)}px`,
    ].join(", ");

    // Left face: p3-top → p2-top → p2-bottom → p3-bottom
    const leftPoints = [
      `${ox(p3)}px ${oy(p3, topH)}px`, `${ox(p2)}px ${oy(p2, topH)}px`,
      `${ox(p2)}px ${oy(p2, lift)}px`, `${ox(p3)}px ${oy(p3, lift)}px`,
    ].join(", ");

    // Right face: p2-top → p1-top → p1-bottom → p2-bottom
    const rightPoints = [
      `${ox(p2)}px ${oy(p2, topH)}px`, `${ox(p1)}px ${oy(p1, topH)}px`,
      `${ox(p1)}px ${oy(p1, lift)}px`, `${ox(p2)}px ${oy(p2, lift)}px`,
    ].join(", ");

    // Label position: center of top face
    const cx = (ox(p0) + ox(p1) + ox(p2) + ox(p3)) / 4;
    const cy = (oy(p0, topH) + oy(p1, topH) + oy(p2, topH) + oy(p3, topH)) / 4;

    return (
      <g>
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPoints})`, background: color, filter: "brightness(0.7)" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPoints})`, background: color, filter: "brightness(0.85)" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPoints})`, background: color }} />
        {label && (
          <div style={{ position: "absolute", left: cx - 30, top: cy - 8, width: 60, textAlign: "center", fontSize: 9, fontWeight: 700, color: "#1e293b", pointerEvents: "none", textShadow: "0 0 3px rgba(255,255,255,0.9)" }}>
            {label}
          </div>
        )}
        {isFragile && (
          <div style={{ position: "absolute", left: cx - 6, top: cy - 14, fontSize: 11, pointerEvents: "none" }}>⚠</div>
        )}
      </g>
    );
  }

  // Rotate racks/zones grid coords using rotateRect for correct anchor
  const rotatedRacks = viewRacks.map((r) => {
    const { rx, ry, rw, rh } = rotateRect(r.gx, r.gy, r.w, r.h);
    return { ...r, gx: rx, gy: ry, w: rw, h: rh };
  });
  const rotatedZones = viewZones.map((z) => {
    const { rx, ry, rw, rh } = rotateRect(z.gx, z.gy, z.w, z.h);
    return { ...z, gx: rx, gy: ry, w: rw, h: rh };
  });

  const rotLabels = ["0°", "90°", "180°", "270°"];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50000,
      background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div
        style={{
          background: "#fff",
          borderRadius: 24,
          boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
          padding: 24,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>3D ビュー</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={viewTarget}
              onChange={(e) => setViewTarget(e.target.value)}
              style={{ borderRadius: 12, border: "2px solid #e2e8f0", padding: "8px 12px", fontSize: 13, fontWeight: 600, background: "#f8fafc", cursor: "pointer" }}
            >
              <option value="floor">床全体</option>
              {layout.zones.map((z) => (
                <option key={z.id} value={`zone-${z.id}`}>区画: {z.name}</option>
              ))}
              {layout.racks.map((r) => (
                <option key={r.id} value={`rack-${r.id}`}>ラック: {r.name}</option>
              ))}
              {(layout.shelves || []).map((s) => (
                <option key={s.id} value={`shelf-${s.id}`}>棚: {s.name || s.id}</option>
              ))}
            </select>
            <button type="button" onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 12, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>
              閉じる
            </button>
          </div>
        </div>

        {/* Controls: rotation + zoom */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>
            {viewLabel} ({effectiveCols} x {effectiveRows} セル)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setRotStep((r) => (r + 3) % 4)}
              style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}
              title="左に90°回転"
            >↶</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", minWidth: 30, textAlign: "center" }}>{rotLabels[rotStep]}</span>
            <button
              type="button"
              onClick={() => setRotStep((r) => (r + 1) % 4)}
              style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}
              title="右に90°回転"
            >↷</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.max(0.3, z - 0.2))}
              style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}
            >−</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", minWidth: 40, textAlign: "center" }}>{Math.round(zoomLevel * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoomLevel((z) => Math.min(3, z + 0.2))}
              style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}
            >+</button>
          </div>
        </div>

        {/* Floor grid + boxes */}
        <div
          style={{ overflow: "auto", maxWidth: "85vw", maxHeight: "65vh" }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoomLevel((z) => Math.min(3, Math.max(0.3, z + (e.deltaY < 0 ? 0.1 : -0.1))));
            }
          }}
        >
          <div style={{ position: "relative", width: svgW * zoomLevel, height: svgH * zoomLevel, margin: "0 auto" }}>
            <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top left", position: "relative", width: svgW, height: svgH }}>
              {/* Floor tiles */}
              {Array.from({ length: effectiveRows }, (_, gy) =>
                Array.from({ length: effectiveCols }, (_, gx) => {
                  const { sx, sy } = toIso(gx, gy);
                  const x = sx + offX;
                  const y = sy + offY;
                  const points = [
                    `${x}px ${y}px`, `${x + tileW / 2}px ${y + tileH / 2}px`,
                    `${x}px ${y + tileH}px`, `${x - tileW / 2}px ${y + tileH / 2}px`,
                  ].join(", ");
                  const baseBg = viewBgColor || "#ffffff";
                  const baseBgRgb = hexToRgb(baseBg);
                  const tileLight = `rgba(${baseBgRgb.join(",")}, 0.9)`;
                  const tileDark = `rgba(${baseBgRgb.map((c) => Math.max(0, c - 20)).join(",")}, 0.9)`;
                  return (
                    <div key={`f-${gx}-${gy}`} style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${points})`, background: (gx + gy) % 2 === 0 ? tileDark : tileLight }} />
                  );
                })
              )}

              {/* Zone outlines */}
              {rotatedZones.map((zone) => {
                const zp0 = toIso(zone.gx, zone.gy);
                const zp1 = toIso(zone.gx + zone.w, zone.gy);
                const zp2 = toIso(zone.gx + zone.w, zone.gy + zone.h);
                const zp3 = toIso(zone.gx, zone.gy + zone.h);
                const pts = [
                  `${zp0.sx + offX}px ${zp0.sy + offY}px`, `${zp1.sx + offX}px ${zp1.sy + offY}px`,
                  `${zp2.sx + offX}px ${zp2.sy + offY}px`, `${zp3.sx + offX}px ${zp3.sy + offY}px`,
                ].join(", ");
                const zcx = (zp0.sx + zp1.sx + zp2.sx + zp3.sx) / 4 + offX;
                const zcy = (zp0.sy + zp1.sy + zp2.sy + zp3.sy) / 4 + offY;
                const zoneBgRgb = hexToRgb(zone.bgColor || "#d1fae5");
                const zoneOpacity = (zone.bgOpacity ?? 90) / 100;
                return (
                  <div key={`zone-${zone.id}`}>
                    <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${pts})`, background: `rgba(${zoneBgRgb.join(",")}, ${zoneOpacity})` }} />
                    <div style={{ position: "absolute", left: zcx - 30, top: zcy - 6, width: 60, textAlign: "center", fontSize: 9, fontWeight: 700, color: zone.labelColor || "#334155", textShadow: "0 0 3px #fff" }}>{zone.name}</div>
                  </div>
                );
              })}

              {/* Rack outlines */}
              {rotatedRacks.map((rack) => {
                const rp0 = toIso(rack.gx, rack.gy);
                const rp1 = toIso(rack.gx + rack.w, rack.gy);
                const rp2 = toIso(rack.gx + rack.w, rack.gy + rack.h);
                const rp3 = toIso(rack.gx, rack.gy + rack.h);
                const rH = 2 * heightScale;
                const rox = (p) => p.sx + offX;
                const roy = (p, up) => p.sy + offY - up;
                const topPts = [
                  `${rox(rp0)}px ${roy(rp0, rH)}px`, `${rox(rp1)}px ${roy(rp1, rH)}px`,
                  `${rox(rp2)}px ${roy(rp2, rH)}px`, `${rox(rp3)}px ${roy(rp3, rH)}px`,
                ].join(", ");
                const leftPts = [
                  `${rox(rp3)}px ${roy(rp3, rH)}px`, `${rox(rp2)}px ${roy(rp2, rH)}px`,
                  `${rox(rp2)}px ${roy(rp2, 0)}px`, `${rox(rp3)}px ${roy(rp3, 0)}px`,
                ].join(", ");
                const rightPts = [
                  `${rox(rp2)}px ${roy(rp2, rH)}px`, `${rox(rp1)}px ${roy(rp1, rH)}px`,
                  `${rox(rp1)}px ${roy(rp1, 0)}px`, `${rox(rp2)}px ${roy(rp2, 0)}px`,
                ].join(", ");
                const rcx = (rox(rp0) + rox(rp1) + rox(rp2) + rox(rp3)) / 4;
                const rcy = (roy(rp0, rH) + roy(rp1, rH) + roy(rp2, rH) + roy(rp3, rH)) / 4;
                const rackColor = rack.bgColor || "#94a3b8";
                return (
                  <div key={`rack-${rack.id}`}>
                    <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPts})`, background: rackColor, filter: "brightness(0.7)" }} />
                    <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPts})`, background: rackColor, filter: "brightness(0.85)" }} />
                    <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPts})`, background: rackColor }} />
                    <div style={{ position: "absolute", left: rcx - 20, top: rcy - 8, width: 40, textAlign: "center", fontSize: 8, fontWeight: 700, color: rack.labelColor || "#334155", textShadow: "0 0 3px #fff" }}>{rack.name || "棚"}</div>
                  </div>
                );
              })}

              {/* Isometric boxes for units */}
              {renderItems.map(({ u, gx, gy, fw, fh, zOff, h }, idx) => (
                <IsoBox
                  key={u.id + "-" + idx}
                  gx={gx} gy={gy}
                  w={fw} d={fh}
                  zOff={zOff} h={h}
                  color={u.bgColor || kindColor(u.kind, u.id)}
                  label={u.kind}
                  isFragile={u.fragile}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#64748b", alignItems: "center" }}>
          <span>荷物: {viewItems.length}個</span>
          <span>スタック: {Object.values(stacks).filter((s) => s.length > 1).length}箇所</span>
          {rotatedRacks.length > 0 && <><span style={{ color: "#94a3b8" }}>■</span><span>ラック {rotatedRacks.length}</span></>}
          {rotatedZones.length > 0 && <><span style={{ color: "#86efac" }}>■</span><span>区画 {rotatedZones.length}</span></>}
          <span style={{ color: "#94a3b8", fontSize: 11 }}>※ Ctrl+ホイールで拡大縮小</span>
        </div>
      </div>
    </div>
  );
}

// 日本の祝日判定（外部ライブラリ不要）
function getJapaneseHolidays(year) {
  const holidays = new Set();
  const add = (m, d) => holidays.add(`${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);

  // 固定祝日
  add(1, 1);   // 元日
  add(2, 11);  // 建国記念の日
  add(2, 23);  // 天皇誕生日
  add(4, 29);  // 昭和の日
  add(5, 3);   // 憲法記念日
  add(5, 4);   // みどりの日
  add(5, 5);   // こどもの日
  add(8, 11);  // 山の日
  add(11, 3);  // 文化の日
  add(11, 23); // 勤労感謝の日

  // ハッピーマンデー
  const nthMonday = (m, n) => {
    const first = new Date(year, m - 1, 1).getDay();
    return (n - 1) * 7 + ((8 - first) % 7) + 1;
  };
  add(1, nthMonday(1, 2));   // 成人の日（1月第2月曜）
  add(7, nthMonday(7, 3));   // 海の日（7月第3月曜）
  add(9, nthMonday(9, 3));   // 敬老の日（9月第3月曜）
  add(10, nthMonday(10, 2)); // スポーツの日（10月第2月曜）

  // 春分の日・秋分の日（近似計算）
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const shubun = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(3, shunbun);
  add(9, shubun);

  // 振替休日：祝日が日曜なら翌月曜
  const fmt = (m, d) => `${year}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  for (const h of [...holidays]) {
    const [, mm, dd] = h.split("-").map(Number);
    const dt = new Date(year, mm - 1, dd);
    if (dt.getDay() === 0) {
      let next = new Date(dt);
      next.setDate(next.getDate() + 1);
      while (holidays.has(fmt(next.getMonth() + 1, next.getDate()))) {
        next.setDate(next.getDate() + 1);
      }
      holidays.add(fmt(next.getMonth() + 1, next.getDate()));
    }
  }

  // 国民の休日（祝日に挟まれた平日）
  for (const h of [...holidays]) {
    const [, mm, dd] = h.split("-").map(Number);
    const next2 = fmt(mm, dd + 2);
    if (holidays.has(next2)) {
      const between = new Date(year, mm - 1, dd + 1);
      if (between.getDay() !== 0) {
        const bKey = fmt(between.getMonth() + 1, between.getDate());
        if (!holidays.has(bKey)) holidays.add(bKey);
      }
    }
  }

  return holidays;
}

function CalendarStub({ selectedDate, onPick }) {
  // Very simple month grid (no locale edge cases)
  const d = new Date(selectedDate);
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const holidays = useMemo(() => getJapaneseHolidays(year), [year]);

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  const dayHeaders = "日月火水木金土".split("");

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

      <div className="grid grid-cols-7 gap-1 text-xs">
        {dayHeaders.map((w, i) => (
          <div
            key={w}
            className="py-1 text-center font-medium"
            style={{ color: i === 0 ? "#ef4444" : i === 6 ? "#3b82f6" : "#4b5563" }}
          >
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
          const dow = idx % 7;
          const isHoliday = cd && holidays.has(
            `${cd.getFullYear()}-${String(cd.getMonth()+1).padStart(2,"0")}-${String(cd.getDate()).padStart(2,"0")}`
          );
          const dayColor = isSelected ? "#ffffff" : (dow === 0 || isHoliday) ? "#ef4444" : dow === 6 ? "#3b82f6" : undefined;
          return (
            <button
              key={idx}
              type="button"
              disabled={!cd}
              onClick={() => cd && onPick(cd)}
              className={
                "aspect-square rounded-lg text-sm " +
                (cd ? (isSelected ? "bg-black" : "hover:bg-gray-100") : "opacity-0")
              }
              style={dayColor ? { color: dayColor } : undefined}
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

function SimpleGridView({ warehouses, selectedWarehouseId, onSelect, onOpen }) {
  const CARD_W = 160;
  const CARD_H = 200;
  const STORAGE_KEY = "wh_simple_positions_v1";

  // positions: { [warehouseId]: { x, y } }
  const [positions, setPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); } catch {}
  }, [positions]);

  // Auto-layout for warehouses without saved positions
  const getPos = useCallback((wId, idx) => {
    if (positions[wId]) return positions[wId];
    const cols = 5;
    const gapX = CARD_W + 24;
    const gapY = CARD_H + 24;
    return { x: 30 + (idx % cols) * gapX, y: 30 + Math.floor(idx / cols) * gapY };
  }, [positions]);

  const containerRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  // dragState: { id, offsetX, offsetY, startX, startY, currentX, currentY, moved }

  const onPointerDown = useCallback((e, wId, pos) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragState({
      id: wId,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
      startX: e.clientX,
      startY: e.clientY,
      currentX: pos.x,
      currentY: pos.y,
      moved: false,
    });
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e) => {
      const nx = e.clientX - dragState.offsetX;
      const ny = e.clientY - dragState.offsetY;
      const dist = Math.abs(e.clientX - dragState.startX) + Math.abs(e.clientY - dragState.startY);
      setDragState((s) => s ? { ...s, currentX: Math.max(0, nx), currentY: Math.max(0, ny), moved: s.moved || dist > 5 } : null);
    };
    const onUp = () => {
      setDragState((s) => {
        if (s && s.moved) {
          setPositions((prev) => ({ ...prev, [s.id]: { x: s.currentX, y: s.currentY } }));
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState]);

  const cardColors = [
    "#fef3c7", "#dbeafe", "#fce7f3", "#d1fae5", "#ede9fe",
    "#ffedd5", "#e0e7ff", "#fecaca", "#ccfbf1", "#fde68a",
  ];

  // Compute canvas size from positions
  const allPos = warehouses.map((w, i) => getPos(w.id, i));
  const canvasW = Math.max(800, ...allPos.map((p) => p.x + CARD_W + 40));
  const canvasH = Math.max(600, ...allPos.map((p) => p.y + CARD_H + 40));

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto rounded-2xl border shadow-sm"
      style={{
        position: "relative",
        backgroundImage: "linear-gradient(rgba(255,255,255,0.82), rgba(255,255,255,0.82)), url(/tez_tile_seamless.png)",
        backgroundRepeat: "repeat",
        backgroundSize: "auto",
      }}
    >
      <div style={{ position: "relative", minWidth: canvasW, minHeight: canvasH }}>
        {warehouses.map((w, wi) => {
          const isSelected = selectedWarehouseId === w.id;
          const isDragging = dragState?.id === w.id;
          const pos = isDragging ? { x: dragState.currentX, y: dragState.currentY } : getPos(w.id, wi);
          const opacity = (w.cardOpacity != null ? w.cardOpacity : 100) / 100;
          const baseBg = w.cardColor || cardColors[wi % cardColors.length];
          return (
            <div
              key={w.id}
              className="select-none"
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: CARD_W,
                zIndex: isDragging ? 100 : isSelected ? 10 : 1,
                cursor: isDragging ? "grabbing" : "grab",
                transform: isDragging ? "scale(1.1) rotate(-3deg)" : "scale(1) rotate(0deg)",
                transition: isDragging ? "none" : "transform 0.25s cubic-bezier(.34,1.56,.64,1), box-shadow 0.25s",
                filter: isDragging ? "drop-shadow(0 20px 30px rgba(0,0,0,0.25))" : "none",
              }}
              onPointerDown={(e) => onPointerDown(e, w.id, pos)}
              onClick={() => { if (!dragState?.moved) onSelect(w.id); }}
              onDoubleClick={() => onOpen(w.id)}
            >
              <div
                className="flex flex-col items-center rounded-3xl border-2 p-4"
                style={{
                  background: baseBg,
                  opacity: opacity,
                  borderColor: isSelected ? "#3b82f6" : "rgba(255,255,255,0.8)",
                  boxShadow: isSelected
                    ? "0 0 0 3px rgba(59,130,246,0.25), 0 8px 20px rgba(0,0,0,0.12)"
                    : "0 4px 16px rgba(0,0,0,0.08)",
                  transition: "border-color 0.2s, box-shadow 0.2s, opacity 0.2s",
                }}
              >
                {w.iconImage ? (
                  <img
                    src={w.iconImage}
                    alt={w.name}
                    className="rounded-2xl border-2 border-white object-cover"
                    style={{ width: 80, height: 80, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
                    draggable={false}
                  />
                ) : (
                  <div
                    className="flex items-center justify-center rounded-2xl border-2 border-white"
                    style={{
                      width: 80, height: 80,
                      fontSize: 44,
                      background: "rgba(255,255,255,0.7)",
                      boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
                    }}
                  >
                    🏭
                  </div>
                )}
                <div className="mt-2 w-full truncate text-center text-xs font-bold" style={{ color: "#1e293b" }}>{w.name}</div>
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  <span className="rounded-full px-1.5 py-0.5 text-xs" style={{ background: "rgba(255,255,255,0.8)", color: "#475569", fontSize: 10 }}>{w.area_m2}m²</span>
                  <span className="rounded-full px-1.5 py-0.5 text-xs" style={{ background: "rgba(255,255,255,0.8)", color: "#475569", fontSize: 10 }}>棚{w.rack_count}</span>
                </div>
                <button
                  type="button"
                  className="mt-2 w-full rounded-xl px-2 py-1.5 text-xs font-bold"
                  style={{
                    background: "#1e293b",
                    color: "#fff",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    transition: "transform 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(w.id);
                  }}
                >
                  開く
                </button>
              </div>
            </div>
          );
        })}
        {warehouses.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl border bg-white/80 p-8 text-center text-sm text-gray-600 shadow">
              倉庫がありません。「＋ 倉庫追加」から作成できます。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WarehouseView({ wh, onBack, onUpdateWarehouse, site, onUpdateSite, warehouses }) {
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

  // マイグレーション: panels → units (配電盤をユニット化)
  useEffect(() => {
    if (panels.length === 0) return;
    const cellMW = layout.floor.cell_m_w || 1.2;
    const cellMD = layout.floor.cell_m_d || 1.0;
    const newUnits = panels.map((p) => ({
      id: p.id.startsWith("p-") ? "u-" + p.id.slice(2) : "u-" + p.id,
      kind: "配電盤",
      client: p.client || "(未設定)",
      name: p.name || "配電盤",
      w_m: p.w_m || (p.w || 2) * cellMW,
      d_m: p.d_m || (p.h || 2) * cellMD,
      h_m: p.h_m || 1.8,
      w_cells: p.w || 2,
      h_cells: p.h || 2,
      qty: 1,
      status: "draft",
      condition: "good",
      rot: false,
      loc: p.loc?.kind === "shelf"
        ? { kind: "shelf", shelfId: p.loc.shelfId, x: p.loc.x, y: p.loc.y }
        : { kind: "floor", x: p.x, y: p.y },
      stackZ: 0,
      sku: "",
      barcode: "",
      batch_number: "",
      weight_kg: 0,
      temperature_zone: "ambient",
      fragile: false,
      stackable: false,
      max_stack_height: 1,
      expires_at: null,
      notes: p.notes || "",
      arrived_at: null,
      moves: [],
      tags: [],
      kintoneRecordId: p.kintoneRecordId || "",
      projectName: p.projectName || "",
      arrivalDate: p.arrivalDate || null,
      departureDate: p.departureDate || null,
      departureHistory: p.departureHistory || [],
      contents: p.contents || [],
      bgColor: p.bgColor || "#fef3c7",
      bgOpacity: p.bgOpacity ?? 90,
      labelColor: p.labelColor || "#000000",
      labelFontSize: p.labelFontSize || 0.75,
    }));
    setUnits((prev) => [...prev, ...newUnits]);
    setPanels([]);
  }, []);

  // 仮置き場ゾーンの自動作成（既存オブジェクトと重ならない空き位置を探索）
  const stagingCreatedRef = useRef(false);
  useEffect(() => {
    if (stagingCreatedRef.current) return;
    const hasStaging = layout.zones.some((z) => z.isStagingArea);
    if (hasStaging) { stagingCreatedRef.current = true; return; }
    stagingCreatedRef.current = true;
    const floor = layout.floor;
    const fx = floor.x || 0;
    const fy = floor.y || 0;
    const sw = Math.max(6, Math.floor(floor.cols * 0.2));
    const sh = Math.max(4, Math.floor(floor.rows * 0.3));
    // 既存オブジェクトの矩形一覧（床・ゾーン・ラック・棚すべて）
    const obstacles = [
      { x: fx, y: fy, w: floor.cols, h: floor.rows },
      ...layout.zones.filter((z) => !z.loc || z.loc.kind === "floor").map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
      ...(layout.racks || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      ...((layout.shelves || []).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))),
    ];
    function hasOverlap(cx, cy, cw, ch) {
      for (const o of obstacles) {
        if (cx < o.x + o.w && cx + cw > o.x && cy < o.y + o.h && cy + ch > o.y) return true;
      }
      return false;
    }
    // 床の周囲をスキャンして空き位置を探す（右→下→左→上）
    let sx = null, sy = null;
    const gap = 2;
    // 右側
    for (let tryX = fx + floor.cols + gap; tryX <= fx + floor.cols + 30; tryX += 2) {
      for (let tryY = fy; tryY <= fy + floor.rows; tryY += 2) {
        if (!hasOverlap(tryX, tryY, sw, sh)) { sx = tryX; sy = tryY; break; }
      }
      if (sx !== null) break;
    }
    // 見つからなければ下側
    if (sx === null) {
      for (let tryY = fy + floor.rows + gap; tryY <= fy + floor.rows + 30; tryY += 2) {
        for (let tryX = fx; tryX <= fx + floor.cols; tryX += 2) {
          if (!hasOverlap(tryX, tryY, sw, sh)) { sx = tryX; sy = tryY; break; }
        }
        if (sx !== null) break;
      }
    }
    // それでも見つからなければ遠い位置にフォールバック
    if (sx === null) { sx = fx + floor.cols + 20; sy = fy; }
    setLayout((prev) => ({
      ...prev,
      zones: [
        ...prev.zones,
        {
          id: "z-staging-" + uid(),
          name: "仮置き場",
          client: "",
          x: sx,
          y: sy,
          w: sw,
          h: sh,
          labelColor: "#000000",
          bgColor: "#fef9c3",
          bgOpacity: 70,
          isStagingArea: true,
          loc: { kind: "floor" },
        },
      ],
    }));
  }, [layout.zones]);

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
  const [transferDest, setTransferDest] = useState("");
  const [panelSections, setPanelSections] = useState({ size: false, appearance: false, detail: true });

  const unitsRef = useRef(units);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const canvasRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [isoViewOpen, setIsoViewOpen] = useState(false);
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

// 区画拡大モーダル用State
const [zoneDetailOpen, setZoneDetailOpen] = useState(false);
const [zoneDetailZone, setZoneDetailZone] = useState(null);
const [zoneDetailDrag, setZoneDetailDrag] = useState(null);
const [zoneDetail3D, setZoneDetail3D] = useState(false);
const [zoneDetailRotStep, setZoneDetailRotStep] = useState(0);
const [zoneDetailZoom, setZoneDetailZoom] = useState(1);

function openZoneDetailModal(zone) {
  setZoneDetailZone(zone);
  setZoneDetailDrag(null);
  setZoneDetail3D(false);
  setZoneDetailRotStep(0);
  setZoneDetailZoom(1);
  setZoneDetailOpen(true);
}
function closeZoneDetailModal() {
  setZoneDetailOpen(false);
  setZoneDetailZone(null);
  setZoneDetailDrag(null);
  setZoneDetail3D(false);
}

// 担当者管理モーダル
const [personModalOpen, setPersonModalOpen] = useState(false);
const [newPersonName, setNewPersonName] = useState("");
const personList = site?.personList || [];

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

  // ========== Unit更新ヘルパー ==========
  function updateUnitField(unitId, field, newValue, action) {
    setUnits((prev) => prev.map((u) => {
      if (u.id !== unitId) return u;
      const oldValue = u[field];
      const hist = (u.editHistory || []).slice();
      hist.push({
        timestamp: new Date().toISOString(),
        action: action || "changed",
        field,
        oldValue,
        newValue,
      });
      if (hist.length > 200) hist.splice(0, hist.length - 200);
      return { ...u, [field]: newValue, editHistory: hist };
    }));
  }

  function updateUnitFieldSilent(unitId, field, newValue) {
    setUnits((prev) => prev.map((u) =>
      u.id === unitId ? { ...u, [field]: newValue } : u
    ));
  }

  function updateUnitFields(unitId, changes, action) {
    setUnits((prev) => prev.map((u) => {
      if (u.id !== unitId) return u;
      const hist = (u.editHistory || []).slice();
      const fields = Object.keys(changes);
      hist.push({
        timestamp: new Date().toISOString(),
        action: action || "changed",
        fields,
        changes: fields.reduce((acc, f) => { acc[f] = { old: u[f], new: changes[f] }; return acc; }, {}),
      });
      if (hist.length > 200) hist.splice(0, hist.length - 200);
      return { ...u, ...changes, editHistory: hist };
    }));
  }

  // 倉庫間移動
  function transferUnitToWarehouse(unitId, destWarehouseId) {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return;
    const destWh = warehouses.find((w) => w.id === destWarehouseId);
    if (!destWh) return;

    // 移動先の layout を読み込み、仮置き場を探す
    const layoutKey = `wh_demo_layout_${destWarehouseId}_v1`;
    const unitsKey = `wh_demo_units_${destWarehouseId}_v1`;
    let destLayout;
    let destUnits;
    try {
      destLayout = JSON.parse(localStorage.getItem(layoutKey)) || null;
      destUnits = JSON.parse(localStorage.getItem(unitsKey)) || [];
    } catch {
      destLayout = null;
      destUnits = [];
    }

    // 移動先のレイアウトが無い場合はデフォルトを作成
    if (!destLayout) {
      destLayout = {
        floor: { cols: 34, rows: 22, cellPx: 32, cell_m_w: 1.2, cell_m_d: 1.0, x: 0, y: 0 },
        zones: [],
        racks: [],
        shelves: [],
      };
    }
    // 仮置き場が無ければ作成（既存オブジェクトと重ならない空き位置を探索）
    let staging = destLayout.zones.find((z) => z.isStagingArea);
    if (!staging) {
      const fl = destLayout.floor;
      const dfx = fl.x || 0;
      const dfy = fl.y || 0;
      const sw = Math.max(6, Math.floor(fl.cols * 0.2));
      const sh = Math.max(4, Math.floor(fl.rows * 0.3));
      const obs = [
        { x: dfx, y: dfy, w: fl.cols, h: fl.rows },
        ...destLayout.zones.map((zz) => ({ x: zz.x, y: zz.y, w: zz.w, h: zz.h })),
        ...(destLayout.racks || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
        ...((destLayout.shelves || []).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h }))),
      ];
      function ovl(cx, cy, cw, ch) { for (const o of obs) { if (cx < o.x + o.w && cx + cw > o.x && cy < o.y + o.h && cy + ch > o.y) return true; } return false; }
      let ssx = null, ssy = null;
      for (let tx = dfx + fl.cols + 2; tx <= dfx + fl.cols + 30; tx += 2) {
        for (let ty = dfy; ty <= dfy + fl.rows; ty += 2) {
          if (!ovl(tx, ty, sw, sh)) { ssx = tx; ssy = ty; break; }
        }
        if (ssx !== null) break;
      }
      if (ssx === null) {
        for (let ty = dfy + fl.rows + 2; ty <= dfy + fl.rows + 30; ty += 2) {
          for (let tx = dfx; tx <= dfx + fl.cols; tx += 2) {
            if (!ovl(tx, ty, sw, sh)) { ssx = tx; ssy = ty; break; }
          }
          if (ssx !== null) break;
        }
      }
      if (ssx === null) { ssx = dfx + fl.cols + 20; ssy = dfy; }
      staging = {
        id: "z-staging-" + uid(),
        name: "仮置き場",
        client: "",
        x: ssx,
        y: ssy,
        w: sw,
        h: sh,
        labelColor: "#000000",
        bgColor: "#fef9c3",
        bgOpacity: 70,
        isStagingArea: true,
        loc: { kind: "floor" },
      };
      destLayout = { ...destLayout, zones: [...destLayout.zones, staging] };
      // レイアウトも保存
      try { localStorage.setItem(layoutKey, JSON.stringify(destLayout)); } catch {}
      if (supabase) {
        supabase.from("app_state").upsert({ key: layoutKey, value: destLayout, updated_at: new Date().toISOString() }).then(() => {});
      }
    }
    const newLoc = { kind: "floor", x: staging.x, y: staging.y };

    // 編集履歴を追加
    const hist = (unit.editHistory || []).slice();
    hist.push({
      timestamp: new Date().toISOString(),
      action: "倉庫間移動",
      field: "倉庫",
      oldValue: wh.name,
      newValue: destWh.name,
    });
    if (hist.length > 200) hist.splice(0, hist.length - 200);

    const movedUnit = { ...unit, loc: newLoc, editHistory: hist };

    // 移動先に追加
    const newDestUnits = [...destUnits, movedUnit];
    try {
      localStorage.setItem(unitsKey, JSON.stringify(newDestUnits));
    } catch { /* ignore */ }
    if (supabase) {
      supabase.from("app_state").upsert({ key: unitsKey, value: newDestUnits, updated_at: new Date().toISOString() }).then(() => {});
    }

    // 元倉庫から削除
    setUnits((prev) => prev.filter((u) => u.id !== unitId));
    setSelected(null);
    showToast(`${unit.name || "荷物"} を ${destWh.name} の仮置き場に移動しました`);
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

  // 矩形outerが矩形innerを完全に包含するか（浮動小数点許容）
  function containsRect(outer, inner) {
    return inner.x >= outer.x - 0.001 &&
           inner.y >= outer.y - 0.001 &&
           inner.x + inner.w <= outer.x + outer.w + 0.001 &&
           inner.y + inner.h <= outer.y + outer.h + 0.001;
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

  // Get the current stack height at a given floor position (sum of h_m of stacked units)
  function getStackAt(x, y, excludeUnitId = null) {
    const items = [];
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      if (Math.abs((u.loc.x||0) - x) < 0.01 && Math.abs((u.loc.y||0) - y) < 0.01) items.push(u);
    }
    items.sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));
    return items;
  }

  function getStackHeight(x, y, excludeUnitId = null) {
    return getStackAt(x, y, excludeUnitId).reduce((sum, u) => sum + (u.h_m || 0), 0);
  }

  // 候補矩形を包含するフロアユニットを返す
  function getContainingStackItems(candidateRect, excludeUnitId = null, fpFn = null) {
    const fpFunc = fpFn || unitFootprintCells;
    const items = [];
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      const fp = fpFunc(u);
      const uRect = { x: u.loc.x || 0, y: u.loc.y || 0, w: fp.w, h: fp.h };
      if (containsRect(uRect, candidateRect)) items.push(u);
    }
    items.sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));
    return items;
  }

  // ユニットの配置範囲がいずれかの仮置き場/入庫予定エリア内に収まるか判定
  function isInStagingZone(x, y, w, h) {
    for (const z of layout.zones || []) {
      if (!z.isStagingArea) continue;
      if (x >= z.x && y >= z.y && x + w <= z.x + z.w && y + h <= z.y + z.h) {
        return true;
      }
    }
    return false;
  }

  function canPlaceOnFloor(u, x, y, excludeUnitId = null) {
    const fp = unitFootprintCells(u);
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;

    // 仮置き場/入庫予定エリア内なら床境界チェックをスキップ
    const inStaging = isInStagingZone(x, y, fp.w, fp.h);
    if (!inStaging) {
      if (x < fx || y < fy) return false;
      if (x + fp.w > fx + layout.floor.cols) return false;
      if (y + fp.h > fy + layout.floor.rows) return false;
    }

    const candidate = { x, y, w: fp.w, h: fp.h };
    for (const r of occupiedRectsFloor(excludeUnitId)) {
      if (overlapsRect(candidate, r)) {
        // Allow stacking: candidate fully contained within existing unit's footprint
        if (r.kind === "unit" && containsRect(r, candidate)) {
          const existing = units.find((e) => e.id === r.id);
          if (existing?.stackable && u.stackable) {
            const stackItems = getContainingStackItems(candidate, excludeUnitId);
            const maxH = Math.min(existing.max_stack_height || 3, u.max_stack_height || 3);
            if (stackItems.length < maxH) continue; // allow this overlap
          }
        }
        return false;
      }
    }
    return true;
  }

  // 区画内限定の衝突判定（ローカル座標 0〜zone.w/h）
  function canPlaceInZone(zone, u, localX, localY, excludeUnitId = null, fpFn = null) {
    const fpFunc = fpFn || unitFootprintCells;
    const fp = fpFunc(u);
    if (localX < -0.001 || localY < -0.001) return false;
    if (localX + fp.w > zone.w + 0.001) return false;
    if (localY + fp.h > zone.h + 0.001) return false;

    // 区画の絶対座標オフセット
    const isShelfZone = zone.loc?.kind === "shelf";
    const absX = isShelfZone ? (zone.loc.x || 0) + localX : zone.x + localX;
    const absY = isShelfZone ? (zone.loc.y || 0) + localY : zone.y + localY;
    const candidate = { x: absX, y: absY, w: fp.w, h: fp.h };

    // 区画内の他荷物との衝突チェック
    const zoneUnits = isShelfZone
      ? units.filter((uu) => uu.loc?.kind === "shelf" && uu.loc.shelfId === zone.loc.shelfId)
      : units.filter((uu) => uu.loc?.kind === "floor");

    for (const uu of zoneUnits) {
      if (uu.id === excludeUnitId) continue;
      const ufp = fpFunc(uu);
      const ux = isShelfZone ? (uu.loc.x || 0) : (uu.loc.x || 0);
      const uy = isShelfZone ? (uu.loc.y || 0) : (uu.loc.y || 0);
      const r = { x: ux, y: uy, w: ufp.w, h: ufp.h };

      // 区画内にあるユニットのみ判定
      const rLocalX = isShelfZone ? ux - (zone.loc.x || 0) : ux - zone.x;
      const rLocalY = isShelfZone ? uy - (zone.loc.y || 0) : uy - zone.y;
      if (rLocalX < 0 || rLocalY < 0 || rLocalX >= zone.w || rLocalY >= zone.h) continue;

      if (overlapsRect(candidate, r)) {
        // スタッキング対応（候補がrに完全包含されていればOK）
        if (containsRect(r, candidate)) {
          if (uu.stackable && u.stackable) {
            const stackAt = isShelfZone
              ? units.filter((s) => s.id !== excludeUnitId && s.loc?.kind === "shelf" && s.loc.shelfId === zone.loc.shelfId && Math.abs((s.loc.x||0) - ux) < 0.01 && Math.abs((s.loc.y||0) - uy) < 0.01).filter((s) => { const sfp = fpFunc(s); return containsRect({ x: s.loc.x||0, y: s.loc.y||0, w: sfp.w, h: sfp.h }, candidate); })
              : getContainingStackItems(candidate, excludeUnitId);
            const maxH = Math.min(uu.max_stack_height || 3, u.max_stack_height || 3);
            if (stackAt.length < maxH) continue;
          }
        }
        return false;
      }
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
    // pointer tracking for shelf drop support (like panels)
    const { cx, cy } = toCell(e.clientX, e.clientY);
    let zoneWorldX = z.x, zoneWorldY = z.y;
    if (z.loc?.kind === "shelf") {
      const shelf = (layout.shelves || []).find((s) => s.id === z.loc.shelfId);
      if (shelf) { zoneWorldX = shelf.x + z.loc.x; zoneWorldY = shelf.y + z.loc.y; }
    }
    setDrag({
      type: "move_zone", id,
      startX: e.clientX, startY: e.clientY,
      pointerX: e.clientX, pointerY: e.clientY,
      baseRect: { ...z },
      offsetCx: cx - zoneWorldX,
      offsetCy: cy - zoneWorldY,
    });
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
    // 荷物と同じくpointerX/pointerY追跡方式（棚ドロップ対応）
    const { cx, cy } = toCell(e.clientX, e.clientY);
    const panelWorldX = p.loc?.kind === "shelf"
      ? (() => { const s = (layout.shelves || []).find((s) => s.id === p.loc.shelfId); return s ? s.x + p.loc.x : p.x; })()
      : p.x;
    const panelWorldY = p.loc?.kind === "shelf"
      ? (() => { const s = (layout.shelves || []).find((s) => s.id === p.loc.shelfId); return s ? s.y + p.loc.y : p.y; })()
      : p.y;
    setDrag({
      type: "move_panel", id,
      startX: e.clientX, startY: e.clientY,
      pointerX: e.clientX, pointerY: e.clientY,
      baseRect: { ...p },
      offsetCx: cx - panelWorldX,
      offsetCy: cy - panelWorldY,
    });
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

    // 配電盤の回転（床上のみ、棚上はスキップ）
    setPanels((prev) => prev.map((p) => {
      if (p.loc?.kind === "shelf") return p;
      const rp = rotatePoint(p.x, p.y, p.w, p.h);
      return { ...p, x: rp.x, y: rp.y, w: p.h, h: p.w };
    }));
  }

  function rotateShelf(id) {
    const shelf = (layout.shelves || []).find((s) => s.id === id);
    if (!shelf) return;
    // 床と同じ方式: w/hを入れ替えて物理的に回転（中心を基準に90度CW）
    const cx = shelf.x + shelf.w / 2;
    const cy = shelf.y + shelf.h / 2;
    const newW = shelf.h;
    const newH = shelf.w;
    // 丸めなし: ドリフト防止（中心座標を正確に維持）
    const newX = cx - newW / 2;
    const newY = cy - newH / 2;

    // 床の rotatePoint と同じパターン（ワールド座標で回転）
    function rotatePoint(worldItemX, worldItemY, w, h) {
      const itemCx = worldItemX + w / 2;
      const itemCy = worldItemY + h / 2;
      const dx = itemCx - cx;
      const dy = itemCy - cy;
      const newItemCx = cx - dy;
      const newItemCy = cy + dx;
      return { x: newItemCx - h / 2, y: newItemCy - w / 2 };
    }

    // 棚上の荷物を回転
    setUnits((prev) =>
      prev.map((u) => {
        if (u.loc?.kind !== "shelf" || u.loc.shelfId !== id) return u;
        const fp = unitFootprintCells(u);
        const p = rotatePoint(shelf.x + u.loc.x, shelf.y + u.loc.y, fp.w, fp.h);
        return { ...u, loc: { ...u.loc, x: p.x - newX, y: p.y - newY }, rot: !u.rot };
      })
    );

    // 棚上の配電盤を回転
    setPanels((prev) =>
      prev.map((p) => {
        if (p.loc?.kind !== "shelf" || p.loc.shelfId !== id) return p;
        const rp = rotatePoint(shelf.x + p.loc.x, shelf.y + p.loc.y, p.w, p.h);
        return { ...p, loc: { ...p.loc, x: rp.x - newX, y: rp.y - newY }, w: p.h, h: p.w };
      })
    );

    setLayout((prev) => ({
      ...prev,
      shelves: (prev.shelves || []).map((s) =>
        s.id === id ? { ...s, x: newX, y: newY, w: newW, h: newH, rotation: 0 } : s
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
      const newWm = +(newW * (layout.floor.cell_m_w || 1.2)).toFixed(2);
      const newDm = +(newH * (layout.floor.cell_m_d || 1.0)).toFixed(2);
      setUnits((prev) =>
        prev.map((u) =>
          u.id === drag.unitId ? { ...u, w_cells: newW, h_cells: newH, w_m: newWm, d_m: newDm } : u
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

    if (drag.type === "move_zone") {
      // pointer tracking for shelf drop support
      setDrag((d) => d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d);
      return;
    }

    if (drag.type === "resize_zone") {
      setLayout((prev) => {
        const zones = prev.zones.map((z) => {
          if (z.id !== drag.id) return z;
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

    if (drag.type === "move_panel") {
      // 荷物と同じくpointer追跡（endDragでドロップ先判定）
      setDrag((d) => d ? { ...d, pointerX: e.clientX, pointerY: e.clientY } : d);
      return;
    }

    if (drag.type === "resize_panel") {
      setPanels((prev) =>
        prev.map((p) => {
          if (p.id !== drag.id) return p;
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
            if (zoneIds.size > 0) zones = zones.map((z) => (zoneIds.has(z.id) && (!z.loc || z.loc.kind === "floor")) ? { ...z, x: z.x + dx, y: z.y + dy } : z);
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
          zones: prev.zones.map((z) => (!z.loc || z.loc.kind === "floor") ? { ...z, x: z.x + totalDx, y: z.y + totalDy } : z),
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
      // 仮置き場/入庫予定エリア内ならclampをスキップ
      let px, py;
      if (isInStagingZone(cx, cy, fp.w, fp.h)) {
        px = cx;
        py = cy;
      } else {
        px = clamp(cx, fx, fx + layout.floor.cols - fp.w);
        py = clamp(cy, fy, fy + layout.floor.rows - fp.h);
      }
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

      // Check if dropped on floor or staging zone
      const fx = layout.floor.x || 0;
      const fy = layout.floor.y || 0;
      // 仮置き場/入庫予定エリア内ならclampをスキップ
      const inStaging = isInStagingZone(dropX, dropY, fp.w, fp.h);
      const floorX = inStaging ? dropX : clamp(dropX, fx, fx + layout.floor.cols - fp.w);
      const floorY = inStaging ? dropY : clamp(dropY, fy, fy + layout.floor.rows - fp.h);

      // Check if unit's target area overlaps with floor or is in staging zone
      if (inStaging || (floorX + fp.w > fx && floorY + fp.h > fy && floorX < fx + layout.floor.cols && floorY < fy + layout.floor.rows)) {
        if (canPlaceOnFloor(u, floorX, floorY, u.id)) {
          const candidate = { x: floorX, y: floorY, w: fp.w, h: fp.h };
          const containingItems = getContainingStackItems(candidate, u.id);
          const newStackZ = containingItems.length > 0
            ? Math.max(...containingItems.map(i => (i.stackZ || 0) + (i.h_m || 0)))
            : 0;
          setUnits((prev) => prev.map((x) =>
            x.id === u.id ? { ...x, loc: { kind: "floor", x: floorX, y: floorY }, stackZ: newStackZ } : x
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

    if (drag.type === "move_zone") {
      const z = layout.zones.find((x) => x.id === drag.id);
      if (!z) { setDrag(null); return; }

      const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
      const dropX = cx - (drag.offsetCx || 0);
      const dropY = cy - (drag.offsetCy || 0);

      // 旧区画の位置・配置情報を記録（内部ユニット連動用）
      const oldLoc = z.loc || { kind: "floor" };
      const oldZX = z.x;
      const oldZY = z.y;

      // ユニットが旧区画内にあるか判定するヘルパー
      function isUnitInOldZone(u) {
        const fp = unitFootprintCells(u);
        const ux = u.loc.x || 0, uy = u.loc.y || 0;
        if (oldLoc.kind === "floor" && u.loc?.kind === "floor") {
          return ux >= oldZX && uy >= oldZY && ux + fp.w <= oldZX + z.w && uy + fp.h <= oldZY + z.h;
        }
        if (oldLoc.kind === "shelf" && u.loc?.kind === "shelf" && u.loc.shelfId === oldLoc.shelfId) {
          return ux >= oldZX && uy >= oldZY && ux + fp.w <= oldZX + z.w && uy + fp.h <= oldZY + z.h;
        }
        return false;
      }

      // Check if dropped on a shelf
      const shelf = findShelfAtCell(cx, cy);
      if (shelf) {
        const local = worldToShelfLocal(shelf, dropX, dropY);
        const clampedX = clamp(Math.floor(local.localX), 0, Math.max(0, shelf.w - z.w));
        const clampedY = clamp(Math.floor(local.localY), 0, Math.max(0, shelf.h - z.h));
        // 棚内の他の区画との重なりチェック
        const zoneCandidate = { x: clampedX, y: clampedY, w: z.w, h: z.h };
        const shelfZoneOverlap = layout.zones.some((oz) => {
          if (oz.id === z.id) return false;
          if (oz.loc?.kind !== "shelf" || oz.loc?.shelfId !== shelf.id) return false;
          return overlapsRect(zoneCandidate, { x: oz.x, y: oz.y, w: oz.w, h: oz.h });
        });
        if (shelfZoneOverlap) {
          showToast("他のオブジェクトと重なるため移動できません");
          setDrag(null);
          return;
        }
        const newZoneLoc = { kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY };
        setLayout((prev) => ({
          ...prev,
          zones: prev.zones.map((zn) =>
            zn.id === z.id ? { ...zn, loc: newZoneLoc, x: clampedX, y: clampedY } : zn
          ),
        }));
        // 区画内ユニットを連動移動（床→棚、棚→棚、棚内移動すべて対応）
        const moveDx = clampedX - oldZX;
        const moveDy = clampedY - oldZY;
        setUnits((prev) => prev.map((u) => {
          if (!isUnitInOldZone(u)) return u;
          const ux = u.loc.x || 0, uy = u.loc.y || 0;
          return { ...u, loc: { kind: "shelf", shelfId: shelf.id, x: ux + moveDx, y: uy + moveDy } };
        }));
        setDrag(null);
        return;
      }

      // Drop on floor
      const fx = layout.floor.x || 0;
      const fy = layout.floor.y || 0;
      const floorX = clamp(dropX, fx, fx + layout.floor.cols - z.w);
      const floorY = clamp(dropY, fy, fy + layout.floor.rows - z.h);
      // 床上の他のオブジェクト（区画・ラック・棚）との重なりチェック
      const floorZoneCandidate = { x: floorX, y: floorY, w: z.w, h: z.h };
      const floorOverlap = [
        ...layout.zones.filter((oz) => oz.id !== z.id && (!oz.loc || oz.loc.kind === "floor")).map((oz) => ({ x: oz.x, y: oz.y, w: oz.w, h: oz.h })),
        ...layout.racks.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
        ...(layout.shelves || []).map((s) => { const vr = getShelfVisualRect(s); return { x: vr.x, y: vr.y, w: vr.w, h: vr.h }; }),
      ].some((obs) => overlapsRect(floorZoneCandidate, obs));
      if (floorOverlap) {
        showToast("他のオブジェクトと重なるため移動できません");
        setDrag(null);
        return;
      }
      const moveDx = floorX - oldZX;
      const moveDy = floorY - oldZY;
      setLayout((prev) => ({
        ...prev,
        zones: prev.zones.map((zn) =>
          zn.id === z.id ? { ...zn, loc: { kind: "floor" }, x: floorX, y: floorY } : zn
        ),
      }));
      // 区画内ユニットを連動移動（棚→床、床内移動すべて対応）
      setUnits((prev) => prev.map((u) => {
        if (!isUnitInOldZone(u)) return u;
        const ux = u.loc.x || 0, uy = u.loc.y || 0;
        return { ...u, loc: { kind: "floor", x: ux + moveDx, y: uy + moveDy } };
      }));
      setDrag(null);
      return;
    }

    if (drag.type === "move_panel") {
      const p = panels.find((x) => x.id === drag.id);
      if (!p) { setDrag(null); return; }

      const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
      const dropX = cx - (drag.offsetCx || 0);
      const dropY = cy - (drag.offsetCy || 0);

      // 棚にドロップ
      const shelf = findShelfAtCell(cx, cy);
      if (shelf) {
        const local = worldToShelfLocal(shelf, dropX, dropY);
        const clampedX = clamp(Math.floor(local.localX), 0, shelf.w - p.w);
        const clampedY = clamp(Math.floor(local.localY), 0, shelf.h - p.h);
        setPanels((prev) => prev.map((x) =>
          x.id === p.id ? { ...x, loc: { kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY } } : x
        ));
        setDrag(null);
        return;
      }

      // 床にドロップ
      const fx = layout.floor.x || 0;
      const fy = layout.floor.y || 0;
      const floorX = clamp(dropX, fx, fx + layout.floor.cols - p.w);
      const floorY = clamp(dropY, fy, fy + layout.floor.rows - p.h);
      setPanels((prev) => prev.map((x) =>
        x.id === p.id ? { ...x, x: floorX, y: floorY, loc: { kind: "floor" } } : x
      ));
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
    const zw = 8, zh = 5;
    // 既存オブジェクトの矩形一覧
    const obstacles = [
      ...layout.zones.filter((zn) => !zn.loc || zn.loc.kind === "floor").map((zn) => ({ x: zn.x, y: zn.y, w: zn.w, h: zn.h })),
      ...layout.racks.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      ...(layout.shelves || []).map((s) => { const vr = getShelfVisualRect(s); return { x: vr.x, y: vr.y, w: vr.w, h: vr.h }; }),
    ];
    function hasZoneOverlap(cx, cy) {
      const cand = { x: cx, y: cy, w: zw, h: zh };
      return obstacles.some((o) => overlapsRect(cand, o));
    }
    // 床内をスキャンして空き位置を探索
    let px = null, py = null;
    for (let ty = zfy; ty <= zfy + layout.floor.rows - zh; ty++) {
      for (let tx = zfx; tx <= zfx + layout.floor.cols - zw; tx++) {
        if (!hasZoneOverlap(tx, ty)) { px = tx; py = ty; break; }
      }
      if (px !== null) break;
    }
    // 床内に見つからなければ床の右側を探索
    if (px === null) {
      for (let tx = zfx + layout.floor.cols + 2; tx <= zfx + layout.floor.cols + 30; tx += 2) {
        for (let ty = zfy; ty <= zfy + layout.floor.rows; ty += 2) {
          if (!hasZoneOverlap(tx, ty)) { px = tx; py = ty; break; }
        }
        if (px !== null) break;
      }
    }
    // それでも見つからなければフォールバック
    if (px === null) { px = zfx + layout.floor.cols + 10; py = zfy; }
    setLayout((prev) => ({
      ...prev,
      zones: [...prev.zones, { id: "z-" + uid(), name: "新規区画", client: "取引先A", x: px, y: py, w: zw, h: zh, labelColor: "#000000", bgColor, bgOpacity: 90, loc: { kind: "floor" } }],
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
  stackZ: 0,

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
  personInCharge: "",
  editHistory: [{
    timestamp: new Date().toISOString(),
    action: "created",
  }],

  // ========== 見た目 ==========
  bgColor: "",
  bgOpacity: 100,
  labelColor: "",
};
    setUnits((prev) => [u, ...prev]);
    setSelected({ kind: "unit", id: u.id });
    showToast("作成しました（「床に配置」で配置できます）");
  }

  function placeOnFloorAuto(unitId) {
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const fp = unitFootprintCells(u);
    const fx = layout.floor.x || 0;
    const fy = layout.floor.y || 0;
    const cols = layout.floor.cols;
    const rows = layout.floor.rows;
    // Spiral search from center of floor
    const cx = fx + Math.floor((cols - fp.w) / 2);
    const cy = fy + Math.floor((rows - fp.h) / 2);
    // Try center first, then spiral outward
    const maxR = Math.max(cols, rows);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only perimeter
          const tx = cx + dx;
          const ty = cy + dy;
          if (canPlaceOnFloor(u, tx, ty, unitId)) {
            const candidate = { x: tx, y: ty, w: fp.w, h: fp.h };
            const containingItems = getContainingStackItems(candidate, unitId);
            const stackZ = containingItems.length > 0
              ? Math.max(...containingItems.map(i => (i.stackZ || 0) + (i.h_m || 0)))
              : 0;
            setUnits((prev) => prev.map((x) => (x.id === unitId ? { ...x, loc: { kind: "floor", x: tx, y: ty }, stackZ } : x)));
            showToast(containingItems.length > 0 ? `床に積み重ねました（${containingItems.length + 1}段目）` : "床に配置しました");
            return;
          }
        }
      }
    }
    showToast("床に空きスペースが見つかりません");
  }

  function placeOnShelfAuto(unitId, shelfId) {
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const shelf = (layout.shelves || []).find((s) => s.id === shelfId);
    if (!shelf) return;
    const fp = unitFootprintCells(u);
    for (let y = 0; y <= shelf.h - fp.h; y++) {
      for (let x = 0; x <= shelf.w - fp.w; x++) {
        if (canPlaceOnShelf(shelfId, u, x, y, unitId)) {
          setUnits((prev) => prev.map((x2) => (x2.id === unitId ? { ...x2, loc: { kind: "shelf", shelfId, x, y } } : x2)));
          showToast(`棚「${shelf.name || shelfId}」に配置しました`);
          return;
        }
      }
    }
    showToast(`棚「${shelf.name || shelfId}」に空きスペースがありません`);
  }

  function placeOnRackAuto(unitId, rackId) {
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const rack = layout.racks.find((r) => r.id === rackId);
    if (!rack) return;
    const totalSlots = (rack.rows || 1) * (rack.cols || 1);
    for (let slot = 0; slot < totalSlots; slot++) {
      if (isRackSlotFree(rackId, slot, unitId)) {
        setUnits((prev) => prev.map((x) => (x.id === unitId ? { ...x, loc: { kind: "rack", rackId, slot } } : x)));
        showToast(`ラック「${rack.name || rackId}」のスロット${slot + 1}に配置しました`);
        return;
      }
    }
    showToast(`ラック「${rack.name || rackId}」に空きスロットがありません`);
  }

  function placeAutoByTarget(unitId, target) {
    if (!target || target === "floor") {
      placeOnFloorAuto(unitId);
    } else if (target.startsWith("shelf-")) {
      placeOnShelfAuto(unitId, target.slice(6));
    } else if (target.startsWith("rack-")) {
      placeOnRackAuto(unitId, target.slice(5));
    }
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
        const nextZoom = clamp(prevZoom * factor, 0.3, 2.2);
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

  // 出庫予定日が selectedDate と一致するユニットの点滅
  const blinkingUnitIds = useMemo(() => {
    const selDateStr = selectedDate.toISOString().slice(0, 10);
    const ids = new Set();
    for (const u of units) {
      if (u.departureDate && u.departureDate.slice(0, 10) === selDateStr) {
        ids.add(u.id);
      }
    }
    return ids;
  }, [units, selectedDate]);

  // 出庫予定一覧（selectedDate と一致）
  const shippingSchedule = useMemo(() => {
    const selDateStr = selectedDate.toISOString().slice(0, 10);
    return units
      .filter((u) => u.departureDate && u.departureDate.slice(0, 10) === selDateStr)
      .sort((a, b) => (a.departureDate || "").localeCompare(b.departureDate || ""));
  }, [units, selectedDate]);

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
          <button
            className="rounded-xl border px-3 py-2 text-sm shadow-sm font-bold"
            style={{ background: "#ede9fe", color: "#7c3aed", borderColor: "#c4b5fd" }}
            onClick={() => setIsoViewOpen(true)}
            type="button"
          >
            3Dビュー
          </button>
          <button
            className="rounded-xl border px-3 py-2 text-sm shadow-sm hover:bg-gray-50"
            onClick={() => setPersonModalOpen(true)}
            type="button"
          >
            担当者管理
          </button>
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

      {isoViewOpen && (
        <IsometricView
          units={units}
          layout={layout}
          panels={panels}
          onClose={() => setIsoViewOpen(false)}
        />
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

          {/* 出庫予定セクション */}
          <div className="rounded-2xl border bg-white p-3 shadow-sm">
            <SectionTitle
              right={<Badge>{shippingSchedule.length} 件</Badge>}
            >
              出庫予定（{selectedDate.toLocaleDateString("ja-JP")}）
            </SectionTitle>
            {shippingSchedule.length === 0 ? (
              <div className="text-sm text-gray-500">この日の出庫予定はありません。</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {shippingSchedule.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl border p-2 text-sm hover:bg-red-50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelected({ kind: "unit", id: u.id });
                      if (u.loc?.kind === "floor") {
                        const fp = unitFootprintCells(u);
                        const centerX = (u.loc.x + fp.w / 2) * cellPx;
                        const centerY = (u.loc.y + fp.h / 2) * cellPx;
                        const el = canvasRef.current;
                        if (el) {
                          const r = el.getBoundingClientRect();
                          setPan({ x: r.width / 2 - centerX * zoom, y: r.height / 2 - centerY * zoom });
                        }
                      }
                    }}
                  >
                    <div className="font-medium flex items-center gap-1">
                      <span className="text-red-500">●</span> {u.name}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{u.client}</Badge>
                      <Badge>数量 {u.qty}</Badge>
                      {u.departureDate && u.departureDate.length > 10 && (
                        <Badge>{u.departureDate.slice(11, 16)}</Badge>
                      )}
                    </div>
                    {u.personInCharge && (
                      <div className="mt-1 text-xs text-gray-500">担当: {u.personInCharge}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

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
              if (e.ctrlKey || e.metaKey) {
                // Start rubber band selection
                setDrag({ type: "rubber_band", startX: e.clientX, startY: e.clientY, pointerX: e.clientX, pointerY: e.clientY });
              } else {
                // 空白エリアのドラッグ → パン（スクロール）
                clearSelection();
                beginPan(e);
              }
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
                          fontSize: `${layout.floor.floorLabelFontSize || 6}rem`,
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

              </div>

              {/* 床リサイズハンドル - 床divの外に配置しz-indexで最前面に */}
              {mode === "layout" && (
                <div
                  className="absolute cursor-se-resize"
                  style={{
                    left: ((layout.floor.x || 0) + layout.floor.cols) * cellPx - 24,
                    top: ((layout.floor.y || 0) + layout.floor.rows) * cellPx - 24,
                    width: 0,
                    height: 0,
                    borderStyle: "solid",
                    borderWidth: "0 0 24px 24px",
                    borderColor: "transparent transparent #374151 transparent",
                    zIndex: 200,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    beginResizeFloor(e, "se");
                  }}
                  title="リサイズ"
                />
              )}


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

              {/* Zones (floor only - shelf zones rendered inside shelf divs) */}
              {layout.zones.filter((z) => !z.loc || z.loc.kind === "floor").map((z) => {
                const labelRgb = hexToRgb(z.labelColor || "#000000");
                const bgRgb = hexToRgb(z.bgColor || "#d1fae5");
                const bgOpacity = (z.bgOpacity ?? 90) / 100;
                const zSel = isItemSelected("zone", z.id);
                const isDraggingZone = drag?.type === "move_zone" && drag.id === z.id;
                const hasMovedZone = isDraggingZone && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                const zoneDragTransform = hasMovedZone
                  ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                  : (zSel && groupMoveTransform ? groupMoveTransform : undefined);
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
                      zIndex: (hasMovedZone || (zSel && drag?.type === "group_move")) ? 50 : 1,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: z.bgColor || "#10b981",
                      transform: zoneDragTransform,
                      opacity: hasMovedZone ? 0.7 : undefined,
                      pointerEvents: hasMovedZone ? "none" : undefined,
                      transition: (hasMovedZone || drag?.type === "group_move") ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "layout" && beginMoveZone(e, z.id)}
                    onClick={(e) => handleItemClick(e, "zone", z.id)}
                    onDoubleClick={(e) => { e.stopPropagation(); openZoneDetailModal(z); }}
                  >
                    {/* Zone label - watermark style */}
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: `${z.labelFontSize || 1.5}rem`,
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
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: `${r.labelFontSize || 1.5}rem`,
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
                              fontSize: `${s.labelFontSize || 2.5}rem`,
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
                      const kindIcon = u.kind === "パレット" ? "📦" : u.kind === "カゴ" ? "🧺" : u.kind === "配電盤" ? "⚡" : "📋";
                      const shelfUnitBgRgb = hexToRgb(u.bgColor || "#ffffff");
                      const shelfUnitBgOpacity = (u.bgOpacity ?? 100) / 100;
                      const isDraggingShelfUnit = drag?.type === "move_unit" && drag.unitId === u.id;
                      const hasMovedShelfUnit = isDraggingShelfUnit && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                      const shelfDragTransform = hasMovedShelfUnit
                        ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                        : undefined;
                      return (
                        <div
                          key={u.id}
                          className={
                            "absolute rounded-xl border-2 cursor-pointer " +
                            (hasMovedShelfUnit ? "" : "transition-all duration-150 ") +
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
                            zIndex: hasMovedShelfUnit ? 50 : 8,
                            transform: shelfDragTransform,
                            opacity: hasMovedShelfUnit ? 0.7 : undefined,
                            pointerEvents: hasMovedShelfUnit ? "none" : undefined,
                            transition: hasMovedShelfUnit ? "none" : undefined,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (mode === "operate") beginMoveUnit(e, u.id);
                          }}
                          onClick={(e) => { e.stopPropagation(); handleItemClick(e, "unit", u.id); }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(u);
                          }}
                        >
                          {/* Unit name - watermark style */}
                          <div
                            className="absolute pointer-events-none"
                            style={{ top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, overflow: "hidden" }}
                          >
                            <div style={{ fontSize: `${u.labelFontSize || 0.7}rem`, fontWeight: 900, color: `rgba(${hexToRgb(u.labelColor || "#000000").join(",")}, 0.15)`, userSelect: "none", textAlign: "center", lineHeight: 1.2 }}>
                              {u.name}
                            </div>
                          </div>
                          {/* 右下リサイズハンドル */}
                          {mode === "operate" && (
                            <div
                              className="absolute cursor-se-resize"
                              style={{
                                bottom: 0, right: 0,
                                width: 0, height: 0,
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

                    {/* Panels on shelf */}
                    {panels.filter((p) => p.loc?.kind === "shelf" && p.loc.shelfId === s.id).map((p) => {
                      const isPanelSel = isItemSelected("panel", p.id);
                      const panelLabelRgb = hexToRgb(p.labelColor || "#000000");
                      const panelBgRgb = hexToRgb(p.bgColor || "#fef3c7");
                      const panelBgOpacity = (p.bgOpacity ?? 90) / 100;
                      const isDraggingShelfPanel = drag?.type === "move_panel" && drag.id === p.id;
                      const hasMovedShelfPanel = isDraggingShelfPanel && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                      const shelfPanelDragTransform = hasMovedShelfPanel
                        ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                        : undefined;
                      return (
                        <div
                          key={p.id}
                          className={
                            "absolute rounded-xl border-2 cursor-pointer " +
                            (hasMovedShelfPanel ? "" : "transition-all duration-150 ") +
                            (isPanelSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-lg")
                          }
                          style={{
                            left: p.loc.x * cellPx + 1,
                            top: p.loc.y * cellPx + 1,
                            width: p.w * cellPx - 2,
                            height: p.h * cellPx - 2,
                            backgroundColor: `rgba(${panelBgRgb.join(",")}, ${panelBgOpacity})`,
                            borderColor: p.bgColor || "#f59e0b",
                            zIndex: hasMovedShelfPanel ? 50 : 8,
                            transform: shelfPanelDragTransform,
                            opacity: hasMovedShelfPanel ? 0.7 : undefined,
                            pointerEvents: hasMovedShelfPanel ? "none" : undefined,
                            transition: hasMovedShelfPanel ? "none" : undefined,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (mode === "operate") beginMovePanel(e, p.id);
                          }}
                          onClick={(e) => { e.stopPropagation(); handleItemClick(e, "panel", p.id); }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            openPanelDetailModal(p);
                          }}
                        >
                          <div
                            className="absolute pointer-events-none"
                            style={{ top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            <div style={{ fontSize: `${p.labelFontSize || 0.6}rem`, fontWeight: 700, color: `rgba(${panelLabelRgb.join(",")}, 0.7)`, userSelect: "none", textAlign: "center" }}>
                              {p.name}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Zones on shelf */}
                    {layout.zones.filter((z) => z.loc?.kind === "shelf" && z.loc.shelfId === s.id).map((z) => {
                      const zLabelRgb = hexToRgb(z.labelColor || "#000000");
                      const zBgRgb = hexToRgb(z.bgColor || "#d1fae5");
                      const zBgOpacity = (z.bgOpacity ?? 90) / 100;
                      const zSel = isItemSelected("zone", z.id);
                      const isDraggingShelfZone = drag?.type === "move_zone" && drag.id === z.id;
                      const hasMovedShelfZone = isDraggingShelfZone && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                      const shelfZoneDragTransform = hasMovedShelfZone
                        ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                        : undefined;
                      return (
                        <div
                          key={z.id}
                          className={
                            "absolute rounded-2xl border-2 " +
                            (zSel ? "ring-2 ring-black" : "")
                          }
                          style={{
                            left: (z.loc.x || 0) * cellPx,
                            top: (z.loc.y || 0) * cellPx,
                            width: z.w * cellPx,
                            height: z.h * cellPx,
                            backgroundColor: `rgba(${zBgRgb.join(",")}, ${zBgOpacity})`,
                            borderColor: z.bgColor || "#10b981",
                            zIndex: hasMovedShelfZone ? 50 : 3,
                            transform: shelfZoneDragTransform,
                            opacity: hasMovedShelfZone ? 0.7 : undefined,
                            pointerEvents: hasMovedShelfZone ? "none" : undefined,
                            transition: hasMovedShelfZone ? "none" : undefined,
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            if (mode === "layout") beginMoveZone(e, z.id);
                          }}
                          onClick={(e) => { e.stopPropagation(); handleItemClick(e, "zone", z.id); }}
                          onDoubleClick={(e) => { e.stopPropagation(); openZoneDetailModal(z); }}
                        >
                          <div
                            className="absolute pointer-events-none"
                            style={{ top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
                          >
                            <div style={{ fontSize: `${z.labelFontSize || 1.5}rem`, fontWeight: 900, color: `rgba(${zLabelRgb.join(",")}, 0.15)`, userSelect: "none", textAlign: "center", lineHeight: 1.2 }}>
                              {z.name}
                            </div>
                          </div>
                          {mode === "layout" && (
                            <div
                              className="absolute cursor-se-resize"
                              style={{ bottom: 0, right: 0, width: 0, height: 0, borderStyle: "solid", borderWidth: "0 0 16px 16px", borderColor: "transparent transparent #1f2937 transparent", zIndex: 100 }}
                              onMouseDown={(e) => { e.stopPropagation(); beginResizeZone(e, z.id, "se"); }}
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
                const kindIcon = u.kind === "パレット" ? "📦" : u.kind === "カゴ" ? "🧺" : u.kind === "配電盤" ? "⚡" : "📋";
                const unitBgRgb = hexToRgb(u.bgColor || "#ffffff");
                const unitBgOpacity = (u.bgOpacity ?? 100) / 100;
                const unitLabelRgb = hexToRgb(u.labelColor || "#000000");
                const isDragging = drag?.type === "move_unit" && drag.unitId === u.id;
                const hasMoved = isDragging && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                const isGroupMoving = isSel && drag?.type === "group_move";
                const dragTransform = hasMoved
                  ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                  : isGroupMoving ? groupMoveTransform : undefined;
                const shouldBlink = blinkingUnitIds.has(u.id);
                return (
                  <div
                    key={u.id}
                    className={
                      "absolute rounded-3xl border-2 cursor-pointer " +
                      ((hasMoved || isGroupMoving) ? "" : "transition-all duration-150 ") +
                      (isSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-xl hover:-translate-y-0.5") +
                      (shouldBlink && !isSel ? " wh-departure-blink" : "")
                    }
                    style={{
                      left: u.loc.x * cellPx,
                      top: u.loc.y * cellPx,
                      width: fp.w * cellPx,
                      height: fp.h * cellPx,
                      background: u.bgColor
                        ? `rgba(${unitBgRgb.join(",")}, ${unitBgOpacity})`
                        : "linear-gradient(145deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)",
                      borderColor: (shouldBlink && !isSel) ? undefined : (isSel ? "#1e293b" : (u.bgColor || "#e2e8f0")),
                      boxShadow: (shouldBlink && !isSel) ? undefined : (isSel
                        ? "0 10px 25px -5px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.1)"
                        : "0 4px 12px -2px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)"),
                      zIndex: (hasMoved || isGroupMoving) ? 50 : 8,
                      transform: dragTransform,
                      opacity: hasMoved ? 0.7 : undefined,
                      pointerEvents: hasMoved ? "none" : undefined,
                      transition: hasMoved ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "operate" && beginMoveUnit(e, u.id)}
                    onClick={(e) => handleItemClick(e, "unit", u.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openDetailModal(u);
                    }}
                  >
                    {/* Unit name - watermark style */}
                    <div
                      className="absolute pointer-events-none"
                      style={{ top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, overflow: "hidden" }}
                    >
                      <div style={{ fontSize: `${u.labelFontSize || 1.2}rem`, fontWeight: 900, color: `rgba(${unitLabelRgb.join(",")}, 0.15)`, userSelect: "none", textAlign: "center", lineHeight: 1.2 }}>
                        {u.name}
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

              {/* Panels (配電盤) on floor - z-index: 6 */}
              {panels.filter((p) => !p.loc || p.loc.kind !== "shelf").map((p) => {
                const isSel = isItemSelected("panel", p.id);
                const labelRgb = hexToRgb(p.labelColor || "#000000");
                const bgRgb = hexToRgb(p.bgColor || "#fef3c7");
                const bgOpacity = (p.bgOpacity ?? 90) / 100;
                const isDraggingPanel = drag?.type === "move_panel" && drag.id === p.id;
                const hasMovedPanel = isDraggingPanel && (drag.pointerX !== drag.startX || drag.pointerY !== drag.startY);
                const panelDragTransform = hasMovedPanel
                  ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                  : isSel && groupMoveTransform ? groupMoveTransform : undefined;
                return (
                  <div
                    key={p.id}
                    className={
                      `absolute rounded-xl border-2 cursor-pointer ` +
                      ((hasMovedPanel || (isSel && drag?.type === "group_move")) ? "" : "transition-all duration-150 ") +
                      (isSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-lg")
                    }
                    style={{
                      left: p.x * cellPx,
                      top: p.y * cellPx,
                      width: p.w * cellPx,
                      height: p.h * cellPx,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: p.bgColor || "#f59e0b",
                      zIndex: hasMovedPanel ? 50 : isSel && drag?.type === "group_move" ? 50 : 6,
                      transform: panelDragTransform,
                      opacity: hasMovedPanel ? 0.7 : undefined,
                      transition: (hasMovedPanel || drag?.type === "group_move") ? "none" : undefined,
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
                        top: 0, left: 0, right: 0, bottom: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          fontSize: `${p.labelFontSize || 0.75}rem`,
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
              <SectionTitle>レイアウト編集</SectionTitle>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "区画", emoji: "\u25A6", color: "#d1fae5", textColor: "#065f46", onClick: addZone },
                  { label: "ラック", emoji: "\u25A4", color: "#e2e8f0", textColor: "#334155", onClick: addRack },
                  { label: "棚", emoji: "\u2261", color: "#ccfbf1", textColor: "#0f766e", onClick: addShelf },
                ].map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className="flex flex-col items-center rounded-2xl border-2 p-2.5 select-none"
                    style={{
                      background: t.color,
                      borderColor: "transparent",
                      color: t.textColor,
                      boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                      transition: "all 0.2s cubic-bezier(.34,1.56,.64,1)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.06)"; }}
                    onClick={t.onClick}
                  >
                    <span style={{ fontSize: 22 }}>{t.emoji}</span>
                    <span className="mt-0.5 text-xs font-bold">+ {t.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-2 rounded-2xl border bg-gray-50 p-3 text-xs text-gray-700">
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
                              className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
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
                              className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="border-t pt-2">
                        <div className="text-xs font-semibold text-gray-700 mb-2">ラベルサイズ</div>
                        <div>
                          <label className="text-[10px] text-gray-500">フォント: {layout.floor.floorLabelFontSize || 6}rem</label>
                          <input
                            type="range"
                            min="1"
                            max="15"
                            step="0.5"
                            value={layout.floor.floorLabelFontSize || 6}
                            onChange={(e) =>
                              setLayout((p) => ({
                                ...p,
                                floor: { ...p.floor, floorLabelFontSize: Number(e.target.value) },
                              }))
                            }
                            className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                          />
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
                                className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                              />
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">ラベルサイズ</div>
                            <div>
                              <label className="text-[10px] text-gray-500">フォント: {selectedEntity.labelFontSize || 1.5}rem</label>
                              <input
                                type="range"
                                min="0.5"
                                max="5"
                                step="0.1"
                                value={selectedEntity.labelFontSize || 1.5}
                                onChange={(e) =>
                                  setLayout((p) => ({
                                    ...p,
                                    zones: p.zones.map((z) =>
                                      z.id === selected.id ? { ...z, labelFontSize: Number(e.target.value) } : z
                                    ),
                                  }))
                                }
                                className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
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
                                className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                              />
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">ラベルサイズ</div>
                            <div>
                              <label className="text-[10px] text-gray-500">フォント: {selectedEntity.labelFontSize || 1.5}rem</label>
                              <input
                                type="range"
                                min="0.5"
                                max="5"
                                step="0.1"
                                value={selectedEntity.labelFontSize || 1.5}
                                onChange={(e) =>
                                  setLayout((p) => ({
                                    ...p,
                                    racks: p.racks.map((r) =>
                                      r.id === selected.id ? { ...r, labelFontSize: Number(e.target.value) } : r
                                    ),
                                  }))
                                }
                                className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
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
                                  className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
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
                                  className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                                />
                              </div>
                            </div>
                          </div>
                          <div className="border-t pt-2">
                            <div className="text-xs font-semibold text-gray-700 mb-2">ラベルサイズ</div>
                            <div>
                              <label className="text-[10px] text-gray-500">フォント: {selectedEntity.labelFontSize || 2.5}rem</label>
                              <input
                                type="range"
                                min="0.5"
                                max="5"
                                step="0.1"
                                value={selectedEntity.labelFontSize || 2.5}
                                onChange={(e) =>
                                  setLayout((p) => ({
                                    ...p,
                                    shelves: (p.shelves || []).map((s) =>
                                      s.id === selected.id ? { ...s, labelFontSize: Number(e.target.value) } : s
                                    ),
                                  }))
                                }
                                className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                              />
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
            <div className="rounded-3xl border-2 bg-white p-4 shadow-md">
              <SectionTitle>オブジェクト作成</SectionTitle>

              {/* テンプレート選択 */}
              <div className="rounded-2xl border-2 p-4" style={{ background: "#f8fafc" }}>
                <div className="text-sm font-bold" style={{ color: "#334155" }}>テンプレート</div>
                <div className="mt-3 grid grid-cols-4 gap-3">
                  {[
                    { k: "パレット", icon: "\u{1f4e6}", w: "1.2", d: "1.0", h: "1.6", color: "#dbeafe", activeColor: "#3b82f6" },
                    { k: "カゴ", icon: "\u{1f6d2}", w: "0.8", d: "0.6", h: "0.7", color: "#d1fae5", activeColor: "#10b981" },
                    { k: "単体荷物", icon: "\u{1f4e6}", w: "0.4", d: "0.3", h: "0.25", color: "#fef3c7", activeColor: "#f59e0b" },
                    { k: "配電盤", icon: "\u{26a1}", w: "1.0", d: "0.5", h: "1.8", color: "#fef9c3", activeColor: "#eab308" },
                  ].map((t) => {
                    const isActive = template === t.k;
                    return (
                      <button
                        key={t.k}
                        type="button"
                        className="flex flex-col items-center rounded-2xl border-2 p-3 select-none"
                        style={{
                          background: isActive ? t.activeColor : t.color,
                          borderColor: isActive ? t.activeColor : "transparent",
                          color: isActive ? "#fff" : "#334155",
                          boxShadow: isActive ? "0 4px 14px " + t.activeColor + "66" : "0 2px 6px rgba(0,0,0,0.06)",
                          transform: isActive ? "scale(1.05)" : "scale(1)",
                          transition: "all 0.2s cubic-bezier(.34,1.56,.64,1)",
                        }}
                        onClick={() => {
                          setTemplate(t.k);
                          setForm((s) => ({ ...s, w: t.w, d: t.d, h: t.h }));
                        }}
                      >
                        <span style={{ fontSize: 28 }}>{t.icon}</span>
                        <span className="mt-1 text-xs font-bold">{t.k}</span>
                        <span className="mt-0.5 text-xs" style={{ opacity: 0.7, fontSize: 10 }}>{t.w}x{t.d}x{t.h}m</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 情報入力 */}
              <div className="mt-4 rounded-2xl border-2 p-4" style={{ background: "#f8fafc" }}>
                <div className="text-sm font-bold" style={{ color: "#334155" }}>情報</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>取引先</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.client}
                      onChange={(e) => setForm((s) => ({ ...s, client: e.target.value }))}
                      placeholder="取引先A"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>数量</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.qty}
                      onChange={(e) => setForm((s) => ({ ...s, qty: e.target.value }))}
                      inputMode="numeric"
                      placeholder="1"
                    />
                  </div>
                  <div className="col-span-2">
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>名称（任意）</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.name}
                      onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                      placeholder="品目や伝票番号など"
                    />
                  </div>
                </div>

                {/* サイズ */}
                <div className="mt-4 text-sm font-bold" style={{ color: "#334155" }}>サイズ</div>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>W(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.w}
                      onChange={(e) => setForm((s) => ({ ...s, w: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>D(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.d}
                      onChange={(e) => setForm((s) => ({ ...s, d: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>H(m)</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.h}
                      onChange={(e) => setForm((s) => ({ ...s, h: e.target.value }))}
                      inputMode="decimal"
                    />
                  </div>
                </div>

                {/* 追加情報 */}
                <div className="mt-4 text-sm font-bold" style={{ color: "#334155" }}>追加情報</div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>SKU</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.sku}
                      onChange={(e) => setForm((s) => ({ ...s, sku: e.target.value }))}
                      placeholder="商品コード"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>バーコード</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.barcode}
                      onChange={(e) => setForm((s) => ({ ...s, barcode: e.target.value }))}
                      placeholder="JAN等"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>ロット番号</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.batch_number}
                      onChange={(e) => setForm((s) => ({ ...s, batch_number: e.target.value }))}
                      placeholder="LOT-001"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>重量(kg)</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.weight_kg}
                      onChange={(e) => setForm((s) => ({ ...s, weight_kg: e.target.value }))}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>温度ゾーン</div>
                    <select
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.temperature_zone}
                      onChange={(e) => setForm((s) => ({ ...s, temperature_zone: e.target.value }))}
                    >
                      <option value="ambient">常温</option>
                      <option value="chilled">冷蔵</option>
                      <option value="frozen">冷凍</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>最大積み段数</div>
                    <input
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.max_stack_height}
                      onChange={(e) => setForm((s) => ({ ...s, max_stack_height: e.target.value }))}
                      inputMode="numeric"
                      placeholder="1"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold" style={{ color: "#64748b" }}>賞味期限</div>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={form.expires_at}
                      onChange={(e) => setForm((s) => ({ ...s, expires_at: e.target.value }))}
                    />
                  </div>
                </div>

                {/* チェックボックス */}
                <div className="mt-3 flex gap-4">
                  <label className="flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm" style={{ borderColor: "#e2e8f0", background: form.fragile ? "#fef2f2" : "transparent" }}>
                    <input
                      type="checkbox"
                      checked={form.fragile}
                      onChange={(e) => setForm((s) => ({ ...s, fragile: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-xs font-semibold">壊れやすい</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm" style={{ borderColor: "#e2e8f0", background: form.stackable ? "#f0fdf4" : "transparent" }}>
                    <input
                      type="checkbox"
                      checked={form.stackable}
                      onChange={(e) => setForm((s) => ({ ...s, stackable: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-xs font-semibold">積み重ね可能</span>
                  </label>
                </div>

                {/* メモ */}
                <div className="mt-3">
                  <div className="text-xs font-semibold" style={{ color: "#64748b" }}>メモ</div>
                  <textarea
                    className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm"
                    style={{ borderColor: "#e2e8f0" }}
                    value={form.notes}
                    onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                    placeholder="特記事項など"
                    rows={2}
                  />
                </div>

                {/* 作成ボタン */}
                <button
                  className="mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold"
                  type="button"
                  onClick={createUnitFromForm}
                  style={{
                    background: "#1e293b",
                    color: "#fff",
                    boxShadow: "0 4px 14px rgba(30,41,59,0.3)",
                    transition: "transform 0.15s, box-shadow 0.15s",
                    fontSize: 14,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.02)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(30,41,59,0.35)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 14px rgba(30,41,59,0.3)"; }}
                >
                  作成
                </button>
              </div>

              <div className="mt-4 rounded-3xl border-2 p-4 shadow-md" style={{ background: "#f8fafc" }}>
                <SectionTitle>未配置</SectionTitle>
                <div className="space-y-3">
                  {unplaced.length === 0 && (
                    <div className="rounded-2xl p-4 text-center text-sm" style={{ background: "#f0f9ff", color: "#64748b" }}>
                      未配置の荷物はありません
                    </div>
                  )}
                  {unplaced.map((u) => {
                    const isSel = isItemSelected("unit", u.id);
                    const kindIcon = u.kind === "パレット" ? "\u{1f4e6}" : u.kind === "カゴ" ? "\u{1f6d2}" : u.kind === "配電盤" ? "\u{26a1}" : "\u{1f4e6}";
                    const kindColor = u.kind === "パレット" ? "#dbeafe" : u.kind === "カゴ" ? "#d1fae5" : u.kind === "配電盤" ? "#fef9c3" : "#fef3c7";
                    return (
                      <div
                        key={u.id}
                        className="rounded-2xl border-2 p-3 select-none"
                        style={{
                          background: "#fff",
                          borderColor: isSel ? "#3b82f6" : "#e2e8f0",
                          boxShadow: isSel ? "0 0 0 3px rgba(59,130,246,0.2), 0 4px 12px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.05)",
                          transition: "all 0.2s",
                        }}
                        onClick={(e) => handleItemClick(e, "unit", u.id)}
                        onDoubleClick={(e) => { e.stopPropagation(); openDetailModal(u); }}
                        role="button"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: kindColor, fontSize: 22 }}>
                            {kindIcon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold" style={{ color: "#1e293b" }}>{u.kind}</div>
                            <div className="truncate text-xs" style={{ color: "#64748b" }}>{u.name}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge>{u.client}</Badge>
                          <Badge color={getStatusColor(u.status)}>{getStatusLabel(u.status)}</Badge>
                          {u.sku && <Badge>SKU: {u.sku}</Badge>}
                          {u.weight_kg > 0 && <Badge>{u.weight_kg}kg</Badge>}
                          {u.temperature_zone && u.temperature_zone !== "ambient" && (
                            <Badge color={getTempZoneColor(u.temperature_zone)}>{getTempZoneLabel(u.temperature_zone)}</Badge>
                          )}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="flex gap-2">
                            <select
                              className="flex-1 rounded-xl border px-2 py-2 text-xs"
                              defaultValue="floor"
                              id={`place-target-${u.id}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <option value="floor">床</option>
                              {(layout.shelves || []).map((s) => (
                                <option key={s.id} value={`shelf-${s.id}`}>棚: {s.name || s.id}</option>
                              ))}
                              {layout.racks.map((r) => (
                                <option key={r.id} value={`rack-${r.id}`}>ラック: {r.name || r.id}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="rounded-xl px-3 py-2 text-xs font-bold"
                              style={{ background: "#1e293b", color: "#fff", boxShadow: "0 2px 8px rgba(30,41,59,0.2)", transition: "transform 0.15s", whiteSpace: "nowrap" }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const sel = document.getElementById(`place-target-${u.id}`);
                                placeAutoByTarget(u.id, sel?.value || "floor");
                              }}
                            >
                              配置
                            </button>
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="rounded-xl px-3 py-1.5 text-xs font-bold"
                              style={{ background: "#fee2e2", color: "#dc2626", transition: "transform 0.15s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.03)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnits((prev) => prev.filter((x) => x.id !== u.id));
                                showToast("削除しました");
                              }}
                            >
                              削除
                            </button>
                          </div>
                        </div>
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
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs text-gray-500">X</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.x} onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, layout.floor.cols - 1); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, x: v } : pn))); }} inputMode="numeric" />
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Y</div>
                        <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" value={selectedEntity.y} onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, layout.floor.rows - 1); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, y: v } : pn))); }} inputMode="numeric" />
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">サイズ（実寸）</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-xs text-gray-500">幅(m)</div>
                          <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" type="number" min="0.1" step="0.1" value={+(selectedEntity.w_m || ((selectedEntity.w || 2) * (layout.floor.cell_m_w || 1.2))).toFixed(2)} onChange={(e) => { const v = Math.max(0.1, Number(e.target.value) || 0.1); const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_w || 1.2))); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, w_m: +v.toFixed(2), w: cells } : pn))); }} />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">奥行(m)</div>
                          <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" type="number" min="0.1" step="0.1" value={+(selectedEntity.d_m || ((selectedEntity.h || 2) * (layout.floor.cell_m_d || 1.0))).toFixed(2)} onChange={(e) => { const v = Math.max(0.1, Number(e.target.value) || 0.1); const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_d || 1.0))); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, d_m: +v.toFixed(2), h: cells } : pn))); }} />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">高さ(m)</div>
                          <input className="mt-1 w-full rounded-xl border px-2 py-1 text-sm" type="number" min="0.1" step="0.1" value={+(selectedEntity.h_m || 1.8).toFixed(2)} onChange={(e) => { const v = Math.max(0.1, Number(e.target.value) || 0.1); setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, h_m: +v.toFixed(2) } : pn))); }} />
                        </div>
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
                        <input type="range" min="0" max="100" value={selectedEntity.bgOpacity ?? 90} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, bgOpacity: Number(e.target.value) } : pn)))} className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500" />
                      </div>
                    </div>
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold text-gray-700 mb-2">ラベルサイズ</div>
                      <div>
                        <label className="text-[10px] text-gray-500">フォント: {selectedEntity.labelFontSize || 0.75}rem</label>
                        <input type="range" min="0.3" max="5" step="0.1" value={selectedEntity.labelFontSize || 0.75} onChange={(e) => setPanels((p) => p.map((pn) => (pn.id === selected.id ? { ...pn, labelFontSize: Number(e.target.value) } : pn)))} className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500" />
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
                    {/* ===== 基本情報（常に展開） ===== */}
                    <div className="text-sm font-semibold">{selectedEntity.kind}</div>
                    <div>
                      <div className="text-xs text-gray-500">名前</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={selectedEntity.name || ""}
                        onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "name", e.target.value)}
                        onBlur={(e) => updateUnitField(selectedEntity.id, "name", e.target.value, "名前変更")}
                      />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">取引先</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={selectedEntity.client || ""}
                        onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "client", e.target.value)}
                        onBlur={(e) => updateUnitField(selectedEntity.id, "client", e.target.value, "取引先変更")}
                      />
                    </div>
                    <div className="text-xs text-gray-500">
                      {selectedEntity.w_m} x {selectedEntity.d_m} x {selectedEntity.h_m} m
                    </div>

                    {/* ===== 操作ボタン（常に展開） ===== */}
                    <div className="flex gap-2">
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => {
                          updateUnitFieldSilent(selectedEntity.id, "rot", !selectedEntity.rot);
                        }}
                      >
                        回転
                      </button>
                      <button
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
                        type="button"
                        onClick={() => {
                          updateUnitField(selectedEntity.id, "loc", { kind: "unplaced" }, "未配置に変更");
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

                    {/* ===== 倉庫間移動（カード風） ===== */}
                    {warehouses.filter((w) => w.id !== wh.id).length > 0 && (
                      <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-3">
                        <div className="text-xs font-bold text-indigo-700 mb-2">倉庫間移動</div>
                        <div className="flex gap-2">
                          <select
                            className="flex-1 rounded-lg border border-indigo-200 bg-white px-2 py-1.5 text-sm"
                            value={transferDest}
                            onChange={(e) => setTransferDest(e.target.value)}
                          >
                            <option value="">移動先を選択</option>
                            {warehouses.filter((w) => w.id !== wh.id).map((w) => (
                              <option key={w.id} value={w.id}>{w.name}</option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 font-medium"
                            type="button"
                            onClick={() => {
                              if (!transferDest) { showToast("移動先を選択してください"); return; }
                              transferUnitToWarehouse(selectedEntity.id, transferDest);
                              setTransferDest("");
                            }}
                          >
                            移動
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ===== サイズ（実寸）— 折りたたみ（デフォルト閉） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, size: !s.size }))}
                      >
                        <span>サイズ（実寸）</span>
                        <span className="text-gray-400">{panelSections.size ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.size && (
                        <div className="pb-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="text-xs text-gray-500">幅(m)</div>
                              <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={selectedEntity.w_m}
                                onChange={(e) => {
                                  const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                  const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_w || 1.2)));
                                  updateUnitFieldSilent(selectedEntity.id, "w_m", +v.toFixed(2));
                                  updateUnitFieldSilent(selectedEntity.id, "w_cells", cells);
                                }}
                                onBlur={() => updateUnitFieldSilent(selectedEntity.id, "w_m", selectedEntity.w_m)}
                              />
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">奥行(m)</div>
                              <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={selectedEntity.d_m}
                                onChange={(e) => {
                                  const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                  const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_d || 1.0)));
                                  updateUnitFieldSilent(selectedEntity.id, "d_m", +v.toFixed(2));
                                  updateUnitFieldSilent(selectedEntity.id, "h_cells", cells);
                                }}
                                onBlur={() => updateUnitFieldSilent(selectedEntity.id, "d_m", selectedEntity.d_m)}
                              />
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">高さ(m)</div>
                              <input
                                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                                type="number"
                                min="0.1"
                                step="0.1"
                                value={selectedEntity.h_m}
                                onChange={(e) => {
                                  const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                  updateUnitFieldSilent(selectedEntity.id, "h_m", +v.toFixed(2));
                                }}
                                onBlur={() => updateUnitFieldSilent(selectedEntity.id, "h_m", selectedEntity.h_m)}
                              />
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            右下の三角ハンドルでもリサイズ可能
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ===== 見た目（色・透明度・ラベル）— 折りたたみ（デフォルト閉） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, appearance: !s.appearance }))}
                      >
                        <span>見た目（色・透明度・ラベル）</span>
                        <span className="text-gray-400">{panelSections.appearance ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.appearance && (
                        <div className="pb-2 space-y-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selectedEntity.bgColor || "#ffffff"}
                                onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "bgColor", e.target.value)}
                                className="w-8 h-8 rounded cursor-pointer border"
                              />
                              <span className="text-xs text-gray-600">背景色</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={selectedEntity.labelColor || "#000000"}
                                onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "labelColor", e.target.value)}
                                className="w-8 h-8 rounded cursor-pointer border"
                              />
                              <span className="text-xs text-gray-600">ラベル色</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">背景透明度: {selectedEntity.bgOpacity ?? 100}%</label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={selectedEntity.bgOpacity ?? 100}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "bgOpacity", Number(e.target.value))}
                              onMouseUp={(e) => updateUnitFieldSilent(selectedEntity.id, "bgOpacity", Number(e.target.value))}
                              className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">フォント: {selectedEntity.labelFontSize || 1.2}rem</label>
                            <input
                              type="range"
                              min="0.3"
                              max="5"
                              step="0.1"
                              value={selectedEntity.labelFontSize || 1.2}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "labelFontSize", Number(e.target.value))}
                              onMouseUp={(e) => updateUnitFieldSilent(selectedEntity.id, "labelFontSize", Number(e.target.value))}
                              className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ===== 詳細情報 — 折りたたみ（デフォルト開） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, detail: !s.detail }))}
                      >
                        <span>詳細情報</span>
                        <span className="text-gray-400">{panelSections.detail ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.detail && (
                        <div className="pb-2 space-y-2">
                          {/* 担当者 */}
                          <div>
                            <div className="text-xs text-gray-500">担当者</div>
                            <select
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.personInCharge || ""}
                              onChange={(e) => updateUnitField(selectedEntity.id, "personInCharge", e.target.value, "担当者変更")}
                            >
                              <option value="">（未設定）</option>
                              {personList.map((p) => (
                                <option key={p.id} value={p.name}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          {/* 案件名 */}
                          <div>
                            <div className="text-xs text-gray-500">案件名</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.projectName || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "projectName", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "projectName", e.target.value, "案件名変更")}
                              placeholder="案件名を入力"
                            />
                          </div>
                          {/* 入庫日時 */}
                          <div>
                            <div className="text-xs text-gray-500">入庫日時</div>
                            <input
                              type="datetime-local"
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.arrivalDate || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "arrivalDate", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "arrivalDate", e.target.value, "入庫日時変更")}
                            />
                          </div>
                          {/* 出庫予定日時 */}
                          <div>
                            <div className="text-xs text-gray-500">出庫予定日時</div>
                            <input
                              type="datetime-local"
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.departureDate || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "departureDate", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "departureDate", e.target.value, "出庫予定日時変更")}
                            />
                          </div>
                          {/* 保管場所（表示のみ） */}
                          <div>
                            <div className="text-xs text-gray-500">保管場所</div>
                            <div className="mt-1 text-sm text-gray-700">
                              {selectedEntity.loc?.kind === "floor"
                                ? `${wh.name} > 床 > (${selectedEntity.loc.x}, ${selectedEntity.loc.y})`
                                : selectedEntity.loc?.kind === "rack"
                                ? `${wh.name} > 棚 ${selectedEntity.loc.rackId} > スロット ${selectedEntity.loc.slot}`
                                : "未配置"}
                            </div>
                          </div>
                          {/* kintoneレコードID */}
                          <div>
                            <div className="text-xs text-gray-500">kintoneレコードID</div>
                            <input
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                              value={selectedEntity.kintoneRecordId || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "kintoneRecordId", e.target.value)}
                              onBlur={(e) => updateUnitFieldSilent(selectedEntity.id, "kintoneRecordId", e.target.value)}
                              placeholder="レコードID"
                            />
                          </div>
                          {/* 備考 */}
                          <div>
                            <div className="text-xs text-gray-500">備考</div>
                            <textarea
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm resize-none"
                              rows={2}
                              value={selectedEntity.notes || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "notes", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "notes", e.target.value, "備考変更")}
                              placeholder="備考を入力"
                            />
                          </div>
                          {/* 詳細モーダルボタン */}
                          <button
                            type="button"
                            className="w-full rounded-lg bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
                            onClick={() => openDetailModal(selectedEntity)}
                          >
                            詳細モーダルを開く
                          </button>
                        </div>
                      )}
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
                <div className="text-xs text-gray-500">担当者</div>
                <div className="text-sm">{detailUnit.personInCharge || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">kintoneレコードID</div>
                <div className="text-sm">{detailUnit.kintoneRecordId || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">案件名</div>
                <div className="text-sm">{detailUnit.projectName || "-"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-500">備考</div>
                <div className="text-sm">{detailUnit.notes || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">入庫日時</div>
                <div className="text-sm">
                  {detailUnit.arrivalDate
                    ? new Date(detailUnit.arrivalDate).toLocaleString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">出庫予定日時</div>
                <div className="text-sm">
                  {detailUnit.departureDate
                    ? new Date(detailUnit.departureDate).toLocaleString("ja-JP")
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

            {/* 編集履歴 */}
            {detailUnit.editHistory && detailUnit.editHistory.length > 0 && (
              <div className="border-t pt-4">
                <div className="text-sm font-semibold mb-2">編集履歴（{detailUnit.editHistory.length}件）</div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {[...detailUnit.editHistory].reverse().map((h, idx) => (
                    <div key={idx} className="rounded-xl border p-2 text-xs">
                      <div className="flex justify-between text-gray-500">
                        <span>{new Date(h.timestamp).toLocaleString("ja-JP")}</span>
                        <span className="font-medium text-gray-700">{h.action}</span>
                      </div>
                      {h.field && (
                        <div className="mt-1">
                          <span className="text-gray-600">{h.field}: </span>
                          <span className="text-red-500">{h.oldValue === undefined || h.oldValue === null || h.oldValue === "" ? "(空)" : String(h.oldValue)}</span>
                          <span className="text-gray-400"> → </span>
                          <span className="text-green-600">{h.newValue === undefined || h.newValue === null || h.newValue === "" ? "(空)" : String(h.newValue)}</span>
                        </div>
                      )}
                      {h.fields && h.changes && (
                        <div className="mt-1 space-y-0.5">
                          {h.fields.map((f) => (
                            <div key={f}>
                              <span className="text-gray-600">{f}: </span>
                              <span className="text-red-500">{h.changes[f]?.old == null || h.changes[f]?.old === "" ? "(空)" : String(h.changes[f].old)}</span>
                              <span className="text-gray-400"> → </span>
                              <span className="text-green-600">{h.changes[f]?.new == null || h.changes[f]?.new === "" ? "(空)" : String(h.changes[f].new)}</span>
                            </div>
                          ))}
                        </div>
                      )}
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

      {/* 担当者管理モーダル */}
      <Modal
        title="担当者リスト管理"
        open={personModalOpen}
        onClose={() => { setPersonModalOpen(false); setNewPersonName(""); }}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
              placeholder="担当者名を入力"
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPersonName.trim()) {
                  const np = { id: "p-" + uid(), name: newPersonName.trim() };
                  onUpdateSite({ ...site, personList: [...personList, np] });
                  setNewPersonName("");
                }
              }}
            />
            <button
              type="button"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!newPersonName.trim()}
              onClick={() => {
                const np = { id: "p-" + uid(), name: newPersonName.trim() };
                onUpdateSite({ ...site, personList: [...personList, np] });
                setNewPersonName("");
              }}
            >
              追加
            </button>
          </div>
          {personList.length === 0 && <div className="text-sm text-gray-500">担当者がまだ登録されていません。</div>}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {personList.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border px-3 py-2">
                <span className="text-sm">{p.name}</span>
                <button
                  type="button"
                  className="text-xs text-red-500 hover:text-red-700"
                  onClick={() => {
                    onUpdateSite({ ...site, personList: personList.filter((x) => x.id !== p.id) });
                  }}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="w-full rounded-2xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={() => { setPersonModalOpen(false); setNewPersonName(""); }}
          >
            閉じる
          </button>
        </div>
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

      {/* 区画拡大モーダル */}
      {zoneDetailOpen && zoneDetailZone && (() => {
        const z = layout.zones.find((zz) => zz.id === zoneDetailZone.id) || zoneDetailZone;
        const isShelfZone = z.loc?.kind === "shelf";
        const cellMW = layout.floor.cell_m_w || 1.2;
        const cellMD = layout.floor.cell_m_d || 1.0;

        // 実寸フットプリント（セル単位の小数）
        const realFP = (u) => {
          const fw = Math.max(0.2, (u.w_m || cellMW) / cellMW);
          const fd = Math.max(0.2, (u.d_m || cellMD) / cellMD);
          return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
        };

        // 区画内の荷物を取得（ローカル座標に変換 + 実寸サイズ）
        const zoneUnits = (() => {
          if (isShelfZone) {
            const shelfId = z.loc.shelfId;
            const zx = z.loc.x || 0, zy = z.loc.y || 0;
            return units.filter((u) => u.loc?.kind === "shelf" && u.loc.shelfId === shelfId).map((u) => {
              const fp = unitFootprintCells(u);
              const rp = realFP(u);
              return { ...u, _localX: (u.loc.x || 0) - zx, _localY: (u.loc.y || 0) - zy, _fw: fp.w, _fh: fp.h, _realW: rp.w, _realH: rp.h };
            }).filter((u) => u._localX >= -0.01 && u._localY >= -0.01 && u._localX + u._realW <= z.w + 0.01 && u._localY + u._realH <= z.h + 0.01);
          } else {
            return units.filter((u) => u.loc?.kind === "floor").map((u) => {
              const fp = unitFootprintCells(u);
              const rp = realFP(u);
              return { ...u, _localX: (u.loc.x || 0) - z.x, _localY: (u.loc.y || 0) - z.y, _fw: fp.w, _fh: fp.h, _realW: rp.w, _realH: rp.h };
            }).filter((u) => u._localX >= -0.01 && u._localY >= -0.01 && u._localX + u._realW <= z.w + 0.01 && u._localY + u._realH <= z.h + 0.01);
          }
        })();

        // 動的スケール: モーダル内に区画が収まるよう計算
        const maxModalW = Math.min(window.innerWidth - 80, 1200);
        const maxModalH = Math.min(window.innerHeight - 160, 800);
        const zoneCellPx = Math.min(Math.floor(maxModalW / z.w), Math.floor(maxModalH / z.h), 80);
        const gridW = z.w * zoneCellPx;
        const gridH = z.h * zoneCellPx;

        // === 3Dビュー用の計算 ===
        const iso3d = (() => {
          if (!zoneDetail3D) return null;

          const rotStep = zoneDetailRotStep;
          const viewCols = z.w, viewRows = z.h;

          // viewItems with local coords and real footprint
          const viewItems = zoneUnits.map((u) => ({ ...u, gx: u._localX, gy: u._localY, fw: u._realW, fh: u._realH }));

          // Rotation helpers
          const rotateGxGy = (gx, gy) => {
            const s = rotStep % 4;
            if (s === 0) return { rx: gx, ry: gy };
            if (s === 1) return { rx: viewRows - 1 - gy, ry: gx };
            if (s === 2) return { rx: viewCols - 1 - gx, ry: viewRows - 1 - gy };
            return { rx: gy, ry: viewCols - 1 - gx };
          };
          const rotateRect = (gx, gy, w, h) => {
            const s = rotStep % 4;
            if (s === 0) return { rx: gx, ry: gy, rw: w, rh: h };
            if (s === 1) return { rx: viewRows - gy - h, ry: gx, rw: h, rh: w };
            if (s === 2) return { rx: viewCols - gx - w, ry: viewRows - gy - h, rw: w, rh: h };
            return { rx: gy, ry: viewCols - gx - w, rw: h, rh: w };
          };
          // 逆回転（スクリーン差分→ローカル座標差分）
          const invRotDelta = (drx, dry) => {
            const s = rotStep % 4;
            if (s === 0) return { dgx: drx, dgy: dry };
            if (s === 1) return { dgx: dry, dgy: -drx };
            if (s === 2) return { dgx: -drx, dgy: -dry };
            return { dgx: -dry, dgy: drx };
          };

          const effCols = (rotStep % 2 === 0) ? viewCols : viewRows;
          const effRows = (rotStep % 2 === 0) ? viewRows : viewCols;

          // Group stacks
          const stacks = {};
          for (const u of viewItems) {
            const { rx, ry } = rotateGxGy(u.gx, u.gy);
            const key = `${rx},${ry}`;
            if (!stacks[key]) stacks[key] = [];
            stacks[key].push({ ...u, rx, ry });
          }
          for (const k of Object.keys(stacks)) stacks[k].sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));

          // Tile sizing
          const baseTile = Math.max(16, Math.min(50, Math.floor(600 / Math.max(effCols, effRows))));
          const tileW = baseTile, tileH = baseTile / 2;
          const heightScale = baseTile * 0.6;
          const toIso = (gx, gy) => ({ sx: (gx - gy) * (tileW / 2), sy: (gx + gy) * (tileH / 2) });

          // Canvas bounds
          const allCorners = [toIso(0, 0), toIso(effCols, 0), toIso(0, effRows), toIso(effCols, effRows)];
          const maxStackH = viewItems.reduce((m, u) => Math.max(m, (u.stackZ || 0) + (u.h_m || 1)), 0);
          const minSx = Math.min(...allCorners.map((c) => c.sx)) - 60;
          const maxSx = Math.max(...allCorners.map((c) => c.sx)) + 60;
          const minSy = Math.min(...allCorners.map((c) => c.sy)) - Math.max(200, maxStackH * heightScale + 80);
          const maxSy = Math.max(...allCorners.map((c) => c.sy)) + 60;
          const svgW = maxSx - minSx;
          const svgH = maxSy - minSy;
          const offX = -minSx;
          const offY = -minSy;

          // Colors
          const boxColors = ["#60a5fa","#34d399","#fbbf24","#f87171","#a78bfa","#fb923c","#38bdf8","#4ade80","#facc15","#f472b6"];
          const stableColorIdx = (id) => { let h=0; for(let i=0;i<id.length;i++) h=((h<<5)-h+id.charCodeAt(i))|0; return ((h%boxColors.length)+boxColors.length)%boxColors.length; };
          const kindCol = (kind, id) => kind==="配電盤"?"#fbbf24":kind==="パレット"?"#60a5fa":kind==="カゴ"?"#34d399":boxColors[stableColorIdx(id||"")];

          // Render items
          const renderItems = [];
          for (const [, stack] of Object.entries(stacks)) {
            for (const u of stack) {
              const isPanel = u.kind === "配電盤";
              const { rx: rgx, ry: rgy, rw: fw, rh: fh } = rotateRect(u.gx, u.gy, u.fw || 1, u.fh || 1);
              renderItems.push({ u, gx: rgx, gy: rgy, fw, fh, zOff: isPanel ? 0 : (u.stackZ || 0), h: u.h_m || 1 });
            }
          }
          renderItems.sort((a, b) => { const da=a.gx+a.gy, db=b.gx+b.gy; return da!==db ? da-db : a.zOff-b.zOff; });

          return { effCols, effRows, tileW, tileH, heightScale, toIso, svgW, svgH, offX, offY, renderItems, kindCol, stacks, viewItems, rotateRect, invRotDelta };
        })();

        // ドラッグ中の移動先ローカル座標を計算するヘルパー
        const SUB = 4; // 4分割サブグリッド（0.25セル刻み）
        const calcDragTarget = (d) => {
          if (zoneDetail3D && iso3d) {
            const { tileW, tileH, invRotDelta } = iso3d;
            const zm = zoneDetailZoom;
            const dsx = (d.pointerX - d.startX) / zm;
            const dsy = (d.pointerY - d.startY) / zm;
            // 逆アイソメトリック: スクリーン差分 → 回転グリッド差分
            const drgx = dsx / tileW + dsy / tileH;
            const drgy = dsy / tileH - dsx / tileW;
            // 逆回転: 回転グリッド差分 → ローカル座標差分
            const { dgx, dgy } = invRotDelta(drgx, drgy);
            return { x: Math.round((d.baseLocalX + dgx) * SUB) / SUB, y: Math.round((d.baseLocalY + dgy) * SUB) / SUB };
          }
          const dx = d.pointerX - d.startX;
          const dy = d.pointerY - d.startY;
          const rawX = d.baseLocalX + dx / zoneCellPx;
          const rawY = d.baseLocalY + dy / zoneCellPx;
          return { x: Math.round(rawX * SUB) / SUB, y: Math.round(rawY * SUB) / SUB };
        };

        // ドラッグ中のゴースト位置計算（2D/3D共通）
        const ghost = (() => {
          if (!zoneDetailDrag) return null;
          const d = zoneDetailDrag;
          const { x: newLocalX, y: newLocalY } = calcDragTarget(d);
          const u = units.find((uu) => uu.id === d.unitId);
          if (!u) return null;
          const ok = canPlaceInZone(z, u, newLocalX, newLocalY, u.id, realFP);
          const fp = realFP(u);
          return { x: newLocalX, y: newLocalY, w: fp.w, h: fp.h, ok, unitId: u.id };
        })();

        // ドラッグ中のユニットかどうか
        const draggingId = zoneDetailDrag?.unitId;
        const hasDragMoved = zoneDetailDrag && (zoneDetailDrag.pointerX !== zoneDetailDrag.startX || zoneDetailDrag.pointerY !== zoneDetailDrag.startY);

        // ドロップ処理（2D/3D共通）
        const handleDrop = () => {
          if (!zoneDetailDrag) return;
          const d = zoneDetailDrag;
          const { x: newLocalX, y: newLocalY } = calcDragTarget(d);
          const u = units.find((uu) => uu.id === d.unitId);
          if (u && (Math.abs(newLocalX - d.baseLocalX) > 0.001 || Math.abs(newLocalY - d.baseLocalY) > 0.001)) {
            if (canPlaceInZone(z, u, newLocalX, newLocalY, u.id, realFP)) {
              const absX = isShelfZone ? (z.loc.x || 0) + newLocalX : z.x + newLocalX;
              const absY = isShelfZone ? (z.loc.y || 0) + newLocalY : z.y + newLocalY;
              const fp = realFP(u);
              const candidate = { x: absX, y: absY, w: fp.w, h: fp.h };
              const containingItems = isShelfZone
                ? units.filter((s) => s.id !== u.id && s.loc?.kind === "shelf" && s.loc.shelfId === z.loc.shelfId).filter((s) => { const sfp = realFP(s); return containsRect({ x: s.loc.x||0, y: s.loc.y||0, w: sfp.w, h: sfp.h }, candidate); })
                : getContainingStackItems(candidate, u.id);
              const newStackZ = containingItems.length > 0
                ? Math.max(...containingItems.map(i => (i.stackZ || 0) + (i.h_m || 0)))
                : 0;
              if (isShelfZone) {
                setUnits((prev) => prev.map((uu) => uu.id === u.id ? { ...uu, loc: { ...uu.loc, x: absX, y: absY }, stackZ: newStackZ } : uu));
              } else {
                setUnits((prev) => prev.map((uu) => uu.id === u.id ? { ...uu, loc: { kind: "floor", x: absX, y: absY }, stackZ: newStackZ } : uu));
              }
            } else {
              showToast("ここには置けません（他の荷物と重なっています）");
            }
          }
          setZoneDetailDrag(null);
        };

        // ドラッグ開始ヘルパー
        const startDragUnit = (e, u) => {
          e.stopPropagation();
          e.preventDefault();
          const zu = zoneUnits.find((uu) => uu.id === u.id);
          if (!zu) return;
          setZoneDetailDrag({
            unitId: u.id,
            startX: e.clientX,
            startY: e.clientY,
            pointerX: e.clientX,
            pointerY: e.clientY,
            baseLocalX: zu._localX,
            baseLocalY: zu._localY,
          });
        };

        return (
          <div
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 99998,
              display: "flex", alignItems: "center", justifyContent: "center",
              backgroundColor: "rgba(0, 0, 0, 0.6)",
            }}
            onClick={(e) => { if (e.target === e.currentTarget) closeZoneDetailModal(); }}
            onMouseMove={(e) => {
              if (!zoneDetailDrag) return;
              setZoneDetailDrag((prev) => prev ? { ...prev, pointerX: e.clientX, pointerY: e.clientY } : null);
            }}
            onMouseUp={handleDrop}
          >
            <div
              style={{
                background: "white",
                borderRadius: 16,
                boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
                maxWidth: maxModalW + 48,
                maxHeight: window.innerHeight - 40,
                overflow: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div className="flex items-center justify-between border-b px-5 py-4 gap-3">
                <div className="text-lg font-semibold flex-1 min-w-0">
                  {z.name || "区画"}{z.client ? ` (${z.client})` : ""} — {z.w}×{z.h} セル
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 2D/3D切替 */}
                  <button
                    className="rounded-xl border px-3 py-1.5 text-sm font-bold"
                    style={zoneDetail3D
                      ? { background: "#ede9fe", color: "#7c3aed", borderColor: "#c4b5fd" }
                      : { background: "#f1f5f9", color: "#475569", borderColor: "#cbd5e1" }
                    }
                    onClick={() => { setZoneDetail3D((v) => !v); setZoneDetailDrag(null); }}
                    type="button"
                  >{zoneDetail3D ? "2Dに戻す" : "3Dビュー"}</button>
                  {/* 3D回転コントロール */}
                  {zoneDetail3D && (
                    <>
                      <button className="rounded-lg border px-2 py-1 text-sm hover:bg-gray-100" onClick={() => setZoneDetailRotStep((r) => (r + 3) % 4)} type="button">↺</button>
                      <button className="rounded-lg border px-2 py-1 text-sm hover:bg-gray-100" onClick={() => setZoneDetailRotStep((r) => (r + 1) % 4)} type="button">↻</button>
                      <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-100" onClick={() => setZoneDetailZoom((v) => Math.min(3, v + 0.2))} type="button">+</button>
                      <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-100" onClick={() => setZoneDetailZoom((v) => Math.max(0.3, v - 0.2))} type="button">-</button>
                    </>
                  )}
                  <button
                    className="rounded-xl px-3 py-1 text-sm hover:bg-gray-100"
                    onClick={closeZoneDetailModal}
                    type="button"
                  >✕</button>
                </div>
              </div>

              {/* === 2Dグリッド（実寸サイズ反映） === */}
              {!zoneDetail3D && (
                <div className="px-5 py-4 flex justify-center">
                  <div
                    style={{
                      position: "relative",
                      width: gridW,
                      height: gridH,
                      backgroundColor: z.bgColor || "#d1fae5",
                      borderRadius: 8,
                      border: `2px solid ${z.bgColor || "#10b981"}`,
                      userSelect: "none",
                    }}
                  >
                    {/* サブグリッド線（0.25セル刻み） */}
                    {Array.from({ length: z.w * SUB - 1 }, (_, i) => (
                      <div key={`sv${i}`} style={{
                        position: "absolute", left: (i + 1) * (zoneCellPx / SUB), top: 0,
                        width: (i + 1) % SUB === 0 ? 1 : 1, height: gridH,
                        backgroundColor: (i + 1) % SUB === 0 ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.03)",
                      }} />
                    ))}
                    {Array.from({ length: z.h * SUB - 1 }, (_, i) => (
                      <div key={`sh${i}`} style={{
                        position: "absolute", top: (i + 1) * (zoneCellPx / SUB), left: 0,
                        height: (i + 1) % SUB === 0 ? 1 : 1, width: gridW,
                        backgroundColor: (i + 1) % SUB === 0 ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.03)",
                      }} />
                    ))}

                    {/* 区画内の荷物（実寸サイズ表示） */}
                    {zoneUnits.map((u) => {
                      const isDrag = u.id === draggingId && hasDragMoved;
                      const ubgRgb = hexToRgb(u.bgColor || "#ffffff");
                      const ubgOp = (u.bgOpacity ?? 100) / 100;
                      const kindIcon = u.kind === "パレット" ? "📦" : u.kind === "カゴ" ? "🧺" : u.kind === "配電盤" ? "⚡" : "📋";
                      // 実寸サイズで描画
                      const realWPx = u._realW * zoneCellPx;
                      const realHPx = u._realH * zoneCellPx;
                      // 寸法ラベル
                      const wM = u.rot ? (u.d_m || cellMD) : (u.w_m || cellMW);
                      const dM = u.rot ? (u.w_m || cellMW) : (u.d_m || cellMD);
                      return (
                        <div
                          key={u.id}
                          style={{
                            position: "absolute",
                            left: u._localX * zoneCellPx,
                            top: u._localY * zoneCellPx,
                            width: realWPx,
                            height: realHPx,
                            background: u.bgColor
                              ? `rgba(${ubgRgb.join(",")}, ${ubgOp})`
                              : "linear-gradient(145deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)",
                            border: "2px solid " + (u.bgColor || "#e2e8f0"),
                            borderRadius: 12,
                            cursor: "grab",
                            boxShadow: "0 4px 12px -2px rgba(0,0,0,0.08)",
                            opacity: isDrag ? 0.4 : 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            zIndex: 5,
                            transition: isDrag ? "none" : "opacity 0.15s",
                          }}
                          onMouseDown={(e) => startDragUnit(e, u)}
                          onDoubleClick={(e) => { e.stopPropagation(); openDetailModal(u); }}
                        >
                          <div style={{ fontSize: Math.min(zoneCellPx * 0.35, 22), lineHeight: 1 }}>{kindIcon}</div>
                          <div style={{
                            fontSize: Math.min(zoneCellPx * 0.16, 11),
                            fontWeight: 700,
                            color: "#334155",
                            textAlign: "center",
                            lineHeight: 1.2,
                            padding: "0 2px",
                            wordBreak: "break-all",
                            maxHeight: "2.4em",
                            overflow: "hidden",
                          }}>{u.name}</div>
                          {zoneCellPx >= 40 && (
                            <div style={{ fontSize: Math.min(zoneCellPx * 0.13, 9), color: "#94a3b8", marginTop: 1 }}>
                              {wM.toFixed(1)}×{dM.toFixed(1)}m
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* ゴーストプレビュー */}
                    {ghost && hasDragMoved && (
                      <div style={{
                        position: "absolute",
                        left: ghost.x * zoneCellPx,
                        top: ghost.y * zoneCellPx,
                        width: ghost.w * zoneCellPx,
                        height: ghost.h * zoneCellPx,
                        border: `3px dashed ${ghost.ok ? "#3b82f6" : "#ef4444"}`,
                        borderRadius: 12,
                        backgroundColor: ghost.ok ? "rgba(59,130,246,0.12)" : "rgba(239,68,68,0.12)",
                        zIndex: 10,
                        pointerEvents: "none",
                        transition: "left 0.08s, top 0.08s",
                      }} />
                    )}
                  </div>
                </div>
              )}

              {/* === 3Dアイソメトリックビュー === */}
              {zoneDetail3D && iso3d && (() => {
                const { effCols, effRows, tileW, tileH, heightScale, toIso, svgW, svgH, offX, offY, renderItems, kindCol, stacks, rotateRect } = iso3d;
                const zm = zoneDetailZoom;
                const bgRgb = hexToRgb(z.bgColor || "#d1fae5");

                // 3Dゴースト用の回転座標計算
                const isoGhost = (() => {
                  if (!ghost || !hasDragMoved) return null;
                  const u = units.find((uu) => uu.id === ghost.unitId);
                  if (!u) return null;
                  const rfp = realFP(u);
                  const { rx, ry, rw, rh } = rotateRect(ghost.x, ghost.y, rfp.w, rfp.h);
                  return { gx: rx, gy: ry, fw: rw, fh: rh, ok: ghost.ok, h: u.h_m || 1 };
                })();

                return (
                  <div className="px-5 py-4 flex justify-center">
                    <div
                      style={{ overflow: "auto", maxWidth: "85vw", maxHeight: "60vh" }}
                      onWheel={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          setZoneDetailZoom((v) => Math.min(3, Math.max(0.3, v + (e.deltaY < 0 ? 0.1 : -0.1))));
                        }
                      }}
                    >
                      <div style={{ position: "relative", width: svgW * zm, height: svgH * zm, margin: "0 auto" }}>
                        <div style={{ transform: `scale(${zm})`, transformOrigin: "top left", position: "relative", width: svgW, height: svgH }}>
                          {/* Floor tiles */}
                          {Array.from({ length: effRows }, (_, gy) =>
                            Array.from({ length: effCols }, (_, gx) => {
                              const { sx, sy } = toIso(gx, gy);
                              const x = sx + offX, y = sy + offY;
                              const points = [`${x}px ${y}px`,`${x+tileW/2}px ${y+tileH/2}px`,`${x}px ${y+tileH}px`,`${x-tileW/2}px ${y+tileH/2}px`].join(", ");
                              const tileLight = `rgba(${bgRgb.join(",")}, 0.9)`;
                              const tileDark = `rgba(${bgRgb.map((c) => Math.max(0, c - 20)).join(",")}, 0.9)`;
                              return <div key={`f-${gx}-${gy}`} style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${points})`, background: (gx+gy)%2===0 ? tileDark : tileLight }} />;
                            })
                          )}

                          {/* Isometric boxes for units */}
                          {renderItems.map(({ u, gx, gy, fw, fh, zOff, h }, idx) => {
                            const isDrag3D = u.id === draggingId && hasDragMoved;
                            const p0 = toIso(gx, gy), p1 = toIso(gx+fw, gy), p2 = toIso(gx+fw, gy+fh), p3 = toIso(gx, gy+fh);
                            const lift = zOff * heightScale, bH = h * heightScale;
                            const ox = (p) => p.sx + offX, oy = (p, up) => p.sy + offY - up;
                            const topH = lift + bH;
                            const topPts = [`${ox(p0)}px ${oy(p0,topH)}px`,`${ox(p1)}px ${oy(p1,topH)}px`,`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p3)}px ${oy(p3,topH)}px`].join(", ");
                            const leftPts = [`${ox(p3)}px ${oy(p3,topH)}px`,`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p2)}px ${oy(p2,lift)}px`,`${ox(p3)}px ${oy(p3,lift)}px`].join(", ");
                            const rightPts = [`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p1)}px ${oy(p1,topH)}px`,`${ox(p1)}px ${oy(p1,lift)}px`,`${ox(p2)}px ${oy(p2,lift)}px`].join(", ");
                            const cx = (ox(p0)+ox(p1)+ox(p2)+ox(p3))/4, cy = (oy(p0,topH)+oy(p1,topH)+oy(p2,topH)+oy(p3,topH))/4;
                            const color = u.bgColor || kindCol(u.kind, u.id);
                            // クリック/ドラッグ領域
                            const bx0 = Math.min(ox(p0),ox(p1),ox(p2),ox(p3)), bx1 = Math.max(ox(p0),ox(p1),ox(p2),ox(p3));
                            const by0 = Math.min(oy(p0,topH),oy(p1,topH),oy(p2,topH),oy(p3,topH)), by1 = Math.max(oy(p0,lift),oy(p1,lift),oy(p2,lift),oy(p3,lift));
                            return (
                              <g key={u.id + "-" + idx}>
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPts})`, background: color, filter: "brightness(0.7)", opacity: isDrag3D ? 0.3 : 1 }} />
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPts})`, background: color, filter: "brightness(0.85)", opacity: isDrag3D ? 0.3 : 1 }} />
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPts})`, background: color, opacity: isDrag3D ? 0.3 : 1 }} />
                                {!isDrag3D && <div style={{ position: "absolute", left: cx-30, top: cy-8, width: 60, textAlign: "center", fontSize: 9, fontWeight: 700, color: "#1e293b", pointerEvents: "none", textShadow: "0 0 3px rgba(255,255,255,0.9)" }}>{u.name || u.kind}</div>}
                                {u.fragile && !isDrag3D && <div style={{ position: "absolute", left: cx-6, top: cy-14, fontSize: 11, pointerEvents: "none" }}>⚠</div>}
                                {/* 透明ドラッグ/クリック領域（ボックス全体） */}
                                <div
                                  style={{ position: "absolute", left: bx0, top: by0, width: bx1-bx0, height: Math.max(by1-by0, 16), cursor: "grab", zIndex: 20 }}
                                  onMouseDown={(e) => startDragUnit(e, u)}
                                  onDoubleClick={(e) => { e.stopPropagation(); openDetailModal(u); }}
                                  title={`${u.name} (ドラッグで移動 / ダブルクリックで詳細)`}
                                />
                              </g>
                            );
                          })}

                          {/* 3Dゴーストプレビュー */}
                          {isoGhost && (() => {
                            const { gx, gy, fw: gfw, fh: gfh, ok, h: gh } = isoGhost;
                            const gp0 = toIso(gx, gy), gp1 = toIso(gx+gfw, gy), gp2 = toIso(gx+gfw, gy+gfh), gp3 = toIso(gx, gy+gfh);
                            const gbH = gh * heightScale;
                            const gox = (p) => p.sx + offX, goy = (p, up) => p.sy + offY - up;
                            const gTopPts = [`${gox(gp0)}px ${goy(gp0,gbH)}px`,`${gox(gp1)}px ${goy(gp1,gbH)}px`,`${gox(gp2)}px ${goy(gp2,gbH)}px`,`${gox(gp3)}px ${goy(gp3,gbH)}px`].join(", ");
                            const gLeftPts = [`${gox(gp3)}px ${goy(gp3,gbH)}px`,`${gox(gp2)}px ${goy(gp2,gbH)}px`,`${gox(gp2)}px ${goy(gp2,0)}px`,`${gox(gp3)}px ${goy(gp3,0)}px`].join(", ");
                            const gRightPts = [`${gox(gp2)}px ${goy(gp2,gbH)}px`,`${gox(gp1)}px ${goy(gp1,gbH)}px`,`${gox(gp1)}px ${goy(gp1,0)}px`,`${gox(gp2)}px ${goy(gp2,0)}px`].join(", ");
                            const ghostColor = ok ? "rgba(59,130,246,0.35)" : "rgba(239,68,68,0.35)";
                            return (
                              <g>
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${gLeftPts})`, background: ghostColor, filter: "brightness(0.8)", pointerEvents: "none", zIndex: 30 }} />
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${gRightPts})`, background: ghostColor, filter: "brightness(0.9)", pointerEvents: "none", zIndex: 30 }} />
                                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${gTopPts})`, background: ghostColor, pointerEvents: "none", zIndex: 30 }} />
                              </g>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* フッター情報 */}
              <div className="border-t px-5 py-3 text-xs text-gray-500 flex justify-between">
                <span>ドラッグで移動 / ダブルクリックで詳細</span>
                <span>{zoneUnits.length} 個の荷物{zoneDetail3D && iso3d ? ` / スタック ${Object.values(iso3d.stacks).filter((s) => s.length > 1).length} 箇所` : ""}</span>
              </div>
            </div>
          </div>
        );
      })()}
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
  const [topViewMode, setTopViewMode] = useState(() => {
    try { return localStorage.getItem("wh_top_view_mode") || "map"; } catch { return "map"; }
  });
  useEffect(() => { try { localStorage.setItem("wh_top_view_mode", topViewMode); } catch {} }, [topViewMode]);

  const [site, setSite] = useSupabaseState("wh_demo_site_v1", {
    id: "site-1",
    name: "共有ワークスペース 倉庫群",
    map_scale_mode: "ui", // ui | scaled
    personList: [],  // [{id, name}]
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
    cardColor: "",
    cardOpacity: "100",
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
      cardColor: editTarget.cardColor ?? "",
      cardOpacity: String(editTarget.cardOpacity ?? "100"),
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
        cardColor: editForm.cardColor || "",
        cardOpacity: Number(editForm.cardOpacity) || 100,
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
        site={site}
        onUpdateSite={setSite}
        warehouses={warehouses}
      />
    );
  }

  return (
    <div className="h-screen w-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-sm text-gray-500">TOP（マップ風配置 / 簡易デモ）</div>
            <div className="text-lg font-semibold">{site.name}</div>
          </div>
          <div className="flex overflow-hidden rounded-lg border text-sm">
            {[["map", "マップ"], ["simple", "一覧"]].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={"px-3 py-1.5 " + (topViewMode === mode ? "bg-black text-white" : "bg-white hover:bg-gray-100")}
                onClick={() => setTopViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton title="倉庫を追加" onClick={addWarehouse}>
            ＋ 倉庫追加
          </IconButton>
          {topViewMode === "map" && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="grid h-[calc(100vh-64px)] grid-cols-[1fr_380px] gap-4 p-4">
        {/* Main area: Map or Simple Grid */}
        {topViewMode === "simple" ? (
          <SimpleGridView
            warehouses={warehouses}
            selectedWarehouseId={selectedWarehouseId}
            onSelect={(id) => setSelectedWarehouseId(id)}
            onOpen={(id) => {
              setActiveWarehouseId(id);
              setView("warehouse");
            }}
          />
        ) : (
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
        )}

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

            {/* カードカラー設定 */}
            <div className="rounded-xl border p-3">
              <div className="text-xs text-gray-500 mb-2 font-semibold">一覧カードの色設定</div>
              <div className="flex gap-3 items-start">
                {/* プレビュー */}
                <div
                  className="flex-shrink-0 flex items-center justify-center rounded-2xl border-2 border-white"
                  style={{
                    width: 64,
                    height: 64,
                    fontSize: 32,
                    background: editForm.cardColor
                      ? editForm.cardColor + String(Math.round((Number(editForm.cardOpacity) / 100) * 255).toString(16)).padStart(2, "0")
                      : "#fef3c7",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                  }}
                >
                  🏭
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-xs text-gray-500">カード背景色</div>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        value={editForm.cardColor || "#fef3c7"}
                        onChange={(e) => setEditForm((s) => ({ ...s, cardColor: e.target.value }))}
                        className="h-9 w-12 cursor-pointer rounded-lg border p-0.5"
                      />
                      <input
                        className="flex-1 rounded-xl border px-3 py-2 text-sm"
                        value={editForm.cardColor}
                        onChange={(e) => setEditForm((s) => ({ ...s, cardColor: e.target.value }))}
                        placeholder="未設定（自動配色）"
                      />
                      {editForm.cardColor && (
                        <button
                          type="button"
                          className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-100"
                          onClick={() => setEditForm((s) => ({ ...s, cardColor: "" }))}
                        >
                          リセット
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 flex justify-between">
                      <span>透明度</span>
                      <span>{editForm.cardOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="100"
                      step="5"
                      value={editForm.cardOpacity}
                      onChange={(e) => setEditForm((s) => ({ ...s, cardOpacity: e.target.value }))}
                      className="mt-1 w-full"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {["#fef3c7","#dbeafe","#fce7f3","#d1fae5","#ede9fe","#ffedd5","#e0e7ff","#fecaca","#ccfbf1","#fde68a","#fee2e2","#f0fdf4","#faf5ff","#fff7ed"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="h-6 w-6 rounded-full border-2"
                        style={{
                          background: c,
                          borderColor: editForm.cardColor === c ? "#3b82f6" : "transparent",
                          boxShadow: editForm.cardColor === c ? "0 0 0 2px rgba(59,130,246,0.3)" : "none",
                        }}
                        onClick={() => setEditForm((s) => ({ ...s, cardColor: c }))}
                      />
                    ))}
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
