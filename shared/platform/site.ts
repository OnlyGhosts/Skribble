/** Site identity: the one place to rename the library. Games keep their own names in the registry. */
export const SITE_NAME = 'Bored Games';
export const SITE_TAGLINE = 'Games to play with friends. Share a code, play instantly.';
/**
 * Canonical public origin, used for social previews and docs only. The running app always uses
 * the origin it is served from, so preview deployments and local dev need no change here.
 */
export const SITE_DOMAIN = 'boredgames.io';
export const SITE_URL = `https://${SITE_DOMAIN}`;
