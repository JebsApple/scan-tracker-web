// El sprite (<symbol id="i-...">) vive inline en index.html, inyectado antes
// del primer render() para que estos <use> resuelvan sin parpadeo.
export const icon = (name, cls = "") => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;
