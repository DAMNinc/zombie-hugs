'use strict';

const THREE = require('three');

export default function Models() {
  this.missing = 0;
  this.fox = null;
  this.flamingo = null;
  this.horse = null;
  this.player = null;

  var self = this;
  var jsonloader = new THREE.JSONLoader(true);

  load(this, jsonloader, '/content/fox.json', function(geo) {
    self.fox = geo;
  });
  load(this, jsonloader, '/content/flamingo.json', function(geo) {
    self.flamingo = geo;
  });
  load(this, jsonloader, '/content/horse.json', function(geo) {
    self.horse = geo;
  });
  load(this, jsonloader, '/content/monster.json', function(geo) {
    self.player = geo;
  });
};

Models.prototype.isReady = function() {
  return this.missing == 0;
};
Models.prototype.getZombie = function() {
  return { model: this.fox, offset: { x: 0, y: 0, z: 0 }, health: 1 };
};
Models.prototype.getFlamingo = function() {
  return { model: this.flamingo, offset: { x: 0, y: 50, z: 0 }, health: 1 };
};
Models.prototype.getHorse = function() {
  return { model: this.horse, offset: { x: 0, y: -10, z: 0 }, health: 2 };
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
