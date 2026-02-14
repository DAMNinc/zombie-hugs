/* eslint-disable no-var */

// three@0.71.0 has no bundled types
declare module 'three';

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
