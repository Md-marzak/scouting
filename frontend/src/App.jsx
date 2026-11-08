import { useEffect, useState } from "react";
import { api } from "./api";
import Search from "./Search";
import Rules from "./Rules";
import PlayerCheck from "./PlayerCheck";

export default function App() {
  const [tab, setTab] = useState("search");
  const [meta, setMeta] = useState(null);
  const [names, setNames] = useState([]);
  const [name, setName] = useState("");
  const [profile, setProfile] = useState(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async (n) => {
    try {
      const p = await api.getProfile(n);
      setProfile(p);
      setSaved(JSON.stringify(p));
      setName(n);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [m, ps] = await Promise.all([api.meta(), api.profiles()]);
        setMeta(m);
        setNames(ps);
        await load(ps.includes("cam_default") ? "cam_default" : ps[0]);
      } catch (e) {
        setError(`Impossible de joindre l'API (${e.message}). Le serveur FastAPI est-il lancé sur le port 8000 ?`);
      }
    })();
  }, []);

  const save = async (n) => {
    try {
      await api.saveProfile(n, profile);
      setNames(await api.profiles());
      setName(n);
      setSaved(JSON.stringify(profile));
      setError("");
      setNotice(`Profil « ${n} » enregistré`);
      setTimeout(() => setNotice(""), 2500);
    } catch (e) {
      setError(e.message);
    }
  };

  const dirty = profile && JSON.stringify(profile) !== saved;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Scouting flou</h1>
          <p className="muted">{meta ? `Milieux offensifs : ${meta.n} joueurs analysés` : "Chargement…"}</p>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button aria-current={tab === "search"} onClick={() => setTab("search")}>Besoin client</button>
          <button aria-current={tab === "custom"} onClick={() => setTab("custom")}>Mon joueur</button>
          <button aria-current={tab === "rules"} onClick={() => setTab("rules")}>Règles du client</button>
        </nav>
        <div className="profile-pick">
          <label htmlFor="prof">Profil client</label>
          <select id="prof" value={name} onChange={(e) => load(e.target.value)}>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
          {dirty && <span className="badge">modifié, non enregistré</span>}
        </div>
      </header>

      {error && <div className="banner error" role="alert">{error}</div>}
      {notice && <div className="banner ok" role="status">{notice}</div>}

      {profile && meta && (
        <main>
          {tab === "search" ? <Search profile={profile} meta={meta} />
            : tab === "custom" ? <PlayerCheck profile={profile} />
              : <Rules profile={profile} setProfile={setProfile} name={name} save={save} />}
        </main>
      )}
    </div>
  );
}
