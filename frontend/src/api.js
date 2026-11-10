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
const call = async (url, options) => {
  try {
    return await json(await fetch(url, { cache: "no-store", ...options }));
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new Error("L'analyse n'a pas répondu. Relance-la.");
    }
    throw e;
  }
};
const send = (method, url, body) => call(url, {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
});

export const api = {
  meta: () => call("/api/meta"),
  profiles: () => call("/api/profiles"),
  getProfile: (n) => call(`/api/profiles/${n}`),
  saveProfile: (n, p) => send("PUT", `/api/profiles/${n}`, p),
  search: (body) => send("POST", "/api/search", body),
  catalog: () => call("/api/catalog"),
  needsSearch: (body) => send("POST", "/api/needs-search", body),
  evaluatePlayer: (body) => send("POST", "/api/evaluate-player", body),
  explainPlayer: (body) => send("POST", "/api/explain-player", body),
  suggest: (body) => send("POST", "/api/suggest-rules", body),
};

export const LEVELS = [["low", "Faible"], ["mid", "Moyen"], ["high", "Élevé"]];
export const levelLabel = (k) => LEVELS.find(([v]) => v === k)[1];
export const ruleText = (r) =>
  `SI ${r.if.map((c) => `${c.var} = ${levelLabel(c.is)}`).join(r.op === "OR" ? " OU " : " ET ")} ALORS ${r.then}`;
