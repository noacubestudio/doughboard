import * as Render from "./render.js";
import * as UI from "./ui.js";
import { Dough } from "./dough-synth/dough.js";

const settings = {
    grid_size_x:   {label: "zoom (h)", v: 50, min: 20, max: 200},
    grid_size_y:   {label: "zoom (v)", v: 600, min: 100, max: 1400, step: 5},
    grid_sharp_x:  {label: "sharp (h)", v: 0.8, min: 0.0, max: 1.0, step: 0.05},
    grid_sharp_y:  {label: "sharp (v)", v: 0.6, min: 0.0, max: 1.0, step: 0.05},
    spiralize:     {v: 0.0, min: 0.0, max: 1.0},
    column_offset: {label: "offset (v)", v: 2., min: 0.0, max: 12.0, step: 0.1},
    edo:           {label: "EDO", v: 12, min: 1, max: 128},
    tilt:          {label: "rotate", v: 0, min: 0, max: 360, step: 1},
    start_pos_x:   {label: "origin (h)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    start_pos_y:   {label: "origin (v)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    origin_freq:   {label: "origin freq", v: 220, min: 55, max: 880, pow: true, round: 1},
    gain:          {v: 0.5, min: 0.0, max: 1.0, pow: true},
    attack:        {v: 0.02, min: 0.01, max: 0.5, pow: true},
    release:       {v: 0.3, min: 0, max: 2, pow: true},
    delay:         {v: 0.2, min: 0, max: 1, pow: true},
    reverb:        {v: 0.0, min: 0, max: 1, pow: true}
}

let playing_pitches = []; // [{octaves, pointer_id, group}, ...]
let audio_started = false;

const canvas = document.getElementById("gl_canvas");


// rendering

Render.setup_rendering(canvas, window.innerWidth, window.innerHeight);

window.addEventListener("resize", () => {
    Render.resize_canvas(canvas, window.innerWidth, window.innerHeight);
});

function animate(time) {
    Render.render(time, settings, playing_pitches, audio_started);
    requestAnimationFrame(animate);
}
requestAnimationFrame(animate);


// interaction -> audio

const dough = new Dough({base: "./dough-synth/"});

const init_audio = new Promise((resolve) => {
    const intro_text_el = document.getElementById("intro-text");
    document.addEventListener("click", function init() {
        const audio_context = new AudioContext();
        resolve(audio_context);
        audio_started = true;
        intro_text_el.style.display = "none";
        document.removeEventListener("click", init);
    });
});

async function touched_canvas(e) {
    await init_audio;
    if (!dough) return;
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
    const y = canvas.height - e.clientY;
    const rgba = Render.get_pixel_float_rgba(x, y); // red channel is 16f float where 1. = 1 octave
    const octaves = rgba[0];
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
        freq, glide: 0.1, 
        gain: settings.gain.v, 
        lpf: 7000,
        s: "saw", 
        vib: 6, vibmod: 0.05, 
        phaser: 0.5, phaserdepth: 0.1,
        attack: settings.attack.v, 
        release: settings.release.v, 
        delay: settings.delay.v,
        verb: settings.reverb.v
    });
}
canvas.addEventListener("pointerdown", touched_canvas);
canvas.addEventListener("pointermove", touched_canvas);
canvas.addEventListener("pointerup", touched_canvas);
canvas.addEventListener("pointerout", touched_canvas);

// fix to allow scribble feature on iPadOS, or something. copied from another project. hope it does something useful.
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }); 


// ui

UI.make_menu(settings);