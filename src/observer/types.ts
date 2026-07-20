/**
 * Shapes shared between the injected observer functions (arm/read) and the
 * Node-side tests/consumers. The functions themselves are serialised into
 * assets/ and run inside the checked page; these types never travel with them.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AnnouncementKind = "live-region-update" | "live-region-added" | "live-region-inserted";

/** Recorded at mutation time by arm(); regionIndex points into the armed state's element list. */
export interface AnnouncementRecord {
  /** ms since arm */
  t: number;
  kind: AnnouncementKind;
  text: string;
  region: string;
  regionIndex: number;
}

/** What read() returns per announcement: the record plus where the region sits now. */
export interface AnnouncementReadback {
  t: number;
  kind: AnnouncementKind;
  text: string;
  region: string;
  rect: Rect | null;
  inViewport: boolean | null;
}

export interface FocusRecord {
  /** ms since arm */
  t: number;
  el: string;
}

export interface AppearedRecord {
  el: string;
  /** added = new DOM node; revealed = pre-rendered node shown by an attribute flip */
  via: "added" | "revealed";
  rect: Rect;
  inViewport: boolean;
}

export interface InvalidFieldRecord {
  el: string;
  validationMessage: string;
  isActive: boolean;
}

export interface ObserverReadback {
  announcements: AnnouncementReadback[];
  focusTrail: FocusRecord[];
  appearedVisible: AppearedRecord[];
  appearedVisibleTotal: number;
  liveRegionsAtArm: string[];
  activeElementNow: string;
  openDialog: { el: string; isModal: boolean } | null;
  invalidFields: InvalidFieldRecord[];
  viewport: { w: number; h: number };
}

/** Internal state stashed on window between arm() and read(). */
export interface ObserverState {
  t0: number;
  announcements: AnnouncementRecord[];
  regionEls: Element[];
  focusTrail: FocusRecord[];
  added: Element[];
  revealed: Element[];
  liveRegionsAtArm: string[];
  describe: (el: unknown) => string;
  mo: MutationObserver;
  onFocus: (e: FocusEvent) => void;
}
