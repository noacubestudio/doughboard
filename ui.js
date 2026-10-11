function add_range_els(parent_el, id, details) {
    const {v: value, min, max, step} = details;
    const name = details.label ?? id;

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
        const new_value = e.target.value;
        details.v = new_value;
        value_el.innerHTML = new_value;
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
        setting_obj.default = setting_obj.v;

        // make updateable slider with label and number display for the setting.
        add_range_els(menu_list_el, setting_key, setting_obj);
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