import { Grid } from "./ui/Grid";
import { FormulaBar, type FormulaBarRef } from "./ui/FormulaBar";
import { Inspector } from "./ui/Inspector";
import { graph } from "./graphInstance";
import { useTranslation } from "./ui/i18n";
import { useState, useRef, useEffect } from "react";
import "./App.css";

function App() {
  const { lang, setLang, t } = useTranslation();
  const [maxComps, setMaxComps] = useState(200);
  const [selectedId, setSelectedId] = useState<string | null>("A1");
  const [refreshTick, setRefreshTick] = useState(0);
  const [filename, setFilename] = useState("Untitled");

  const formulaBarRef = useRef<FormulaBarRef>(null);

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value) || 200;
    setMaxComps(val);
    graph.setGlobalConfig({ maxComponents: val });
  };

  const notifyUpdate = () => {
    setRefreshTick((t) => t + 1);
  };

  useEffect(() => {
    return graph.subscribe(notifyUpdate);
  }, []);

  const handleStartTyping = (char: string) => {
    formulaBarRef.current?.beginEdit(char);
  };

  return (
    <div className="App">
      <div className="toolbar">
        <div className="header-title">
          <h1>{t("title")}</h1>
          <input
            className="filename-input"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </div>
        <div className="settings">
          <label style={{ marginRight: 10, fontSize: "0.9rem" }}>
            {t("maxComps")}:
            <input
              type="number"
              value={maxComps}
              onChange={handleMaxChange}
              style={{ width: 60, marginLeft: 5 }}
            />
          </label>
        </div>
        <div className="file-actions" style={{ marginLeft: 20 }}>
          <button
            onClick={() => {
              const json = graph.toJSON();
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${filename}.bnp`;
              a.click();
            }}
          >
            {t("save")}
          </button>
          <button
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json,.bnp,application/json,text/plain"; // Broaden support for iOS
              input.onchange = (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (re) => {
                    try {
                      const text = re.target?.result as string;
                      if (text) {
                        graph.fromJSON(text);
                        notifyUpdate();
                      }
                    } catch (err) {
                      alert("Error parsing file: " + err);
                    }
                  };
                  reader.onerror = () => {
                    alert("Failed to read file.");
                  };
                  reader.readAsText(file);
                }
              };
              input.click();
            }}
          >
            {t("load")}
          </button>
        </div>
        <div className="lang-toggle">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as "en" | "ja")}
            style={{ marginLeft: 10, padding: 4 }}
          >
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>
      </div>

      <div className="formula-bar-container">
        <div className="fx-icon">ƒx</div>
        <FormulaBar
          ref={formulaBarRef}
          selectedId={selectedId}
          onCommit={(val) => {
            if (selectedId) {
              graph.setCellInput(selectedId, val);
              notifyUpdate();
            }
          }}
        />
      </div>

      <div className="main-content">
        <div className="grid-pane">
          <Grid
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdate={notifyUpdate}
            onStartTyping={handleStartTyping}
            externalTick={refreshTick}
          />
        </div>
        <div className="inspector-pane">
          <Inspector selectedId={selectedId} externalTick={refreshTick} />
        </div>
      </div>
    </div>
  );
}

export default App;
