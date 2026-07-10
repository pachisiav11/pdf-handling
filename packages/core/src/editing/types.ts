/** Shared editing geometry. All coordinates are PDF user-space points with
    origin at the page's bottom-left (pdf-lib convention). UI layers convert
    from screen space before calling core. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RGB {
  r: number; // 0..1
  g: number;
  b: number;
}

export const BLACK: RGB = { r: 0, g: 0, b: 0 };
export const HIGHLIGHT_YELLOW: RGB = { r: 1, g: 0.86, b: 0.23 };
