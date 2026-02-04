import * as THREE from 'three';
import ImprovedNoise from './ImprovedNoise';

let terrainWidth: number | null = null;
let terrainHeight: number | null = null;

function generateHeight(): Uint8Array {
  if (!terrainWidth || !terrainHeight) throw new Error('Terrain dimensions not set');
  
	const size = terrainWidth * terrainHeight;
  const data = new Uint8Array(size);
	const perlin = new ImprovedNoise();
  let quality = 2;
  const z = Math.random() * 100;

	for (let j = 0; j < 4; j ++) {
		for (let i = 0; i < size; i ++) {
			const x = i % terrainWidth;
      const y = ~~ ( i / terrainWidth );
			data[i] += Math.abs(perlin.noise(x / quality, y / quality, z) * quality * 1.75);
		}

		quality *= 2;
	}

	return data;
}

function generateTexture(data: Uint8Array): HTMLCanvasElement {
  if (!terrainWidth || !terrainHeight) throw new Error('Terrain dimensions not set');

	let canvas: HTMLCanvasElement;
  let canvasScaled: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null;
  let image: ImageData;
  let imageData: Uint8ClampedArray;
	let vector3: THREE.Vector3;
  let sun: THREE.Vector3;
  let shade: number;

	vector3 = new THREE.Vector3( 0, 0, 0 );

	sun = new THREE.Vector3( 1, 1, 1 );
	sun.normalize();

	canvas = document.createElement( 'canvas' );
	canvas.width = terrainWidth;
	canvas.height = terrainHeight;

	context = canvas.getContext( '2d' );
  if (!context) throw new Error('Could not get 2d context');
  
	context.fillStyle = '#000';
	context.fillRect( 0, 0, terrainWidth, terrainHeight );

	image = context.getImageData( 0, 0, canvas.width, canvas.height );
	imageData = image.data;

	for (let i = 0, j = 0, l = imageData.length; i < l; i += 4, j ++) {
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
  if (!context) throw new Error('Could not get 2d context');
  
	context.scale( 4, 4 );
	context.drawImage( canvas, 0, 0 );

	image = context.getImageData( 0, 0, canvasScaled.width, canvasScaled.height );
	imageData = image.data;

	for (let i = 0, l = imageData.length; i < l; i += 4 ) {
		const v = ~~ ( Math.random() * 5 );

		imageData[ i ] += v;
		imageData[ i + 1 ] += v;
		imageData[ i + 2 ] += v;
	}

	context.putImageData( image, 0, 0 );

	return canvasScaled;
}

export default class Terrain {
  yOffset: number;

  constructor(width: number, height: number, offset: number) {
    terrainWidth = width * 2;
    terrainHeight = height * 2;
    this.yOffset = offset;
  }

  getMesh(): THREE.Mesh {
    if (!terrainWidth || !terrainHeight) throw new Error('Terrain dimensions not set');
    
    const data = generateHeight();

    const geometry = new THREE.PlaneBufferGeometry( 7500, 7500, terrainWidth - 1, terrainHeight - 1 );
    geometry.applyMatrix( new THREE.Matrix4().makeRotationX( - Math.PI / 2 ) );

    const vertices = geometry.attributes.position.array as Float32Array;

    for (let i = 0, j = 0, l = vertices.length; i < l; i ++, j += 3) {
      const x = i % terrainWidth;
      const y = ~~ ( i / terrainWidth );
      if (x > terrainWidth / 4 && x < 3 * terrainWidth / 4 && y > terrainHeight / 4 && y < 3 * terrainHeight / 4) {
        vertices[j + 1] = this.yOffset - 50; // flat terrain for the foxy fox!
      } else {
        vertices[ j + 1 ] = data[ i ] * 10;
      }
    }

    const texture = new THREE.Texture(generateTexture(data), THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping);
    texture.needsUpdate = true;

    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial( { map: texture } ));
  }
}
