/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the game server (https://…) when it is not the site's own; see net/server.ts. */
  readonly VITE_GAME_SERVER?: string;
}
