import {okhsv_okhsl_conversion_source} from "./color-conversion.js";

let gl, shader_program, blit_program, display_texture, data_texture, fbo;

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

    uniform int u_warp_mode;
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

    ${okhsv_okhsl_conversion_source}

    void main() {
        // start with actual pixel scale, 1.0 = 1px., at start pos which is in normal 0-1 uv space.
        // half pixel offset for alignment, not sure if that makes sense.
        vec2 uv = gl_FragCoord.xy - (u_start_pos * u_resolution) + 0.5;

        if (u_warp_mode == 1) {
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
        if (u_warp_mode == 2) {
            if (column_x >= 0.) {
                column_x = log2(column_x + 1.);
            } else {
                column_x = -log2(1. - column_x);
            }
        }
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

        float output_pitch = pitch_in_octave + floor(uv.y);
        outData = vec4(output_pitch, 0.0, 0.0, 1.0);

        float highlight = 0.0;
        // highlight playing pitches
        for (int i = 0; i < 16; i++) {
            if (u_playing_pitches_count == i) { break; }
            float rect_height = max(0.25, u_grid_sharp.y) / u_edo;
            float pitch_dist = u_playing_pitches[i] - uv.y;
            if (abs(pitch_dist) < 0.5 * rect_height) {
                highlight = 1.0;
            } else if (mod(pitch_dist + 0.5 * rect_height, 1.) < rect_height) { 
                highlight = min(1., highlight += 0.12);
            }
        }
        // highlight edo steps with centered dots
        float dotl = 2. - u_grid_sharp.y;
        vec2 step_uv = vec2(
            mod(uv.x + 0.5, 1.0) - 0.5, 
            (mod(uv.y * u_edo + 0.5, 1.0) - 0.5) * dotl
        );
        float dot_dist = distance(step_uv, vec2(0.0)) * 2.;
        highlight = max(highlight, 1. - smoothstep(0.0, 1.0, dot_dist));

        // not initiated yet, show that somehow.
        float dim = 1.;
        if (u_time == 0.) {
            dim = 0.5;
        }
        float base_l = 0.4 * (uv.y / 16. + 0.5);
        float h = pitch_in_octave + 0.05;
        float s = highlight * 0.3 + 0.7;
        float l = clamp((highlight * 0.5 + base_l) * dim, 0.0, 1.0);
        outDisplay = vec4(okhsl_to_srgb(vec3(h, s, l)), 1.0);
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

export function setup_rendering(canvas) {
    gl = canvas.getContext("webgl2", {});
    if (!gl) { throw new Error("WebGL2 is not available in this browser."); }

    const float_extension = gl.getExtension("EXT_color_buffer_float"); // needed for 32f data framebuffer
    if (!float_extension) { console.error("This device can't render to float textures."); }

    // 1. setup shaders

    const vertex_shader = create_shader(gl.VERTEX_SHADER, vertex_source);
    const fragment_shader = create_shader(gl.FRAGMENT_SHADER, fragment_source);
    const blit_fragment_shader = create_shader(gl.FRAGMENT_SHADER, blit_fragment_source);

    shader_program = create_program(vertex_shader, fragment_shader);
    blit_program = create_program(vertex_shader, blit_fragment_shader);

    const position_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, position_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    
    gl.enableVertexAttribArray(0); // match layout(location = 0) in vertex shader
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 2. setup textures and fbo

    display_texture = gl.createTexture();
    data_texture = gl.createTexture();
    fbo = gl.createFramebuffer();

    resize_canvas(canvas, window.innerWidth, window.innerHeight);

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
        console.error("Framebuffer incomplete:", status);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function create_shader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function create_program(vertex_shader, fragment_shader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program linking error:", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

export function resize_canvas(canvas, w, h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.bindTexture(gl.TEXTURE_2D, display_texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindTexture(gl.TEXTURE_2D, data_texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, canvas.width, canvas.height, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function get_pixel_float_rgba(x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const data = new Float32Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.FLOAT, data);
    return data;
}

export function render(time, settings, playing_pitches, audio_started) {
    // draw both textures
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.useProgram(shader_program);
    set_uniforms(shader_program, audio_started ? time * 0.001 : 0, settings, playing_pitches);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // blit display texture to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(blit_program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, display_texture);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function set_uniforms(program, time, settings, playing_pitches) {
    function at(string) { return gl.getUniformLocation(program, string); }

    const pitches_in_octaves = (playing_pitches.length > 0) ? playing_pitches.map((voice) => voice.octaves) : [-99];

    gl.uniform2f(at("u_resolution")           , gl.canvas.width, gl.canvas.height);
    gl.uniform1f(at("u_time")                 , time);
    gl.uniform1fv(at("u_playing_pitches")     , pitches_in_octaves);
    gl.uniform1i(at("u_playing_pitches_count"), playing_pitches.length);
    gl.uniform1i(at("u_warp_mode")            , settings.warp_mode.v);
    gl.uniform2f(at("u_start_pos")            , settings.start_pos_x.v, settings.start_pos_y.v);
    gl.uniform2f(at("u_grid_size")            , settings.grid_size_x.v, settings.grid_size_y.v);
    gl.uniform2f(at("u_grid_sharp")           , settings.grid_sharp_x.v, settings.grid_sharp_y.v);
    gl.uniform1f(at("u_column_offset")        , settings.column_offset.v / 12);
    gl.uniform1f(at("u_tilt")                 , settings.tilt.v / 360);
    gl.uniform1f(at("u_edo")                  , settings.edo.v);
}
