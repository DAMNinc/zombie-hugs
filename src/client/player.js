'use strict';

/* global THREE */

/**
 * Represents a playable character.
 * The character is controllable with keyboard and mouse.
 */
function Player(id, position, direction, playerMesh) {
  this.id = id;
  this.direction = direction;

  this.forward = false;
  this.backward = false;
  this.left = false;
  this.right = false;

  this.mesh = playerMesh;

  this.mesh.position.x = position.x;
  this.mesh.position.y = position.y - 40;
  this.mesh.position.z = position.z;

  console.log('Player created');
}

Player.prototype.getMesh = function() {
  return this.mesh;
};

Player.prototype.toggleMovement = function(keyCode, directionBool) {
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

Player.prototype.update = function(elapsed) {
  var curPosX = this.mesh.position.x;

  // How much to move.
  var tr = 100.0;

  if (this.left) {
    curPosX -= tr*elapsed*this.direction;
  }
  else if (this.right) {
    curPosX += tr*elapsed*this.direction;
  }

  this.mesh.position.x = curPosX;
};

Player.prototype.setPosition = function(position) {
  this.mesh.position.set(position.x, position.y-40, position.z);
};

module.exports = Player;
