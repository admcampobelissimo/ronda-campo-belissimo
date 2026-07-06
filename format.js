export function pad(n) { return String(n).padStart(2, "0"); }

export function formatDateTime(d) {
  d = new Date(d);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDate(d) {
  d = new Date(d);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatTime(d) {
  d = new Date(d);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function slugify(str) {
  return str
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
