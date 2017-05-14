'use strict';

/* global THREE */

import ImprovedNoise from './ImprovedNoise';

var terrainWidth = null;
var terrainHeight = null;
var yOffset = null;

function generateHeight() {
	var size = terrainWidth * terrainHeight, data = new Uint8Array( size ),
	perlin = new ImprovedNoise(), quality = 2, z = Math.random() * 100;

	for ( var j = 0; j < 4; j ++ ) {
		for ( var i = 0; i < size; i ++ ) {

			var x = i % terrainWidth, y = ~~ ( i / terrainWidth );
			data[ i ] += Math.abs( perlin.noise( x / quality, y / quality, z ) * quality * 1.75 );
		}

		quality *= 2;
	}

	return data;
}

function generateTexture(data) {

	var canvas, canvasScaled, context, image, imageData, vector3, sun, shade;

	vector3 = new THREE.Vector3( 0, 0, 0 );

	sun = new THREE.Vector3( 1, 1, 1 );
	sun.normalize();

	canvas = document.createElement( 'canvas' );
	canvas.width = terrainWidth;
	canvas.height = terrainHeight;

	context = canvas.getContext( '2d' );
	context.fillStyle = '#000';
	context.fillRect( 0, 0, terrainWidth, terrainHeight );

	image = context.getImageData( 0, 0, canvas.width, canvas.height );
	imageData = image.data;

	for ( var i = 0, j = 0, l = imageData.length; i < l; i += 4, j ++ ) {

		vector3.x = data[ j - 2 ] - data[ j + 2 ];
		vector3.y = 2;
		vector3.z = data[ j - terrainWidth * 2 ] - data[ j + terrainWidth * 2 ];
		vector3.normalize();

		shade = vector3.dot( sun );

		imageData[ i ] = ( 96 + shade * 128 ) * ( 0.5 + data[ j ] * 0.007 );
		imageData[ i + 1 ] = ( 32 + shade * 96 ) * ( 0.5 + data[ j ] * 0.007 );
		imageData[ i + 2 ] = ( shade * 96 ) * ( 0.5 + data[ j ] * 0.007 );
	}

	context.putImageData( image, 0, 0 );

	// Scaled 4x

	canvasScaled = document.createElement( 'canvas' );
	canvasScaled.width = terrainWidth * 4;
	canvasScaled.height = terrainHeight * 4;

	context = canvasScaled.getContext( '2d' );
	context.scale( 4, 4 );
	context.drawImage( canvas, 0, 0 );

	image = context.getImageData( 0, 0, canvasScaled.width, canvasScaled.height );
	imageData = image.data;

	for ( var i = 0, l = imageData.length; i < l; i += 4 ) {

		var v = ~~ ( Math.random() * 5 );

		imageData[ i ] += v;
		imageData[ i + 1 ] += v;
		imageData[ i + 2 ] += v;

	}

	context.putImageData( image, 0, 0 );

	return canvasScaled;

}

export default function Terrain(width, height, offset) {
	terrainWidth = width * 2;
	terrainHeight = height * 2;
	this.yOffset = offset;
}

Terrain.prototype.getMesh = function() {
  var data = generateHeight( terrainWidth, terrainHeight );

  var geometry = new THREE.PlaneBufferGeometry( 7500, 7500, terrainWidth - 1, terrainHeight - 1 );
  geometry.applyMatrix( new THREE.Matrix4().makeRotationX( - Math.PI / 2 ) );

  var vertices = geometry.attributes.position.array;

  for (var i = 0, j = 0, l = vertices.length; i < l; i ++, j += 3) {
    var x = i % terrainWidth, y = ~~ ( i / terrainWidth );
    if (x > terrainWidth / 4 && x < 3 * terrainWidth / 4 && y > terrainHeight / 4 && y < 3 * terrainHeight / 4) {
      vertices[j + 1] = yOffset - 50; // flat terrain for the foxy fox!
    } else {
      vertices[ j + 1 ] = data[ i ] * 10;
    }
  }

  var texture = new THREE.Texture(generateTexture(data), THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);
  texture.needsUpdate = true;

  // var material = new THREE.MeshBasicMaterial( {
  // 					color: new THREE.Color().setHSL( 0.3, 0.75, ( i / 15 ) * 0.4 + 0.1 ),
  // 					map: texture,
  // 					depthTest: false,
  // 					depthWrite: false,
  // 					transparent: true
  // 				} );


  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial( { map: texture } ));
};
