const changed_settings = new CustomEvent("changed_settings", {detail: {sound_only: false}});
const changed_sound = new CustomEvent("changed_settings", {detail: {sound_only: true}});

const SETTING_EL_ID_PREFIX = "set_input_";

function normalize_pow_value(value, min, max) {
    return Math.sqrt((value - min) / (max - min));
}

function add_setting_div(parent_el, id, details) {
    const {v: value, min, max, step, type, round} = details;
    const name = details.label ?? id;

    // make label

    const label_div_el = document.createElement("div");

    const label_el = document.createElement("label");
    label_el.innerHTML = name;
    label_div_el.appendChild(label_el);
    label_el.classList.add("label-param");

    let value_el;
    if (type !== "select") {
        value_el = document.createElement("label");
        value_el.innerHTML = value;
        label_div_el.appendChild(value_el);
        value_el.classList.add("label-value");
        value_el.id = "value_label_" + id;
    }

    parent_el.appendChild(label_div_el);
    label_div_el.classList.add("label-group");

    // make input 
    if (type === "select") {
        const select_el = document.createElement("select");

        select_el.id = SETTING_EL_ID_PREFIX + id;
        select_el.name = name;

        details.options.forEach((option) => {
            const option_el = document.createElement("option");
            option_el.text = option;
            option_el.id = option;
            select_el.add(option_el);
        });

        select_el.addEventListener("change", () => {
            details.v = select_el.value;
            document.dispatchEvent(type == "sound" ? changed_sound : changed_settings); // this makes no sense now grr
        });

        parent_el.appendChild(select_el);
    } else {
        const range_el = document.createElement("input");
        range_el.type = "range";
        range_el.id = SETTING_EL_ID_PREFIX + id;
        range_el.name = name;

        if (type === "range") {
            if (min) range_el.min = min;
            if (max) range_el.max = max;
            if (step) range_el.step = step;
            range_el.value = value;
        } else if (type === "sound") {
            range_el.min = 0;
            range_el.max = 1;
            range_el.step = 0.0001;
            range_el.value = normalize_pow_value(value, min, max);
        }
        
        range_el.addEventListener("input", (e) => {
            let new_value = e.target.value;
            if (type == "sound") {
                new_value = min + (new_value ** 2) * (max-min);
            }
            if (type == "sound" || round) {
                const factor = round ?? 100;
                new_value = Math.round(new_value * factor) / factor;
            }
            details.v = new_value;
            value_el.innerHTML = new_value;
            document.dispatchEvent(type == "sound" ? changed_sound : changed_settings);
        });

        parent_el.appendChild(range_el);
    }
}

let menu_shown = true;

export function make_menu(settings) {
    const menu_list_el = document.getElementById("menu-list");
    const menu_top_el = document.getElementById("menu-top");
    const buttons_el = document.getElementById("menu-buttons");
    const about_text_el = document.getElementById("about-text");

    for (const [setting_key, setting_obj] of Object.entries(settings)) {
        // store the initial values while making the menu.
        setting_obj.initial_v = setting_obj.v;

        // make inputs with label and number display for the setting.
        add_setting_div(menu_list_el, setting_key, setting_obj);
    }

    const hide_button_el = document.createElement("button");
    hide_button_el.innerText = "hide";
    hide_button_el.addEventListener("click", (e) => {
        menu_shown = !menu_shown;
        hide_button_el.innerText = menu_shown ? "hide" : "menu";
        reset_button_el.style.display = menu_shown ? "inline-block" : "none";
        menu_top_el.style.flexDirection = menu_shown ? "column" : "row";
        menu_top_el.style.alignItems = menu_shown ? "flex-start" : "baseline";

        menu_list_el.style.display = menu_shown ? "grid" : "none";
        about_text_el.style.display = menu_shown ? "inline" : "none";
    });
    const reset_button_el = document.createElement("button");
    reset_button_el.innerText = "reset to default";
    reset_button_el.addEventListener("click", (e) => {
        for (const [param, details] of Object.entries(settings)) {
            const {initial_v, min, max, type} = details;
            details.v = initial_v;

            const value_el = document.getElementById("value_label_" + param);
            if (value_el) { value_el.innerHTML = initial_v; }

            const input_el = document.getElementById(SETTING_EL_ID_PREFIX + param);

            if (type === "sound") {
                input_el.value = normalize_pow_value(initial_v, min, max);
            } else {
                input_el.value = initial_v;
            }
        }
        document.dispatchEvent(changed_settings);
    });
    
    buttons_el.appendChild(hide_button_el);
    buttons_el.appendChild(reset_button_el);
}

const playing_pitches_text_el = document.getElementById("playing-pitches");
export function write_playing_pitches(playing_pitches) {
    const pitches_string = playing_pitches.map(voice => Math.round(voice.octaves * 1200)).join(",");
    playing_pitches_text_el.innerHTML = pitches_string ? pitches_string : "-";
    playing_pitches_text_el.style.opacity = pitches_string ? 1.0 : 0.5;
}