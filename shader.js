const canvas = document.getElementById('gl_canvas');
const gl = canvas.getContext('webgl2', {preserveDrawingBuffer: true});
if (!gl) { throw new Error('WebGL2 is not available in this browser.'); }

const settings = {
    grid_size_x:   {label: "zoom (h)", v: 50, min: 20, max: 200},
    grid_size_y:   {label: "zoom (v)", v: 600, min: 100, max: 1400, step: 5},
    grid_sharp_x:  {label: "sharp (h)", v: 0.8, min: 0.0, max: 1.0, step: 0.05},
    grid_sharp_y:  {label: "sharp (v)", v: 0.6, min: 0.0, max: 1.0, step: 0.05},
    spiralize:     {v: 0.0, min: 0.0, max: 1.0},
    column_offset: {label: "offset (v)", v: 2., min: 0.0, max: 12.0, step: 0.1},
    edo:           {label: "EDO", v: 12, min: 1, max: 128},
    tilt:          {label: "rotate", v: 0.0, min: 0.0, max: 1.0, step: 0.01},
    start_pos_x:   {label: "origin (h)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    start_pos_y:   {label: "origin (v)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    origin_freq:   {label: "origin freq", v: 220, min: 55, max: 880},
    gain:          {label: "gain", v: 0.5, min: 0.0, max: 1.0, step: 0.05},
    delay:         {v: 0.2, min: 0, max: 1, step: 0.05}
}

const vertex_source = /*glsl*/`#version 300 es 
    layout(location = 0) in vec4 a_position;
    out vec2 v_tex_coord;

    void main() {
        v_tex_coord = a_position.xy * 0.5 + 0.5;
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

    layout(location = 0) out vec4 outDisplay;
    layout(location = 1) out vec4 outData;

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

    vec3 hsv2rgb(vec3 c) { // for range 0-1
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
        // start with actual pixel scale, 1.0 = 1px., at start pos which is in normal 0-1 uv space.
        // half pixel offset for alignment, not sure if that makes sense.
        vec2 uv = gl_FragCoord.xy - (u_start_pos * u_resolution) + 0.5;

        if (u_spiralize == 1.) {
            uv = spiralize(uv);
        } else {
            uv = gridize(uv);
        }

        // warp grid in x to make column offset smooth or sharp
        float column_x = uv.x;
        if (u_grid_sharp.x == 1.0) {
            column_x = floor(column_x + 0.5);
        } else if (u_grid_sharp.x > 0.0) {
            float half_s = u_grid_sharp.x / 2.;
            column_x = floor(column_x) + smoothstep(half_s, 1.-half_s, mod(column_x, 1.0));
        }
        // apply offset per column
        uv.y += column_x * u_column_offset;

        float pitch_in_octave = mod(uv.y, 1.0);
        // separate octave into steps
        if (u_grid_sharp.y == 1.0) {
            pitch_in_octave = floor(pitch_in_octave * u_edo + 0.5) / u_edo;
        } else if (u_grid_sharp.y > 0.0) {
            float half_s = u_grid_sharp.y / 2.;
            pitch_in_octave *= u_edo;
            pitch_in_octave = floor(pitch_in_octave) + smoothstep(half_s, 1.-half_s, mod(pitch_in_octave, 1.0));
            pitch_in_octave /= u_edo;
        }

        // support 16 octaves with uv.y = 0 being in the middle of the range.
        float normalized_pitch = (pitch_in_octave + floor(uv.y) + 8.) / 16.;
        float data_r = (floor(normalized_pitch * 256.0) + 0.5) / 255.0;
        float data_g = mod(normalized_pitch * 256.0, 1.);
        outData = vec4(data_r, data_g, 0., 1.);


        float hightlight = 0.0;
        // highlight playing pitches
        for (int i = 0; i < 16; i++) {
            if (u_playing_pitches_count == i) { break; }
            float rect_height = max(0.25, u_grid_sharp.y) / u_edo;
            if (abs(u_playing_pitches[i] - uv.y) < 0.5 * rect_height) {
                hightlight = 1.0;
            }
        }
        // highlight edo steps with centered dots
        float dotl = 2. - u_grid_sharp.y;
        vec2 step_uv = vec2(
            mod(uv.x + 0.5, 1.0) - 0.5, 
            (mod(uv.y * u_edo + 0.5, 1.0) - 0.5) * dotl
        );
        float dot_dist = distance(step_uv, vec2(0.0)) * 2.;
        hightlight = max(hightlight, 1. - smoothstep(0.0, 1.0, dot_dist));

        // not initiated yet, show that somehow.
        float dim = 1.;
        if (u_time == 0.) {
            dim = 0.5;
        }

        outDisplay = vec4(hsv2rgb(vec3(pitch_in_octave, hightlight * 0.1 + 0.7, (hightlight * 0.6 + 0.4) * dim)), 1.0);
    }
`;

const blit_fragment_source = /*glsl*/`#version 300 es
    precision highp float;

    in vec2 v_tex_coord;
    uniform sampler2D u_screen_texture;

    out vec4 outColor;

    void main() {
        outColor = texture(u_screen_texture, v_tex_coord);
    }
`;

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

let shader_program, blit_program;
function setup_shaders() {
    // compile the shaders
    const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_source);
    const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_source);
    const blit_fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, blit_fragment_source);

    shader_program = create_program(gl, vertex_shader, fragment_shader);
    blit_program = create_program(gl, vertex_shader, blit_fragment_shader);

    const position_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    
    // match layout(location = 0) in vertex shader
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
setup_shaders();

const display_texture = gl.createTexture();
const data_texture = gl.createTexture();
function resize_canvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.bindTexture(gl.TEXTURE_2D, display_texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, data_texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
}
window.addEventListener('resize', resize_canvas);
resize_canvas();

const fbo = gl.createFramebuffer();
function setup_fbo() {
    gl.bindTexture(gl.TEXTURE_2D, display_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, data_texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    // match fragment shader locations
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, display_texture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, data_texture, 0);
    
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error('Framebuffer incomplete:', status);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
setup_fbo();

// each is {octaves, pointer_id, group}
let playing_pitches = [];
let audio_started = false;
function set_uniforms(program, time) {
    function at(string) { return gl.getUniformLocation(program, string); }

    const pitches_in_octaves = (playing_pitches.length > 0) ? playing_pitches.map((o) => o.octaves) : [-99];

    gl.uniform2f(at('u_resolution')           , gl.canvas.width, gl.canvas.height);
    gl.uniform1f(at('u_time')                 , audio_started ? time * 0.001 : 0);
    gl.uniform1fv(at('u_playing_pitches')     , pitches_in_octaves);
    gl.uniform1i(at('u_playing_pitches_count'), playing_pitches.length);
    gl.uniform1f(at('u_spiralize')            , settings.spiralize.v);
    gl.uniform2f(at('u_start_pos')            , settings.start_pos_x.v, settings.start_pos_y.v);
    gl.uniform2f(at('u_grid_size')            , settings.grid_size_x.v, settings.grid_size_y.v);
    gl.uniform2f(at('u_grid_sharp')           , settings.grid_sharp_x.v, settings.grid_sharp_y.v);
    gl.uniform1f(at('u_column_offset')        , settings.column_offset.v / 12);
    gl.uniform1f(at('u_tilt')                 , settings.tilt.v);
    gl.uniform1f(at('u_edo')                  , settings.edo.v);
}

function render(gl, time) {
    // draw both textures
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.useProgram(shader_program);
    set_uniforms(shader_program, time);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // assume no VAO

    // blit display texture to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(blit_program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, display_texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function animate(time) {
    render(gl, time);
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

const intro_text_el = document.getElementById("intro_text");
const init_audio = new Promise((resolve) =>
    document.addEventListener("click", function init() {
        const audio_context = new AudioContext();
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const x = e.clientX;
    const y = e.clientY;
    const data = new Uint8Array(4);
    gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const steps_16bit = (data[0] << 8) | data[1]; 
    const octaves = (steps_16bit / 65535) * 16 - 8; // assume 16 octaves total with the middle point of the range being the origin
    let freq = settings.origin_freq.v * (2 ** octaves);
    //console.log(`octaves: ${octaves}, freq: ${freq}.`)

    if (p_index == -1) {
        // new
        playing_pitches.push({pointer_id: p_id, octaves, group});
    } else {
        playing_pitches[p_index].octaves = octaves;
    }

    freq = Math.min(freq, 20000);
    dough.evaluate({
        dough: "play", group, voices: 1,
        freq, glide: 0.1, gain: settings.gain.v, lpf: 7000,
        s: "saw", vib: 6, vibmod: 0.05, phaser: 0.5, phaserdepth: 0.1,
        attack: .02, release: .3, delay: settings.delay.v
    });
}
canvas.addEventListener('pointerdown', touched_canvas);
canvas.addEventListener('pointermove', touched_canvas);
canvas.addEventListener('pointerup', touched_canvas);
canvas.addEventListener('pointerout', touched_canvas);

function add_range_els(parent_el, value, id, name, min, max, step) {
    const range_el = document.createElement("input");
    range_el.type = "range";
    range_el.id = "range_" + id;
    range_el.name = name;
    if (min) range_el.min = min;
    if (max) range_el.max = max;
    if (step) range_el.step = step;
    range_el.value = value;

    const label_div_el = document.createElement("div");
    const label_el = document.createElement("label");
    const value_el = document.createElement("label");
    label_el.innerHTML = name;
    value_el.innerHTML = value;
    label_div_el.appendChild(label_el);
    label_div_el.appendChild(value_el);
    label_el.classList.add("label-param");
    value_el.classList.add("label-value");
    value_el.id = "value_label_" + id;
    label_div_el.classList.add("label-group");
    
    range_el.addEventListener("input", (e) => {
        const v = e.target.value;
        settings[id].v = v;
        value_el.innerHTML = v;
    });

    parent_el.appendChild(label_div_el);
    parent_el.appendChild(range_el);
}

let menu_shown = true;
function make_menu() {
    const menu_list_el = document.getElementById("menu-list");
    const buttons_el = document.getElementById("menu-buttons");
    const about_text_el = document.getElementById("about-text");

    for (const [param, details] of Object.entries(settings)) {
        const {v, min, max, step} = details;
        const name = details.label ?? param;
        details.default = v;
        add_range_els(menu_list_el, v, param, name, min, max, step);
    }

    const hide_button_el = document.createElement("button");
    hide_button_el.innerText = "hide";
    hide_button_el.addEventListener("click", (e) => {
        menu_shown = !menu_shown;
        hide_button_el.innerText = menu_shown ? "hide" : "show";
        reset_button_el.style.display = menu_shown ? "inline-block" : "none";

        menu_list_el.style.display = menu_shown ? "grid" : "none";
        about_text_el.style.display = menu_shown ? "inline" : "none";
    });
    const reset_button_el = document.createElement("button");
    reset_button_el.innerText = "reset to default";
    reset_button_el.addEventListener("click", (e) => {
        for (const [param, details] of Object.entries(settings)) {
            const range_el = document.getElementById("range_" + param);
            const label_el = document.getElementById("value_label_" + param);
            range_el.value = details.default;
            label_el.innerHTML = details.default;
            details.v = details.default;
        }
    });
    
    
    buttons_el.appendChild(hide_button_el);
    buttons_el.appendChild(reset_button_el);
}
make_menu();