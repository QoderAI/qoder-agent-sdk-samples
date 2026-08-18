/** Default width of the expanded Session sidebar. */
export const SIDEBAR_DEFAULT = 280;
/** Smallest user-resized expanded Session sidebar width. */
export const SIDEBAR_MIN = 264;
/** Largest user-resized Session sidebar width. */
export const SIDEBAR_MAX = 420;
/** Width of the collapsed Session sidebar rail. */
export const SIDEBAR_COLLAPSED = 56;
/** Default width of the contextual details panel. */
export const DETAILS_DEFAULT = 360;
/** Smallest usable contextual details panel width. */
export const DETAILS_MIN = 300;
/** Largest supported contextual details panel width. */
export const DETAILS_MAX = 520;
/** Target minimum width for the conversation center column. */
export const CENTER_MIN = 640;

/** Resolved widths for the three-column product layout. */
export type Columns = {
  sidebar: number;
  center: number;
  details: number;
};

/**
 * Resolves DSH-style columns while preserving the sidebar before closing details.
 *
 * @param viewport - Available application width in pixels.
 * @param sidebar - Current sidebar width in pixels.
 * @param details - Preferred details width in pixels.
 * @returns The widths to render for the sidebar, conversation center, and details.
 */
export function computeColumns(
  viewport: number,
  sidebar: number,
  details: number,
): Columns {
  const centerAndDetails = Math.max(0, viewport - sidebar);
  if (details === 0) {
    return { sidebar, center: centerAndDetails, details: 0 };
  }
  const preferredDetails = Math.min(
    DETAILS_MAX,
    Math.max(DETAILS_MIN, details),
  );

  if (centerAndDetails >= CENTER_MIN + preferredDetails) {
    return {
      sidebar,
      center: centerAndDetails - preferredDetails,
      details: preferredDetails,
    };
  }
  if (centerAndDetails >= CENTER_MIN + DETAILS_MIN) {
    return {
      sidebar,
      center: CENTER_MIN,
      details: centerAndDetails - CENTER_MIN,
    };
  }
  return { sidebar, center: centerAndDetails, details: 0 };
}
