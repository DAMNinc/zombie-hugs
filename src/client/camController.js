'use strict';

import Constants from './constants';
import Util from './util';


var camera = null;
var socket = null;
var isSpectator = false;
var lastShot = 0;


export default function CamController(cam, sock, direction) {
  // TODO: Consider using THREE.FirstPersonControls?

  camera = cam;
  socket = sock;

  // Currently, the absense of a socket object determines whether or not the
  // cam controller is a spectator.
  isSpectator = !sock;

  this.direction = direction;
  this.weapon = Constants.FOX;

  var self = this;
  var startMovement = function(code) {
    if (self.toggleMovement(code, true) && socket) {
      console.log('Cam movement started', code);
      socket.emit('move.start', code);
    }
  };

  var endMovement = function(code) {
    if (self.toggleMovement(code, false) && socket) {
      console.log('Cam movement ended', code);
      socket.emit('move.end', code);
    }
  };

  var selectWeapon = function(keyCode) {
    const code = Util.getWeaponCode(keyCode);
    if (code && socket && self.weapon !== code) {
      console.log('Changed weapon from ' + self.weapon + ' to ' + code);
      socket.emit('weapon.set', code);
      self.weapon = code;
    }
  }

  // Register the player for key events.
  var keyDownEvent = function(keyEvent) {
    startMovement(keyEvent.keyCode);
  };

  var keyUpEvent = function(keyEvent) {
    var keyCode = keyEvent.keyCode;

    switch (keyCode) {
      case 49:
      case 50:
      case 51:
      case 97: // numeric keypad 1
      case 98: // numeric keypad 2
      case 99: // numeric keypad 3
        selectWeapon(keyCode);
        break;
      default:
        endMovement(keyCode);
    }

    endMovement(keyEvent.keyCode);
  };

  var mouseClickEvent = function() {
    console.log('Click');
    self.fire();
  };

  var touchStart = function(e) {
    // Prevent mouse clicks...
    e.preventDefault();

    if (e.touches.length > 0) {
      if (e.touches[0].clientX < window.innerWidth / 3) {
        // Simulate left arrow
        startMovement(-1);
      } else if (e.touches[0].clientX > window.innerWidth - window.innerWidth / 3) {
        // Simulate right arrow
        startMovement(1);
      } else {
        console.log('Touch "click"');
        self.fire();
      }
    }
  }

  var touchEnd = function(e) {
    if (e.touches.length === 0) {
      // Just stop movement in both directions :-)
      endMovement(-1);
      endMovement(1);
    }
  };

  window.addEventListener('keydown', keyDownEvent);
  window.addEventListener('keyup', keyUpEvent);
  window.addEventListener('click', mouseClickEvent);
  window.addEventListener('touchstart', touchStart);
  window.addEventListener('touchend', touchEnd);
};

CamController.prototype.toggleMovement = function(keyCode, directionBool) {
  var hasChanged = false;
  switch (keyCode) {
    case -1:  // Custom keycode for touch
    case 37:  // Leftarrow
    case 65:  // a key
      hasChanged = this.left !== directionBool;
      this.left = directionBool;
      break;
    case 38:  // Up arrow
    case 87:  // w key
      hasChanged = this.forward !== directionBool;
      this.forward = directionBool;
      break;
    case 1:   // Custom keycode for touch
    case 39:  // Right arrow
    case 68:  // d key
      hasChanged = this.right !== directionBool;
      this.right = directionBool;
      break;
    case 40:  // Down arrow
    case 83:  // s key
      hasChanged = this.backward !== directionBool;
      this.backward = directionBool;
      break;
  }

  return hasChanged;
};

CamController.prototype.fire = function() {
  if (socket) {
    const delay = Util.getWeaponDelay(this.weapon);
    const now = new Date().getTime();
    if (now - lastShot > delay) {
      lastShot = now;
      socket.emit('fire', camera.position, this.weapon);
    }
  }
};

CamController.prototype.update = function(elapsed) {
  // How much to move.
  var tr = 100.0;
  var curPosX = camera.position.x;

  // Spectators have full movement
  if (isSpectator) {

    // Because free movement is calculated differently, the position modifier
    // has to be much lower.
    tr = 5.0;

    var rot = 0.025;
    var curPosZ = camera.position.z;
    var curRot = camera.rotation.y;

    if (this.forward) {
      curPosX -= Math.sin(-curRot) * -tr;
      curPosZ -= Math.cos(-curRot) * tr;
    }
    else if (this.backward) {
      curPosX -= Math.sin(curRot) * -tr;
      curPosZ += Math.cos(curRot) * tr;
    }

    if (this.left) {
      curRot += rot;
    }
    else if (this.right) {
      curRot -= rot;
    }

    camera.position.x = curPosX;
    camera.position.z = curPosZ;
    camera.rotation.y = curRot;
    return;
  } else {
    // only show reload-bar when playing

    var delay = Util.getWeaponDelay(this.weapon);
    var now = new Date().getTime();

    var reloader = document.getElementById('reload-bar');
    if (now - lastShot <= delay) {
      reloader.style.width = ((now - lastShot) / delay)*100 + '%';
    } else {
      // set to 100% when ready to shoot
      reloader.style.width = '100%';
    }

  }

  // If the cam controller is a player, the player direction matters and we can
  // only move along the x-axis (at the edge of the battlefield).
  if (this.left) {
    curPosX -= tr*elapsed*this.direction;
  }
  else if (this.right) {
    curPosX += tr*elapsed*this.direction;
  }
  camera.position.x = curPosX;
};
