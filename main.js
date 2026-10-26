import * as Render from "./render.js";
import * as UI from "./ui.js";
import { Dough } from "./dough-synth/dough.js";

const settings = {
    grid_size_x:   {type: "range", label: "zoom (h)", v: 50, min: 20, max: 200},
    grid_size_y:   {type: "range", label: "zoom (v)", v: 600, min: 100, max: 1400, step: 5},
    grid_sharp_x:  {type: "range", label: "sharp (h)", v: 0.8, min: 0.0, max: 1.0, step: 0.05},
    grid_sharp_y:  {type: "range", label: "sharp (v)", v: 0.6, min: 0.0, max: 1.0, step: 0.05},
    warp_mode:     {type: "range", label: "warp mode", v: 0, min: 0, max: 2},
    column_offset: {type: "range", label: "offset (v)", v: 2., min: 0.0, max: 12.0, step: 0.1},
    edo:           {type: "range", label: "EDO", v: 12, min: 1, max: 128},
    tilt:          {type: "range", label: "rotate", v: 0, min: 0, max: 360, step: 1},
    start_pos_x:   {type: "range", label: "origin (h)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    start_pos_y:   {type: "range", label: "origin (v)", v: 0.5, min: 0.0, max: 1.0, step: 0.01},
    origin_freq:   {type: "sound", label: "origin freq", v: 220, min: 55, max: 880, round: 1},
    gain:          {type: "sound", v: 0.5, min: 0.0, max: 1.0},
    sound:         {type: "select", v: "saw", options: ["saw", "tri", "sine"]},
    attack:        {type: "sound", v: 0.02, min: 0.01, max: 0.5},
    release:       {type: "sound", v: 0.3, min: 0, max: 2},
    delay:         {type: "sound", v: 0.2, min: 0, max: 1},
    reverb:        {type: "sound", v: 0.0, min: 0, max: 1}
}

let playing_pitches = []; // [{last_event, group, octaves}, ...]
let audio_started = false;
let pending_refresh_all_pitches = false;

const canvas = document.getElementById("gl_canvas");


// rendering

Render.setup_rendering(canvas, window.innerWidth, window.innerHeight);

window.addEventListener("resize", () => {
    Render.resize_canvas(canvas, window.innerWidth, window.innerHeight);
});

function animate(time) {
    Render.render(time, settings, playing_pitches, audio_started);

    if (pending_refresh_all_pitches) {
        pending_refresh_all_pitches = false;

        playing_pitches.forEach(({last_event, group}, index) => {
            const x = last_event.clientX;
            const y = canvas.height - last_event.clientY;
            const rgba = Render.get_pixel_float_rgba(x, y); // red channel is float value where 1. = 1 octave
            const octaves = rgba[0];

            playing_pitches[index].octaves = octaves;
            play_voice(group, octaves);
        });
        UI.write_playing_pitches(playing_pitches);
    }
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

function play_voice(group, octaves) {
    let freq = settings.origin_freq.v * (2 ** octaves);
    //console.log(`octaves: ${octaves}, freq: ${freq}.`)

    freq = Math.min(freq, 20000);
    dough.evaluate({
        dough: "play", group, voices: 1,
        freq, glide: 0.1, 
        gain: settings.gain.v, 
        lpf: 7000,
        s: settings.sound.v, 
        vib: 6, vibmod: 0.05, 
        phaser: 0.5, phaserdepth: 0.1,
        attack: settings.attack.v, 
        release: settings.release.v, 
        delay: settings.delay.v,
        verb: settings.reverb.v
    });
}

async function touched_canvas(e) {
    await init_audio;
    if (!dough) return;
    e.preventDefault();

    const existing_index = playing_pitches.findIndex((voice) => voice.last_event.pointerId === e.pointerId);

    if (e.type == "pointerup" || e.type == "pointerout") {
        // remove existing
        if (existing_index == -1) return;
        dough.evaluate({dough: "hush_group", group: playing_pitches[existing_index].group});
        playing_pitches.splice(existing_index, 1); 
        UI.write_playing_pitches(playing_pitches);
        return;
    } else if (e.type == "pointermove") {
        if (existing_index == -1) return;
    }

    const first_free = () => {
        for (let i = 0; i < 16; i++) {
            const group_index = playing_pitches.findIndex((o) => o.group == i);
            if (group_index == -1) return i;
        }
    }
    const group = (existing_index >= 0) ? playing_pitches[existing_index].group : first_free();

    // get the color at the cursor
    const x = e.clientX;
    const y = canvas.height - e.clientY;
    const rgba = Render.get_pixel_float_rgba(x, y); // red channel is float value where 1. = 1 octave
    const octaves = rgba[0];

    // add or update the note
    if (existing_index == -1) {
        playing_pitches.push({last_event: e, group, octaves});
    } else {
        playing_pitches[existing_index].octaves = octaves;
        playing_pitches[existing_index].last_event = e;
    }
    UI.write_playing_pitches(playing_pitches);

    play_voice(group, octaves);
}

canvas.addEventListener("pointerdown", touched_canvas);
canvas.addEventListener("pointermove", touched_canvas);
canvas.addEventListener("pointerup", touched_canvas);
canvas.addEventListener("pointerout", touched_canvas);

// fix to allow scribble feature on iPadOS, or something. copied from another project. hope it does something useful.
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }); 


// ui

UI.make_menu(settings);
UI.write_playing_pitches(playing_pitches);

document.addEventListener("changed_settings", (e) => {
    if (!dough) return;
    if (e.detail.sound_only) {
        playing_pitches.forEach(({group, octaves}) => {
            play_voice(group, octaves);
        });
        return;
    }
    // queue for next animation frame, when sliders have had an effect
    pending_refresh_all_pitches = true;
});