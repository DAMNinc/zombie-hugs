/* eslint-disable no-var */

// jQuery is loaded from CDN as a global
declare const jQuery: any;
declare const $: any;

// ROME namespace (defined in fox.ts, used by gallery.js)
declare var ROME: any;

// ZombieHugs game instance attached to window
interface Window {
  ZombieHugs: any;
  ROME: any;
}
