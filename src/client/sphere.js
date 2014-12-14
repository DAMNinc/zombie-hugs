
function Sphere(mesh) {
    this.mesh = mesh;
    this.direction = [ 
        Math.round(Math.random()) == 1 ? 1 : -1, 
        Math.round(Math.random()) == 1 ? 1 : -1,
        Math.round(Math.random()) == 1 ? 1 : -1
    ];

    // Speed will be between 400 and 600 pixels per millisecond.
    this.speed = 1000; // Math.random() * 200 + 400;

    this.updatePosition = function (elapsed) {
        this.mesh.position.z -= elapsed * this.speed;
        //this.mesh.position.x += this.direction[0] * ;
        //this.mesh.position.y += this.direction[1] * (elapsed / 1000.0 * this.speed);
        //this.mesh.position.z += this.direction[2] * (elapsed / 1000.0 * this.speed);
    }
}

module.exports = Sphere;