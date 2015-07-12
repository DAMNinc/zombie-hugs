'use strict';

function Models() {
  this.missing = 0;
  this.zombie = null;
  this.player = null;

  var self = this;
  var jsonloader = new THREE.JSONLoader(true);

  load(this, jsonloader, '/content/fox.json', function(geo) {
    self.zombie = geo;
  });
  load(this, jsonloader, '/content/monster.json', function(geo) {
    self.player = geo;
  });
};

Models.prototype.isReady = function() {
  return this.missing == 0;
};
Models.prototype.getZombie = function() {
  return this.zombie;
};
Models.prototype.getPlayer = function(direction) {  
  var material = new THREE.MeshFaceMaterial( this.player.materials );
  var mesh = new THREE.Mesh(this.player.geometry, material);
  mesh.scale.set(0.05, 0.05, 0.05);

  mesh.rotation.y = Math.PI * 0.5 * direction;

  return mesh;
};

function load(models, loader, file, result) {
  models.missing++;
  console.log('loading ' + file);
  loader.load(file, function(geo, mat) {
      console.log(file + ' loaded');
      console.log(mat);
      result({
        geometry: geo,
        materials: mat
      });
      models.missing--;
  });
}

module.exports = Models;