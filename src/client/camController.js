'use strict';

var camera = null;
var socket = null;

var CamController = function(cam, sock, direction) {
  // TODO: Consider using THREE.FirstPersonControls?

  camera = cam;
  socket = sock;

  this.direction = direction;

  // Register the player for key events.
  var self = this;
  var startMoveEvent = function(keyEvent) {
    console.log('Key down ' + keyEvent.keyCode);
    if (socket) {
      socket.emit('move.start', keyEvent.keyCode);
    }
    self.toggleMovement(keyEvent.keyCode, true);
  }

  var endMoveEvent = function(keyEvent) {
    console.log('Key up ' + keyEvent.keyCode);
    if (socket) {
      socket.emit('move.end', keyEvent.keyCode);
    }
    self.toggleMovement(keyEvent.keyCode, false);
  }

  var mouseClickEvent = function(ev) {
    console.log('Click');
    self.fire();
  };

  window.addEventListener('keydown', startMoveEvent);
  window.addEventListener('keyup', endMoveEvent);
  window.addEventListener('click', mouseClickEvent);
};

CamController.prototype.toggleMovement = function (keyCode, directionBool) {
  switch (keyCode) {
    case 37:  // Leftarrow
    case 65:  // a key
      this.left = directionBool;
      break;
    case 38:  // Up arrow
    case 87:  // w key
      this.forward = directionBool;
      break;
    case 39:  // Right arrow
    case 68:  // d key
      this.right = directionBool;
      break;
    case 40:  // Down arrow
    case 83:  // s key
      this.backward = directionBool;
      break;
  }
};

CamController.prototype.fire = function() {
  if (socket) {
    socket.emit('fire', camera.position);
  }
};

CamController.prototype.update = function(elapsed) {
  var curPosX = camera.position.x;

  // How much to move.
  var tr = 100.0;

  if (this.left) {
    curPosX -= tr*elapsed*this.direction;
  }
  else if (this.right) {
    curPosX += tr*elapsed*this.direction;
  }

  camera.position.x = curPosX;
};

module.exports = CamController;