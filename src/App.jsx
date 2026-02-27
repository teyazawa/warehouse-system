import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { normalize as normalizeAddress } from "@geolonia/normalize-japanese-addresses";


// HEX色をRGB配列に変換
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [0, 0, 0];
}

// 吹き出し風カスタム倉庫マーカーのDOM要素を生成
function createWarehouseMarkerElement(warehouse, isSelected = false) {
  const size = warehouse.iconSize || 48;
  const imageUrl = warehouse.iconImage;
  const pointerLength = warehouse.pointerLength || 10;
  const pointerWidth = warehouse.pointerWidth || 8;
  const borderColor = isSelected ? "#2563eb" : "#333";
  const borderWidth = isSelected ? "3px" : "2px";
  const shadowColor = isSelected ? "rgba(37,99,235,0.4)" : "rgba(0,0,0,0.3)";

  const el = document.createElement("div");
  el.className = "warehouse-marker";
  el.style.cursor = "pointer";

  let innerHtml;
  if (imageUrl) {
    innerHtml = `
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
    innerHtml = `
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

  el.innerHTML = innerHtml;
  return el;
}

// MapLibre GL JS マップコンポーネント
const STORAGE_KEY_V2 = "wh_demo_map_state_v2";
const STORAGE_KEY_V1 = "wh_demo_map_state_v1";

function MapLibreMap({ warehouses, selectedWarehouseId, onSelect, onPositionChange, onDoubleClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({}); // { [warehouseId]: maplibregl.Marker }

  // マップ初期化
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // 保存状態の復元
    let initCenter = [139.75, 35.68]; // [lng, lat]
    let initZoom = 12;
    let initPitch = 0;
    let initBearing = 0;

    try {
      const savedV2 = localStorage.getItem(STORAGE_KEY_V2);
      if (savedV2) {
        const s = JSON.parse(savedV2);
        if (s.center) initCenter = s.center;
        if (s.zoom != null) initZoom = s.zoom;
        if (s.pitch != null) initPitch = s.pitch;
        if (s.bearing != null) initBearing = s.bearing;
      } else {
        // v1フォールバック: Leaflet時代は [lat, lng] で保存されていた
        const savedV1 = localStorage.getItem(STORAGE_KEY_V1);
        if (savedV1) {
          const s = JSON.parse(savedV1);
          if (s.center && s.center.length === 2) {
            initCenter = [s.center[1], s.center[0]]; // [lat,lng] → [lng,lat]
          }
          if (s.zoom != null) initZoom = s.zoom;
        }
      }
    } catch (e) {
      console.error("Failed to restore map state:", e);
    }

    // 衛星写真 + ラベルのハイブリッドスタイル
    const satelliteStyle = {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        },
        labels: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        { id: "satellite-tiles", type: "raster", source: "satellite", minzoom: 0, maxzoom: 19 },
        { id: "label-tiles", type: "raster", source: "labels", minzoom: 0, maxzoom: 19 },
      ],
    };
    const osmStyle = {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        { id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 19 },
      ],
    };

    const savedMapType = localStorage.getItem("wh_map_type") || "satellite";

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: savedMapType === "satellite" ? satelliteStyle : osmStyle,
      center: initCenter,
      zoom: initZoom,
      pitch: initPitch,
      bearing: initBearing,
      maxPitch: 60,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    // 地図/衛星 切り替えボタン
    class MapTypeControl {
      constructor() { this._type = savedMapType; }
      onAdd(map) {
        this._map = map;
        this._container = document.createElement("div");
        this._container.className = "maplibregl-ctrl maplibregl-ctrl-group";
        this._btn = document.createElement("button");
        this._btn.type = "button";
        this._btn.style.cssText = "width:auto;padding:0 8px;font-size:12px;font-weight:600;cursor:pointer;";
        this._btn.textContent = this._type === "satellite" ? "地図" : "衛星";
        this._btn.title = "地図/衛星写真を切り替え";
        this._btn.addEventListener("click", () => {
          this._type = this._type === "satellite" ? "osm" : "satellite";
          this._btn.textContent = this._type === "satellite" ? "地図" : "衛星";
          localStorage.setItem("wh_map_type", this._type);
          this._map.setStyle(this._type === "satellite" ? satelliteStyle : osmStyle);
        });
        this._container.appendChild(this._btn);
        return this._container;
      }
      onRemove() { this._container.remove(); }
    }
    map.addControl(new MapTypeControl(), "top-right");

    // setStyle後にマーカーを再追加
    map.on("style.load", () => {
      for (const id of Object.keys(markersRef.current)) {
        const marker = markersRef.current[id];
        marker.addTo(map);
      }
    });

    // 状態保存
    const saveState = () => {
      try {
        const center = map.getCenter();
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        }));
      } catch (e) {
        // ignore
      }
    };
    map.on("moveend", saveState);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  // マーカー同期
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(warehouses.map((w) => w.id));
    const existingIds = new Set(Object.keys(markersRef.current));

    // 削除されたマーカーを除去
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    }

    // 追加・更新
    for (const w of warehouses) {
      const isSelected = selectedWarehouseId === w.id;
      const lng = w.lng || 139.75;
      const lat = w.lat || 35.68;

      if (markersRef.current[w.id]) {
        // 既存マーカーの更新: 位置と見た目を更新
        const marker = markersRef.current[w.id];
        marker.setLngLat([lng, lat]);
        // 見た目を再生成して選択状態を反映（要素自体はMapLibreが参照保持するので中身だけ差し替え）
        const fresh = createWarehouseMarkerElement(w, isSelected);
        marker.getElement().innerHTML = fresh.innerHTML;
      } else {
        // 新規マーカー
        const el = createWarehouseMarkerElement(w, isSelected);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(w.id);
        });
        el.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          onDoubleClick(w.id);
        });

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);

        marker.on("dragend", () => {
          const lngLat = marker.getLngLat();
          onPositionChange(w.id, lngLat.lat, lngLat.lng);
        });

        markersRef.current[w.id] = marker;
      }
    }
  }, [warehouses, selectedWarehouseId, onSelect, onPositionChange, onDoubleClick]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// 住所からジオコーディング（Geolonia → Nominatim フォールバック）
async function geocodeAddress(address) {
  // 1) Geolonia normalize-japanese-addresses（番地レベル対応）
  try {
    const result = await normalizeAddress(address);
    if (result?.point?.lat && result?.point?.lng) {
      const display = [result.pref, result.city, result.town, result.addr].filter(Boolean).join("");
      return {
        lat: result.point.lat,
        lng: result.point.lng,
        displayName: display + (result.other ? ` ${result.other}` : ""),
        level: result.point.level,
      };
    }
  } catch (e) {
    console.warn("Geolonia geocoding failed, trying Nominatim:", e);
  }
  // 2) Nominatim フォールバック
  try {
    const encoded = encodeURIComponent(address);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      { headers: { "Accept-Language": "ja" } }
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
  } catch (e) {
    console.error("Nominatim geocoding also failed:", e);
  }
  return null;
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
    in_transit: "orange",
    in_stock: "green",
    planned_out: "purple",
  };
  return map[status] || "gray";
}

// ステータスのラベル
function getStatusLabel(status) {
  const map = {
    draft: "下書き",
    in_transit: "運行中",
    in_stock: "保管中",
    planned_out: "出荷予定",
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

// ========== 画像アップロードAPI（GASウェブアプリ） ==========
const IMAGE_API_URL = "https://script.google.com/macros/s/AKfycbySvsonWAF4igHJ9xFVkG5H7hbNeReElMy5k6w84p8peXiUMhg65d-U-Xu3t52LRMie/exec";

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

// ========== 認証フック ==========
function useAuth() {
  const [session, setSession] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    // 初期セッション取得
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) fetchProfile(s.user.id);
      else setLoading(false);
    });

    // 状態変化リスン
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) fetchProfile(s.user.id);
      else {
        setDisplayName("");
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId) {
    try {
      const { data } = await supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle();
      setDisplayName(data?.display_name || session?.user?.email?.split("@")[0] || "");
    } catch {
      setDisplayName(session?.user?.email?.split("@")[0] || "");
    }
    setLoading(false);
  }

  const isLoggedIn = !!session;

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return { isLoggedIn, displayName, loading, signOut };
}

// ========== ログインモーダル ==========
function LoginModal({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    if (!supabase) { setError("Supabase が設定されていません"); return; }
    setError("");
    setSubmitting(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (err) {
      setError(err.message === "Invalid login credentials" ? "メールアドレスまたはパスワードが正しくありません" : err.message);
    } else {
      setEmail("");
      setPassword("");
      onClose();
    }
  }

  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(236,72,153,0.1) 100%)",
        backdropFilter: "blur(4px)", padding: "16px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "24rem", borderRadius: "24px", backgroundColor: "white", boxShadow: "0 20px 60px -10px rgba(99,102,241,0.3)" }}>
        <div style={{ textAlign: "center", padding: "28px 24px 0" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "linear-gradient(135deg, #e0e7ff, #c7d2fe)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px", fontSize: "22px" }}>🔑</div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#312e81" }}>ログイン</div>
          <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>メールアドレスとパスワードを入力してください</div>
        </div>
        <form onSubmit={handleLogin} style={{ padding: "20px 24px 24px" }} className="space-y-4">
          {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "10px 14px", fontSize: "13px", color: "#dc2626" }}>{error}</div>}
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#6366f1", marginBottom: "6px" }}>メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              style={{ width: "100%", borderRadius: "12px", border: "2px solid #e0e7ff", padding: "10px 14px", fontSize: "14px", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
              onFocus={(e) => e.target.style.borderColor = "#818cf8"} onBlur={(e) => e.target.style.borderColor = "#e0e7ff"}
              placeholder="user@example.com" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#6366f1", marginBottom: "6px" }}>パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              style={{ width: "100%", borderRadius: "12px", border: "2px solid #e0e7ff", padding: "10px 14px", fontSize: "14px", outline: "none", transition: "border-color 0.2s", boxSizing: "border-box" }}
              onFocus={(e) => e.target.style.borderColor = "#818cf8"} onBlur={(e) => e.target.style.borderColor = "#e0e7ff"}
              placeholder="••••••••" />
          </div>
          <button type="submit" disabled={submitting}
            style={{ width: "100%", borderRadius: "14px", padding: "12px", fontSize: "15px", fontWeight: 700, color: "white", border: "none", cursor: submitting ? "wait" : "pointer", background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)", boxShadow: "0 4px 14px rgba(99,102,241,0.4)", opacity: submitting ? 0.6 : 1, transition: "opacity 0.2s" }}>
            {submitting ? "ログイン中..." : "ログイン"}
          </button>
          <div style={{ textAlign: "center" }}>
            <button type="button" onClick={onClose} style={{ fontSize: "13px", color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>閉じる</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Modal({ title, open, onClose, children, maxWidth = "36rem" }) {
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
        background: "rgba(15, 23, 42, 0.4)",
        backdropFilter: "blur(4px)",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth,
          maxHeight: "90vh",
          overflowX: "hidden",
          overflowY: "auto",
          borderRadius: "20px",
          backgroundColor: "#fff",
          boxShadow: "0 20px 60px -10px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9", background: "linear-gradient(135deg, #f8fafc, #f1f5f9)" }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>{title}</div>
          <button
            style={{ borderRadius: "10px", padding: "4px 10px", fontSize: "13px", color: "#94a3b8", background: "none", border: "1px solid #e2e8f0", cursor: "pointer" }}
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
  const styles = {
    gray:   { bg: "#f1f5f9", fg: "#475569" },
    blue:   { bg: "#dbeafe", fg: "#2563eb" },
    green:  { bg: "#dcfce7", fg: "#16a34a" },
    yellow: { bg: "#fef9c3", fg: "#a16207" },
    red:    { bg: "#fee2e2", fg: "#dc2626" },
    purple: { bg: "#ede9fe", fg: "#7c3aed" },
    orange: { bg: "#fff7ed", fg: "#c2410c" },
  };
  const s = styles[color] || styles.gray;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", borderRadius: "20px", padding: "2px 10px", fontSize: "11px", fontWeight: 600, background: s.bg, color: s.fg }}>
      {children}
    </span>
  );
}

function IconButton({ children, onClick, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{ borderRadius: "12px", border: "1px solid #e2e8f0", background: "#fff", padding: "6px 14px", fontSize: "13px", fontWeight: 500, color: "#475569", cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", transition: "all 0.15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "#cbd5e1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
      type="button"
    >
      {children}
    </button>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div style={{ width: 3, height: 16, borderRadius: 2, background: "linear-gradient(180deg, #6366f1, #a855f7)" }} />
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", letterSpacing: "0.01em" }}>{children}</div>
      </div>
      {right}
    </div>
  );
}

// ─── CSS 2.5D アイソメトリックビュー ───
// === Shared 3D Isometric Utilities & Component ===

// Isometric math helper (used by Iso3DView and inline drag calculations)
function getIsoMath(viewCols, viewRows, rotStep) {
  const effCols = (rotStep % 2 === 0) ? viewCols : viewRows;
  const effRows = (rotStep % 2 === 0) ? viewRows : viewCols;
  const baseTile = Math.max(16, Math.min(50, Math.floor(600 / Math.max(effCols, effRows))));
  const tileW = baseTile, tileH = baseTile / 2;
  const heightScale = baseTile * 0.6;
  const toIso = (gx, gy) => ({ sx: (gx - gy) * (tileW / 2), sy: (gx + gy) * (tileH / 2) });
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
  const invRotDelta = (drx, dry) => {
    const s = rotStep % 4;
    if (s === 0) return { dgx: drx, dgy: dry };
    if (s === 1) return { dgx: dry, dgy: -drx };
    if (s === 2) return { dgx: -drx, dgy: -dry };
    return { dgx: -dry, dgy: drx };
  };
  return { effCols, effRows, tileW, tileH, heightScale, toIso, rotateGxGy, rotateRect, invRotDelta };
}

const isoBoxColors = ["#60a5fa","#34d399","#fbbf24","#f87171","#a78bfa","#fb923c","#38bdf8","#4ade80","#facc15","#f472b6"];
function isoKindColor(kind, id) {
  if (kind === "配電盤") return "#fbbf24";
  if (kind === "パレット") return "#60a5fa";
  if (kind === "カゴ") return "#34d399";
  let h = 0; for (let i = 0; i < (id||"").length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return isoBoxColors[((h % isoBoxColors.length) + isoBoxColors.length) % isoBoxColors.length];
}

// Shared 3D isometric renderer with built-in pan/zoom
function Iso3DView({
  viewCols, viewRows, viewBgColor,
  viewItems, viewRacks = [], viewZones = [],
  rotStep, zoom, onZoomChange,
  blinkingUnitIds,
  maxHeight = "65vh",
  onUnitMouseDown, onUnitDoubleClick,
  draggingId, hasDragMoved,
  ghostBox, // { gx, gy, fw, fh, h, ok } in rotated coords (optional)
  stackTargetId, // 重ね置き先のユニットID (optional)
}) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef(null);
  const containerRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const isoCenterRef = useRef({ cx: 0, cy: 0 });

  const iso = getIsoMath(viewCols, viewRows, rotStep);
  const { effCols, effRows, tileW, tileH, heightScale, toIso, rotateGxGy, rotateRect } = iso;

  // 回転・ビュー変更時にグリッド中央を維持してパンをリセット
  useEffect(() => {
    const el = containerRef.current;
    if (!el) { setPan({ x: 0, y: 0 }); return; }
    const rect = el.getBoundingClientRect();
    const z = zoomRef.current;
    const { cx, cy } = isoCenterRef.current;
    setPan({ x: rect.width / 2 - cx * z, y: rect.height / 2 - cy * z });
  }, [rotStep, viewCols, viewRows]);

  // Wheel zoom (cursor-stable, no modifier key)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const prev = zoomRef.current;
      const next = Math.min(3, Math.max(0.3, prev * factor));
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      setPan((p) => ({ x: cx - ((cx - p.x) / prev) * next, y: cy - ((cy - p.y) / prev) * next }));
      onZoomChange(next);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

  // Mouse drag to pan
  useEffect(() => {
    const onMove = (e) => { const d = panDragRef.current; if (!d) return; setPan({ x: d.bp.x + (e.clientX - d.sx), y: d.bp.y + (e.clientY - d.sy) }); };
    const onUp = () => { panDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // Stack grouping
  const stacks = {};
  for (const u of viewItems) {
    const { rx, ry } = rotateGxGy(u.gx, u.gy);
    const key = `${rx},${ry}`;
    if (!stacks[key]) stacks[key] = [];
    stacks[key].push({ ...u, rx, ry });
  }
  for (const k of Object.keys(stacks)) stacks[k].sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));

  // Canvas bounds
  const allCorners = [toIso(0, 0), toIso(effCols, 0), toIso(0, effRows), toIso(effCols, effRows)];
  const maxStackH = viewItems.reduce((m, u) => Math.max(m, (u.stackZ || 0) + (u.h_m || 1)), 0);
  const minSx = Math.min(...allCorners.map((c) => c.sx)) - 60;
  const maxSx = Math.max(...allCorners.map((c) => c.sx)) + 60;
  const minSy = Math.min(...allCorners.map((c) => c.sy)) - Math.max(200, maxStackH * heightScale + 80);
  const maxSy = Math.max(...allCorners.map((c) => c.sy)) + 60;
  const svgW = maxSx - minSx, svgH = maxSy - minSy;
  const offX = -minSx, offY = -minSy;

  // グリッド中央のスクリーン座標をrefに保存（回転時のセンタリング用）
  const gridCenter = toIso(effCols / 2, effRows / 2);
  isoCenterRef.current = { cx: gridCenter.sx + offX, cy: gridCenter.sy + offY - maxStackH * heightScale / 2 };

  // Render items (sorted back→front)
  const renderItems = [];
  for (const [, stack] of Object.entries(stacks)) {
    for (const u of stack) {
      const isPanel = u.kind === "配電盤";
      const { rx: gx, ry: gy, rw: fw, rh: fh } = rotateRect(u.gx, u.gy, u.fw || 1, u.fh || 1);
      renderItems.push({ u, gx, gy, fw, fh, zOff: isPanel ? 0 : (u.stackZ || 0), h: u.h_m || 1 });
    }
  }
  renderItems.sort((a, b) => { const da = a.gx + a.gy, db = b.gx + b.gy; return da !== db ? da - db : a.zOff - b.zOff; });

  // Rotated racks/zones
  const rotatedRacks = viewRacks.map((r) => { const { rx, ry, rw, rh } = rotateRect(r.gx, r.gy, r.w, r.h); return { ...r, gx: rx, gy: ry, w: rw, h: rh }; });
  const rotatedZones = viewZones.map((z) => { const { rx, ry, rw, rh } = rotateRect(z.gx, z.gy, z.w, z.h); return { ...z, gx: rx, gy: ry, w: rw, h: rh }; });

  // IsoBox helper
  const ox = (p) => p.sx + offX;
  const oy = (p, up) => p.sy + offY - up;

  function renderIsoBox(gx, gy, fw, fh, zOff, h, color, label, isFragile, isBlink, opacity) {
    const p0 = toIso(gx, gy), p1 = toIso(gx + fw, gy), p2 = toIso(gx + fw, gy + fh), p3 = toIso(gx, gy + fh);
    const lift = zOff * heightScale, bH = h * heightScale, topH = lift + bH;
    const topPts = [`${ox(p0)}px ${oy(p0,topH)}px`,`${ox(p1)}px ${oy(p1,topH)}px`,`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p3)}px ${oy(p3,topH)}px`].join(", ");
    const leftPts = [`${ox(p3)}px ${oy(p3,topH)}px`,`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p2)}px ${oy(p2,lift)}px`,`${ox(p3)}px ${oy(p3,lift)}px`].join(", ");
    const rightPts = [`${ox(p2)}px ${oy(p2,topH)}px`,`${ox(p1)}px ${oy(p1,topH)}px`,`${ox(p1)}px ${oy(p1,lift)}px`,`${ox(p2)}px ${oy(p2,lift)}px`].join(", ");
    const cx = (ox(p0)+ox(p1)+ox(p2)+ox(p3))/4, cy = (oy(p0,topH)+oy(p1,topH)+oy(p2,topH)+oy(p3,topH))/4;
    const op = opacity != null ? opacity : 1;
    return (
      <>
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPts})`, background: color, filter: "brightness(0.7)", opacity: op }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPts})`, background: color, filter: "brightness(0.85)", opacity: op }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPts})`, background: color, opacity: op }} />
        {isBlink && op > 0.5 && (
          <>
            <div className="wh-3d-blink-overlay" style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPts})` }} />
            <div className="wh-3d-blink-overlay" style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPts})` }} />
            <div className="wh-3d-blink-overlay" style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPts})` }} />
          </>
        )}
        {isFragile && op > 0.5 && <div style={{ position: "absolute", left: cx-6, top: cy-14, fontSize: 11, pointerEvents: "none" }}>⚠</div>}
      </>
    );
  }

  // Hit area bounds for a rendered box
  function boxBounds(gx, gy, fw, fh, zOff, h) {
    const p0 = toIso(gx, gy), p1 = toIso(gx+fw, gy), p2 = toIso(gx+fw, gy+fh), p3 = toIso(gx, gy+fh);
    const topH = (zOff + h) * heightScale;
    const lift = zOff * heightScale;
    return {
      x: Math.min(ox(p0),ox(p1),ox(p2),ox(p3)),
      y: Math.min(oy(p0,topH),oy(p1,topH),oy(p2,topH),oy(p3,topH)),
      w: Math.max(ox(p0),ox(p1),ox(p2),ox(p3)) - Math.min(ox(p0),ox(p1),ox(p2),ox(p3)),
      h: Math.max(oy(p0,lift),oy(p1,lift),oy(p2,lift),oy(p3,lift)) - Math.min(oy(p0,topH),oy(p1,topH),oy(p2,topH),oy(p3,topH)),
    };
  }

  const stackCount = Object.values(stacks).filter((s) => s.length > 1).length;

  return (
    <div
      ref={containerRef}
      style={{ overflow: "hidden", maxWidth: "85vw", maxHeight: maxHeight, cursor: panDragRef.current ? "grabbing" : "grab" }}
      onMouseDown={(e) => { if (e.button === 0) panDragRef.current = { sx: e.clientX, sy: e.clientY, bp: { ...pan } }; }}
    >
      <div style={{ position: "relative", width: "100%", height: maxHeight }}>
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", position: "relative", width: svgW, height: svgH }}>
          {/* Floor tiles */}
          {Array.from({ length: effRows }, (_, gy) =>
            Array.from({ length: effCols }, (_, gx) => {
              const { sx, sy } = toIso(gx, gy);
              const x = sx + offX, y = sy + offY;
              const points = [`${x}px ${y}px`,`${x+tileW/2}px ${y+tileH/2}px`,`${x}px ${y+tileH}px`,`${x-tileW/2}px ${y+tileH/2}px`].join(", ");
              const bgRgb = hexToRgb(viewBgColor || "#ffffff");
              return <div key={`f-${gx}-${gy}`} style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${points})`, background: (gx+gy)%2===0 ? `rgba(${bgRgb.map(c=>Math.max(0,c-20)).join(",")},0.9)` : `rgba(${bgRgb.join(",")},0.9)` }} />;
            })
          )}

          {/* Zone outlines */}
          {rotatedZones.map((zone) => {
            const zp0 = toIso(zone.gx, zone.gy), zp1 = toIso(zone.gx+zone.w, zone.gy), zp2 = toIso(zone.gx+zone.w, zone.gy+zone.h), zp3 = toIso(zone.gx, zone.gy+zone.h);
            const pts = [`${zp0.sx+offX}px ${zp0.sy+offY}px`,`${zp1.sx+offX}px ${zp1.sy+offY}px`,`${zp2.sx+offX}px ${zp2.sy+offY}px`,`${zp3.sx+offX}px ${zp3.sy+offY}px`].join(", ");
            const zcx = (zp0.sx+zp1.sx+zp2.sx+zp3.sx)/4+offX, zcy = (zp0.sy+zp1.sy+zp2.sy+zp3.sy)/4+offY;
            const bgRgb = hexToRgb(zone.bgColor||"#d1fae5");
            return (
              <div key={`zone-${zone.id}`}>
                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${pts})`, background: `rgba(${bgRgb.join(",")},${(zone.bgOpacity??90)/100})` }} />
                <div style={{ position: "absolute", left: zcx-30, top: zcy-6, width: 60, textAlign: "center", fontSize: 9, fontWeight: 700, color: zone.labelColor||"#334155", textShadow: "0 0 3px #fff" }}>{zone.name}</div>
              </div>
            );
          })}

          {/* Rack outlines */}
          {rotatedRacks.map((rack) => {
            const rp0 = toIso(rack.gx, rack.gy), rp1 = toIso(rack.gx+rack.w, rack.gy), rp2 = toIso(rack.gx+rack.w, rack.gy+rack.h), rp3 = toIso(rack.gx, rack.gy+rack.h);
            const rH = 2*heightScale;
            const rox = (p) => p.sx+offX, roy = (p, up) => p.sy+offY-up;
            const topPts = [`${rox(rp0)}px ${roy(rp0,rH)}px`,`${rox(rp1)}px ${roy(rp1,rH)}px`,`${rox(rp2)}px ${roy(rp2,rH)}px`,`${rox(rp3)}px ${roy(rp3,rH)}px`].join(", ");
            const leftPts = [`${rox(rp3)}px ${roy(rp3,rH)}px`,`${rox(rp2)}px ${roy(rp2,rH)}px`,`${rox(rp2)}px ${roy(rp2,0)}px`,`${rox(rp3)}px ${roy(rp3,0)}px`].join(", ");
            const rightPts = [`${rox(rp2)}px ${roy(rp2,rH)}px`,`${rox(rp1)}px ${roy(rp1,rH)}px`,`${rox(rp1)}px ${roy(rp1,0)}px`,`${rox(rp2)}px ${roy(rp2,0)}px`].join(", ");
            const rcx = (rox(rp0)+rox(rp1)+rox(rp2)+rox(rp3))/4, rcy = (roy(rp0,rH)+roy(rp1,rH)+roy(rp2,rH)+roy(rp3,rH))/4;
            const col = rack.bgColor||"#94a3b8";
            return (
              <div key={`rack-${rack.id}`}>
                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${leftPts})`, background: col, filter: "brightness(0.7)" }} />
                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${rightPts})`, background: col, filter: "brightness(0.85)" }} />
                <div style={{ position: "absolute", left: 0, top: 0, width: svgW, height: svgH, clipPath: `polygon(${topPts})`, background: col }} />
                <div style={{ position: "absolute", left: rcx-20, top: rcy-8, width: 40, textAlign: "center", fontSize: 8, fontWeight: 700, color: rack.labelColor||"#334155", textShadow: "0 0 3px #fff" }}>{rack.name||"棚"}</div>
              </div>
            );
          })}

          {/* Isometric boxes for units */}
          {renderItems.map(({ u, gx, gy, fw, fh, zOff, h }, idx) => {
            const isDrag = u.id === draggingId && hasDragMoved;
            const isStackTgt = stackTargetId === u.id;
            const color = u.bgColor || isoKindColor(u.kind, u.id);
            const bb = (onUnitMouseDown || onUnitDoubleClick) ? boxBounds(gx, gy, fw, fh, zOff, h) : null;
            return (
              <g key={u.id+"-"+idx}>
                {isStackTgt && renderIsoBox(gx - 0.08, gy - 0.08, fw + 0.16, fh + 0.16, zOff, h, "rgba(59,130,246,0.3)", null, false, false, 1)}
                {renderIsoBox(gx, gy, fw, fh, zOff, h, isStackTgt ? "#93c5fd" : color, null, u.fragile, blinkingUnitIds?.has(u.id), isDrag ? 0.3 : (u.status === "in_transit" ? 0.35 : 1))}
                {bb && (
                  <div
                    style={{ position: "absolute", left: bb.x, top: bb.y, width: bb.w, height: Math.max(bb.h, 16), cursor: "grab", zIndex: 20 }}
                    onMouseDown={onUnitMouseDown ? (e) => { e.stopPropagation(); onUnitMouseDown(e, u); } : undefined}
                    onDoubleClick={onUnitDoubleClick ? (e) => { e.stopPropagation(); onUnitDoubleClick(e, u); } : undefined}
                    title={u.name || u.kind}
                  />
                )}
              </g>
            );
          })}

          {/* Ghost overlay */}
          {ghostBox && renderIsoBox(ghostBox.gx, ghostBox.gy, ghostBox.fw, ghostBox.fh, 0, ghostBox.h, ghostBox.ok ? "rgba(59,130,246,0.35)" : "rgba(239,68,68,0.35)", null, false, false, 1)}
        </div>
      </div>
    </div>
  );
}

// === Popup IsometricView (uses Iso3DView) ===

function IsometricView({ units, layout, panels, onClose, blinkingUnitIds }) {
  const [viewTarget, setViewTarget] = useState("floor");
  const [rotStep, setRotStep] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  const fx = layout.floor.x || 0;
  const fy = layout.floor.y || 0;
  const cellMW = layout.floor.cell_m_w || 1.2;
  const cellMD = layout.floor.cell_m_d || 1.0;

  function realFootprint(u) {
    const fw = Math.max(0.2, (u.w_m || cellMW) / cellMW);
    const fd = Math.max(0.2, (u.d_m || cellMD) / cellMD);
    return u.rot ? { w: fd, h: fw } : { w: fw, h: fd };
  }
  function panelAsUnit(p) {
    return {
      id: p.id, kind: "配電盤", name: p.name || "配電盤",
      w_m: p.w_m || (p.w || 2) * cellMW, d_m: p.d_m || (p.h || 2) * cellMD, h_m: p.h_m || 1.8,
      rot: false, bgColor: p.bgColor || "#fef3c7", fragile: false,
      loc: p.loc?.kind === "shelf" ? { kind: "shelf", shelfId: p.loc.shelfId, x: p.loc.x, y: p.loc.y } : { kind: "floor", x: p.x, y: p.y },
    };
  }

  // Determine visible area & items based on viewTarget
  let viewCols, viewRows, viewLabel, viewItems, viewRacks, viewZones, viewBgColor;
  if (viewTarget === "floor") {
    viewCols = layout.floor.cols; viewRows = layout.floor.rows; viewLabel = "床全体";
    viewBgColor = layout.floor.floorBgColor || "#ffffff";
    viewItems = units.filter((u) => u.loc?.kind === "floor").map((u) => { const fp = realFootprint(u); return { ...u, gx: (u.loc.x||0)-fx, gy: (u.loc.y||0)-fy, fw: fp.w, fh: fp.h }; });
    for (const p of (panels||[])) { if (p.loc?.kind==="shelf") continue; const pu=panelAsUnit(p); const fp=realFootprint(pu); viewItems.push({...pu, gx:(p.x||0)-fx, gy:(p.y||0)-fy, fw:fp.w, fh:fp.h}); }
    viewRacks = layout.racks.map((r) => ({ ...r, gx: r.x-fx, gy: r.y-fy }));
    viewZones = layout.zones.filter((z) => !z.loc||z.loc.kind==="floor").map((z) => ({ ...z, gx: z.x-fx, gy: z.y-fy }));
  } else if (viewTarget.startsWith("zone-")) {
    const zoneId = viewTarget.slice(5); const zone = layout.zones.find((z) => z.id === zoneId);
    if (zone) {
      viewCols = zone.w; viewRows = zone.h; viewLabel = zone.name; viewBgColor = zone.bgColor || "#d1fae5";
      if (zone.loc?.kind === "shelf") {
        const shelfId = zone.loc.shelfId, zx = zone.loc.x||0, zy = zone.loc.y||0;
        viewItems = units.filter((u) => u.loc?.kind==="shelf"&&u.loc.shelfId===shelfId).map((u) => { const fp=realFootprint(u); return {...u, gx:(u.loc.x||0)-zx, gy:(u.loc.y||0)-zy, fw:fp.w, fh:fp.h}; }).filter((u) => u.gx>=0&&u.gy>=0&&u.gx<zone.w&&u.gy<zone.h);
        for (const p of (panels||[])) { if (p.loc?.kind!=="shelf"||p.loc.shelfId!==shelfId) continue; const pgx=(p.loc.x||0)-zx,pgy=(p.loc.y||0)-zy; if(pgx<0||pgy<0||pgx>=zone.w||pgy>=zone.h) continue; const pu=panelAsUnit(p); const fp=realFootprint(pu); viewItems.push({...pu,gx:pgx,gy:pgy,fw:fp.w,fh:fp.h}); }
      } else {
        viewItems = units.filter((u) => u.loc?.kind==="floor").map((u) => { const fp=realFootprint(u); return {...u, gx:(u.loc.x||0)-zone.x, gy:(u.loc.y||0)-zone.y, fw:fp.w, fh:fp.h}; }).filter((u) => u.gx>=0&&u.gy>=0&&u.gx<zone.w&&u.gy<zone.h);
        for (const p of (panels||[])) { if(p.loc?.kind==="shelf") continue; const pgx=(p.x||0)-zone.x,pgy=(p.y||0)-zone.y; if(pgx<0||pgy<0||pgx>=zone.w||pgy>=zone.h) continue; const pu=panelAsUnit(p); const fp=realFootprint(pu); viewItems.push({...pu,gx:pgx,gy:pgy,fw:fp.w,fh:fp.h}); }
      }
      viewRacks = []; viewZones = [];
    } else { viewCols=1;viewRows=1;viewLabel="?";viewItems=[];viewRacks=[];viewZones=[]; }
  } else if (viewTarget.startsWith("rack-")) {
    const rackId = viewTarget.slice(5); const rack = layout.racks.find((r) => r.id === rackId);
    if (rack) {
      viewCols=rack.w; viewRows=rack.h; viewLabel=rack.name; viewBgColor=rack.bgColor||"#f1f5f9";
      viewItems = units.filter((u) => u.loc?.kind==="rack"&&u.loc.rackId===rackId).map((u) => { const slot=u.loc.slot||0; const rCols=rack.cols||1; const col=slot%rCols; const row=Math.floor(slot/rCols); return {...u, gx:col*Math.floor(rack.w/rCols), gy:row*Math.floor(rack.h/(rack.rows||1)), fw:Math.floor(rack.w/rCols), fh:Math.floor(rack.h/(rack.rows||1))}; });
      viewRacks=[]; viewZones=[];
    } else { viewCols=1;viewRows=1;viewLabel="?";viewItems=[];viewRacks=[];viewZones=[]; }
  } else if (viewTarget.startsWith("shelf-")) {
    const shelfId = viewTarget.slice(6); const shelf = (layout.shelves||[]).find((s) => s.id === shelfId);
    if (shelf) {
      viewCols=shelf.w; viewRows=shelf.h; viewLabel=shelf.name||"棚"; viewBgColor=shelf.bgColor||"#f0fdfa";
      viewItems = units.filter((u) => u.loc?.kind==="shelf"&&u.loc.shelfId===shelfId).map((u) => { const fp=realFootprint(u); return {...u, gx:u.loc.x||0, gy:u.loc.y||0, fw:fp.w, fh:fp.h}; });
      for (const p of (panels||[])) { if(p.loc?.kind!=="shelf"||p.loc.shelfId!==shelfId) continue; const pu=panelAsUnit(p); const fp=realFootprint(pu); viewItems.push({...pu,gx:p.loc.x||0,gy:p.loc.y||0,fw:fp.w,fh:fp.h}); }
      viewRacks=[];
      viewZones = layout.zones.filter((z) => z.loc?.kind==="shelf"&&z.loc.shelfId===shelfId).map((z) => ({...z, gx:z.loc.x||0, gy:z.loc.y||0}));
    } else { viewCols=1;viewRows=1;viewLabel="?";viewItems=[];viewRacks=[];viewZones=[]; }
  } else { viewCols=layout.floor.cols; viewRows=layout.floor.rows; viewLabel="床全体"; viewItems=[]; viewRacks=[]; viewZones=[]; }

  const { effCols, effRows } = getIsoMath(viewCols, viewRows, rotStep);
  const rotLabels = ["0°", "90°", "180°", "270°"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 24, boxShadow: "0 25px 60px rgba(0,0,0,0.3)", padding: 24, maxWidth: "90vw", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>3D ビュー</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value={viewTarget} onChange={(e) => setViewTarget(e.target.value)} style={{ borderRadius: 12, border: "2px solid #e2e8f0", padding: "8px 12px", fontSize: 13, fontWeight: 600, background: "#f8fafc", cursor: "pointer" }}>
              <option value="floor">床全体</option>
              {layout.zones.map((z) => <option key={z.id} value={`zone-${z.id}`}>区画: {z.name}</option>)}
              {layout.racks.map((r) => <option key={r.id} value={`rack-${r.id}`}>ラック: {r.name}</option>)}
              {(layout.shelves||[]).map((s) => <option key={s.id} value={`shelf-${s.id}`}>棚: {s.name||s.id}</option>)}
            </select>
            <button type="button" onClick={onClose} style={{ background: "#f1f5f9", border: "none", borderRadius: 12, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>閉じる</button>
          </div>
        </div>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>{viewLabel} ({effCols} x {effRows} セル)</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={() => setRotStep((r) => (r+3)%4)} style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }} title="左に90°回転">↶</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", minWidth: 30, textAlign: "center" }}>{rotLabels[rotStep]}</span>
            <button type="button" onClick={() => setRotStep((r) => (r+1)%4)} style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }} title="右に90°回転">↷</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={() => setZoomLevel((z) => Math.max(0.3,z-0.2))} style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}>−</button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", minWidth: 40, textAlign: "center" }}>{Math.round(zoomLevel*100)}%</span>
            <button type="button" onClick={() => setZoomLevel((z) => Math.min(3,z+0.2))} style={{ background: "#f1f5f9", border: "2px solid #e2e8f0", borderRadius: 10, padding: "4px 10px", fontSize: 16, cursor: "pointer", fontWeight: 700 }}>+</button>
          </div>
        </div>
        {/* 3D View */}
        <Iso3DView
          viewCols={viewCols} viewRows={viewRows} viewBgColor={viewBgColor}
          viewItems={viewItems} viewRacks={viewRacks} viewZones={viewZones}
          rotStep={rotStep} zoom={zoomLevel} onZoomChange={setZoomLevel}
          blinkingUnitIds={blinkingUnitIds} maxHeight="65vh"
        />
        {/* Legend */}
        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#64748b", alignItems: "center" }}>
          <span>荷物: {viewItems.length}個</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>※ ドラッグでスクロール / ホイールで拡大縮小</span>
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
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
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

const UNIT_SEARCH_KEYS = [
  { key: "all", label: "全項目" },
  { key: "personInCharge", label: "社内担当者名" },
  { key: "client", label: "顧客名" },
  { key: "department", label: "部署名" },
  { key: "name", label: "荷物名" },
  { key: "notes", label: "荷物詳細" },
  { key: "status", label: "ステータス" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "下書き" },
  { value: "in_transit", label: "運行中" },
  { value: "in_stock", label: "保管中" },
  { value: "planned_out", label: "出荷予定" },
];

function UnitSearchModal({ open, onClose, query, setQuery, searchKey, setSearchKey, results, onNavigate, allUnits }) {
  if (!open) return null;
  const capped = results.slice(0, 100);
  const isSpecific = searchKey !== "all";

  // 選択中フィールドの既存値一覧（ソート済み）
  const suggestions = useMemo(() => {
    if (!isSpecific) return [];
    const set = new Set();
    for (const u of allUnits) {
      const v = u[searchKey];
      if (v && typeof v === "string" && v.trim()) set.add(v.trim());
    }
    return [...set].sort();
  }, [allUnits, searchKey, isSpecific]);

  // テキスト入力で候補を絞り込み
  const filteredSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter((s) => s.toLowerCase().includes(q));
  }, [suggestions, query]);

  const isPerson = searchKey === "personInCharge";
  const isStatus = searchKey === "status";
  const isDropdown = isPerson || isStatus;
  const showSuggestions = isSpecific && !isDropdown && suggestions.length > 0;

  return (
    <div
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.4)", backdropFilter: "blur(4px)", padding: "16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "white", borderRadius: "20px", boxShadow: "0 25px 60px rgba(0,0,0,0.18)", width: "100%", maxWidth: "720px", maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 12px", borderBottom: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "17px", fontWeight: 700, color: "#1e293b" }}>荷物検索（全倉庫横断）</span>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>
        {/* Search field chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "12px 24px 8px" }}>
          {UNIT_SEARCH_KEYS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => { setSearchKey(k.key); setQuery(""); }}
              style={{
                padding: "4px 12px", borderRadius: "16px", fontSize: "12px", fontWeight: 600, border: "1.5px solid",
                cursor: "pointer", transition: "all .15s",
                ...(searchKey === k.key
                  ? { background: "linear-gradient(135deg,#fbbf24,#f59e0b)", color: "#fff", borderColor: "#f59e0b" }
                  : { background: "#f8fafc", color: "#64748b", borderColor: "#e2e8f0" }),
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
        {/* Input area */}
        <div style={{ padding: "8px 24px" }}>
          {isStatus ? (
            /* ステータス: プルダウン */
            <select
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "14px", outline: "none", background: "white", cursor: "pointer" }}
            >
              <option value="">-- ステータスを選択 --</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          ) : isPerson ? (
            /* 社内担当者名: プルダウン */
            <select
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "14px", outline: "none", background: "white", cursor: "pointer" }}
            >
              <option value="">-- 担当者を選択 --</option>
              {suggestions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            /* その他: テキスト入力 */
            <input
              autoFocus
              placeholder="検索キーワードを入力..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #e2e8f0", fontSize: "14px", outline: "none" }}
              onFocus={(e) => e.target.style.borderColor = "#fbbf24"}
              onBlur={(e) => e.target.style.borderColor = "#e2e8f0"}
            />
          )}
        </div>
        {/* Suggestion chips (specific field, not personInCharge) */}
        {showSuggestions && !isPerson && (
          <div style={{ padding: "2px 24px 6px", display: "flex", flexWrap: "wrap", gap: "5px", maxHeight: "72px", overflowY: "auto" }}>
            {filteredSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                style={{
                  padding: "3px 10px", borderRadius: "14px", fontSize: "11px", fontWeight: 600, border: "1px solid",
                  cursor: "pointer", transition: "all .12s",
                  ...(query === s
                    ? { background: "#fbbf24", color: "#fff", borderColor: "#f59e0b" }
                    : { background: "#f8fafc", color: "#64748b", borderColor: "#e2e8f0" }),
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {/* Count */}
        <div style={{ padding: "2px 24px 6px", fontSize: "12px", color: "#94a3b8" }}>
          {query.trim() ? `${results.length} 件ヒット${results.length > 100 ? "（先頭100件表示）" : ""}` : isDropdown ? "選択してください" : "キーワードを入力してください"}
        </div>
        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 16px" }}>
          {capped.map((u) => {
            const locText = !u.loc || u.loc.kind === "unplaced" ? "未配置" : u.loc.kind === "floor" ? "床置き" : u.loc.kind === "rack" ? "ラック" : u.loc.kind === "shelf" ? "棚" : u.loc.kind;
            return (
              <div
                key={u.id + "_" + u._whId}
                onClick={() => onNavigate(u)}
                style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", cursor: "pointer", borderBottom: "1px solid #f1f5f9", transition: "background .12s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fffbeb"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <Badge color={getStatusColor(u.status)}>{getStatusLabel(u.status)}</Badge>
                <span style={{ fontWeight: 600, fontSize: "13px", color: "#1e293b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "180px" }}>{u.name || "(名称なし)"}</span>
                <span style={{ fontSize: "11px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "160px" }}>
                  {[u.client, u.department, u.personInCharge].filter(Boolean).join(" / ") || "—"}
                </span>
                <Badge color="purple">{u._whName}</Badge>
                <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "auto", flexShrink: 0 }}>{locText}</span>
              </div>
            );
          })}
          {query.trim() && results.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: "14px" }}>該当する荷物が見つかりません</div>
          )}
        </div>
      </div>
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

function WarehouseView({ wh, onBack, onUpdateWarehouse, site, onUpdateSite, warehouses, onSwitchWarehouse, isLoggedIn, displayName, onLoginClick, onLogout, pendingFocusUnit, onFocusUnitHandled, onOpenUnitSearch }) {
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

  const [layout, _setLayoutRaw] = useSupabaseState(`wh_demo_layout_${wh.id}_v1`, defaultLayout);
  const [units, _setUnitsRaw] = useSupabaseState(`wh_demo_units_${wh.id}_v1`, []);
  // units: {id, kind, client, name, w_m,d_m,h_m, qty, status, rot, loc:{kind:'unplaced'|'floor'|'rack', x?,y?, rackId?, slot?}}

  const [panels, _setPanelsRaw] = useSupabaseState(`wh_demo_panels_${wh.id}_v1`, []);

  const [pricing, _setPricingRaw] = useSupabaseState(`wh_demo_pricing_${wh.id}_v1`, {
    defaultRates: { zoneMonthlyPerTsubo: 5000, unitDailyRate: 100, unitMonthlyRate: 2500 },
    clientRates: {},
  });

  const [toast, setToast] = useState(null);

  // 認証付きセッター（未ログイン時はブロック、デバウンスでトースト表示）
  const _authToastRef = useRef(0);
  function _authBlock() {
    const now = Date.now();
    if (now - _authToastRef.current > 2000) {
      _authToastRef.current = now;
      setToast("この操作にはログインが必要です");
      setTimeout(() => setToast(null), 1600);
    }
  }
  const setLayout = useCallback((...args) => {
    if (!isLoggedIn) { _authBlock(); return; }
    _setLayoutRaw(...args);
  }, [isLoggedIn, _setLayoutRaw]);
  const setUnits = useCallback((...args) => {
    if (!isLoggedIn) { _authBlock(); return; }
    _setUnitsRaw(...args);
  }, [isLoggedIn, _setUnitsRaw]);
  const setPanels = useCallback((...args) => {
    if (!isLoggedIn) { return; }
    _setPanelsRaw(...args);
  }, [isLoggedIn, _setPanelsRaw]);
  const setPricing = useCallback((...args) => {
    if (!isLoggedIn) { _authBlock(); return; }
    _setPricingRaw(...args);
  }, [isLoggedIn, _setPricingRaw]);

  // マイグレーション: layout.panelsが存在する場合、新stateに移行（rawセッター使用）
  useEffect(() => {
    if (layout.panels && layout.panels.length > 0) {
      _setPanelsRaw((prev) => prev.length > 0 ? prev : layout.panels);
      _setLayoutRaw((prev) => { const { panels: _, ...rest } = prev; return rest; });
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
    _setUnitsRaw((prev) => [...prev, ...newUnits]);
    _setPanelsRaw([]);
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
    _setLayoutRaw((prev) => ({
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
  const [highlightUnitId, setHighlightUnitId] = useState(null); // 検索からの赤点滅

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
  const [panelSections, setPanelSections] = useState({ size: false, appearance: false, detail: true, editHistory: false });

  const unitsRef = useRef(units);
  useEffect(() => { unitsRef.current = units; }, [units]);

  const canvasRef = useRef(null);
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
// 料金設定モーダル
const [pricingModalOpen, setPricingModalOpen] = useState(false);
// 請求書モーダル
const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
const [invoicePeriod, setInvoicePeriod] = useState({ start: "", end: "" });
const [invoiceFilters, setInvoiceFilters] = useState({ client: "", department: "", personInCharge: "" });
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
  personInCharge: "",
  client: "",
  department: "",
  clientContact: "",
  name: "",
  notes: "",
  arrivalDate: "",
  departureDate: "",
  transitStartDate: "",
  transitEndDate: "",
  w: "1.2",
  d: "1.0",
  h: "1.6",
  weight_kg: "",
  kintoneRecordId: "",
  qty: "1",
  bgColor: "",
});
  // ログイン時、担当者名を自動設定
  useEffect(() => {
    if (displayName && isLoggedIn) {
      setForm((prev) => prev.personInCharge ? prev : { ...prev, personInCharge: displayName });
    }
  }, [displayName, isLoggedIn]);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [listSearchKey, setListSearchKey] = useState("personInCharge"); // 検索キー
  const [listSearchValue, setListSearchValue] = useState(""); // 検索値

  // 全倉庫のユニット＋倉庫名を取得（リスト出力用）
  const allWarehouseUnits = useMemo(() => {
    const result = [];
    for (const w of warehouses) {
      let wUnits;
      if (w.id === wh.id) {
        wUnits = units;
      } else {
        try {
          wUnits = JSON.parse(localStorage.getItem(`wh_demo_units_${w.id}_v1`)) || [];
        } catch { wUnits = []; }
      }
      for (const u of wUnits) {
        result.push({ ...u, _whName: w.name, _whId: w.id });
      }
    }
    return result;
  }, [warehouses, wh.id, units]);

  // 検索キーごとのプルダウン候補（全倉庫横断）
  const listSearchOptions = useMemo(() => {
    const collect = (field) => {
      const set = new Set();
      for (const u of allWarehouseUnits) {
        const v = u[field];
        if (v && typeof v === "string" && v.trim()) set.add(v.trim());
      }
      return [...set].sort();
    };
    return {
      personInCharge: collect("personInCharge"),
      client: collect("client"),
      department: collect("department"),
      name: collect("name"),
    };
  }, [allWarehouseUnits]);

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

  // ========== 認証ガード ==========
  function requireAuth() {
    if (isLoggedIn) return true;
    showToast("この操作にはログインが必要です");
    return false;
  }

  // ========== 画像アップロード / 削除 ==========
  async function uploadImage(unitId, file) {
    if (!requireAuth()) return;
    showToast("画像をアップロード中...");
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(IMAGE_API_URL, {
        method: "POST",
        body: JSON.stringify({ image: base64, fileName: file.name }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      setUnits((prev) => prev.map((u) => {
        if (u.id !== unitId) return u;
        const imgs = (u.images || []).concat({
          url: json.url,
          fileId: json.fileId,
          uploadedAt: new Date().toISOString(),
        });
        return { ...u, images: imgs };
      }));
      showToast("画像を登録しました");
    } catch (err) {
      console.error("Image upload error:", err);
      showToast("画像アップロードに失敗しました");
    }
  }

  async function deleteImage(unitId, fileId) {
    if (!requireAuth()) return;
    showToast("画像を削除中...");
    try {
      await fetch(IMAGE_API_URL + "?action=delete&fileId=" + encodeURIComponent(fileId));
      setUnits((prev) => prev.map((u) => {
        if (u.id !== unitId) return u;
        return { ...u, images: (u.images || []).filter((img) => img.fileId !== fileId) };
      }));
      showToast("画像を削除しました");
    } catch (err) {
      console.error("Image delete error:", err);
      showToast("画像削除に失敗しました");
    }
  }

  // ========== Unit更新ヘルパー ==========
  function updateUnitField(unitId, field, newValue, action) {
    if (!requireAuth()) return;
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
        by: displayName || "",
      });
      if (hist.length > 200) hist.splice(0, hist.length - 200);
      return { ...u, [field]: newValue, editHistory: hist };
    }));
  }

  function updateUnitFieldSilent(unitId, field, newValue) {
    if (!requireAuth()) return;
    setUnits((prev) => prev.map((u) =>
      u.id === unitId ? { ...u, [field]: newValue } : u
    ));
  }

  function updateUnitFields(unitId, changes, action) {
    if (!requireAuth()) return;
    setUnits((prev) => prev.map((u) => {
      if (u.id !== unitId) return u;
      const hist = (u.editHistory || []).slice();
      const fields = Object.keys(changes);
      hist.push({
        timestamp: new Date().toISOString(),
        action: action || "changed",
        fields,
        changes: fields.reduce((acc, f) => { acc[f] = { old: u[f], new: changes[f] }; return acc; }, {}),
        by: displayName || "",
      });
      if (hist.length > 200) hist.splice(0, hist.length - 200);
      return { ...u, ...changes, editHistory: hist };
    }));
  }

  // 倉庫間移動
  function transferUnitToWarehouse(unitId, destWarehouseId) {
    if (!requireAuth()) return;
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return;
    const destWh = warehouses.find((w) => w.id === destWarehouseId);
    if (!destWh) return;

    const unitsKey = `wh_demo_units_${destWarehouseId}_v1`;
    let destUnits;
    try {
      destUnits = JSON.parse(localStorage.getItem(unitsKey)) || [];
    } catch {
      destUnits = [];
    }

    // 編集履歴を追加
    const hist = (unit.editHistory || []).slice();
    hist.push({
      timestamp: new Date().toISOString(),
      action: "倉庫間移動",
      field: "倉庫",
      oldValue: wh.name,
      newValue: destWh.name,
      by: displayName || "",
    });
    if (hist.length > 200) hist.splice(0, hist.length - 200);

    // 未配置として移動先に追加（移動元情報を付与）
    const movedUnit = {
      ...unit,
      loc: { kind: "unplaced" },
      transferredFrom: wh.name,
      transferredAt: new Date().toISOString(),
      editHistory: hist,
    };

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
    showToast(`${unit.name || "荷物"} を ${destWh.name} に移動しました（未配置リストに表示されます）`);
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

  // 重ね置き用: 緩い包含チェック（3Dアイソメ変換の誤差・同サイズ荷物の重ね置き対応）
  function containsRectLoose(outer, inner) {
    const tol = 0.3;
    return inner.x >= outer.x - tol &&
           inner.y >= outer.y - tol &&
           inner.x + inner.w <= outer.x + outer.w + tol &&
           inner.y + inner.h <= outer.y + outer.h + tol;
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
    // placed units (skip in_transit units)
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      if (u.status === "in_transit") continue;
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

  // 候補矩形を包含するフロアユニットを返す（重ね置き用: 緩い判定）
  function getContainingStackItems(candidateRect, excludeUnitId = null, fpFn = null) {
    const fpFunc = fpFn || unitFootprintCells;
    const items = [];
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      const fp = fpFunc(u);
      const uRect = { x: u.loc.x || 0, y: u.loc.y || 0, w: fp.w, h: fp.h };
      if (containsRectLoose(uRect, candidateRect)) items.push(u);
    }
    items.sort((a, b) => (a.stackZ || 0) - (b.stackZ || 0));
    return items;
  }

  // 重ね置きスナップ: 近くにstackableな荷物があればその位置にスナップ
  function snapToStackTarget(x, y, fp, excludeUnitId = null) {
    const SNAP_DIST = 1.5; // セル単位のスナップ距離
    let best = null;
    let bestDist = SNAP_DIST;
    for (const u of units) {
      if (u.id === excludeUnitId) continue;
      if (u.loc?.kind !== "floor") continue;
      if (!u.stackable) continue;
      if (u.status === "in_transit") continue;
      const ufp = unitFootprintCells(u);
      // 候補が既存荷物の上に乗れるか（サイズ的に収まるか）
      if (fp.w > ufp.w + 0.3 || fp.h > ufp.h + 0.3) continue;
      const ux = u.loc.x || 0, uy = u.loc.y || 0;
      const dist = Math.abs(x - ux) + Math.abs(y - uy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: ux, y: uy };
      }
    }
    return best;
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
        // 重ね置き: 下の荷物のstackableがtrueなら、上に乗せる荷物のstackableは不問
        if (r.kind === "unit" && containsRectLoose(r, candidate)) {
          const stackItems = getContainingStackItems(candidate, excludeUnitId);
          if (stackItems.some((item) => item.stackable)) {
            continue; // allow this overlap
          }
        }
        return false;
      }
    }
    return true;
  }

  // 予約ゾーンブロック判定（メインキャンバス上の絶対座標で判定）
  function isBlockedByReservedZone(absX, absY, w, h) {
    const today = new Date(); today.setHours(0,0,0,0);
    for (const z of layout.zones) {
      if (!z.reserved || !z.reservationEndDate) continue;
      if (z.loc?.kind !== "floor") continue;
      const endD = new Date(z.reservationEndDate); endD.setHours(0,0,0,0);
      const diff = Math.ceil((endD - today) / (1000*60*60*24));
      if (diff > 1) continue;
      // 矩形の重なりチェック
      if (absX < z.x + z.w && absX + w > z.x && absY < z.y + z.h && absY + h > z.y) {
        return true;
      }
    }
    return false;
  }

  // 取引先不一致チェック: 荷物のクライアントとゾーンのクライアントが異なる場合ブロック
  function getClientMismatchZone(unit, absX, absY, w, h) {
    const uClient = unit.client;
    if (!uClient || uClient === "(未設定)") return null;
    for (const z of layout.zones) {
      if (!z.client || z.client === "(未設定)") continue;
      if (z.isStagingArea) continue; // 仮置き場はチェックしない
      const zx = z.x, zy = z.y, zw = z.w, zh = z.h;
      // 矩形の重なりチェック
      if (absX < zx + zw && absX + w > zx && absY < zy + zh && absY + h > zy) {
        if (uClient !== z.client) return z;
      }
    }
    return null;
  }

  // 区画内限定の衝突判定（ローカル座標 0〜zone.w/h）
  function canPlaceInZone(zone, u, localX, localY, excludeUnitId = null, fpFn = null) {
    // 予約ONかつ期限前日以降 → 配置ブロック
    if (zone.reserved && zone.reservationEndDate) {
      const today = new Date(); today.setHours(0,0,0,0);
      const endD = new Date(zone.reservationEndDate); endD.setHours(0,0,0,0);
      const diff = Math.ceil((endD - today) / (1000*60*60*24));
      if (diff <= 1) return false;
    }
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
        // 重ね置き: 下の荷物のstackableがtrueなら、上に乗せる荷物のstackableは不問
        if (containsRectLoose(r, candidate)) {
          const stackAt = isShelfZone
            ? units.filter((s) => s.id !== excludeUnitId && s.loc?.kind === "shelf" && s.loc.shelfId === zone.loc.shelfId).filter((s) => { const sfp = fpFunc(s); return containsRectLoose({ x: s.loc.x||0, y: s.loc.y||0, w: sfp.w, h: sfp.h }, candidate); })
            : getContainingStackItems(candidate, excludeUnitId);
          if (stackAt.some((item) => item.stackable)) continue;
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
      if (u.status === "in_transit") continue;
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
          // 取引先不一致チェック
          let blocked = false;
          for (const uid of unitIds) {
            const u = units.find((x) => x.id === uid);
            if (!u || u.loc?.kind !== "floor") continue;
            const fp = unitFootprintCells(u);
            const mz = getClientMismatchZone(u, u.loc.x + dx, u.loc.y + dy, fp.w, fp.h);
            if (mz) {
              showToast(`「${u.name}」は「${mz.client}」専用区画に置けません`);
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            setUnits((prev) => prev.map((u) => {
              if (!unitIds.has(u.id)) return u;
              if (u.loc?.kind === "floor") {
                return { ...u, loc: { ...u.loc, x: u.loc.x + dx, y: u.loc.y + dy } };
              }
              return u;
            }));
          }
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
      if (!requireAuth()) { setDrag(null); return; }
      const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
      const u = drag.draftUnit;
      const origId = u._origId; // 既存ユニットのドラッグ配置の場合、元のIDを保持

      // ヘルパー: 既存ユニット更新 or 新規追加
      const commitPlacement = (locData, extraFields = {}) => {
        if (origId) {
          // 既存ユニットを更新（重複を防ぐ）
          setUnits((prev) => prev.map((x) => x.id === origId
            ? { ...x, loc: locData, status: autoPromoteStatus(x), ...extraFields }
            : x
          ));
        } else {
          // 新規ユニット作成
          const created = { ...u, id: "u-" + uid(), loc: locData, status: autoPromoteStatus(u), ...extraFields };
          delete created._origId;
          setUnits((prev) => [...prev, created]);
        }
      };

      // Try rack slot first if hovering rack
      const slot = findRackSlotAtCell(cx, cy);
      if (slot && isRackSlotFree(slot.rackId, slot.slot, origId)) {
        commitPlacement({ kind: "rack", rackId: slot.rackId, slot: slot.slot });
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
        if (canPlaceOnShelf(shelf.id, u, clampedX, clampedY, origId)) {
          commitPlacement({ kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY });
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
      if (isBlockedByReservedZone(px, py, fp.w, fp.h)) {
        showToast("予約期限間近のため配置できません（予約OFFにするか期限を延長してください）");
        setDrag(null);
        return;
      }
      {
        const mz = getClientMismatchZone(u, px, py, fp.w, fp.h);
        if (mz) {
          showToast(`この区画は「${mz.client}」専用です（荷物の取引先: ${u.client || "(未設定)"}）`);
          setDrag(null);
          return;
        }
      }
      // 重ね置きスナップ: 近くのstackable荷物にスナップ
      const snapTarget = snapToStackTarget(px, py, fp, origId);
      if (snapTarget) { px = snapTarget.x; py = snapTarget.y; }

      if (!canPlaceOnFloor(u, px, py, origId)) {
        showToast("ここには置けません（他の荷物/棚と重なっています）");
        setDrag(null);
        return;
      }
      const containingItems = getContainingStackItems({ x: px, y: py, w: fp.w, h: fp.h }, origId);
      const stackZ = containingItems.length > 0
        ? Math.max(...containingItems.map(i => (i.stackZ || 0) + (i.h_m || 0)))
        : 0;
      commitPlacement({ kind: "floor", x: px, y: py }, { stackZ });
      setDrag(null);
      return;
    }

    if (drag.type === "move_unit") {
      if (!requireAuth()) { setDrag(null); return; }
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
            x.id === u.id ? { ...x, loc: { kind: "shelf", shelfId: shelf.id, x: clampedX, y: clampedY }, status: autoPromoteStatus(x) } : x
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
      let floorX = inStaging ? dropX : clamp(dropX, fx, fx + layout.floor.cols - fp.w);
      let floorY = inStaging ? dropY : clamp(dropY, fy, fy + layout.floor.rows - fp.h);

      // 重ね置きスナップ: 近くのstackable荷物にスナップ
      const snapTarget = snapToStackTarget(floorX, floorY, fp, u.id);
      if (snapTarget) { floorX = snapTarget.x; floorY = snapTarget.y; }

      // Check if unit's target area overlaps with floor or is in staging zone
      if (isBlockedByReservedZone(floorX, floorY, fp.w, fp.h)) {
        showToast("予約期限間近のため配置できません（予約OFFにするか期限を延長してください）");
        setDrag(null);
        return;
      }
      {
        const mz = getClientMismatchZone(u, floorX, floorY, fp.w, fp.h);
        if (mz) {
          showToast(`この区画は「${mz.client}」専用です（荷物の取引先: ${u.client || "(未設定)"}）`);
          setDrag(null);
          return;
        }
      }
      if (inStaging || (floorX + fp.w > fx && floorY + fp.h > fy && floorX < fx + layout.floor.cols && floorY < fy + layout.floor.rows)) {
        if (canPlaceOnFloor(u, floorX, floorY, u.id)) {
          const candidate = { x: floorX, y: floorY, w: fp.w, h: fp.h };
          const containingItems = getContainingStackItems(candidate, u.id);
          const newStackZ = containingItems.length > 0
            ? Math.max(...containingItems.map(i => (i.stackZ || 0) + (i.h_m || 0)))
            : 0;
          setUnits((prev) => prev.map((x) =>
            x.id === u.id ? { ...x, loc: { kind: "floor", x: floorX, y: floorY }, stackZ: newStackZ, status: autoPromoteStatus(x) } : x
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

  // --- 料金計算ヘルパー ---
  const TSUBO_M2 = 3.30579;

  function getClientRates(clientName) {
    const cr = pricing.clientRates?.[clientName];
    const dr = pricing.defaultRates || { zoneMonthlyPerTsubo: 5000, unitDailyRate: 100, unitMonthlyRate: 2500 };
    return {
      zoneMonthlyPerTsubo: cr?.zoneMonthlyPerTsubo ?? dr.zoneMonthlyPerTsubo,
      unitDailyRate: cr?.unitDailyRate ?? dr.unitDailyRate,
      unitMonthlyRate: cr?.unitMonthlyRate ?? dr.unitMonthlyRate,
    };
  }

  function calcZoneBilling(zone) {
    const cellW = layout.floor.cell_m_w || 1.2;
    const cellD = layout.floor.cell_m_d || 1.0;
    const areaM2 = zone.area_m2_manual ? (zone.area_m2 || 0) : (zone.w * cellW * zone.h * cellD);
    const tsubo = areaM2 / TSUBO_M2;
    const rates = getClientRates(zone.client);
    const monthlyAmount = Math.round(tsubo * rates.zoneMonthlyPerTsubo);
    return { areaM2, tsubo, rate: rates.zoneMonthlyPerTsubo, monthlyAmount };
  }

  function calcUnitBilling(unit) {
    const rates = getClientRates(unit.client);
    const billingType = unit.billingType || "daily";
    const arrDate = unit.arrivalDate ? new Date(unit.arrivalDate) : null;
    const depDate = unit.departureDate ? new Date(unit.departureDate) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let storageDays = 0;
    if (arrDate) {
      const endDate = depDate || today;
      storageDays = Math.max(1, Math.ceil((endDate - arrDate) / (1000 * 60 * 60 * 24)));
    }
    const storageMonths = Math.max(1, Math.ceil(storageDays / 30));
    const qty = unit.qty || 1;
    let amount;
    if (billingType === "monthly") {
      amount = storageMonths * rates.unitMonthlyRate * qty;
    } else {
      amount = storageDays * rates.unitDailyRate * qty;
    }
    return {
      billingType,
      rate: billingType === "monthly" ? rates.unitMonthlyRate : rates.unitDailyRate,
      storageDays,
      storageMonths,
      qty,
      amount,
    };
  }

  // 期間指定版: 区画料金
  function calcZoneBillingForPeriod(zone, startDate, endDate) {
    const cellW = layout.floor.cell_m_w || 1.2;
    const cellD = layout.floor.cell_m_d || 1.0;
    const areaM2 = zone.area_m2_manual ? (zone.area_m2 || 0) : (zone.w * cellW * zone.h * cellD);
    const tsubo = areaM2 / TSUBO_M2;
    const rates = getClientRates(zone.client);
    const periodDays = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
    const months = Math.max(1, Math.ceil(periodDays / 30));
    const monthlyAmount = Math.round(tsubo * rates.zoneMonthlyPerTsubo);
    const amount = monthlyAmount * months;
    return { areaM2, tsubo, rate: rates.zoneMonthlyPerTsubo, monthlyAmount, months, amount };
  }

  // 期間指定版: 荷物料金
  function calcUnitBillingForPeriod(unit, periodStart, periodEnd) {
    const rates = getClientRates(unit.client);
    const billingType = unit.billingType || "daily";
    const arrDate = unit.arrivalDate ? new Date(unit.arrivalDate) : null;
    if (!arrDate) return { billingType, rate: 0, overlapDays: 0, overlapMonths: 0, qty: unit.qty || 1, amount: 0 };
    const depDate = unit.departureDate ? new Date(unit.departureDate) : new Date();
    depDate.setHours(0, 0, 0, 0);
    const effectiveStart = arrDate > periodStart ? arrDate : periodStart;
    const effectiveEnd = depDate < periodEnd ? depDate : periodEnd;
    if (effectiveStart > effectiveEnd) return { billingType, rate: 0, overlapDays: 0, overlapMonths: 0, qty: unit.qty || 1, amount: 0 };
    const overlapDays = Math.max(1, Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24)) + 1);
    const overlapMonths = Math.max(1, Math.ceil(overlapDays / 30));
    const qty = unit.qty || 1;
    let amount;
    if (billingType === "monthly") {
      amount = overlapMonths * rates.unitMonthlyRate * qty;
    } else {
      amount = overlapDays * rates.unitDailyRate * qty;
    }
    return {
      billingType,
      rate: billingType === "monthly" ? rates.unitMonthlyRate : rates.unitDailyRate,
      overlapDays,
      overlapMonths,
      qty,
      amount,
    };
  }

  // クライアント別請求サマリー
  const clientBillingSummary = useMemo(() => {
    const acc = new Map();
    // ゾーン（区画）料金
    for (const z of layout.zones) {
      const client = z.client || "(未設定)";
      const prev = acc.get(client) || { zones: [], units: [], zoneTotal: 0, unitTotal: 0 };
      const billing = calcZoneBilling(z);
      prev.zones.push({ ...z, billing });
      prev.zoneTotal += billing.monthlyAmount;
      acc.set(client, prev);
    }
    // 荷物（ユニット）料金
    for (const u of units) {
      if (u.loc?.kind !== "floor" && u.loc?.kind !== "rack" && u.loc?.kind !== "shelf") continue;
      if (!u.arrivalDate) continue;
      const client = u.client || "(未設定)";
      const prev = acc.get(client) || { zones: [], units: [], zoneTotal: 0, unitTotal: 0 };
      const billing = calcUnitBilling(u);
      prev.units.push({ ...u, billing });
      prev.unitTotal += billing.amount;
      acc.set(client, prev);
    }
    return [...acc.entries()]
      .map(([client, v]) => ({ client, ...v, total: v.zoneTotal + v.unitTotal }))
      .sort((a, b) => b.total - a.total);
  }, [layout.zones, units, pricing, layout.floor.cell_m_w, layout.floor.cell_m_d]);

  // 期間指定＋フィルタ付き請求データ生成
  function getFilteredBillingData(periodStart, periodEnd, filters) {
    const acc = new Map();
    const pStart = new Date(periodStart); pStart.setHours(0, 0, 0, 0);
    const pEnd = new Date(periodEnd); pEnd.setHours(0, 0, 0, 0);
    // 区画
    for (const z of layout.zones) {
      const client = z.client || "(未設定)";
      if (filters.client && client !== filters.client) continue;
      const prev = acc.get(client) || { zones: [], units: [], zoneTotal: 0, unitTotal: 0 };
      const billing = calcZoneBillingForPeriod(z, pStart, pEnd);
      prev.zones.push({ ...z, billing });
      prev.zoneTotal += billing.amount;
      acc.set(client, prev);
    }
    // 荷物
    for (const u of units) {
      if (u.loc?.kind !== "floor" && u.loc?.kind !== "rack" && u.loc?.kind !== "shelf") continue;
      if (!u.arrivalDate) continue;
      const client = u.client || "(未設定)";
      if (filters.client && client !== filters.client) continue;
      if (filters.department && (u.department || "") !== filters.department) continue;
      if (filters.personInCharge && (u.personInCharge || "") !== filters.personInCharge) continue;
      const prev = acc.get(client) || { zones: [], units: [], zoneTotal: 0, unitTotal: 0 };
      const billing = calcUnitBillingForPeriod(u, pStart, pEnd);
      if (billing.amount === 0) continue;
      prev.units.push({ ...u, billing });
      prev.unitTotal += billing.amount;
      acc.set(client, prev);
    }
    return [...acc.entries()]
      .map(([client, v]) => ({ client, ...v, total: v.zoneTotal + v.unitTotal }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
  }

  function generateInvoiceForPeriod(clientData, periodStart, periodEnd) {
    const cs = clientData;
    const clientName = cs.client;
    const today = new Date();
    const invoiceNo = `INV-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const invoiceDate = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    const ps = new Date(periodStart);
    const pe = new Date(periodEnd);
    const periodLabel = `${ps.getFullYear()}年${ps.getMonth() + 1}月${ps.getDate()}日 〜 ${pe.getFullYear()}年${pe.getMonth() + 1}月${pe.getDate()}日`;

    let zoneRows = "";
    for (const z of cs.zones) {
      zoneRows += `<tr>
        <td style="border:1px solid #ccc;padding:6px 8px;">区画: ${z.name}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">${z.billing.tsubo.toFixed(2)} 坪</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">¥${z.billing.rate.toLocaleString()}/坪/月</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:center;">${z.billing.months}ヶ月</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;font-weight:600;">¥${z.billing.amount.toLocaleString()}</td>
      </tr>`;
    }

    let unitRows = "";
    for (const u of cs.units) {
      const b = u.billing;
      const pLabel = b.billingType === "monthly" ? `${b.overlapMonths}ヶ月` : `${b.overlapDays}日`;
      const rateLabel = b.billingType === "monthly" ? `¥${b.rate.toLocaleString()}/月` : `¥${b.rate.toLocaleString()}/日`;
      const qtyLabel = b.qty > 1 ? `${u.name} ×${b.qty}` : u.name;
      unitRows += `<tr>
        <td style="border:1px solid #ccc;padding:6px 8px;">荷物: ${qtyLabel}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">${b.billingType === "monthly" ? "-" : `${(u.w_m * u.d_m).toFixed(2)} m²`}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">${rateLabel}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:center;">${pLabel}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;font-weight:600;">¥${b.amount.toLocaleString()}</td>
      </tr>`;
    }

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>請求書 - ${clientName}</title>
<style>
  @media print { body { margin: 0; } @page { margin: 15mm 10mm; } }
  body { font-family: "Hiragino Kaku Gothic Pro", "Yu Gothic", "Meiryo", sans-serif; color: #333; max-width: 800px; margin: 20px auto; padding: 20px; }
  h1 { text-align: center; font-size: 28px; letter-spacing: 8px; border-bottom: 3px double #333; padding-bottom: 8px; margin-bottom: 24px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .header-left { font-size: 14px; }
  .header-right { text-align: right; font-size: 13px; color: #555; }
  .client-name { font-size: 20px; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 8px; }
  .total-box { background: #f0f4ff; border: 2px solid #3b82f6; border-radius: 8px; padding: 12px 20px; text-align: center; margin: 20px 0; }
  .total-label { font-size: 14px; color: #555; }
  .total-amount { font-size: 28px; font-weight: bold; color: #1e40af; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
  th { background: #f8fafc; border: 1px solid #ccc; padding: 8px; text-align: left; font-weight: 600; }
  .section-title { font-size: 15px; font-weight: 600; margin-top: 20px; margin-bottom: 4px; padding-left: 8px; border-left: 3px solid #3b82f6; }
  .footer { margin-top: 40px; font-size: 12px; color: #888; text-align: center; }
  .print-btn { display: block; margin: 20px auto; padding: 10px 32px; font-size: 15px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
  .print-btn:hover { background: #2563eb; }
  @media print { .print-btn { display: none; } }
</style>
</head>
<body>
<h1>請 求 書</h1>
<div class="header">
  <div class="header-left">
    <div class="client-name">${clientName} 御中</div>
    <div>下記の通りご請求申し上げます。</div>
    <div style="margin-top:8px;font-size:13px;color:#555;">請求期間: ${periodLabel}</div>
  </div>
  <div class="header-right">
    <div>請求番号: ${invoiceNo}</div>
    <div>発行日: ${invoiceDate}</div>
    <div style="margin-top:8px;">${site.name || "倉庫管理システム"}</div>
  </div>
</div>
<div class="total-box">
  <div class="total-label">ご請求金額（税抜）</div>
  <div class="total-amount">¥${cs.total.toLocaleString()}</div>
</div>
${cs.zones.length > 0 ? `
<div class="section-title">区画利用料</div>
<table>
  <thead><tr><th>項目</th><th style="text-align:right;">面積</th><th style="text-align:right;">単価</th><th style="text-align:center;">期間</th><th style="text-align:right;">金額</th></tr></thead>
  <tbody>${zoneRows}
    <tr style="background:#f8fafc;font-weight:700;">
      <td colspan="4" style="border:1px solid #ccc;padding:6px 8px;text-align:right;">区画小計</td>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">¥${cs.zoneTotal.toLocaleString()}</td>
    </tr>
  </tbody>
</table>` : ""}
${cs.units.length > 0 ? `
<div class="section-title">荷物保管料</div>
<table>
  <thead><tr><th>項目</th><th style="text-align:right;">面積</th><th style="text-align:right;">単価</th><th style="text-align:center;">期間</th><th style="text-align:right;">金額</th></tr></thead>
  <tbody>${unitRows}
    <tr style="background:#f8fafc;font-weight:700;">
      <td colspan="4" style="border:1px solid #ccc;padding:6px 8px;text-align:right;">荷物小計</td>
      <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;">¥${cs.unitTotal.toLocaleString()}</td>
    </tr>
  </tbody>
</table>` : ""}
<div class="footer">
  <div>※この請求書はシステムにより自動生成されたものです。</div>
</div>
<button class="print-btn" onclick="window.print()">印刷 / PDF保存</button>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  }

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
      zones: [...prev.zones, { id: "z-" + uid(), name: "新規区画", client: "取引先A", x: px, y: py, w: zw, h: zh, labelColor: "#000000", bgColor, bgOpacity: 90, loc: { kind: "floor" }, reserved: false, reservationEndDate: null }],
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

  // 保管場所を文字列で取得するヘルパー（現在の倉庫用）
  function getStorageLocationText(u) {
    const loc = u.loc;
    if (!loc || loc.kind === "unplaced") return "未配置";
    if (loc.kind === "floor") {
      const zone = (layout.zones || []).find((z) => (!z.loc || z.loc.kind === "floor") && loc.x >= z.x && loc.y >= z.y && loc.x < z.x + z.w && loc.y < z.y + z.h);
      return `${wh.name} 床${zone ? ` ${zone.name}` : ""}`;
    }
    if (loc.kind === "shelf") {
      const shelf = (layout.shelves || []).find((s) => s.id === loc.shelfId);
      const shelfZone = (layout.zones || []).find((z) => z.loc?.kind === "shelf" && z.loc.shelfId === loc.shelfId && loc.x >= (z.loc.x || 0) && loc.y >= (z.loc.y || 0) && loc.x < (z.loc.x || 0) + z.w && loc.y < (z.loc.y || 0) + z.h);
      return `${wh.name} ${shelf?.name || "棚"}${shelfZone ? ` ${shelfZone.name}` : ""}`;
    }
    if (loc.kind === "rack") {
      const rack = layout.racks.find((r) => r.id === loc.rackId);
      return `${wh.name} ラック${rack?.name || loc.rackId}`;
    }
    return "不明";
  }

  // 保管場所を文字列で取得（全倉庫対応版: _whId, _whName付きunit用）
  function getStorageLocationTextAllWh(u) {
    const loc = u.loc;
    const whName = u._whName || "不明倉庫";
    if (!loc || loc.kind === "unplaced") return "未配置";
    if (u._whId === wh.id) return getStorageLocationText(u);
    // 他の倉庫の場合はレイアウトをlocalStorageから読む
    let wLayout;
    try {
      wLayout = JSON.parse(localStorage.getItem(`wh_demo_layout_${u._whId}_v1`)) || null;
    } catch { wLayout = null; }
    if (!wLayout) return `${whName}`;
    if (loc.kind === "floor") {
      const zone = (wLayout.zones || []).find((z) => (!z.loc || z.loc.kind === "floor") && loc.x >= z.x && loc.y >= z.y && loc.x < z.x + z.w && loc.y < z.y + z.h);
      return `${whName} 床${zone ? ` ${zone.name}` : ""}`;
    }
    if (loc.kind === "shelf") {
      const shelf = (wLayout.shelves || []).find((s) => s.id === loc.shelfId);
      return `${whName} ${shelf?.name || "棚"}`;
    }
    if (loc.kind === "rack") {
      const rack = (wLayout.racks || []).find((r) => r.id === loc.rackId);
      return `${whName} ラック${rack?.name || loc.rackId}`;
    }
    return whName;
  }

  function exportListAsPdf() {
    const keyField = listSearchKey;
    const query = listSearchValue.trim();
    const effectiveField = (keyField === "department" && !query) ? "client" : keyField;

    // 全倉庫データからフィルタ
    const filtered = query
      ? allWarehouseUnits.filter((u) => String(u[effectiveField] || "") === query)
      : allWarehouseUnits;

    if (filtered.length === 0) {
      showToast("該当する荷物がありません");
      return;
    }

    const allColumns = [
      { key: "personInCharge", label: "社内担当者名" },
      { key: "client", label: "顧客名" },
      { key: "department", label: "部署名" },
      { key: "clientContact", label: "顧客担当者名" },
      { key: "name", label: "荷物名" },
      { key: "arrivalDate", label: "入庫日" },
      { key: "departureDate", label: "出庫予定日" },
      { key: "storageLocation", label: "保管場所" },
    ];
    const columns = allColumns.filter((c) => c.key !== keyField);
    const keyLabel = allColumns.find((c) => c.key === keyField)?.label || keyField;

    const rows = filtered.map((u) => {
      const row = {};
      for (const col of columns) {
        if (col.key === "storageLocation") {
          row[col.key] = getStorageLocationTextAllWh(u);
        } else if (col.key === "arrivalDate" || col.key === "departureDate") {
          row[col.key] = u[col.key] ? new Date(u[col.key]).toLocaleString("ja-JP") : "-";
        } else {
          row[col.key] = u[col.key] || "-";
        }
      }
      return row;
    });

    const now = new Date().toLocaleString("ja-JP");
    const whNames = warehouses.map((w) => w.name).join("・");
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>荷物リスト</title>
<style>
  @page { size: A4 landscape; margin: 15mm; }
  body { font-family: "Hiragino Sans", "Yu Gothic", sans-serif; font-size: 11px; color: #1e293b; }
  h1 { font-size: 16px; margin-bottom: 4px; }
  .meta { font-size: 10px; color: #64748b; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 10px; font-weight: 700; }
  td { border: 1px solid #e2e8f0; padding: 5px 8px; font-size: 10px; }
  tr:nth-child(even) { background: #f8fafc; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>荷物リスト（全倉庫）</h1>
<div class="meta">対象: ${whNames} / 検索条件: ${keyLabel}「${query || "(全件)"}」 / ${filtered.length}件 / 出力日時: ${now}</div>
<table>
<thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${r[c.key]}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
</body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 300);
    }
  }

  function createUnitFromForm() {
    if (!requireAuth()) return;
    const w = Number(form.w);
    const d = Number(form.d);
    const h = Number(form.h);
    const qty = Math.max(1, Number(form.qty) || 1);
    const name = form.name || `${template}（${form.client || "顧客"}）`;
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

      // ========== 基本情報（後方互換） ==========
      sku: "",
      barcode: "",
      batch_number: "",
      weight_kg: Number(form.weight_kg) || 0,
      temperature_zone: "ambient",
      fragile: false,
      stackable: true,
      max_stack_height: 1,
      expires_at: null,
      notes: form.notes || "",
      arrived_at: null,
      moves: [],
      tags: [],

      // ========== 拡張フィールド ==========
      kintoneRecordId: form.kintoneRecordId || "",
      projectName: "",
      arrivalDate: form.arrivalDate || null,
      departureDate: form.departureDate || null,
      departureHistory: [],
      contents: [],
      personInCharge: form.personInCharge || "",
      department: form.department || "",
      clientContact: form.clientContact || "",
      editHistory: [{
        timestamp: new Date().toISOString(),
        action: "created",
        by: displayName || "",
      }],

      // ========== 運行中 ==========
      transitStartDate: form.transitStartDate || null,
      transitEndDate: form.transitEndDate || null,

      // ========== 見た目 ==========
      bgColor: form.bgColor || "",
      bgOpacity: 100,
      labelColor: "",

      // ========== 画像 ==========
      images: [],
    };
    setUnits((prev) => [u, ...prev]);
    setSelected({ kind: "unit", id: u.id });
    setCreateModalOpen(false);
    showToast("作成しました（未配置リストから配置できます）");
  }

  // 配置時にdraft→in_stockへ自動変更するヘルパー
  function autoPromoteStatus(unitObj) {
    if (unitObj.status === "draft") return "in_stock";
    return unitObj.status;
  }

  // ユニットをキャンバス中央にパンするヘルパー
  function panToUnit(u) {
    if (!u?.loc || u.loc.kind === "unplaced") return;
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (u.loc.kind === "floor") {
      const fp = unitFootprintCells(u);
      const centerX = (u.loc.x + fp.w / 2) * cellPx;
      const centerY = (u.loc.y + fp.h / 2) * cellPx;
      setPan({ x: r.width / 2 - centerX * zoom, y: r.height / 2 - centerY * zoom });
    } else if (u.loc.kind === "shelf") {
      const shelf = (layout.shelves || []).find((s) => s.id === u.loc.shelfId);
      if (shelf) {
        const fp = unitFootprintCells(u);
        // ユニットのローカル座標を棚の絶対座標に変換
        const centerX = (shelf.x + u.loc.x + fp.w / 2) * cellPx;
        const centerY = (shelf.y + u.loc.y + fp.h / 2) * cellPx;
        setPan({ x: r.width / 2 - centerX * zoom, y: r.height / 2 - centerY * zoom });
      }
    } else if (u.loc.kind === "rack") {
      const rack = layout.racks.find((rc) => rc.id === u.loc.rackId);
      if (rack) {
        const centerX = (rack.x + rack.w / 2) * cellPx;
        const centerY = (rack.y + rack.h / 2) * cellPx;
        setPan({ x: r.width / 2 - centerX * zoom, y: r.height / 2 - centerY * zoom });
      }
    }
  }

  // 区画をキャンバス中央にパンするヘルパー
  function panToZone(z) {
    if (!z) return;
    const el = canvasRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const centerX = (z.x + z.w / 2) * cellPx;
    const centerY = (z.y + z.h / 2) * cellPx;
    setPan({ x: r.width / 2 - centerX * zoom, y: r.height / 2 - centerY * zoom });
  }

  // 荷物検索からのフォーカス（canvasRef準備待ちリトライ付き）
  useEffect(() => {
    if (!pendingFocusUnit || pendingFocusUnit.whId !== wh.id) return;
    let attempt = 0;
    const maxAttempts = 10;
    const tryFocus = () => {
      attempt++;
      const u = units.find((x) => x.id === pendingFocusUnit.unitId);
      if (u) {
        setSelected({ kind: "unit", id: u.id });
        setHighlightUnitId(u.id);
        if (canvasRef.current) {
          panToUnit(u);
          if (onFocusUnitHandled) onFocusUnitHandled();
          return;
        }
        if (attempt < maxAttempts) { timerId = setTimeout(tryFocus, 200); return; }
      }
      if (onFocusUnitHandled) onFocusUnitHandled();
    };
    let timerId = setTimeout(tryFocus, 300);
    return () => clearTimeout(timerId);
  }, [pendingFocusUnit]);

  // 赤点滅を5秒後に自動クリア
  useEffect(() => {
    if (!highlightUnitId) return;
    const timer = setTimeout(() => setHighlightUnitId(null), 5000);
    return () => clearTimeout(timer);
  }, [highlightUnitId]);

  function placeOnFloorAuto(unitId) {
    if (!requireAuth()) return;
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
            setUnits((prev) => prev.map((x) => (x.id === unitId ? { ...x, loc: { kind: "floor", x: tx, y: ty }, stackZ, status: autoPromoteStatus(x) } : x)));
            showToast(containingItems.length > 0 ? `床に積み重ねました（${containingItems.length + 1}段目）` : "床に配置しました");
            return;
          }
        }
      }
    }
    showToast("床に空きスペースが見つかりません");
  }

  function placeOnShelfAuto(unitId, shelfId) {
    if (!requireAuth()) return;
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const shelf = (layout.shelves || []).find((s) => s.id === shelfId);
    if (!shelf) return;
    const fp = unitFootprintCells(u);
    for (let y = 0; y <= shelf.h - fp.h; y++) {
      for (let x = 0; x <= shelf.w - fp.w; x++) {
        if (canPlaceOnShelf(shelfId, u, x, y, unitId)) {
          setUnits((prev) => prev.map((x2) => (x2.id === unitId ? { ...x2, loc: { kind: "shelf", shelfId, x, y }, status: autoPromoteStatus(x2) } : x2)));
          showToast(`棚「${shelf.name || shelfId}」に配置しました`);
          return;
        }
      }
    }
    showToast(`棚「${shelf.name || shelfId}」に空きスペースがありません`);
  }

  function placeOnRackAuto(unitId, rackId) {
    if (!requireAuth()) return;
    const u = units.find((x) => x.id === unitId);
    if (!u) return;
    const rack = layout.racks.find((r) => r.id === rackId);
    if (!rack) return;
    const totalSlots = (rack.rows || 1) * (rack.cols || 1);
    for (let slot = 0; slot < totalSlots; slot++) {
      if (isRackSlotFree(rackId, slot, unitId)) {
        setUnits((prev) => prev.map((x) => (x.id === unitId ? { ...x, loc: { kind: "rack", rackId, slot }, status: autoPromoteStatus(x) } : x)));
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
    const draft = { ...u, id: "__draft__", _origId: u.id, loc: { kind: "unplaced" } };
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

  // ドラッグ中のスナップ先ハイライト用ID
  const mainStackTargetId = useMemo(() => {
    if (!drag || (drag.type !== "move_unit" && drag.type !== "place_new")) return null;
    if (drag.pointerX === drag.startX && drag.pointerY === drag.startY) return null;
    const du = drag.type === "move_unit" ? units.find((x) => x.id === drag.unitId) : drag.draftUnit;
    if (!du) return null;
    const dfp = unitFootprintCells(du);
    const { cx, cy } = toCell(drag.pointerX, drag.pointerY);
    const fx = layout.floor.x || 0, fy = layout.floor.y || 0;
    let px, py;
    if (drag.type === "move_unit") {
      const ddx = cx - (drag.offsetCx || 0), ddy = cy - (drag.offsetCy || 0);
      px = clamp(ddx, fx, fx + layout.floor.cols - dfp.w);
      py = clamp(ddy, fy, fy + layout.floor.rows - dfp.h);
    } else {
      px = clamp(cx, fx, fx + layout.floor.cols - dfp.w);
      py = clamp(cy, fy, fy + layout.floor.rows - dfp.h);
    }
    const excludeId = drag.type === "move_unit" ? du.id : null;
    const st = snapToStackTarget(px, py, dfp, excludeId);
    if (!st) return null;
    const target = units.find((x) => x.loc?.kind === "floor" && x.stackable && Math.abs((x.loc.x || 0) - st.x) < 0.01 && Math.abs((x.loc.y || 0) - st.y) < 0.01 && x.id !== excludeId);
    return target?.id || null;
  }, [drag, units, layout.floor]);

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
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const d = String(selectedDate.getDate()).padStart(2, "0");
    const selDateStr = `${y}-${m}-${d}`;
    return units
      .filter((u) => u.departureDate && u.departureDate.slice(0, 10) === selDateStr)
      .sort((a, b) => (a.departureDate || "").localeCompare(b.departureDate || ""));
  }, [units, selectedDate]);

  // 入庫予定一覧（selectedDate と一致）
  const arrivalSchedule = useMemo(() => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
    const d = String(selectedDate.getDate()).padStart(2, "0");
    const selDateStr = `${y}-${m}-${d}`;
    return units
      .filter((u) => u.arrivalDate && u.arrivalDate.slice(0, 10) === selDateStr)
      .sort((a, b) => (a.arrivalDate || "").localeCompare(b.arrivalDate || ""));
  }, [units, selectedDate]);

  // 運行中ユニット一覧（selectedDate が運行期間内のもの）
  const transitUnits = useMemo(() => {
    const selDateStr = (() => {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
      const d = String(selectedDate.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();
    return units.filter((u) => {
      if (u.status !== "in_transit") return false;
      if (!u.transitStartDate && !u.transitEndDate) return true;
      const start = u.transitStartDate ? u.transitStartDate.slice(0, 10) : "0000-00-00";
      const end = u.transitEndDate ? u.transitEndDate.slice(0, 10) : "9999-99-99";
      return selDateStr >= start && selDateStr <= end;
    });
  }, [units, selectedDate]);

  // 運行終了3日前アラート
  const transitAlerts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const alerts = [];
    for (const u of units) {
      if (u.status !== "in_transit" || !u.transitEndDate) continue;
      const endDate = new Date(u.transitEndDate);
      endDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
      if (diffDays > 3) continue;
      // 元の配置位置に別ユニットが置かれているかチェック
      let positionOccupied = false;
      if (u.loc?.kind === "floor") {
        const fp = unitFootprintCells(u);
        for (const other of units) {
          if (other.id === u.id || other.status === "in_transit") continue;
          if (other.loc?.kind !== "floor") continue;
          const ofp = unitFootprintCells(other);
          if (u.loc.x < other.loc.x + ofp.w && u.loc.x + fp.w > other.loc.x &&
              u.loc.y < other.loc.y + ofp.h && u.loc.y + fp.h > other.loc.y) {
            positionOccupied = true;
            break;
          }
        }
      }
      alerts.push({ unit: u, diffDays, positionOccupied });
    }
    return alerts;
  }, [units]);

  // 予約期限アラート
  const reservationAlerts = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const alerts = [];
    for (const z of layout.zones) {
      if (!z.reserved || !z.reservationEndDate) continue;
      const endDate = new Date(z.reservationEndDate); endDate.setHours(0,0,0,0);
      const diffDays = Math.ceil((endDate - today) / (1000*60*60*24));
      if (diffDays > 3) continue;
      alerts.push({ zone: z, diffDays, expired: diffDays <= 0 });
    }
    return alerts;
  }, [layout.zones]);

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
      <div style={{ display: "flex", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid #e2e8f0", background: "linear-gradient(to right, #ffffff, #f8fafc)" }}>
        <div className="flex items-center gap-3">
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #dbeafe, #e0e7ff)", color: "#4338ca", borderColor: "#818cf8", cursor: "pointer" }}
            onClick={onBack}
            type="button"
          >
            ← TOPへ戻る
          </button>
          <div style={{ width: 16 }} />
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={mode === "operate"
              ? { padding: "8px 18px", fontSize: "14px", background: "linear-gradient(135deg, #dcfce7, #bbf7d0)", color: "#15803d", borderColor: "#4ade80", cursor: "pointer" }
              : { padding: "8px 18px", fontSize: "14px", background: "#f9fafb", color: "#6b7280", borderColor: "#e5e7eb", cursor: "pointer" }
            }
            onClick={() => setMode("operate")}
            type="button"
          >
            運用モード
          </button>
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={mode === "layout"
              ? { padding: "8px 18px", fontSize: "14px", background: "linear-gradient(135deg, #ffedd5, #fed7aa)", color: "#ea580c", borderColor: "#fb923c", cursor: "pointer" }
              : { padding: "8px 18px", fontSize: "14px", background: "#f9fafb", color: "#6b7280", borderColor: "#e5e7eb", cursor: "pointer" }
            }
            onClick={() => setMode("layout")}
            type="button"
          >
            レイアウトモード
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <span style={{ fontSize: "22px", fontWeight: 800, color: "#1e293b", letterSpacing: "0.02em" }}>
            {wh.name}
          </span>
          {transitAlerts.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#ef4444", minWidth: 20, height: 20, padding: "0 5px" }} title={`運行終了間近: ${transitAlerts.length}件`}>
              {transitAlerts.length}
            </span>
          )}
          {reservationAlerts.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#f97316", minWidth: 20, height: 20, padding: "0 5px" }} title={`予約期限間近: ${reservationAlerts.length}件`}>
              {reservationAlerts.length}
            </span>
          )}
          {warehouses.length > 1 && onSwitchWarehouse && (
            <select
              className="rounded-xl border-2 shadow-sm font-bold"
              style={{ padding: "8px 14px", fontSize: "14px", background: "white", borderColor: "#cbd5e1", cursor: "pointer", minWidth: "160px" }}
              value={wh.id}
              onChange={(e) => onSwitchWarehouse(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {mode === "operate" && (
            <>
              <button
                className="rounded-xl border-2 shadow-sm font-bold"
                style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #dbeafe, #bfdbfe)", color: "#2563eb", borderColor: "#60a5fa", cursor: "pointer" }}
                onClick={() => setCreateModalOpen(true)}
                type="button"
              >
                ＋新規作成
              </button>
              <button
                className="rounded-xl border-2 shadow-sm font-bold"
                style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #f0fdf4, #dcfce7)", color: "#15803d", borderColor: "#86efac", cursor: "pointer" }}
                onClick={() => setListModalOpen(true)}
                type="button"
              >
                荷物リスト
              </button>
            </>
          )}
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #ede9fe, #ddd6fe)", color: "#7c3aed", borderColor: "#a78bfa", cursor: "pointer" }}
            onClick={() => setIsoViewOpen(true)}
            type="button"
          >
            3Dビュー
          </button>
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #fef3c7, #fde68a)", color: "#92400e", borderColor: "#fbbf24", cursor: "pointer" }}
            onClick={onOpenUnitSearch}
            type="button"
          >
            荷物検索
          </button>
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #dbeafe, #bfdbfe)", color: "#1e40af", borderColor: "#93c5fd", cursor: "pointer" }}
            onClick={() => setPricingModalOpen(true)}
            type="button"
          >
            料金設定
          </button>
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #d1fae5, #a7f3d0)", color: "#065f46", borderColor: "#6ee7b7", cursor: "pointer" }}
            onClick={() => {
              const now = new Date();
              const y = now.getFullYear(), m = now.getMonth();
              const start = `${y}-${String(m + 1).padStart(2, "0")}-01`;
              const lastDay = new Date(y, m + 1, 0).getDate();
              const end = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
              setInvoicePeriod({ start, end });
              setInvoiceFilters({ client: "", department: "", personInCharge: "" });
              setInvoiceModalOpen(true);
            }}
            type="button"
          >
            請求書
          </button>
          <div style={{ width: 1, height: 28, background: "#e2e8f0" }} />
          <button
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #ccfbf1, #99f6e4)", color: "#0d9488", borderColor: "#5eead4", cursor: "pointer" }}
            onClick={() => setPersonModalOpen(true)}
            type="button"
          >
            担当者管理
          </button>
          {/* Auth UI */}
          <div className="ml-1 border-l pl-2 flex items-center gap-2">
            {isLoggedIn ? (
              <>
                <span style={{ background: "linear-gradient(135deg, #e0e7ff, #ede9fe)", color: "#4338ca", borderRadius: "20px", padding: "4px 12px", fontSize: "12px", fontWeight: 600 }}>{displayName}</span>
                <button type="button" onClick={onLogout} style={{ borderRadius: "8px", padding: "4px 8px", fontSize: "11px", color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>ログアウト</button>
              </>
            ) : (
              <button type="button" onClick={onLoginClick} style={{ borderRadius: "20px", padding: "6px 16px", fontSize: "12px", fontWeight: 600, color: "white", background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>ログイン</button>
            )}
          </div>
        </div>
      </div>

      {/* 閲覧モードバナー */}
      {!isLoggedIn && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "linear-gradient(90deg, #fef3c7, #fde68a)", borderBottom: "1px solid #fcd34d", padding: "8px 16px", fontSize: "13px", color: "#92400e" }}>
          <span style={{ fontSize: "16px" }}>👀</span>
          <span>閲覧モード — 編集するにはログインしてください</span>
          <button type="button" onClick={onLoginClick} style={{ borderRadius: "16px", padding: "3px 12px", fontSize: "12px", fontWeight: 600, color: "white", background: "linear-gradient(135deg, #f59e0b, #ef4444)", border: "none", cursor: "pointer" }}>ログイン</button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", top: "72px", transform: "translateX(-50%)", zIndex: 9999, borderRadius: "14px", padding: "8px 20px", fontSize: "13px", fontWeight: 500, color: "#fff", background: "linear-gradient(135deg, #1e293b, #334155)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
          {toast}
        </div>
      )}

      {/* 荷物リスト作成モーダル */}
      <Modal title="荷物リスト作成" open={listModalOpen} onClose={() => setListModalOpen(false)}>
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: "#64748b" }}>検索キー</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "personInCharge", label: "社内担当者名" },
                { key: "client", label: "顧客名" },
                { key: "department", label: "部署名" },
                { key: "name", label: "荷物名" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className="rounded-xl border-2 px-3 py-2 text-sm font-medium"
                  style={{
                    background: listSearchKey === opt.key ? "#1e293b" : "#fff",
                    color: listSearchKey === opt.key ? "#fff" : "#334155",
                    borderColor: listSearchKey === opt.key ? "#1e293b" : "#e2e8f0",
                    transition: "all 0.15s",
                  }}
                  onClick={() => { setListSearchKey(opt.key); setListSearchValue(""); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: "#64748b" }}>
              検索値
              {listSearchKey === "department" && (
                <span className="text-[10px] text-gray-400 ml-1">（空欄の場合は顧客名で検索）</span>
              )}
            </div>
            <select
              className="w-full rounded-xl border-2 px-3 py-2 text-sm"
              style={{ borderColor: "#e2e8f0" }}
              value={listSearchValue}
              onChange={(e) => setListSearchValue(e.target.value)}
            >
              <option value="">（全件）</option>
              {(listSearchKey === "personInCharge"
                ? personList.map((p) => p.name)
                : (listSearchOptions[listSearchKey] || [])
              ).map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-gray-500">
            {(() => {
              const keyField = listSearchKey;
              const query = listSearchValue.trim();
              const effectiveField = (keyField === "department" && !query) ? "client" : keyField;
              const count = query
                ? allWarehouseUnits.filter((u) => String(u[effectiveField] || "") === query).length
                : allWarehouseUnits.length;
              return `該当: ${count}件 / 全${allWarehouseUnits.length}件（全倉庫）`;
            })()}
          </div>
          <div className="text-xs text-gray-500 rounded-xl border bg-gray-50 p-3">
            <div className="font-semibold mb-1">出力項目（検索キー以外）:</div>
            {[
              { key: "personInCharge", label: "社内担当者名" },
              { key: "client", label: "顧客名" },
              { key: "department", label: "部署名" },
              { key: "clientContact", label: "顧客担当者名" },
              { key: "name", label: "荷物名" },
              { key: "arrivalDate", label: "入庫日" },
              { key: "departureDate", label: "出庫予定日" },
              { key: "storageLocation", label: "保管場所" },
            ].filter((c) => c.key !== listSearchKey).map((c) => (
              <span key={c.key} className="inline-block mr-2">{c.label}</span>
            ))}
          </div>
          <button
            className="w-full rounded-2xl px-4 py-3 text-sm font-bold"
            type="button"
            onClick={exportListAsPdf}
            style={{ background: "#15803d", color: "#fff", boxShadow: "0 4px 14px rgba(21,128,61,0.3)" }}
          >
            PDF出力（印刷）
          </button>
        </div>
      </Modal>

      {/* 新規作成モーダル */}
      <Modal title="新規荷物作成" open={createModalOpen} onClose={() => setCreateModalOpen(false)}>
        <div className="space-y-5">
          {/* テンプレート選択 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-4 rounded-full" style={{ background: "#3b82f6" }} />
              <div className="text-sm font-bold text-gray-700">テンプレート</div>
            </div>
            <div className="grid grid-cols-4 gap-2">
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
                    className="flex flex-col items-center rounded-xl border-2 p-2 select-none"
                    style={{
                      background: isActive ? t.activeColor : t.color,
                      borderColor: isActive ? t.activeColor : "transparent",
                      color: isActive ? "#fff" : "#334155",
                      transition: "all 0.15s",
                    }}
                    onClick={() => {
                      setTemplate(t.k);
                      setForm((s) => ({ ...s, w: t.w, d: t.d, h: t.h }));
                    }}
                  >
                    <span style={{ fontSize: 22 }}>{t.icon}</span>
                    <span className="mt-0.5 text-xs font-bold">{t.k}</span>
                    <span className="text-[10px]" style={{ opacity: 0.7 }}>{t.w}x{t.d}x{t.h}m</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 基本情報 */}
          <div className="rounded-xl border p-4 space-y-3" style={{ background: "#f8fafc" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full" style={{ background: "#6366f1" }} />
              <div className="text-sm font-bold text-gray-700">基本情報</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">荷物名(イベント名)</label>
              <input
                className="mt-1 w-full rounded-xl border-2 px-3 py-2.5 text-sm font-medium"
                style={{ borderColor: "#c7d2fe", background: "#fff" }}
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                placeholder="荷物名やイベント名を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">社内担当者</label>
                <select
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.personInCharge}
                  onChange={(e) => setForm((s) => ({ ...s, personInCharge: e.target.value }))}
                >
                  <option value="">（未設定）</option>
                  {personList.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">顧客名</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.client}
                  onChange={(e) => setForm((s) => ({ ...s, client: e.target.value }))}
                  placeholder="顧客名"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">部署名</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.department}
                  onChange={(e) => setForm((s) => ({ ...s, department: e.target.value }))}
                  placeholder="部署名"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">顧客担当者名</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.clientContact}
                  onChange={(e) => setForm((s) => ({ ...s, clientContact: e.target.value }))}
                  placeholder="顧客担当者名"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">荷物詳細</label>
              <textarea
                className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                style={{ borderColor: "#e2e8f0", background: "#fff" }}
                value={form.notes}
                onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="荷物の詳細情報やメモ"
                rows={2}
              />
            </div>
          </div>

          {/* スケジュール */}
          <div className="rounded-xl border p-4 space-y-3" style={{ background: "#f8fafc" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full" style={{ background: "#10b981" }} />
              <div className="text-sm font-bold text-gray-700">スケジュール</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">入庫日</label>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.arrivalDate}
                  onChange={(e) => setForm((s) => ({ ...s, arrivalDate: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">出庫予定日</label>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.departureDate}
                  onChange={(e) => setForm((s) => ({ ...s, departureDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">運行期間（任意）</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <div className="text-[10px] text-gray-400">開始日</div>
                  <input
                    type="datetime-local"
                    className="mt-0.5 w-full rounded-xl border-2 px-3 py-2 text-sm"
                    style={{ borderColor: "#e2e8f0", background: "#fff" }}
                    value={form.transitStartDate}
                    onChange={(e) => setForm((s) => ({ ...s, transitStartDate: e.target.value }))}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-gray-400">終了日（戻り予定）</div>
                  <input
                    type="datetime-local"
                    className="mt-0.5 w-full rounded-xl border-2 px-3 py-2 text-sm"
                    style={{ borderColor: "#e2e8f0", background: "#fff" }}
                    value={form.transitEndDate}
                    onChange={(e) => setForm((s) => ({ ...s, transitEndDate: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* サイズ・重量 */}
          <div className="rounded-xl border p-4 space-y-3" style={{ background: "#f8fafc" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 rounded-full" style={{ background: "#f59e0b" }} />
              <div className="text-sm font-bold text-gray-700">サイズ・重量</div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-600">幅 W(m)</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-sm text-center"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.w}
                  onChange={(e) => setForm((s) => ({ ...s, w: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">奥行 D(m)</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-sm text-center"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.d}
                  onChange={(e) => setForm((s) => ({ ...s, d: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">高さ H(m)</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-sm text-center"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.h}
                  onChange={(e) => setForm((s) => ({ ...s, h: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">数量</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-2 py-2 text-sm text-center"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.qty}
                  onChange={(e) => setForm((s) => ({ ...s, qty: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">重量(kg)</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.weight_kg}
                  onChange={(e) => setForm((s) => ({ ...s, weight_kg: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">kintoneレコードID</label>
                <input
                  className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-sm"
                  style={{ borderColor: "#e2e8f0", background: "#fff" }}
                  value={form.kintoneRecordId}
                  onChange={(e) => setForm((s) => ({ ...s, kintoneRecordId: e.target.value }))}
                  placeholder="レコードID"
                />
              </div>
            </div>
          </div>

          {/* カード背景色 */}
          <div className="rounded-xl border p-4" style={{ background: "#f8fafc" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: "#ec4899" }} />
              <div className="text-sm font-bold text-gray-700">カード背景色</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.bgColor || "#ffffff"}
                onChange={(e) => setForm((s) => ({ ...s, bgColor: e.target.value }))}
                className="h-9 w-12 cursor-pointer rounded-lg border p-0.5"
              />
              <input
                className="flex-1 rounded-xl border-2 px-3 py-2 text-sm"
                style={{ borderColor: "#e2e8f0", background: "#fff" }}
                value={form.bgColor}
                onChange={(e) => setForm((s) => ({ ...s, bgColor: e.target.value }))}
                placeholder="未設定（自動配色）"
              />
              {form.bgColor && (
                <button
                  type="button"
                  className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-100"
                  onClick={() => setForm((s) => ({ ...s, bgColor: "" }))}
                >
                  リセット
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {["#dbeafe","#d1fae5","#fef3c7","#fce7f3","#e0e7ff","#fef9c3","#ffedd5","#f3e8ff","#ccfbf1","#fee2e2"].map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-7 h-7 rounded-lg border-2 transition-all"
                  style={{
                    background: c,
                    borderColor: form.bgColor === c ? "#1e293b" : "transparent",
                    transform: form.bgColor === c ? "scale(1.15)" : undefined,
                  }}
                  onClick={() => setForm((s) => ({ ...s, bgColor: c }))}
                />
              ))}
            </div>
          </div>

          {/* 作成ボタン */}
          <button
            className="w-full rounded-2xl px-4 py-3.5 text-sm font-bold"
            type="button"
            onClick={createUnitFromForm}
            style={{
              background: "linear-gradient(135deg, #1e293b, #334155)",
              color: "#fff",
              boxShadow: "0 4px 14px rgba(30,41,59,0.3)",
            }}
          >
            作成
          </button>
        </div>
      </Modal>

      {isoViewOpen && (
        <IsometricView
          units={units}
          layout={layout}
          panels={panels}
          onClose={() => setIsoViewOpen(false)}
          blinkingUnitIds={blinkingUnitIds}
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
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
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
                      panToUnit(u);
                    }}
                  >
                    <div className="font-medium flex items-center gap-1">
                      <span className="text-red-500">●</span> {u.name}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                      {u.client && <div>顧客: {u.client}</div>}
                      {u.qty && <div>数量: {u.qty}</div>}
                      {u.departureDate && u.departureDate.length > 10 && (
                        <div>時間: {u.departureDate.slice(11, 16)}</div>
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

          {/* 運行中セクション */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" style={{ borderColor: transitAlerts.length > 0 ? "#fbbf24" : undefined }}>
            <SectionTitle
              right={
                <span className="flex items-center gap-1">
                  <Badge color="orange">{transitUnits.length} 件</Badge>
                  {transitAlerts.length > 0 && (
                    <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#ef4444", width: 18, height: 18 }}>
                      {transitAlerts.length}
                    </span>
                  )}
                </span>
              }
            >
              運行中
            </SectionTitle>
            {transitAlerts.length > 0 && (
              <div className="space-y-1 mb-2">
                {transitAlerts.map((a) => (
                  <div
                    key={a.unit.id}
                    className="rounded-xl p-2 text-xs cursor-pointer"
                    style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}
                    onClick={() => {
                      setSelected({ kind: "unit", id: a.unit.id });
                      panToUnit(a.unit);
                    }}
                  >
                    <div className="font-bold" style={{ color: "#dc2626" }}>
                      ⚠ {a.unit.name} — {a.diffDays <= 0 ? "期限超過" : `あと${a.diffDays}日`}
                    </div>
                    {a.positionOccupied && (
                      <div style={{ color: "#b91c1c" }}>元の位置に別荷物あり</div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {transitUnits.length === 0 ? (
              <div className="text-sm text-gray-500">運行中の荷物はありません。</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {transitUnits.map((u) => {
                  const isAlert = transitAlerts.some((a) => a.unit.id === u.id);
                  const startStr = u.transitStartDate ? new Date(u.transitStartDate).toLocaleDateString("ja-JP") : "-";
                  const endStr = u.transitEndDate ? new Date(u.transitEndDate).toLocaleDateString("ja-JP") : "-";
                  const diffDays = u.transitEndDate
                    ? Math.ceil((new Date(u.transitEndDate) - new Date()) / (1000 * 60 * 60 * 24))
                    : null;
                  return (
                    <div
                      key={u.id}
                      className="rounded-xl border p-2 text-sm cursor-pointer transition-colors"
                      style={{
                        borderColor: isAlert ? "#fca5a5" : undefined,
                        background: isAlert ? "#fff7ed" : undefined,
                      }}
                      onClick={() => {
                        setSelected({ kind: "unit", id: u.id });
                        panToUnit(u);
                      }}
                    >
                      <div className="font-medium flex items-center gap-1">
                        <span style={{ color: "#ea580c" }}>●</span> {u.name}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                        {u.client && <div>顧客: {u.client}</div>}
                        <div>期間: {startStr} 〜 {endStr}</div>
                        {diffDays !== null && (
                          <div style={{ color: diffDays <= 3 ? "#dc2626" : "#6b7280" }}>
                            {diffDays <= 0 ? "期限超過" : `残り${diffDays}日`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 予約アラートセクション */}
          {reservationAlerts.length > 0 && (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" style={{ borderColor: "#f97316" }}>
              <SectionTitle
                right={
                  <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: "#f97316", minWidth: 20, height: 20, padding: "0 5px" }}>
                    {reservationAlerts.length}
                  </span>
                }
              >
                予約アラート
              </SectionTitle>
              <div className="space-y-1">
                {reservationAlerts.map((a) => (
                  <div
                    key={a.zone.id}
                    className="rounded-xl p-2 text-xs cursor-pointer"
                    style={{
                      background: a.expired ? "#fef2f2" : "#fffbeb",
                      border: `1px solid ${a.expired ? "#fca5a5" : "#fde68a"}`,
                    }}
                    onClick={() => { setSelected({ kind: "zone", id: a.zone.id }); panToZone(a.zone); }}
                  >
                    <div className="font-bold" style={{ color: a.expired ? "#dc2626" : "#d97706" }}>
                      {a.expired ? "⚠ " : "⏰ "}{a.zone.name} — {a.expired ? "期限超過" : `あと${a.diffDays}日`}
                    </div>
                    {a.zone.client && <div className="text-gray-600 mt-0.5">取引先: {a.zone.client}</div>}
                    <div className="text-gray-500 mt-0.5">期限: {a.zone.reservationEndDate}</div>
                    {a.expired && (
                      <div className="flex gap-1 mt-1">
                        <button
                          className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-white"
                          style={{ background: "#f97316" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const newDate = prompt("新しい期限日を入力 (YYYY-MM-DD):", a.zone.reservationEndDate);
                            if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
                              setLayout((p) => ({
                                ...p,
                                zones: p.zones.map((z) => z.id === a.zone.id ? { ...z, reservationEndDate: newDate } : z),
                              }));
                            }
                          }}
                        >
                          延長
                        </button>
                        <button
                          className="rounded-lg px-2 py-0.5 text-[10px] font-bold text-white"
                          style={{ background: "#10b981" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLayout((p) => ({
                              ...p,
                              zones: p.zones.map((z) => z.id === a.zone.id ? { ...z, reserved: false, reservationEndDate: null } : z),
                            }));
                          }}
                        >
                          予約OFF
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 入庫予定セクション */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <SectionTitle
              right={<Badge color="blue">{arrivalSchedule.length} 件</Badge>}
            >
              入庫予定（{selectedDate.toLocaleDateString("ja-JP")}）
            </SectionTitle>
            {arrivalSchedule.length === 0 ? (
              <div className="text-sm text-gray-500">この日の入庫予定はありません。</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {arrivalSchedule.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-xl border p-2 text-sm hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelected({ kind: "unit", id: u.id });
                      panToUnit(u);
                    }}
                  >
                    <div className="font-medium flex items-center gap-1">
                      <span className="text-blue-500">●</span> {u.name}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                      {u.client && <div>顧客: {u.client}</div>}
                      {u.arrivalDate && u.arrivalDate.length > 10 && (
                        <div>時間: {u.arrivalDate.slice(11, 16)}</div>
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

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
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
        <div className="flex-1 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm min-w-0">
          <SectionTitle>倉庫キャンバス</SectionTitle>

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
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openZoneDetailModal({
                    id: "__floor__",
                    name: wh.name || "床",
                    x: layout.floor.x || 0,
                    y: layout.floor.y || 0,
                    w: layout.floor.cols,
                    h: layout.floor.rows,
                    bgColor: layout.floor.floorBgColor || "#ffffff",
                    _isVirtual: "floor",
                  });
                }}
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
                // 予約状態の計算
                let reservationBorderColor = z.bgColor || "#10b981";
                let reservationExpired = false;
                if (z.reserved && z.reservationEndDate) {
                  const today = new Date(); today.setHours(0,0,0,0);
                  const endD = new Date(z.reservationEndDate); endD.setHours(0,0,0,0);
                  const diff = Math.ceil((endD - today) / (1000*60*60*24));
                  if (diff <= 0) { reservationBorderColor = "#ef4444"; reservationExpired = true; }
                  else if (diff <= 3) { reservationBorderColor = "#fbbf24"; }
                }
                return (
                  <div
                    key={z.id}
                    className={
                      `absolute rounded-2xl border-2 ` +
                      (reservationExpired ? "wh-reservation-expired " : "") +
                      (zSel ? "ring-2 ring-black" : "")
                    }
                    style={{
                      left: z.x * cellPx,
                      top: z.y * cellPx,
                      width: z.w * cellPx,
                      height: z.h * cellPx,
                      zIndex: (hasMovedZone || (zSel && drag?.type === "group_move")) ? 50 : 1,
                      backgroundColor: `rgba(${bgRgb.join(",")}, ${bgOpacity})`,
                      borderColor: reservationBorderColor,
                      transform: zoneDragTransform,
                      opacity: hasMovedZone ? 0.7 : undefined,
                      pointerEvents: hasMovedZone ? "none" : undefined,
                      transition: (hasMovedZone || drag?.type === "group_move") ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "layout" && beginMoveZone(e, z.id)}
                    onClick={(e) => handleItemClick(e, "zone", z.id)}
                    onDoubleClick={(e) => { e.stopPropagation(); openZoneDetailModal(z); }}
                  >
                    {/* 予約ゾーンのハッチングオーバーレイ */}
                    {z.reserved && (
                      <div className="absolute inset-0 rounded-2xl wh-zone-reserved" style={{ zIndex: 60 }} />
                    )}
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
                            className={"absolute rounded-lg border" + (occupant && highlightUnitId === occupant.id ? " wh-search-highlight" : "")}
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
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openZoneDetailModal({
                        id: `__shelf_${s.id}__`,
                        name: s.name || "棚",
                        x: s.x,
                        y: s.y,
                        w: s.w,
                        h: s.h,
                        bgColor: shelfBgColor,
                        loc: { kind: "shelf", shelfId: s.id, x: s.x, y: s.y },
                        _isVirtual: "shelf",
                        _shelfId: s.id,
                      });
                    }}
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
                            (highlightUnitId === u.id ? "wh-search-highlight" : (isUnitSel ? "ring-2 ring-black shadow-lg z-20" : "hover:shadow-lg"))
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
                          title={u.name}
                        >
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
                          title={p.name}
                        >
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
                const isStackTarget = mainStackTargetId === u.id;
                const dragTransform = hasMoved
                  ? `translate(${(drag.pointerX - drag.startX) / zoom}px, ${(drag.pointerY - drag.startY) / zoom}px)`
                  : isGroupMoving ? groupMoveTransform : undefined;
                const shouldBlink = blinkingUnitIds.has(u.id);
                const isTransit = u.status === "in_transit";
                const isHighlight = highlightUnitId === u.id;
                return (
                  <div
                    key={u.id}
                    className={
                      "absolute rounded-3xl cursor-pointer " +
                      (isTransit ? "" : "border-2 ") +
                      ((hasMoved || isGroupMoving) ? "" : "transition-all duration-150 ") +
                      (isHighlight ? "wh-search-highlight" : (isSel ? "ring-2 ring-black shadow-lg" : "hover:shadow-xl hover:-translate-y-0.5")) +
                      (shouldBlink && !isSel && !isHighlight ? " wh-departure-blink" : "")
                    }
                    style={{
                      left: u.loc.x * cellPx,
                      top: u.loc.y * cellPx,
                      width: fp.w * cellPx,
                      height: fp.h * cellPx,
                      background: u.bgColor
                        ? `rgba(${unitBgRgb.join(",")}, ${unitBgOpacity})`
                        : "linear-gradient(145deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)",
                      borderColor: isStackTarget ? "#3b82f6" : (shouldBlink && !isSel) ? undefined : (isSel ? "#1e293b" : (u.bgColor || "#e2e8f0")),
                      borderWidth: isStackTarget ? 3 : (isTransit ? 2 : undefined),
                      borderStyle: isTransit ? "dashed" : undefined,
                      boxShadow: isStackTarget
                        ? "0 0 20px 6px rgba(59,130,246,0.5)"
                        : (shouldBlink && !isSel) ? undefined : (isSel
                          ? "0 10px 25px -5px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.1)"
                          : "0 4px 12px -2px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04)"),
                      zIndex: (hasMoved || isGroupMoving) ? 50 : 8 + (u.stackZ || 0),
                      transform: dragTransform,
                      opacity: hasMoved ? 0.7 : (isTransit ? 0.35 : undefined),
                      pointerEvents: hasMoved ? "none" : undefined,
                      transition: hasMoved ? "none" : undefined,
                    }}
                    onMouseDown={(e) => mode === "operate" && beginMoveUnit(e, u.id)}
                    onClick={(e) => handleItemClick(e, "unit", u.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openDetailModal(u);
                    }}
                    title={u.name}
                  >
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
                    title={p.name}
                  >
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
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
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
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                  {/* 床の契約坪数 */}
                  <div className="mt-3 rounded-xl border bg-blue-50 p-2">
                    {(() => {
                      const autoM2 = layout.floor.cols * (layout.floor.cell_m_w || 1.2) * layout.floor.rows * (layout.floor.cell_m_d || 1.0);
                      const autoTsubo = autoM2 / TSUBO_M2;
                      const whMaxTsubo = (wh.area_m2 || 0) / TSUBO_M2;
                      return (
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between text-gray-500">
                            <span>自動計算</span>
                            <span>{autoM2.toFixed(2)} m² ({autoTsubo.toFixed(2)} 坪)</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-600 font-medium">契約坪数</span>
                            <input
                              className="w-20 rounded-lg border px-2 py-0.5 text-xs text-right"
                              type="number" min="0" step="0.1"
                              value={layout.floor.area_m2_manual ? (layout.floor.area_m2 / TSUBO_M2).toFixed(2) : ""}
                              placeholder={autoTsubo.toFixed(2)}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "") {
                                  setLayout((p) => ({ ...p, floor: { ...p.floor, area_m2_manual: false, area_m2: autoM2 } }));
                                } else {
                                  const tsubo = Number(v);
                                  if (whMaxTsubo > 0 && tsubo > whMaxTsubo) {
                                    showToast(`倉庫面積(${whMaxTsubo.toFixed(2)}坪)を超えています`);
                                    return;
                                  }
                                  setLayout((p) => ({ ...p, floor: { ...p.floor, area_m2_manual: true, area_m2: tsubo * TSUBO_M2 } }));
                                }
                              }}
                            />
                          </div>
                          {whMaxTsubo > 0 && <div className="text-[10px] text-gray-400 text-right">上限: {whMaxTsubo.toFixed(2)} 坪（倉庫面積: {wh.area_m2}m²）</div>}
                          {!layout.floor.area_m2_manual && <div className="text-[10px] text-gray-400 text-right">空欄時は自動計算値を使用</div>}
                        </div>
                      );
                    })()}
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
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                          {/* 予約ON/OFF */}
                          <div className="border-t pt-2 pb-1">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-gray-500">予約状態</div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selectedEntity.reserved ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                                {selectedEntity.reserved ? "予約中" : "運用中"}
                              </span>
                            </div>
                            <div
                              className="mt-1 flex items-center gap-2 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                const newVal = !selectedEntity.reserved;
                                setLayout((p) => ({
                                  ...p,
                                  zones: p.zones.map((z) => z.id === selected.id ? { ...z, reserved: newVal, ...(!newVal ? { reservationEndDate: null } : {}) } : z),
                                }));
                              }}
                            >
                              <div className="relative rounded-full" style={{ width: 40, height: 20, backgroundColor: selectedEntity.reserved ? "#fb923c" : "#d1d5db", transition: "background-color 0.2s" }}>
                                <div className="absolute rounded-full shadow pointer-events-none" style={{ top: 2, width: 16, height: 16, backgroundColor: "#fff", transition: "transform 0.2s", transform: selectedEntity.reserved ? "translateX(20px)" : "translateX(2px)" }} />
                              </div>
                              <span className="text-xs text-gray-600">予約 {selectedEntity.reserved ? "ON" : "OFF"}</span>
                            </div>
                            {selectedEntity.reserved && (
                              <div className="mt-2">
                                <div className="text-[10px] text-gray-400">予約期限日</div>
                                <input
                                  type="date"
                                  className="mt-0.5 w-full rounded-xl border px-3 py-1.5 text-sm"
                                  value={selectedEntity.reservationEndDate || ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLayout((p) => ({
                                      ...p,
                                      zones: p.zones.map((z) => z.id === selected.id ? { ...z, reservationEndDate: v || null } : z),
                                    }));
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">取引先</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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

                      {/* 棚専用: 契約坪数 */}
                      {selected.kind === "shelf" && (
                        <div className="rounded-xl border bg-teal-50 p-2">
                          {(() => {
                            const autoM2 = selectedEntity.w * (layout.floor.cell_m_w || 1.2) * selectedEntity.h * (layout.floor.cell_m_d || 1.0);
                            const autoTsubo = autoM2 / TSUBO_M2;
                            return (
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between text-gray-400">
                                  <span>自動計算</span>
                                  <span>{autoM2.toFixed(2)} m² ({autoTsubo.toFixed(2)} 坪)</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-gray-600 font-medium">契約坪数</span>
                                  <input
                                    className="w-20 rounded-lg border px-2 py-0.5 text-xs text-right"
                                    type="number" min="0" step="0.1"
                                    value={selectedEntity.area_m2_manual ? (selectedEntity.area_m2 / TSUBO_M2).toFixed(2) : ""}
                                    placeholder={autoTsubo.toFixed(2)}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === "") {
                                        setLayout((p) => ({ ...p, shelves: (p.shelves || []).map((s) => s.id === selected.id ? { ...s, area_m2_manual: false, area_m2: autoM2 } : s) }));
                                      } else {
                                        setLayout((p) => ({ ...p, shelves: (p.shelves || []).map((s) => s.id === selected.id ? { ...s, area_m2_manual: true, area_m2: Number(v) * TSUBO_M2 } : s) }));
                                      }
                                    }}
                                  />
                                </div>
                                {!selectedEntity.area_m2_manual && <div className="text-[10px] text-gray-400 text-right">空欄時は自動計算値を使用</div>}
                              </div>
                            );
                          })()}
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
            <div>
              {/* 倉庫間移動受入 */}
              {(() => {
                const transferred = unplaced.filter((u) => u.transferredFrom);
                if (transferred.length === 0) return null;
                return (
                  <div className="rounded-3xl border-2 border-indigo-200 p-4 shadow-md mb-3" style={{ background: "#eef2ff" }}>
                    <SectionTitle>倉庫間移動 受入（{transferred.length}件）</SectionTitle>
                    <div className="space-y-3">
                      {transferred.map((u) => {
                        const isSel = isItemSelected("unit", u.id);
                        const kindIcon = u.kind === "パレット" ? "\u{1f4e6}" : u.kind === "カゴ" ? "\u{1f6d2}" : u.kind === "配電盤" ? "\u{26a1}" : "\u{1f4e6}";
                        const kindColor = u.kind === "パレット" ? "#dbeafe" : u.kind === "カゴ" ? "#d1fae5" : u.kind === "配電盤" ? "#fef9c3" : "#fef3c7";
                        return (
                          <div
                            key={u.id}
                            className="rounded-2xl border-2 p-3 select-none"
                            style={{
                              background: "#fff",
                              borderColor: isSel ? "#6366f1" : "#c7d2fe",
                              boxShadow: isSel ? "0 0 0 3px rgba(99,102,241,0.2), 0 4px 12px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.05)",
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
                                <div className="truncate text-sm font-bold" style={{ color: "#1e293b" }}>{u.name || u.kind}</div>
                                <div className="truncate text-xs" style={{ color: "#6366f1" }}>{u.transferredFrom} から移動</div>
                                {u.transferredAt && (
                                  <div className="truncate text-[10px]" style={{ color: "#94a3b8" }}>{new Date(u.transferredAt).toLocaleString("ja-JP")}</div>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {u.client && <Badge>{u.client}</Badge>}
                              {u.weight_kg > 0 && <Badge>{u.weight_kg}kg</Badge>}
                            </div>
                            <div className="mt-3 flex gap-2">
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
                                style={{ background: "#4f46e5", color: "#fff", whiteSpace: "nowrap" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sel = document.getElementById(`place-target-${u.id}`);
                                  placeAutoByTarget(u.id, sel?.value || "floor");
                                  // 配置後にtransferredFromをクリア
                                  setUnits((prev) => prev.map((x) => x.id === u.id ? { ...x, transferredFrom: undefined, transferredAt: undefined } : x));
                                }}
                              >
                                配置
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 未配置 */}
              <div className="rounded-3xl border-2 p-4 shadow-md" style={{ background: "#f8fafc" }}>
                <SectionTitle>未配置</SectionTitle>
                <div className="space-y-3">
                  {(() => {
                    const normalUnplaced = unplaced.filter((u) => !u.transferredFrom);
                    if (normalUnplaced.length === 0) return (
                      <div className="rounded-2xl p-4 text-center text-sm" style={{ background: "#f0f9ff", color: "#64748b" }}>
                        未配置の荷物はありません
                      </div>
                    );
                    return normalUnplaced.map((u) => {
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
                            {u.client && <Badge>{u.client}</Badge>}
                            {u.weight_kg > 0 && <Badge>{u.weight_kg}kg</Badge>}
                          </div>
                          <div className="mt-3 flex gap-2">
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
                              style={{ background: "#1e293b", color: "#fff", whiteSpace: "nowrap" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const sel = document.getElementById(`place-target-${u.id}`);
                                placeAutoByTarget(u.id, sel?.value || "floor");
                              }}
                            >
                              配置
                            </button>
                          </div>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              className="rounded-xl px-3 py-1.5 text-xs font-bold"
                              style={{ background: "#fee2e2", color: "#dc2626" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!requireAuth()) return;
                                setUnits((prev) => prev.filter((x) => x.id !== u.id));
                                showToast("削除しました");
                              }}
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
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
                      onClick={() => { if (!requireAuth()) return; removeSelected(); showToast("一括削除しました"); }}
                      type="button"
                    >
                      一括削除 ({selectionSet.length}件)
                    </button>
                  </div>
                ) : !selectedEntity || (selected.kind !== "unit" && selected.kind !== "panel" && selected.kind !== "zone") ? (
                  <div className="text-sm text-gray-600">荷物または配電盤をクリックすると詳細が出ます。Ctrl+クリックで複数選択。</div>
                ) : selected.kind === "zone" ? (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">区画: {selectedEntity.name}</div>
                    {selectedEntity.client && <div className="text-xs text-gray-500">取引先: {selectedEntity.client}</div>}
                    {/* 予約ON/OFF */}
                    <div className="border-t pt-2 pb-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500">予約状態</div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${selectedEntity.reserved ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"}`}>
                          {selectedEntity.reserved ? "予約中" : "運用中"}
                        </span>
                      </div>
                      <div
                        className="mt-1 flex items-center gap-2 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          const newVal = !selectedEntity.reserved;
                          setLayout((p) => ({
                            ...p,
                            zones: p.zones.map((z) => z.id === selected.id ? { ...z, reserved: newVal, ...(!newVal ? { reservationEndDate: null } : {}) } : z),
                          }));
                        }}
                      >
                        <div className="relative rounded-full" style={{ width: 40, height: 20, backgroundColor: selectedEntity.reserved ? "#fb923c" : "#d1d5db", transition: "background-color 0.2s" }}>
                          <div className="absolute rounded-full shadow pointer-events-none" style={{ top: 2, width: 16, height: 16, backgroundColor: "#fff", transition: "transform 0.2s", transform: selectedEntity.reserved ? "translateX(20px)" : "translateX(2px)" }} />
                        </div>
                        <span className="text-xs text-gray-600">予約 {selectedEntity.reserved ? "ON" : "OFF"}</span>
                      </div>
                      {selectedEntity.reserved && (
                        <div className="mt-2">
                          <div className="text-[10px] text-gray-400">予約期限日</div>
                          <input
                            type="date"
                            className="mt-0.5 w-full rounded-xl border px-3 py-1.5 text-sm"
                            value={selectedEntity.reservationEndDate || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLayout((p) => ({
                                ...p,
                                zones: p.zones.map((z) => z.id === selected.id ? { ...z, reservationEndDate: v || null } : z),
                              }));
                            }}
                          />
                        </div>
                      )}
                    </div>
                    {/* ===== 区画料金 ===== */}
                    <div className="border-t pt-2 pb-1">
                      <div className="text-xs font-semibold text-gray-700 mb-1">料金</div>
                      {(() => {
                        const autoM2 = selectedEntity.w * (layout.floor.cell_m_w || 1.2) * selectedEntity.h * (layout.floor.cell_m_d || 1.0);
                        const autoTsubo = autoM2 / TSUBO_M2;
                        const b = calcZoneBilling(selectedEntity);
                        return (
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between text-gray-400"><span>自動計算</span><span>{autoM2.toFixed(2)} m² ({autoTsubo.toFixed(2)} 坪)</span></div>
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-gray-500">契約坪数</span>
                                <input
                                  className="w-20 rounded-lg border px-2 py-0.5 text-xs text-right"
                                  type="number" min="0" step="0.1"
                                  value={selectedEntity.area_m2_manual ? (selectedEntity.area_m2 / TSUBO_M2).toFixed(2) : ""}
                                  placeholder={autoTsubo.toFixed(2)}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "") {
                                      setLayout((p) => ({ ...p, zones: p.zones.map((z) => z.id === selected.id ? { ...z, area_m2_manual: false, area_m2: autoM2 } : z) }));
                                    } else {
                                      setLayout((p) => ({ ...p, zones: p.zones.map((z) => z.id === selected.id ? { ...z, area_m2_manual: true, area_m2: Number(v) * TSUBO_M2 } : z) }));
                                    }
                                  }}
                                />
                              </div>
                              {!selectedEntity.area_m2_manual && <div className="text-[10px] text-gray-400 text-right">空欄時は自動計算値を使用</div>}
                            </div>
                            <div className="flex justify-between"><span className="text-gray-500">請求面積</span><span className="font-medium">{b.tsubo.toFixed(2)} 坪</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">坪単価/月</span><span>¥{b.rate.toLocaleString()}</span></div>
                            <div className="flex justify-between font-semibold text-sm"><span>月額</span><span>¥{b.monthlyAmount.toLocaleString()}</span></div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : selected.kind === "panel" ? (
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">配電盤: {selectedEntity.name}</div>
                    <div>
                      <div className="text-xs text-gray-500">名前</div>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                      <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" type="button" onClick={() => { if (!requireAuth()) return; setPanels((prev) => prev.filter((p) => p.id !== selectedEntity.id)); clearSelection(); showToast("削除しました"); }}>
                        削除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* ===== 操作ボタン（常に表示） ===== */}
                    <div className="text-sm font-semibold">{selectedEntity.kind}</div>
                    <div className="flex flex-wrap gap-2">
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
                        className="rounded-xl border px-3 py-2 text-sm hover:bg-red-50 text-red-600"
                        type="button"
                        onClick={() => {
                          if (!requireAuth()) return;
                          setUnits((prev) => prev.filter((u) => u.id !== selectedEntity.id));
                          clearSelection();
                          showToast("削除しました");
                        }}
                      >
                        削除
                      </button>
                    </div>

                    {/* ===== 画像登録 ===== */}
                    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
                      <div className="text-xs font-bold text-blue-700 mb-2">画像</div>
                      <input
                        type="file"
                        accept="image/*"
                        id="image-upload-input"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadImage(selectedEntity.id, file);
                          e.target.value = "";
                        }}
                      />
                      <button
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 font-medium"
                        type="button"
                        onClick={() => document.getElementById("image-upload-input")?.click()}
                      >
                        画像を登録
                      </button>
                      {(selectedEntity.images || []).length > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {(selectedEntity.images || []).map((img, idx) => (
                            <div key={img.fileId || idx} className="relative group">
                              <img
                                src={img.fileId ? `https://drive.google.com/thumbnail?id=${img.fileId}&sz=w200` : img.url}
                                alt=""
                                className="w-full h-16 object-cover rounded-lg border cursor-pointer"
                                onClick={() => window.open(img.fileId ? `https://drive.google.com/uc?export=view&id=${img.fileId}` : img.url, "_blank")}
                              />
                              <button
                                type="button"
                                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => deleteImage(selectedEntity.id, img.fileId)}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ===== 倉庫間移動 ===== */}
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

                    {/* ===== ステータス変更 ===== */}
                    <div className="border-t pt-2 pb-1">
                      <div className="text-xs text-gray-500 mb-1">ステータス</div>
                      <select
                        className="w-full rounded-xl border px-3 py-2 text-sm"
                        value={selectedEntity.status || "draft"}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          updateUnitField(selectedEntity.id, "status", newStatus, "ステータス変更");
                          if (newStatus === "in_transit" && !selectedEntity.transitStartDate) {
                            const now = new Date();
                            const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                            updateUnitFieldSilent(selectedEntity.id, "transitStartDate", localIso);
                          }
                        }}
                      >
                        <option value="draft">下書き</option>
                        <option value="in_transit">運行中</option>
                        <option value="in_stock">保管中</option>
                        <option value="planned_out">出荷予定</option>
                      </select>
                    </div>

                    {/* ===== 運行期間 ===== */}
                    <div className="border-t pt-2 pb-1">
                      <div className="text-xs text-gray-500 mb-1">運行期間</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-gray-400">開始日</div>
                          <input
                            type="datetime-local"
                            className="mt-0.5 w-full rounded-xl border px-2 py-1.5 text-sm"
                            value={selectedEntity.transitStartDate || ""}
                            onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "transitStartDate", e.target.value)}
                            onBlur={(e) => updateUnitField(selectedEntity.id, "transitStartDate", e.target.value, "運行開始日変更")}
                          />
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400">終了日（戻り予定）</div>
                          <input
                            type="datetime-local"
                            className="mt-0.5 w-full rounded-xl border px-2 py-1.5 text-sm"
                            value={selectedEntity.transitEndDate || ""}
                            onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "transitEndDate", e.target.value)}
                            onBlur={(e) => updateUnitField(selectedEntity.id, "transitEndDate", e.target.value, "運行終了日変更")}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ===== 見た目（色・透明度）— 折りたたみ（デフォルト閉） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, appearance: !s.appearance }))}
                      >
                        <span>見た目（色・透明度）</span>
                        <span className="text-gray-400">{panelSections.appearance ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.appearance && (
                        <div className="pb-2 space-y-3">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={selectedEntity.bgColor || "#ffffff"}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "bgColor", e.target.value)}
                              className="w-8 h-8 rounded cursor-pointer border"
                            />
                            <span className="text-xs text-gray-600">背景色</span>
                            {selectedEntity.bgColor && (
                              <button
                                type="button"
                                className="text-xs text-gray-400 hover:text-gray-600"
                                onClick={() => updateUnitFieldSilent(selectedEntity.id, "bgColor", "")}
                              >
                                リセット
                              </button>
                            )}
                          </div>
                          <div>
                            <label className="text-[10px] text-gray-500">背景透明度: {selectedEntity.bgOpacity ?? 100}%</label>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={selectedEntity.bgOpacity ?? 100}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "bgOpacity", Number(e.target.value))}
                              className="w-full h-2 bg-gray-300 rounded-lg cursor-pointer accent-blue-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ===== 荷物詳細（折りたたみ、デフォルト開） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, detail: !s.detail }))}
                      >
                        <span>荷物詳細</span>
                        <span className="text-gray-400">{panelSections.detail ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.detail && (
                        <div className="pb-2 space-y-2">
                          {/* 社内担当者名 */}
                          <div>
                            <div className="text-xs text-gray-500">社内担当者名</div>
                            <select
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.personInCharge || ""}
                              onChange={(e) => updateUnitField(selectedEntity.id, "personInCharge", e.target.value, "担当者変更")}
                            >
                              <option value="">（未設定）</option>
                              {personList.map((p) => (
                                <option key={p.id} value={p.name}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          {/* 顧客名 */}
                          <div>
                            <div className="text-xs text-gray-500">顧客名</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.client || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "client", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "client", e.target.value, "顧客名変更")}
                              placeholder="顧客名"
                            />
                          </div>
                          {/* 部署名 */}
                          <div>
                            <div className="text-xs text-gray-500">部署名</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.department || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "department", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "department", e.target.value, "部署名変更")}
                              placeholder="部署名"
                            />
                          </div>
                          {/* 顧客担当者名 */}
                          <div>
                            <div className="text-xs text-gray-500">顧客担当者名</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.clientContact || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "clientContact", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "clientContact", e.target.value, "顧客担当者名変更")}
                              placeholder="顧客担当者名"
                            />
                          </div>
                          {/* 荷物名(イベント名) */}
                          <div>
                            <div className="text-xs text-gray-500">荷物名(イベント名)</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.name || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "name", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "name", e.target.value, "荷物名変更")}
                              placeholder="荷物名"
                            />
                          </div>
                          {/* 荷物詳細 */}
                          <div>
                            <div className="text-xs text-gray-500">荷物詳細</div>
                            <textarea
                              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm resize-none"
                              rows={2}
                              value={selectedEntity.notes || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "notes", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "notes", e.target.value, "荷物詳細変更")}
                              placeholder="荷物の詳細情報"
                            />
                          </div>
                          {/* 入庫日 */}
                          <div>
                            <div className="text-xs text-gray-500">入庫日</div>
                            <input
                              type="datetime-local"
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.arrivalDate || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "arrivalDate", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "arrivalDate", e.target.value, "入庫日変更")}
                            />
                          </div>
                          {/* 出庫予定日 */}
                          <div>
                            <div className="text-xs text-gray-500">出庫予定日</div>
                            <input
                              type="datetime-local"
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.departureDate || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "departureDate", e.target.value)}
                              onBlur={(e) => updateUnitField(selectedEntity.id, "departureDate", e.target.value, "出庫予定日変更")}
                            />
                          </div>
                          {/* 保管場所（表示のみ） */}
                          <div>
                            <div className="text-xs text-gray-500">保管場所</div>
                            <div className="mt-1 text-sm text-gray-700">
                              {(() => {
                                const loc = selectedEntity.loc;
                                if (!loc || loc.kind === "unplaced") return "未配置";
                                if (loc.kind === "floor") {
                                  const zone = (layout.zones || []).find((z) => (!z.loc || z.loc.kind === "floor") && loc.x >= z.x && loc.y >= z.y && loc.x < z.x + z.w && loc.y < z.y + z.h);
                                  return `${wh.name} 床${zone ? ` ${zone.name}` : ""}`;
                                }
                                if (loc.kind === "shelf") {
                                  const shelf = (layout.shelves || []).find((s) => s.id === loc.shelfId);
                                  const shelfZone = (layout.zones || []).find((z) => z.loc?.kind === "shelf" && z.loc.shelfId === loc.shelfId && loc.x >= (z.loc.x || 0) && loc.y >= (z.loc.y || 0) && loc.x < (z.loc.x || 0) + z.w && loc.y < (z.loc.y || 0) + z.h);
                                  return `${wh.name} ${shelf?.name || "棚"}${shelfZone ? ` ${shelfZone.name}` : ""}`;
                                }
                                if (loc.kind === "rack") {
                                  const rack = layout.racks.find((r) => r.id === loc.rackId);
                                  return `${wh.name} ラック${rack?.name || loc.rackId}`;
                                }
                                return "不明";
                              })()}
                            </div>
                          </div>
                          {/* サイズ */}
                          <div>
                            <div className="text-xs text-gray-500">サイズ</div>
                            <div className="grid grid-cols-3 gap-2 mt-1">
                              <div>
                                <div className="text-[10px] text-gray-400">幅(m)</div>
                                <input
                                  className="w-full rounded-lg border px-2 py-1 text-sm"
                                  type="number" min="0.1" step="0.1"
                                  value={selectedEntity.w_m}
                                  onChange={(e) => {
                                    const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                    const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_w || 1.2)));
                                    updateUnitFieldSilent(selectedEntity.id, "w_m", +v.toFixed(2));
                                    updateUnitFieldSilent(selectedEntity.id, "w_cells", cells);
                                  }}
                                />
                              </div>
                              <div>
                                <div className="text-[10px] text-gray-400">奥行(m)</div>
                                <input
                                  className="w-full rounded-lg border px-2 py-1 text-sm"
                                  type="number" min="0.1" step="0.1"
                                  value={selectedEntity.d_m}
                                  onChange={(e) => {
                                    const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                    const cells = Math.max(1, Math.ceil(v / (layout.floor.cell_m_d || 1.0)));
                                    updateUnitFieldSilent(selectedEntity.id, "d_m", +v.toFixed(2));
                                    updateUnitFieldSilent(selectedEntity.id, "h_cells", cells);
                                  }}
                                />
                              </div>
                              <div>
                                <div className="text-[10px] text-gray-400">高さ(m)</div>
                                <input
                                  className="w-full rounded-lg border px-2 py-1 text-sm"
                                  type="number" min="0.1" step="0.1"
                                  value={selectedEntity.h_m}
                                  onChange={(e) => {
                                    const v = Math.max(0.1, Number(e.target.value) || 0.1);
                                    updateUnitFieldSilent(selectedEntity.id, "h_m", +v.toFixed(2));
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          {/* 重量(kg) */}
                          <div>
                            <div className="text-xs text-gray-500">重量(kg)</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              type="number" min="0" step="0.1"
                              value={selectedEntity.weight_kg || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "weight_kg", Number(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </div>
                          {/* kintoneレコードID */}
                          <div>
                            <div className="text-xs text-gray-500">kintoneレコードID</div>
                            <input
                              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                              value={selectedEntity.kintoneRecordId || ""}
                              onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "kintoneRecordId", e.target.value)}
                              onBlur={(e) => updateUnitFieldSilent(selectedEntity.id, "kintoneRecordId", e.target.value)}
                              placeholder="レコードID"
                            />
                          </div>
                          {/* 重ね置きOK */}
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!!selectedEntity.stackable}
                                onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "stackable", e.target.checked)}
                                className="accent-blue-600"
                              />
                              <span className="text-xs text-gray-700">重ね置きOK</span>
                            </label>
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

                    {/* ===== 荷物料金 ===== */}
                    <div className="border-t pt-2 pb-1">
                      <div className="text-xs font-semibold text-gray-700 mb-1">料金</div>
                      {(() => {
                        const b = calcUnitBilling(selectedEntity);
                        return (
                          <div className="space-y-1.5 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">計算方式:</span>
                              <select
                                className="rounded-lg border px-2 py-0.5 text-xs"
                                value={selectedEntity.billingType || "daily"}
                                onChange={(e) => updateUnitFieldSilent(selectedEntity.id, "billingType", e.target.value)}
                              >
                                <option value="daily">日額</option>
                                <option value="monthly">月額</option>
                              </select>
                            </div>
                            <div className="flex justify-between"><span className="text-gray-500">単価</span><span>¥{b.rate.toLocaleString()}/{b.billingType === "monthly" ? "月" : "日"}</span></div>
                            {selectedEntity.arrivalDate ? (
                              <>
                                <div className="flex justify-between"><span className="text-gray-500">保管期間</span><span>{b.storageDays}日{b.billingType === "monthly" ? ` (${b.storageMonths}ヶ月)` : ""}</span></div>
                                {b.qty > 1 && <div className="flex justify-between"><span className="text-gray-500">数量</span><span>{b.qty}</span></div>}
                                <div className="flex justify-between font-semibold text-sm"><span>合計</span><span>¥{b.amount.toLocaleString()}</span></div>
                              </>
                            ) : (
                              <div className="text-gray-400">入荷日が未設定のため計算できません</div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* ===== 編集履歴（折りたたみ、デフォルト閉） ===== */}
                    <div className="border-t">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between py-2 text-xs font-semibold text-gray-700 hover:text-gray-900"
                        onClick={() => setPanelSections((s) => ({ ...s, editHistory: !s.editHistory }))}
                      >
                        <span>編集履歴（{(selectedEntity.editHistory || []).length}件）</span>
                        <span className="text-gray-400">{panelSections.editHistory ? "\u25BC" : "\u25B6"}</span>
                      </button>
                      {panelSections.editHistory && (
                        <div className="pb-2 space-y-1 max-h-48 overflow-y-auto">
                          {[...(selectedEntity.editHistory || [])].reverse().map((h, idx) => (
                            <div key={idx} className="rounded-lg border p-1.5 text-xs">
                              <div className="flex justify-between text-gray-500">
                                <span>{new Date(h.timestamp).toLocaleString("ja-JP")}</span>
                                <span className="font-medium text-gray-700">{h.action}</span>
                              </div>
                              {h.by && (
                                <div className="text-indigo-600 mt-0.5">by {h.by}</div>
                              )}
                              {h.field && (
                                <div className="mt-0.5">
                                  <span className="text-gray-600">{h.field}: </span>
                                  <span className="text-red-500">{h.oldValue == null || h.oldValue === "" ? "(空)" : String(h.oldValue)}</span>
                                  <span className="text-gray-400"> → </span>
                                  <span className="text-green-600">{h.newValue == null || h.newValue === "" ? "(空)" : String(h.newValue)}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <SectionTitle>請求サマリー</SectionTitle>
            <div className="space-y-2">
              {clientBillingSummary.length === 0 && <div className="text-xs text-gray-400">請求対象がありません</div>}
              {clientBillingSummary.map((cs) => (
                <div key={cs.client} className="rounded-lg border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{cs.client}</div>
                    <div className="font-bold text-blue-600">¥{cs.total.toLocaleString()}</div>
                  </div>
                  {cs.zones.length > 0 && (
                    <div className="mt-1 text-gray-500">
                      区画: {cs.zones.length}件 ¥{cs.zoneTotal.toLocaleString()}/月
                    </div>
                  )}
                  {cs.units.length > 0 && (
                    <div className="mt-0.5 text-gray-500">
                      荷物: {cs.units.length}件 ¥{cs.unitTotal.toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
                <Badge>{detailUnit.kind}</Badge>
                <Badge color={getStatusColor(detailUnit.status)}>
                  {getStatusLabel(detailUnit.status)}
                </Badge>
                {detailUnit.weight_kg > 0 && <Badge>{detailUnit.weight_kg}kg</Badge>}
              </div>
            </div>

            {(detailUnit.images || []).length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">画像</div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {(detailUnit.images || []).map((img, idx) => (
                    <img
                      key={img.fileId || idx}
                      src={img.fileId ? `https://drive.google.com/thumbnail?id=${img.fileId}&sz=w200` : img.url}
                      alt=""
                      className="h-20 w-20 object-cover rounded-lg border flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => window.open(img.fileId ? `https://drive.google.com/uc?export=view&id=${img.fileId}` : img.url, "_blank")}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500">社内担当者名</div>
                <div className="text-sm">{detailUnit.personInCharge || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">顧客名</div>
                <div className="text-sm">{detailUnit.client || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">部署名</div>
                <div className="text-sm">{detailUnit.department || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">顧客担当者名</div>
                <div className="text-sm">{detailUnit.clientContact || "-"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-500">荷物名(イベント名)</div>
                <div className="text-sm">{detailUnit.name || "-"}</div>
              </div>
            </div>

            {detailUnit.notes && (
              <div>
                <div className="text-xs text-gray-500">荷物詳細</div>
                <div className="mt-1 rounded-xl border bg-gray-50 p-3 text-sm">
                  {detailUnit.notes}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div>
                <div className="text-xs text-gray-500">入庫日</div>
                <div className="text-sm">
                  {detailUnit.arrivalDate
                    ? new Date(detailUnit.arrivalDate).toLocaleString("ja-JP")
                    : "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">出庫予定日</div>
                <div className="text-sm">
                  {detailUnit.departureDate
                    ? new Date(detailUnit.departureDate).toLocaleString("ja-JP")
                    : "-"}
                </div>
              </div>
              {detailUnit.status === "in_transit" && (
                <div className="col-span-2">
                  <div className="text-xs text-gray-500">運行期間</div>
                  <div className="text-sm">
                    {detailUnit.transitStartDate
                      ? new Date(detailUnit.transitStartDate).toLocaleString("ja-JP")
                      : "-"}
                    {" 〜 "}
                    {detailUnit.transitEndDate
                      ? new Date(detailUnit.transitEndDate).toLocaleString("ja-JP")
                      : "-"}
                  </div>
                </div>
              )}
              <div className="col-span-2">
                <div className="text-xs text-gray-500">保管場所</div>
                <div className="text-sm">
                  {(() => {
                    const loc = detailUnit.loc;
                    if (!loc || loc.kind === "unplaced") return "未配置";
                    if (loc.kind === "floor") {
                      const zone = (layout.zones || []).find((z) => (!z.loc || z.loc.kind === "floor") && loc.x >= z.x && loc.y >= z.y && loc.x < z.x + z.w && loc.y < z.y + z.h);
                      return `${wh.name} 床${zone ? ` ${zone.name}` : ""}`;
                    }
                    if (loc.kind === "shelf") {
                      const shelf = (layout.shelves || []).find((s) => s.id === loc.shelfId);
                      const shelfZone = (layout.zones || []).find((z) => z.loc?.kind === "shelf" && z.loc.shelfId === loc.shelfId && loc.x >= (z.loc.x || 0) && loc.y >= (z.loc.y || 0) && loc.x < (z.loc.x || 0) + z.w && loc.y < (z.loc.y || 0) + z.h);
                      return `${wh.name} ${shelf?.name || "棚"}${shelfZone ? ` ${shelfZone.name}` : ""}`;
                    }
                    if (loc.kind === "rack") {
                      const rack = layout.racks.find((r) => r.id === loc.rackId);
                      return `${wh.name} ラック${rack?.name || loc.rackId}`;
                    }
                    return "不明";
                  })()}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">サイズ(W×D×H)</div>
                <div className="text-sm">
                  {detailUnit.w_m}×{detailUnit.d_m}×{detailUnit.h_m}m
                  ({(detailUnit.w_m * detailUnit.d_m * detailUnit.h_m).toFixed(3)}m³)
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">重量(kg)</div>
                <div className="text-sm">{detailUnit.weight_kg || 0}kg</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">kintoneレコードID</div>
                <div className="text-sm">{detailUnit.kintoneRecordId || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">数量</div>
                <div className="text-sm">{detailUnit.qty}</div>
              </div>
            </div>

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
                      {h.by && (
                        <div className="text-indigo-600 mt-0.5">by {h.by}</div>
                      )}
                      {h.field && (
                        <div className="mt-1">
                          <span className="text-gray-600">{h.field}: </span>
                          <span className="text-red-500">{h.oldValue == null || h.oldValue === "" ? "(空)" : String(h.oldValue)}</span>
                          <span className="text-gray-400"> → </span>
                          <span className="text-green-600">{h.newValue == null || h.newValue === "" ? "(空)" : String(h.newValue)}</span>
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

      {/* 料金設定モーダル */}
      <Modal
        title="料金設定"
        open={pricingModalOpen}
        onClose={() => setPricingModalOpen(false)}
        maxWidth="22rem"
      >
        <div className="space-y-5">
          {/* デフォルト単価 */}
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-3">デフォルト単価</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600 whitespace-nowrap">区画 坪/月</span>
                <input
                  className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                  type="number" min="0" inputMode="numeric"
                  value={pricing.defaultRates?.zoneMonthlyPerTsubo ?? 5000}
                  onChange={(e) => setPricing((p) => ({ ...p, defaultRates: { ...p.defaultRates, zoneMonthlyPerTsubo: Number(e.target.value) || 0 } }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600 whitespace-nowrap">荷物 個/日</span>
                <input
                  className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                  type="number" min="0" inputMode="numeric"
                  value={pricing.defaultRates?.unitDailyRate ?? 100}
                  onChange={(e) => setPricing((p) => ({ ...p, defaultRates: { ...p.defaultRates, unitDailyRate: Number(e.target.value) || 0 } }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-600 whitespace-nowrap">荷物 個/月</span>
                <input
                  className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                  type="number" min="0" inputMode="numeric"
                  value={pricing.defaultRates?.unitMonthlyRate ?? 2500}
                  onChange={(e) => setPricing((p) => ({ ...p, defaultRates: { ...p.defaultRates, unitMonthlyRate: Number(e.target.value) || 0 } }))}
                />
              </div>
            </div>
          </div>

          {/* 取引先別単価 */}
          <div className="border-t pt-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">取引先別単価</div>
            <div className="space-y-4 max-h-[50vh] overflow-y-auto">
              {(() => {
                const clientSet = new Set();
                layout.zones.forEach((z) => z.client && clientSet.add(z.client));
                units.forEach((u) => u.client && u.client !== "(未設定)" && clientSet.add(u.client));
                const clients = [...clientSet].sort();
                if (clients.length === 0) return <div className="text-sm text-gray-400">取引先が未登録です</div>;
                return clients.map((c) => {
                  const cr = pricing.clientRates?.[c] || {};
                  const updateCR = (field, val) => {
                    setPricing((p) => ({
                      ...p,
                      clientRates: {
                        ...p.clientRates,
                        [c]: { ...(p.clientRates?.[c] || {}), [field]: val },
                      },
                    }));
                  };
                  return (
                    <div key={c} className="rounded-xl border p-3">
                      <div className="text-sm font-semibold mb-2.5">{c}</div>
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 whitespace-nowrap">坪/月</span>
                          <input
                            className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                            type="number" min="0" inputMode="numeric"
                            value={cr.zoneMonthlyPerTsubo ?? ""}
                            placeholder={String(pricing.defaultRates?.zoneMonthlyPerTsubo ?? 5000)}
                            onChange={(e) => updateCR("zoneMonthlyPerTsubo", e.target.value === "" ? undefined : Number(e.target.value))}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 whitespace-nowrap">個/日</span>
                          <input
                            className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                            type="number" min="0" inputMode="numeric"
                            value={cr.unitDailyRate ?? ""}
                            placeholder={String(pricing.defaultRates?.unitDailyRate ?? 100)}
                            onChange={(e) => updateCR("unitDailyRate", e.target.value === "" ? undefined : Number(e.target.value))}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 whitespace-nowrap">個/月</span>
                          <input
                            className="w-28 rounded-xl border px-3 py-1.5 text-sm text-right"
                            type="number" min="0" inputMode="numeric"
                            value={cr.unitMonthlyRate ?? ""}
                            placeholder={String(pricing.defaultRates?.unitMonthlyRate ?? 2500)}
                            onChange={(e) => updateCR("unitMonthlyRate", e.target.value === "" ? undefined : Number(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </Modal>

      {/* 請求書モーダル */}
      <Modal
        title="請求書作成"
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        maxWidth="28rem"
      >
        {(() => {
          const billingData = (invoicePeriod.start && invoicePeriod.end)
            ? getFilteredBillingData(invoicePeriod.start, invoicePeriod.end, invoiceFilters)
            : [];
          // フィルタ用選択肢を自動検出
          const allClients = [...new Set([
            ...layout.zones.map((z) => z.client).filter(Boolean),
            ...units.filter((u) => u.arrivalDate && (u.loc?.kind === "floor" || u.loc?.kind === "rack" || u.loc?.kind === "shelf")).map((u) => u.client).filter(Boolean),
          ])].sort();
          const filteredUnits = units.filter((u) => u.arrivalDate && (u.loc?.kind === "floor" || u.loc?.kind === "rack" || u.loc?.kind === "shelf"));
          const allDepartments = [...new Set(
            filteredUnits
              .filter((u) => !invoiceFilters.client || u.client === invoiceFilters.client)
              .map((u) => u.department).filter(Boolean)
          )].sort();
          const allPersons = [...new Set(
            filteredUnits
              .filter((u) => !invoiceFilters.client || u.client === invoiceFilters.client)
              .filter((u) => !invoiceFilters.department || u.department === invoiceFilters.department)
              .map((u) => u.personInCharge).filter(Boolean)
          )].sort();
          const grandTotal = billingData.reduce((s, c) => s + c.total, 0);
          return (
            <div className="space-y-4">
              {/* 請求期間 */}
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: "#64748b" }}>請求期間</div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    className="rounded-lg border px-2 py-1.5 text-sm flex-1"
                    style={{ borderColor: "#e2e8f0" }}
                    value={invoicePeriod.start}
                    onChange={(e) => setInvoicePeriod((p) => ({ ...p, start: e.target.value }))}
                  />
                  <span className="text-gray-400 text-sm">〜</span>
                  <input
                    type="date"
                    className="rounded-lg border px-2 py-1.5 text-sm flex-1"
                    style={{ borderColor: "#e2e8f0" }}
                    value={invoicePeriod.end}
                    onChange={(e) => setInvoicePeriod((p) => ({ ...p, end: e.target.value }))}
                  />
                </div>
              </div>
              {/* フィルタ */}
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: "#64748b" }}>フィルタ</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-16 text-gray-500 shrink-0">顧客名</span>
                    <select
                      className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={invoiceFilters.client}
                      onChange={(e) => setInvoiceFilters({ client: e.target.value, department: "", personInCharge: "" })}
                    >
                      <option value="">すべて</option>
                      {allClients.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-16 text-gray-500 shrink-0">部署名</span>
                    <select
                      className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={invoiceFilters.department}
                      onChange={(e) => setInvoiceFilters((p) => ({ ...p, department: e.target.value, personInCharge: "" }))}
                    >
                      <option value="">すべて</option>
                      {allDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-16 text-gray-500 shrink-0">担当者名</span>
                    <select
                      className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
                      style={{ borderColor: "#e2e8f0" }}
                      value={invoiceFilters.personInCharge}
                      onChange={(e) => setInvoiceFilters((p) => ({ ...p, personInCharge: e.target.value }))}
                    >
                      <option value="">すべて</option>
                      {allPersons.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              {/* プレビュー */}
              <div>
                <div className="text-xs font-semibold mb-1" style={{ color: "#64748b", borderBottom: "1px solid #e2e8f0", paddingBottom: 4 }}>プレビュー</div>
                {billingData.length === 0 ? (
                  <div className="text-xs text-gray-400 py-2">該当する請求データがありません</div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {billingData.map((cs) => (
                      <div key={cs.client} className="rounded-lg border p-2 text-xs">
                        <div className="font-semibold">{cs.client}</div>
                        {cs.zones.length > 0 && (
                          <div className="text-gray-500 mt-0.5">
                            区画: {cs.zones.length}件 ¥{cs.zoneTotal.toLocaleString()}
                          </div>
                        )}
                        {cs.units.length > 0 && (
                          <div className="text-gray-500 mt-0.5">
                            荷物: {cs.units.length}件 ¥{cs.unitTotal.toLocaleString()}
                          </div>
                        )}
                        <div className="text-right font-bold text-blue-600 mt-1">
                          合計: ¥{cs.total.toLocaleString()}
                        </div>
                      </div>
                    ))}
                    {billingData.length > 1 && (
                      <div className="text-right text-xs font-bold pt-1" style={{ borderTop: "1px solid #e2e8f0", color: "#1e40af" }}>
                        総合計: ¥{grandTotal.toLocaleString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* 生成ボタン */}
              <button
                type="button"
                className="w-full rounded-xl py-2.5 text-sm font-bold text-white"
                style={{
                  background: billingData.length > 0 ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "#cbd5e1",
                  cursor: billingData.length > 0 ? "pointer" : "not-allowed",
                  border: "none",
                }}
                disabled={billingData.length === 0}
                onClick={() => {
                  for (const cs of billingData) {
                    generateInvoiceForPeriod(cs, invoicePeriod.start, invoicePeriod.end);
                  }
                }}
              >
                請求書を生成{billingData.length > 0 ? `（${billingData.length}件）` : ""}
              </button>
            </div>
          );
        })()}
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

        // === 3Dビュー用の計算（getIsoMathで統合） ===
        const isoMath = zoneDetail3D ? getIsoMath(z.w, z.h, zoneDetailRotStep) : null;
        const isoViewItems = zoneUnits.map((u) => ({ ...u, gx: u._localX, gy: u._localY, fw: u._realW, fh: u._realH }));

        // 区画内重ね置きスナップ（ローカル座標）
        const snapToZoneStackTarget = (lx, ly, dragUnitId) => {
          const SNAP_DIST = 1.2;
          let best = null, bestDist = SNAP_DIST;
          for (const zu of zoneUnits) {
            if (zu.id === dragUnitId) continue;
            if (!zu.stackable) continue;
            const dist = Math.abs(lx - zu._localX) + Math.abs(ly - zu._localY);
            if (dist < bestDist) {
              bestDist = dist;
              best = { x: zu._localX, y: zu._localY, targetId: zu.id };
            }
          }
          return best;
        };

        // ドラッグ中の移動先ローカル座標を計算するヘルパー
        const SUB = 4; // 4分割サブグリッド（0.25セル刻み）
        const calcDragTarget = (d) => {
          let rawX, rawY;
          if (zoneDetail3D && isoMath) {
            const { tileW, tileH, invRotDelta } = isoMath;
            const zm = zoneDetailZoom;
            const dsx = (d.pointerX - d.startX) / zm;
            const dsy = (d.pointerY - d.startY) / zm;
            const drgx = dsx / tileW + dsy / tileH;
            const drgy = dsy / tileH - dsx / tileW;
            const { dgx, dgy } = invRotDelta(drgx, drgy);
            rawX = Math.round((d.baseLocalX + dgx) * SUB) / SUB;
            rawY = Math.round((d.baseLocalY + dgy) * SUB) / SUB;
          } else {
            const dx = d.pointerX - d.startX;
            const dy = d.pointerY - d.startY;
            rawX = Math.round((d.baseLocalX + dx / zoneCellPx) * SUB) / SUB;
            rawY = Math.round((d.baseLocalY + dy / zoneCellPx) * SUB) / SUB;
          }
          // 重ね置きスナップ
          const snap = snapToZoneStackTarget(rawX, rawY, d.unitId);
          if (snap) return { x: snap.x, y: snap.y, stackTargetId: snap.targetId };
          return { x: rawX, y: rawY, stackTargetId: null };
        };

        // ドラッグ中のゴースト位置計算（2D/3D共通）
        const ghost = (() => {
          if (!zoneDetailDrag) return null;
          const d = zoneDetailDrag;
          const { x: newLocalX, y: newLocalY, stackTargetId } = calcDragTarget(d);
          const u = units.find((uu) => uu.id === d.unitId);
          if (!u) return null;
          const ok = canPlaceInZone(z, u, newLocalX, newLocalY, u.id, realFP);
          const fp = realFP(u);
          return { x: newLocalX, y: newLocalY, w: fp.w, h: fp.h, ok, unitId: u.id, stackTargetId };
        })();

        // ドラッグ中のユニットかどうか
        const draggingId = zoneDetailDrag?.unitId;
        const hasDragMoved = zoneDetailDrag && (zoneDetailDrag.pointerX !== zoneDetailDrag.startX || zoneDetailDrag.pointerY !== zoneDetailDrag.startY);

        // ドロップ処理（2D/3D共通）
        const handleDrop = () => {
          if (!zoneDetailDrag) return;
          if (!requireAuth()) { setZoneDetailDrag(null); return; }
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
                ? units.filter((s) => s.id !== u.id && s.loc?.kind === "shelf" && s.loc.shelfId === z.loc.shelfId).filter((s) => { const sfp = realFP(s); return containsRectLoose({ x: s.loc.x||0, y: s.loc.y||0, w: sfp.w, h: sfp.h }, candidate); })
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
              if (z.reserved && z.reservationEndDate) {
                const _today = new Date(); _today.setHours(0,0,0,0);
                const _endD = new Date(z.reservationEndDate); _endD.setHours(0,0,0,0);
                const _diff = Math.ceil((_endD - _today) / (1000*60*60*24));
                if (_diff <= 1) {
                  showToast("予約期限間近のため配置できません（予約OFFにするか期限を延長してください）");
                } else {
                  showToast("ここには置けません（他の荷物と重なっています）");
                }
              } else {
                showToast("ここには置けません（他の荷物と重なっています）");
              }
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
                      const isStackTarget = ghost && ghost.stackTargetId === u.id;
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
                            border: isStackTarget ? "3px solid #3b82f6" : "2px solid " + (u.bgColor || "#e2e8f0"),
                            borderRadius: 12,
                            cursor: "grab",
                            boxShadow: isStackTarget ? "0 0 16px 4px rgba(59,130,246,0.5)" : "0 4px 12px -2px rgba(0,0,0,0.08)",
                            opacity: isDrag ? 0.4 : 1,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                            zIndex: 5 + (u.stackZ || 0),
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

              {/* === 3Dアイソメトリックビュー（Iso3DView統合） === */}
              {zoneDetail3D && isoMath && (() => {
                // ゴースト計算
                const isoGhost = (ghost && hasDragMoved) ? (() => {
                  const u = units.find((uu) => uu.id === ghost.unitId);
                  if (!u) return null;
                  const rfp = realFP(u);
                  const { rx, ry, rw, rh } = isoMath.rotateRect(ghost.x, ghost.y, rfp.w, rfp.h);
                  return { gx: rx, gy: ry, fw: rw, fh: rh, ok: ghost.ok, h: u.h_m || 1 };
                })() : null;

                return (
                  <div className="px-5 py-4 flex justify-center">
                    <Iso3DView
                      viewCols={z.w} viewRows={z.h} viewBgColor={z.bgColor || "#d1fae5"}
                      viewItems={isoViewItems}
                      rotStep={zoneDetailRotStep} zoom={zoneDetailZoom} onZoomChange={setZoneDetailZoom}
                      blinkingUnitIds={blinkingUnitIds} maxHeight="60vh"
                      onUnitMouseDown={(e, u) => startDragUnit(e, u)}
                      onUnitDoubleClick={(e, u) => openDetailModal(u)}
                      draggingId={draggingId} hasDragMoved={hasDragMoved}
                      ghostBox={isoGhost}
                      stackTargetId={ghost?.stackTargetId || null}
                    />
                  </div>
                );
              })()}

              {/* フッター情報 */}
              <div className="border-t px-5 py-3 text-xs text-gray-500 flex justify-between">
                <span>ドラッグで移動 / ダブルクリックで詳細</span>
                <span>{zoneUnits.length} 個の荷物</span>
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
  const { isLoggedIn, displayName, loading: authLoading, signOut } = useAuth();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [editingSiteName, setEditingSiteName] = useState(null);

  const [view, setView] = useState("map"); // map | warehouse
  const [activeWarehouseId, setActiveWarehouseId] = useState(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(null); // 地図上で選択中の倉庫

  const [topViewMode, setTopViewMode] = useState(() => {
    try { return localStorage.getItem("wh_top_view_mode") || "map"; } catch { return "map"; }
  });
  useEffect(() => { try { localStorage.setItem("wh_top_view_mode", topViewMode); } catch {} }, [topViewMode]);

  // --- 荷物検索 ---
  const [unitSearchOpen, setUnitSearchOpen] = useState(false);
  const [unitSearchQuery, setUnitSearchQuery] = useState("");
  const [unitSearchKey, setUnitSearchKey] = useState("all");
  const [pendingFocusUnit, setPendingFocusUnit] = useState(null); // { unitId, whId, ts }
  const [searchRefreshKey, setSearchRefreshKey] = useState(0);

  const [site, setSite] = useSupabaseState("wh_demo_site_v1", {
    id: "site-1",
    name: "手塚運輸倉庫システム",
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

  // マップコールバック（安定参照）
  const handleMapSelect = useCallback((id) => setSelectedWarehouseId(id), []);
  const handleMapPositionChange = useCallback((id, lat, lng) => {
    setWarehouses((prev) =>
      prev.map((wh) => (wh.id === id ? { ...wh, lat, lng } : wh))
    );
  }, [setWarehouses]);
  const handleMapDoubleClick = useCallback((id) => {
    setActiveWarehouseId(id);
    setView("warehouse");
  }, []);

  // --- 荷物検索: 全倉庫ユニット取得 ---
  const allUnitsForSearch = useMemo(() => {
    void searchRefreshKey; // 依存に含めて再計算トリガー
    const result = [];
    for (const w of warehouses) {
      try {
        const raw = JSON.parse(localStorage.getItem(`wh_demo_units_${w.id}_v1`)) || [];
        for (const u of raw) {
          result.push({ ...u, _whName: w.name, _whId: w.id });
        }
      } catch { /* skip */ }
    }
    return result;
  }, [warehouses, searchRefreshKey]);

  const unitSearchResults = useMemo(() => {
    const q = unitSearchQuery.trim().toLowerCase();
    if (!q) return [];
    const match = (val) => val && typeof val === "string" && val.toLowerCase().includes(q);
    const exact = (val) => val && typeof val === "string" && val === unitSearchQuery.trim();
    return allUnitsForSearch.filter((u) => {
      if (unitSearchKey === "all") {
        return match(u.client) || match(u.department) || match(u.personInCharge) || match(u.clientContact) || match(u.name) || match(u.kind) || match(u.notes) || match(u._whName);
      }
      if (unitSearchKey === "status") return exact(u.status);
      if (unitSearchKey === "personInCharge") return exact(u.personInCharge);
      return match(u[unitSearchKey]);
    });
  }, [allUnitsForSearch, unitSearchQuery, unitSearchKey]);

  function openUnitSearch() {
    setSearchRefreshKey((k) => k + 1);
    setUnitSearchOpen(true);
  }

  function navigateToUnit(unit) {
    setUnitSearchOpen(false);
    setUnitSearchQuery("");
    const targetWhId = unit._whId;
    const ts = Date.now();
    setPendingFocusUnit({ unitId: unit.id, whId: targetWhId, ts });
    if (view !== "warehouse" || activeWarehouseId !== targetWhId) {
      setActiveWarehouseId(targetWhId);
      setView("warehouse");
    }
  }

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
    if (!isLoggedIn) { return; }
    setWarehouses((prev) => prev.filter((w) => w.id !== id));
    if (editId === id) {
      setEditOpen(false);
      setEditId(null);
    }
  }

  function addWarehouse() {
    if (!isLoggedIn) { return; }
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
    if (!isLoggedIn) { return; }
    setWarehouses((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  }, [isLoggedIn]);

  if (view === "warehouse" && activeWarehouse) {
    return (
      <>
      <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />
      <WarehouseView
        key={activeWarehouseId}
        wh={activeWarehouse}
        onBack={() => {
          setView("map");
          setActiveWarehouseId(null);
        }}
        onUpdateWarehouse={updateWarehouse}
        site={site}
        onUpdateSite={setSite}
        warehouses={warehouses}
        onSwitchWarehouse={(id) => setActiveWarehouseId(id)}
        isLoggedIn={isLoggedIn}
        displayName={displayName}
        onLoginClick={() => setLoginModalOpen(true)}
        onLogout={signOut}
        pendingFocusUnit={pendingFocusUnit}
        onFocusUnitHandled={() => setPendingFocusUnit(null)}
        onOpenUnitSearch={openUnitSearch}
      />
      <UnitSearchModal
        open={unitSearchOpen}
        onClose={() => setUnitSearchOpen(false)}
        query={unitSearchQuery}
        setQuery={setUnitSearchQuery}
        searchKey={unitSearchKey}
        setSearchKey={setUnitSearchKey}
        results={unitSearchResults}
        onNavigate={navigateToUnit}
        allUnits={allUnitsForSearch}
      />
      </>
    );
  }

  return (
    <div className="h-screen w-full bg-gray-50">
      {/* LoginModal */}
      <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid #e2e8f0", background: "linear-gradient(to right, #ffffff, #f8fafc)" }}>
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-xl border-2 shadow-sm" style={{ borderColor: "#6366f1" }}>
            {[["map", "マップ"], ["simple", "一覧"]].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                style={topViewMode === mode
                  ? { padding: "8px 18px", fontSize: "14px", fontWeight: 700, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "white", border: "none", cursor: "pointer" }
                  : { padding: "8px 18px", fontSize: "14px", fontWeight: 600, background: "white", color: "#6366f1", border: "none", cursor: "pointer" }
                }
                onClick={() => setTopViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #dbeafe, #e0e7ff)", color: "#4338ca", borderColor: "#818cf8", cursor: "pointer" }}
            title="倉庫を追加"
            onClick={addWarehouse}
          >
            ＋ 倉庫追加
          </button>
          <button
            type="button"
            className="rounded-xl border-2 shadow-sm font-bold"
            style={{ padding: "8px 16px", fontSize: "14px", background: "linear-gradient(135deg, #fef3c7, #fde68a)", color: "#92400e", borderColor: "#fbbf24", cursor: "pointer" }}
            onClick={openUnitSearch}
          >
            荷物検索
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {editingSiteName != null ? (
            <input
              autoFocus
              style={{ fontSize: "22px", fontWeight: 800, color: "#1e293b", letterSpacing: "0.02em", textAlign: "center", border: "2px solid #6366f1", borderRadius: "8px", padding: "2px 12px", outline: "none", background: "#f8fafc", width: "320px" }}
              value={editingSiteName}
              onChange={(e) => setEditingSiteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = editingSiteName.trim();
                  if (v) setSite((s) => ({ ...s, name: v }));
                  setEditingSiteName(null);
                } else if (e.key === "Escape") {
                  setEditingSiteName(null);
                }
              }}
              onBlur={() => {
                const v = editingSiteName.trim();
                if (v) setSite((s) => ({ ...s, name: v }));
                setEditingSiteName(null);
              }}
            />
          ) : (
            <span
              style={{ fontSize: "22px", fontWeight: 800, color: "#1e293b", letterSpacing: "0.02em", cursor: "pointer", borderBottom: "2px dashed transparent" }}
              onMouseEnter={(e) => e.currentTarget.style.borderBottomColor = "#c7d2fe"}
              onMouseLeave={(e) => e.currentTarget.style.borderBottomColor = "transparent"}
              onClick={() => setEditingSiteName(site.name)}
              title="クリックで名前を変更"
            >{site.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          {/* Auth UI */}
          <div className="ml-2 border-l pl-2 flex items-center gap-2">
            {isLoggedIn ? (
              <>
                <span style={{ background: "linear-gradient(135deg, #e0e7ff, #ede9fe)", color: "#4338ca", borderRadius: "20px", padding: "4px 12px", fontSize: "12px", fontWeight: 600 }}>{displayName}</span>
                <button type="button" onClick={signOut} style={{ borderRadius: "8px", padding: "4px 8px", fontSize: "11px", color: "#9ca3af", background: "none", border: "none", cursor: "pointer" }}>ログアウト</button>
              </>
            ) : (
              <button type="button" onClick={() => setLoginModalOpen(true)} style={{ borderRadius: "20px", padding: "6px 16px", fontSize: "12px", fontWeight: 600, color: "white", background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>ログイン</button>
            )}
          </div>
        </div>
      </div>

      {/* 閲覧モードバナー */}
      {!isLoggedIn && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", background: "linear-gradient(90deg, #fef3c7, #fde68a)", borderBottom: "1px solid #fcd34d", padding: "8px 16px", fontSize: "13px", color: "#92400e" }}>
          <span style={{ fontSize: "16px" }}>👀</span>
          <span>閲覧モード — 編集するにはログインしてください</span>
          <button type="button" onClick={() => setLoginModalOpen(true)} style={{ borderRadius: "16px", padding: "3px 12px", fontSize: "12px", fontWeight: 600, color: "white", background: "linear-gradient(135deg, #f59e0b, #ef4444)", border: "none", cursor: "pointer" }}>ログイン</button>
        </div>
      )}

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
                  <li>マップ：右ドラッグで回転・傾き（3D）</li>
                </ul>
              </div>
            </div>

            {/* OpenStreetMap (MapLibre GL JS) */}
            <MapLibreMap
              warehouses={warehouses}
              selectedWarehouseId={selectedWarehouseId}
              onSelect={handleMapSelect}
              onPositionChange={handleMapPositionChange}
              onDoubleClick={handleMapDoubleClick}
            />
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
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.name}
                  onChange={(e) => setEditForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">面積（m²）</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.area_m2}
                  onChange={(e) => setEditForm((s) => ({ ...s, area_m2: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">棚台数</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.rack_count}
                  onChange={(e) => setEditForm((s) => ({ ...s, rack_count: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">今日 入荷</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.inbound_today}
                  onChange={(e) => setEditForm((s) => ({ ...s, inbound_today: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">今日 出荷</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.outbound_today}
                  onChange={(e) => setEditForm((s) => ({ ...s, outbound_today: e.target.value }))}
                  inputMode="numeric"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">占有（m²）</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.occupancy_m2}
                  onChange={(e) => setEditForm((s) => ({ ...s, occupancy_m2: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">占有（m³）</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
                  value={editForm.lat}
                  onChange={(e) => setEditForm((s) => ({ ...s, lat: e.target.value }))}
                  inputMode="decimal"
                  placeholder="35.6812"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500">経度（lng）</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none transition-colors"
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
      <UnitSearchModal
        open={unitSearchOpen}
        onClose={() => setUnitSearchOpen(false)}
        query={unitSearchQuery}
        setQuery={setUnitSearchQuery}
        searchKey={unitSearchKey}
        setSearchKey={setUnitSearchKey}
        results={unitSearchResults}
        onNavigate={navigateToUnit}
        allUnits={allUnitsForSearch}
      />
    </div>
  );
}
