const canvas = document.getElementById('gl_canvas');
const gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
if (!gl) {
  throw new Error('WebGL2 is not available in this browser.');
}

// each is {pitch, pointer_id, group}
let playing_pitches = [];
let audio_started = false;
const settings = {
    spiralize:     {v: 0.0, min: 0.0, max: 1.0},
    start_pos_x:   {v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    start_pos_y:   {v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    grid_size_x:   {v: 50, min: 20, max: 200},
    grid_size_y:   {v: 600, min: 40, max: 1000, step: 5},
    grid_sharp_x:  {v: 0.8, min: 0.0, max: 1.0, step: 0.05},
    grid_sharp_y:  {v: 0.6, min: 0.0, max: 1.0, step: 0.05},
    column_offset: {v: 2., min: 0.0, max: 12.0, step: 0.1},
    tilt:          {v: 0.0, min: 0.0, max: 1.0, step: 0.01},
    edo:           {v: 12, min: 1, max: 128},
    origin_freq:   {v: 220, min: 55, max: 880},
    delay:         {v: 0.2, min: 0, max: 1, step: 0.05}
}

const vertex_source = /*glsl*/`#version 300 es 
    in vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

const fragment_source = /*glsl*/`#version 300 es 
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float[16] u_playing_pitches;
    uniform int u_playing_pitches_count;

    uniform float u_tilt;
    uniform vec2 u_start_pos;

    uniform float u_spiralize;
    uniform vec2 u_grid_size;
    uniform vec2 u_grid_sharp;

    uniform float u_edo;
    uniform float u_column_offset;

    out vec4 outColor;

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

    vec2 gridize(vec2 uv) {
        uv *= rotation(PI * 2.0 * u_tilt);
        uv /= u_grid_size;
        return uv;
    }

    // spiral mode where the column height is ignored and always wraps
    // once around the center in polar coords instead.
    vec2 spiralize(vec2 uv) {
        uv *= rotation(PI * 2.0 * u_tilt);
        uv /= u_resolution.y; // y 0-1 - wrap octave once around by default.
        uv = cart_to_polar(uv);
        uv.x *= u_resolution.y / u_grid_size.x; // rings using grid size
        uv.x -= uv.y; // spiral
        uv.y -= 4.;
        uv.y *= u_column_offset; //scale so that each revolution is as long as offset
        return uv;
    }

    // // All components are in the range [0…1], including hue.
    // vec3 hsv2rgb(vec3 c)
    // {
    //     vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    //     vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    //     return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    // }

    void main() {
        // start with actual pixel scale, 1.0 = 1px., at start pos which is in normal 0-1 uv space.
        // half pixel offset for alignment, not sure if that makes sense.
        vec2 uv = gl_FragCoord.xy - (u_start_pos * u_resolution) + 0.5;

        uv = mix(gridize(uv), spiralize(uv), u_spiralize);

        // warp grid in x to make column offset smooth or sharp
        float colx = uv.x;
        if (u_grid_sharp.x == 1.0) {
            colx = floor(colx  + 0.5);
        } else if (u_grid_sharp.x > 0.0) {
            float half_s = u_grid_sharp.x / 2.;
            colx = floor(colx) + smoothstep(half_s, 1.-half_s, mod(colx, 1.0));
        }
        // apply offset per column
        uv.y += colx * u_column_offset;

        // split part >1 and <1 into separate color channels.
        // this is to make the output image be able to display many different pitches.
        float g_stepsize = 1./64.; // how much to change the second color channel by
        vec3 col = vec3(
            // r = pitch
            mod(uv.y, 1.0),
            // g = octave steps            
            0.5 + floor(uv.y) * g_stepsize,
            // b = visual only stuff
            0.0
        );

        // use blue channel to show active notes
        for (int i = 0; i < 16; i++) {
            if (u_playing_pitches_count == i) { break; }
            float rect_height = max(0.25, u_grid_sharp.y) / u_edo;
            if (abs(u_playing_pitches[i] - uv.y) < 0.5 * rect_height) {
                col.b = 1.0;
            }
        }

        // show edo scale
        if (u_grid_sharp.y == 1.0) {
            col.r = floor(col.r * u_edo + 0.5) / u_edo;
        } else if (u_grid_sharp.y > 0.0) {
            float half_s = u_grid_sharp.y / 2.;
            col.r *= u_edo;
            col.r = floor(col.r) + smoothstep(half_s, 1.-half_s, mod(col.r, 1.0));
            col.r /= u_edo;
        }

        // add centered dots on edo steps
        float dotl = 2. - u_grid_sharp.y;
        vec2 step_uv = vec2(
            mod(uv.x + 0.5, 1.0) - 0.5, 
            (mod(uv.y * u_edo + 0.5, 1.0) - 0.5) * dotl
        );
        float dot_dist = distance(step_uv, vec2(0.0)) * 2.;
        col.b = max(col.b, 1. - smoothstep(0.0, 1.0, dot_dist));

        // not initiated yet, show that somehow.
        if (u_time == 0.) {
            col.b = 1. - col.b;
        }

        //col = hsv2rgb(col.xzy);

        outColor = vec4(col.rgb, 1.0);
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

    function at(string) {
        return gl.getUniformLocation(program, string);
    }

    gl.uniform2f(at('u_resolution'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(at('u_time'), audio_started ? time * 0.001 : 0);

    const pitches = (playing_pitches.length > 0) ? playing_pitches.map((o) => o.pitch) : [-99];
    gl.uniform1fv(at('u_playing_pitches'), pitches);
    gl.uniform1i(at('u_playing_pitches_count'), playing_pitches.length);

    gl.uniform1f(at('u_spiralize'), settings.spiralize.v);
    gl.uniform2f(at('u_start_pos'), settings.start_pos_x.v, settings.start_pos_y.v);
    gl.uniform2f(at('u_grid_size'), settings.grid_size_x.v, settings.grid_size_y.v);
    gl.uniform2f(at('u_grid_sharp'), settings.grid_sharp_x.v, settings.grid_sharp_y.v);
    gl.uniform1f(at('u_column_offset'), settings.column_offset.v / 12);
    gl.uniform1f(at('u_tilt'), settings.tilt.v);
    gl.uniform1f(at('u_edo'), settings.edo.v);


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

const intro_text_el = document.getElementById("intro_text");
const init_audio = new Promise((resolve) =>
    document.addEventListener("click", function init() {
        const audio_context = new AudioContext();
        // possibly hide a prompt here
        resolve(audio_context);
        audio_started = true;
        intro_text_el.style.display = "none";
        document.removeEventListener("click", init);
    })
);

import { Dough } from "./dough-synth/dough.js";
const dough = new Dough({base: "./dough-synth/"});

async function touched_canvas(e) {
    await init_audio;
    if (!dough) {
        return;
    }
    e.preventDefault();

    const p_id = e.pointerId ?? 0;
    const p_index = playing_pitches.findIndex((o) => o.pointer_id == p_id);

    if (e.type == "pointerup" || e.type == "pointerout") {
        // remove existing
        if (p_index == -1) return;
        dough.evaluate({dough: "hush_group", group: playing_pitches[p_index].group});
        playing_pitches.splice(p_index, 1); 
        return;
    } else if (e.type == "pointermove") {
        if (p_index == -1) return;
    }

    const first_free = () => {
        for (let i = 0; i < 16; i++) {
            const group_index = playing_pitches.findIndex((o) => o.group == i);
            if (group_index == -1) return i;
        }
    }
    const group = (p_index >= 0) ? playing_pitches[p_index].group : first_free();

    // get the color at the cursor
    const x = e.clientX;
    const y = e.clientY;
    const data = new Uint8Array(4);
    gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const [r, g, b, a] = data;

    // r is the octave. the calculation brings it in the desired range.
    // g is the specific note within the octave
    const pitch = (Math.round(g / 4) - 32) + (r / 255);

    const freq = settings.origin_freq.v * (2 ** pitch);
    //console.log(`pitch: ${pitch}, freq: ${freq}.`)

    if (p_index == -1) {
        // new
        playing_pitches.push({pointer_id: p_id, pitch, group});
    } else {
        playing_pitches[p_index].pitch = pitch;
    }

    dough.evaluate({
        dough: "play", group, voices: 1,
        freq, glide: 0.1, lpf: 7000,
        s: "saw", vib: 6, vibmod: 0.05, phaser: 0.5, phaserdepth: 0.1,
        attack: .02, release: .3, delay: settings.delay.v
    });
}
canvas.addEventListener('pointerdown', touched_canvas);
canvas.addEventListener('pointermove', touched_canvas);
canvas.addEventListener('pointerup', touched_canvas);
canvas.addEventListener('pointerout', touched_canvas);

function make_range_div(value, name, min, max, step) {
    const div_el = document.createElement("div");
    const range_el = document.createElement("input");
    const label_el = document.createElement("label");
    range_el.type = "range";
    range_el.value = value;
    range_el.id = "range_" + name;
    range_el.name = name;
    label_el.innerHTML = name + ": " + value;
    label_el.id = "label_" + name;
    if (min) range_el.min = min;
    if (max) range_el.max = max;
    if (step) range_el.step = step;
    range_el.addEventListener("input", (e) => {
        const v = e.target.value;
        settings[name].v = v;
        label_el.innerHTML = name + ": " + v;
    });
    div_el.appendChild(range_el);
    div_el.appendChild(label_el);
    return div_el;
}

let menu_shown = true;
function make_menu() {
    const menu_el = document.getElementById("menu");
    const menu_list_el = document.createElement("div");
    menu_list_el.id = "menu_list";
    for (const [param, details] of Object.entries(settings)) {
        const {v, min, max, step} = details;
        details.default = v;
        menu_list_el.appendChild(make_range_div(v, param, min, max, step));
    }
    menu_el.appendChild(menu_list_el);

    const hide_button_el = document.createElement("button");
    hide_button_el.innerText = "Hide";
    hide_button_el.addEventListener("click", (e) => {
        menu_shown = !menu_shown;
        hide_button_el.innerText = menu_shown ? "Hide" : "Show";
        menu_list_el.style.display = menu_shown ? "inherit" : "none";
        reset_button_el.style.display = menu_shown ? "inline-block" : "none";
    });

    const reset_button_el = document.createElement("button");
    reset_button_el.addEventListener("click", (e) => {
        for (const [param, details] of Object.entries(settings)) {
            const range_el = document.getElementById("range_" + param);
            const label_el = document.getElementById("label_" + param);
            range_el.value = details.default;
            label_el.innerHTML = param + ": " + details.default;
            details.v = details.default;
        }
    });
    reset_button_el.innerText = "Reset to default";

    const buttons_el = document.createElement("div");
    buttons_el.id = "buttons"
    buttons_el.appendChild(hide_button_el);
    buttons_el.appendChild(reset_button_el);
    menu_el.appendChild(buttons_el);
}
make_menu();