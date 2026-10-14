/** Site identity: the one place to rename the site. Games keep their own names in the registry. */
export const SITE_NAME = 'boredgames.io';
/** The one-line description for the document head, the manifest and link previews. */
export const SITE_DESCRIPTION = 'Party games for phones, played in the same room.';
/**
 * Canonical public origin, used for social previews and docs only. The running app always uses
 * the origin it is served from, so preview deployments and local dev need no change here.
 */
export const SITE_DOMAIN = 'boredgames.io';
export const SITE_URL = `https://${SITE_DOMAIN}`;
