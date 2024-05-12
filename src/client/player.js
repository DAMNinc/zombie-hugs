'use strict';

/* global THREE */

/**
 * Represents a playable character.
 * The character is controllable with keyboard and mouse.
 */
export default function Player(id, name, position, direction, playerMesh, weapon) {
  this.id = id;
  this.name = name;
  this.direction = direction;

  this.forward = false;
  this.backward = false;
  this.left = false;
  this.right = false;

  this.mesh = playerMesh;
  
  this.weaponCode = 1;
  this.weapon = null;

  this.mesh.position.x = position.x;
  this.mesh.position.y = position.y - 40;
  this.mesh.position.z = position.z;

  this.score = 0;

  console.log('Player created');
}

Player.prototype.getMesh = function() {
  return this.mesh;
};

Player.prototype.getDirection = function() {
  return this.direction;
}

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

Player.prototype.setWeapon = function(code, weapon) {
  this.weaponCode = code;
  this.weapon = weapon;
}

Player.prototype.getCurrentWeapon = function() {
  return this.weapon;
}

Player.prototype.getWeaponCode = function() {
  return this.weaponCode;
}

Player.prototype.update = function(elapsed) {
  var changeX = 0;

  // How much to move.
  var tr = 100.0;

  if (this.left) {
    changeX = -tr*elapsed*this.direction;
  }
  else if (this.right) {
    changeX = tr*elapsed*this.direction;
  }

  this.mesh.position.x += changeX;

  this.weapon.getMesh().position.x += changeX;
  this.weapon.update(elapsed); 
};

Player.prototype.setPosition = function(position) {
  this.mesh.position.set(position.x, position.y-40, position.z);
};

Player.prototype.setScore = function(score) {
  this.score = score;
};
