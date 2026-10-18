const changed_settings = new CustomEvent("changed_settings", {detail: {sound_only: false}});
const changed_sound = new CustomEvent("changed_settings", {detail: {sound_only: true}});

function normalize_pow_value(value, min, max) {
    return Math.sqrt((value - min) / (max - min));
}

function add_range_els(parent_el, id, details) {
    const {v: value, min, max, step, pow, round} = details;
    const name = details.label ?? id;

    const range_el = document.createElement("input");
    range_el.type = "range";
    range_el.id = "range_" + id;
    range_el.name = name;
    if (!pow) {
        if (min) range_el.min = min;
        if (max) range_el.max = max;
        if (step) range_el.step = step;
        range_el.value = value;
    } else {
        range_el.min = 0;
        range_el.max = 1;
        range_el.step = 0.0001;
        range_el.value = normalize_pow_value(value, min, max);
    }
    

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
        let new_value = e.target.value;
        if (pow) {
            new_value = min + (new_value ** 2) * (max-min);
        }
        if (pow || round) {
            const factor = round ?? 100;
            new_value = Math.round(new_value * factor) / factor;
        }
        details.v = new_value;
        value_el.innerHTML = new_value;
        document.dispatchEvent(details.sound_setting ? changed_sound : changed_settings);
    });

    parent_el.appendChild(label_div_el);
    parent_el.appendChild(range_el);
}

let menu_shown = true;

export function make_menu(settings) {
    const menu_list_el = document.getElementById("menu-list");
    const buttons_el = document.getElementById("menu-buttons");
    const about_text_el = document.getElementById("about-text");

    for (const [setting_key, setting_obj] of Object.entries(settings)) {
        // store the initial values while making the menu.
        setting_obj.initial_v = setting_obj.v;

        // make updateable slider with label and number display for the setting.
        add_range_els(menu_list_el, setting_key, setting_obj);
    }

    const hide_button_el = document.createElement("button");
    hide_button_el.innerText = "hide";
    hide_button_el.addEventListener("click", (e) => {
        menu_shown = !menu_shown;
        hide_button_el.innerText = menu_shown ? "hide" : "menu";
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

            const {pow, initial_v, min, max} = details;

            range_el.value = pow ? normalize_pow_value(initial_v, min, max) : initial_v;

            label_el.innerHTML = initial_v;
            details.v = initial_v;
        }
        document.dispatchEvent(changed_settings);
    });
    
    buttons_el.appendChild(hide_button_el);
    buttons_el.appendChild(reset_button_el);
}