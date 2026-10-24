// Small pure helpers: the URL ↔ params sync, JSON re-indenting on the text, DOM shortcuts.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

// ---- URL ↔ params ------------------------------------------------------------------------
// The URL is the truth for what is sent; the params table mirrors its query and also keeps
// the disabled rows (which are not in the URL). Keys and values are kept as typed (encoded
// or not): the program percent-encodes what needs it when sending, so nothing is encoded twice.

/// [base, query] of a URL: the query without "?" and without the fragment.
export function splitUrl(url) {
  const hash = url.indexOf("#");
  const noHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = noHash.indexOf("?");
  if (q < 0) return [noHash, null];
  return [noHash.slice(0, q), noHash.slice(q + 1)];
}

export function parseQuery(query) {
  if (query == null || query === "") return [];
  return query.split("&").filter((part) => part !== "").map((part) => {
    const eq = part.indexOf("=");
    return eq < 0
      ? { key: part, value: "", enabled: true }
      : { key: part.slice(0, eq), value: part.slice(eq + 1), enabled: true };
  });
}

// "flag" and "flag=" mean the same to servers; an empty value is written bare.
function renderParam(p) {
  return p.value === "" ? p.key : `${p.key}=${p.value}`;
}

/// The params after the user edited the URL: the URL's query, then the disabled rows kept.
export function paramsFromUrl(url, previous) {
  const [, query] = splitUrl(url);
  const fromUrl = parseQuery(query);
  const disabled = (previous || []).filter((p) => !p.enabled);
  return [...fromUrl, ...disabled];
}

/// The URL after the user edited the params table.
export function urlFromParams(url, params) {
  const hash = url.indexOf("#");
  const fragment = hash >= 0 ? url.slice(hash) : "";
  const [base] = splitUrl(url);
  const on = params.filter((p) => p.enabled && (p.key !== "" || p.value !== ""));
  const query = on.map(renderParam).join("&");
  return base + (on.length ? "?" + query : "") + fragment;
}

// ---- JSON ----------------------------------------------------------------------------------

/// Re-indents JSON text without parsing numbers (JSON.parse would round 64-bit ids) and keeps
/// the key order; throws a SyntaxError when it is not JSON.
export function reindentJson(text, indent = 2) {
  JSON.parse(text); // validation only
  const pad = (n) => "\n" + " ".repeat(n * indent);
  let out = "";
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") { out += text[++i]; }
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === " " || c === "\n" || c === "\r" || c === "\t") continue;
    if (c === "{" || c === "[") {
      // An empty {} or [] stays on one line.
      let j = i + 1;
      while (j < text.length && " \n\r\t".includes(text[j])) j++;
      if (text[j] === (c === "{" ? "}" : "]")) { out += c + text[j]; i = j; continue; }
      depth++;
      out += c + pad(depth);
    } else if (c === "}" || c === "]") {
      depth--;
      out += pad(depth) + c;
    } else if (c === ",") {
      out += "," + pad(depth);
    } else if (c === ":") {
      out += ": ";
    } else {
      out += c;
    }
  }
  return out;
}

export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
