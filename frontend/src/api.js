const json = async (r) => {
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const d = await r.json();
      msg = typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail);
    } catch {}
    throw new Error(msg);
  }
  return r.json();
};
const send = (method, url, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);

export const api = {
  meta: () => fetch("/api/meta").then(json),
  profiles: () => fetch("/api/profiles").then(json),
  getProfile: (n) => fetch(`/api/profiles/${n}`).then(json),
  saveProfile: (n, p) => send("PUT", `/api/profiles/${n}`, p),
  search: (body) => send("POST", "/api/search", body),
  catalog: () => fetch("/api/catalog").then(json),
  needsSearch: (body) => send("POST", "/api/needs-search", body),
  evaluatePlayer: (body) => send("POST", "/api/evaluate-player", body),
  explainPlayer: (body) => send("POST", "/api/explain-player", body),
  suggest: (body) => send("POST", "/api/suggest-rules", body),
};

export const LEVELS = [["low", "Faible"], ["mid", "Moyen"], ["high", "Élevé"]];
export const levelLabel = (k) => LEVELS.find(([v]) => v === k)[1];
export const ruleText = (r) =>
  `SI ${r.if.map((c) => `${c.var} = ${levelLabel(c.is)}`).join(r.op === "OR" ? " OU " : " ET ")} ALORS ${r.then}`;
