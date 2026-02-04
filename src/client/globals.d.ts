/* eslint-disable no-var */

// THREE.js is loaded from CDN (r71) as a global
declare const THREE: any;

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
