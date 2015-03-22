'use strict';

var Fox = require('./fox');

var game = null;

/**
 * Represents an opponent character.
 * The character is controlled by socket events.
 */
function Opponent(gam, socket) {
  game = gam;
  this.left = false;
  this.right = false;
  this.id = null;

  var geometry = new THREE.BoxGeometry(50, 50, 50);
  var material = new THREE.MeshBasicMaterial( {color: 0x00ff00} );
  this.mesh = new THREE.Mesh(geometry, material);
  this.mesh.position.x = 0;
  this.mesh.position.z = 0;

  // Register the player for key events.
  var self = this;

  socket.on('move.start', function(keyCode, playerId) {
    console.log('Opponent move start', keyCode, playerId);
    self.toggleMovement(keyCode, true);
  });

  socket.on('move.end', function(keyCode, playerId) {
    console.log('Opponent move end', keyCode, playerId);
    self.toggleMovement(keyCode, false);
  });
}

Opponent.prototype.toggleMovement = function(keyCode, directionBool) {
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

Opponent.prototype.update = function(elapsed) {
  var curPosX = this.mesh.position.x;

  // How much to move.
  var tr = 100.0;

  if (this.left) {
    curPosX += tr*elapsed;
  }
  else if (this.right) {
    curPosX -= tr*elapsed;
  }

  this.mesh.position.x = curPosX;
};

Opponent.prototype.setId = function(id) {
  this.id = id;
};

module.exports = Opponent;
