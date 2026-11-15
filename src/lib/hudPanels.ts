/**
 * Floating visor HUD panels — catalog, layout math and persistence helpers.
 *
 * Every dock card (control, navigation, EVA, biometrics, terrain, radiation,
 * location, comms, mini-map) is a movable window: drag by its header, resize
 * from the corner, collapse, close, and re-add from the panel library. The
 * layout (position/size/z/collapsed/open per panel) lives in the store and is
 * persisted with the mission file.
 *
 * Coordinates are LOCAL px — measured inside the zoomed visor root, i.e. real
 * px divided by --hud-zoom. Pointer deltas from real px must be divided by the
 * zoom factor before hitting this math (FloatingPanel does that).
 */

export type HudPanelId =
  | "control"
  | "nav"
  | "eva"
  | "bio"
  | "terrain"
  | "rad"
  | "wx"
  | "location"
  | "comms"
  | "minimap";

export interface HudPanelState {
  open: boolean;
  collapsed: boolean;
  /** local px — left edge of the panel (pre zoom) */
  x: number;
  /** local px — top edge of the panel (pre zoom) */
  y: number;
  /** local px width */
  w: number;
  /** local px height — null = content-driven (auto) */
  h: number | null;
  /** stacking order — higher wins; store keeps a monotonic counter */
  z: number;
}

export interface HudPanelDef {
  id: HudPanelId;
  label: string;
  hint: string;
  /** default width (local px) */
  w: number;
  /** estimated content height — layout math only, real height is content-driven */
  estH: number;
  minW: number;
  minH: number;
  resizable: boolean;
  /** frame silhouette, cut to match the panel's role — not a plain rectangle */
  shape: PanelShape;
}

/** content-aware frame silhouettes (clip-path polygons, local px) */
export type PanelShape = "octagon" | "console" | "wedge";

export const FRAME_CLIPS: Record<PanelShape, string> = {
  /* 10 px chamfer on all four corners — telemetry blocks */
  octagon:
    "polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)",
  /* console: heavy 16 px cut top-left + bottom-right — interactive panels */
  console:
    "polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px)",
  /* wedge: single 18 px cut bottom-right — linear readouts (nav, comms) */
  wedge:
    "polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)",
};

export const HUD_PANELS: HudPanelDef[] = [
  /* control renders ~289 px tall at its fixed 226 px width (4 button rows +
     hint) — keep the slot ahead of it so nothing packs under it overlapping */
  { id: "control", label: "Control panel", hint: "walk · view · prefs · drills", w: 226, estH: 268, minW: 214, minH: 130, resizable: false, shape: "console" },
  { id: "nav", label: "Navigation", hint: "next WP · range · ETA · progress", w: 300, estH: 124, minW: 264, minH: 96, resizable: true, shape: "wedge" },
  { id: "eva", label: "EVA telemetry", hint: "O₂ bar · dose · LST clock", w: 188, estH: 154, minW: 172, minH: 122, resizable: true, shape: "octagon" },
  { id: "bio", label: "Biometrics", hint: "heart · core temp · work rate", w: 186, estH: 178, minW: 172, minH: 140, resizable: true, shape: "octagon" },
  { id: "terrain", label: "Terrain underfoot", hint: "elev · slope · speed · sun · air", w: 166, estH: 172, minW: 152, minH: 140, resizable: true, shape: "octagon" },
  { id: "rad", label: "Radiation", hint: "dose rate · cumulative · space wx", w: 178, estH: 172, minW: 166, minH: 140, resizable: true, shape: "octagon" },
  { id: "wx", label: "Mars weather — live", hint: "MSL REMS · Gale Crater temps", w: 178, estH: 160, minW: 166, minH: 110, resizable: true, shape: "octagon" },
  { id: "location", label: "Location beacon", hint: "live position · region · elev", w: 210, estH: 118, minW: 196, minH: 92, resizable: true, shape: "octagon" },
  { id: "comms", label: "Comms link", hint: "status · relay · last message", w: 192, estH: 196, minW: 178, minH: 150, resizable: true, shape: "wedge" },
  { id: "minimap", label: "Traverse mini-map", hint: "top-down route · walker cone", w: 150, estH: 156, minW: 128, minH: 128, resizable: true, shape: "octagon" },
];

export const HUD_PANEL_ORDER: HudPanelId[] = ["control", "nav", "eva", "bio", "terrain", "rad", "wx", "location", "comms", "minimap"];

/** bump when the stock panel arrangement changes — persisted layouts from an
    older version are discarded once so everyone lands on the clean default */
export const HUD_LAYOUT_VERSION = 3;

export function hudPanelDef(id: HudPanelId): HudPanelDef {
  return HUD_PANELS.find((d) => d.id === id) ?? HUD_PANELS[0];
}

/** panel ids open under each density preset (positions are kept) */
export const PRESET_PANEL_OPEN: Record<"minimal" | "standard" | "full", HudPanelId[]> = {
  minimal: ["control", "nav", "eva", "location"],
  standard: ["control", "nav", "eva", "terrain", "rad", "wx", "location", "comms", "minimap"],
  full: ["control", "nav", "eva", "bio", "terrain", "rad", "wx", "location", "comms", "minimap"],
};

/** which panels the legacy visorPrefs booleans map to (migration) */
export function panelsOpenFromPrefs(p: {
  nav: boolean;
  eva: boolean;
  bio: boolean;
  terrain: boolean;
  rad: boolean;
  comms: boolean;
  minimap: boolean;
}): Partial<Record<HudPanelId, boolean>> {
  return {
    control: true,
    location: true,
    nav: p.nav,
    eva: p.eva,
    bio: p.bio,
    terrain: p.terrain,
    rad: p.rad,
    wx: p.terrain, // live Mars weather follows the terrain-panel preference
    comms: p.comms,
    minimap: p.minimap,
  };
}

/**
 * Default layout — open panels packed into right-edge columns (starting below
 * the compass tape); a column that reaches the bottom edge wraps into a new
 * column left of the widest panel so far. Closed panels get parked coordinates
 * (clamped into view when opened). Widths shrink on narrow viewports.
 */
const PACK_GAP = 10;
const PACK_MARGIN = 8;
const PACK_TOP = 64; // below the compass tape

interface PackItem {
  id: string;
  w: number;
  h: number;
  /** open panels advance the layout; closed ones only take a slot */
  active: boolean;
}

/**
 * Pack panels into right-anchored columns that fill downward. On short
 * viewports the columns would multiply past the left edge — clampPanelRect
 * would then pile every column onto the left margin — so once a column
 * doesn't fit horizontally, remaining panels dock into bottom rows
 * (side by side above the status bar, wrapping upward) instead.
 */
function packPanelLayout(vw: number, vh: number, panels: PackItem[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const cols: { right: number; y: number; maxW: number }[] = [{ right: vw - PACK_MARGIN, y: PACK_TOP, maxW: 0 }];
  let dock = false;
  let rowX = PACK_MARGIN;
  let rowBottom = vh - PACK_MARGIN;
  let rowMaxH = 0;
  for (const p of panels) {
    if (!dock) {
      const c = cols[cols.length - 1];
      const wrapped = p.active && c.y + p.h > vh - PACK_MARGIN - 12;
      const right = wrapped ? c.right - c.maxW - PACK_GAP : c.right;
      if (p.active && right - p.w < PACK_MARGIN) {
        dock = true; // columns exhausted horizontally — switch to bottom rows
      } else {
        if (wrapped) cols.push({ right, y: PACK_TOP, maxW: 0 });
        const col = cols[cols.length - 1];
        pos[p.id] = {
          x: Math.max(PACK_MARGIN, Math.round(Math.min(col.right - p.w, vw - PACK_MARGIN - p.w))),
          y: Math.max(PACK_MARGIN, Math.round(Math.min(col.y, Math.max(PACK_MARGIN, vh - 44 - p.h)))),
        };
        if (p.active) {
          col.y += p.h + PACK_GAP;
          col.maxW = Math.max(col.maxW, p.w);
        }
        continue;
      }
    }
    /* bottom-row docking */
    if (p.active && rowX + p.w > vw - PACK_MARGIN) {
      rowX = PACK_MARGIN;
      rowBottom -= rowMaxH + PACK_GAP;
      rowMaxH = 0;
    }
    pos[p.id] = {
      x: Math.max(PACK_MARGIN, Math.round(Math.min(rowX, vw - PACK_MARGIN - p.w))),
      y: Math.max(PACK_TOP, Math.round(rowBottom - p.h)),
    };
    if (p.active) {
      rowX += p.w + PACK_GAP;
      rowMaxH = Math.max(rowMaxH, p.h);
    }
  }
  return pos;
}

export function defaultHudPanels(
  vw: number,
  vh: number,
  open: Partial<Record<HudPanelId, boolean>>
): Record<HudPanelId, HudPanelState> {
  const scale = vw < 1100 ? 0.92 : 1;
  const colW = (id: HudPanelId) => Math.round(hudPanelDef(id).w * scale);
  const slotH = (id: HudPanelId) => Math.round((hudPanelDef(id).estH + 26) * scale); // + header bar

  const pos = packPanelLayout(
    vw,
    vh,
    HUD_PANEL_ORDER.map((id) => ({ id, w: colW(id), h: slotH(id), active: open[id] ?? false }))
  );

  const out = {} as Record<HudPanelId, HudPanelState>;
  for (const id of HUD_PANEL_ORDER) {
    const p = pos[id] ?? { x: vw - PACK_MARGIN - colW(id), y: PACK_TOP };
    out[id] = {
      open: open[id] ?? false,
      collapsed: false,
      x: p.x,
      y: p.y,
      w: colW(id),
      h: null,
      z: 1,
    };
  }
  return out;
}

/** tidy re-stack: pack every open panel into edge columns (bottom rows when
    the viewport is too short for more columns), preserving open/collapsed/size */
export function stackedHudPanels(
  vw: number,
  vh: number,
  cur: Record<HudPanelId, HudPanelState>
): Record<HudPanelId, HudPanelState> {
  const next = { ...cur };
  const pos = packPanelLayout(
    vw,
    vh,
    HUD_PANEL_ORDER.filter((id) => next[id].open).map((id) => ({
      id,
      w: next[id].w,
      h: next[id].h ?? hudPanelDef(id).estH + 26,
      active: true,
    }))
  );
  for (const id of Object.keys(pos)) {
    next[id as HudPanelId] = { ...next[id as HudPanelId], x: pos[id].x, y: pos[id].y };
  }
  return next;
}

/** clamp any panel rect into the local viewport bounds */
export function clampPanelRect(
  st: { x: number; y: number; w: number; h: number | null },
  def: HudPanelDef,
  vw: number,
  vh: number,
  collapsed: boolean
): { x: number; y: number; w: number; h: number | null } {
  const margin = 8;
  const maxW = Math.max(def.minW, vw - margin * 2);
  const w = Math.min(Math.max(def.minW, st.w), maxW);
  const h = st.h === null ? null : Math.min(Math.max(collapsed ? 44 : def.minH, st.h), Math.max(def.minH, vh - margin * 2));
  const x = Math.min(Math.max(margin, st.x), Math.max(margin, vw - w - margin));
  // keep at least the header (or the whole panel) reachable
  const maxY = collapsed ? vh - 48 : Math.max(margin, vh - (h ?? def.estH) - margin);
  const y = Math.min(Math.max(8, st.y), Math.max(8, maxY));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: h === null ? null : Math.round(h) };
}
