const canvas = document.getElementById('gl_canvas');
const gl = canvas.getContext('webgl', {preserveDrawingBuffer: true});

const vertex_source = /*glsl*/`
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

const fragment_source = /*glsl*/`
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;

    uniform vec2 u_grid_size;
    uniform float u_column_offset;
    uniform float u_edo;
    uniform float u_tilt;
    uniform int u_spiral_mode;

    #define PI 3.1415926538

    mat2 rotation(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
    }

    vec2 cart_to_polar(vec2 cartesian) {
        float radius = length(cartesian);
        float angle = atan(cartesian.x, cartesian.y) + PI;
        float norm_angle = (angle * 0.5 / PI + 0.5);
        return vec2(radius, norm_angle);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy - 0.5 * u_resolution;
        if (u_spiral_mode == 0) {
            uv *= rotation(PI * 2.0 * u_tilt);
            uv /= u_grid_size;
            uv.x += 0.5;
            uv.y += floor(uv.x) * u_column_offset;
        } else {
            uv /= u_resolution.y; // y 0-1 - wrap octave once around by default.
            uv = cart_to_polar(uv);
            uv.x *= u_resolution.y / u_grid_size.x; // rings using grid size
            uv.x -= uv.y; // spiral
            uv.y = (uv.y + floor(uv.x)) * u_column_offset; // half turn depends on col offset though...
        }
        //uv.y = log2(uv.y);
        vec2 tile_uv = mod(uv, 1.0);
        float tile_i = 0.5 + (floor(uv.y) / 64.); // magic number for now.

        float key_snapped = floor(tile_uv.y * u_edo + 0.5) / u_edo;
        vec2 key_uv = vec2(tile_uv.x, mod(tile_uv.y * u_edo + 0.5, 1.0));

        float grid = smoothstep(
            0.45, 0.5,
            max(distance(key_uv.x, 0.5), distance(key_uv.y, 0.5))
        );
        if ((key_snapped == 0. && abs(tile_i) == 0.5) || (key_snapped == 1. && abs(tile_i) == 0.5-1./64.)) {
            grid = 1.;
        }

        gl_FragColor = vec4(key_snapped, tile_i, grid, 1.0);
    }
`

function create_shader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function create_program(gl, vertex_shader, fragment_shader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function setup_shader(gl, vertex_source, fragment_source) {
    const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_source);
    const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_source);
    const program = create_program(gl, vertex_shader, fragment_shader);

    const position_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    
    const position_attrib_location = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position_attrib_location);
    gl.vertexAttribPointer(position_attrib_location, 2, gl.FLOAT, false, 0, 0);

    return program;
}

function render(gl, program, time) {
    gl.useProgram(program);

    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), 
        gl.canvas.width, gl.canvas.height
    );
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), 
        time * 0.001
    );
    gl.uniform1i(gl.getUniformLocation(program, 'u_spiral_mode'), 
        0
    );
    gl.uniform2f(gl.getUniformLocation(program, 'u_grid_size'),
        50, 600
    );
    gl.uniform1f(gl.getUniformLocation(program, 'u_column_offset'), 
        2/12
    );
    gl.uniform1f(gl.getUniformLocation(program, 'u_tilt'), 
        0.0
    );
    gl.uniform1f(gl.getUniformLocation(program, 'u_edo'), 
        12
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function resize_canvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize_canvas);
resize_canvas();

const shader_program = setup_shader(gl, vertex_source, fragment_source);

function animate(time) {
    render(gl, shader_program, time);
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);


import { Dough } from "/dough-synth/dough.js";
const dough = new Dough({base: "/dough-synth/"});

let is_down = false;
function touched_canvas(e) {
    if (is_down) {
        if (e.type == "pointerup" || e.type == "pointerout") is_down = false;
    } else {
        // wasn't down
        if (e.type == "pointerdown") {
            is_down = true;
        } else {
            return;
        }
    }
    
    const x = e.clientX;
    const y = e.clientY;
    const data = new Uint8Array(4);
    gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const [r, g, b, a] = data;

    const octave = Math.round(g / 4) - 29;
    const pitch = r / 255; // rounding...hmm. something isn't right with this number
    const mult = octave + pitch;
    const freq = 440 * (2 ** (mult-4));
    //console.log(`pitch: ${mult}, freq: ${freq}.`)

    const duration = is_down ? 30.0 : 0.01;
    dough.evaluatePath(`
        /group/1/voices/1
        /freq/${freq}/glide/0.1
        /s/saw/vib/6/vibmod/0.05/phaser/0.5/phaserdepth/0.1
        /duration/${duration}/attack/.02/release/.3
        /delay/0.2
        /lpf/7000
    `)
    dough.evaluatePath(`
        /group/2/voices/1
        /freq/${55}
        /s/saw
        /duration/${duration}/attack/.05/release/.3
        /lpf/4000
    `)
}
canvas.addEventListener('pointerdown', touched_canvas);
canvas.addEventListener('pointermove', touched_canvas);
canvas.addEventListener('pointerup', touched_canvas);
canvas.addEventListener('pointerout', touched_canvas);