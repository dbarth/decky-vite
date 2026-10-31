// The harness screen: Steam's header and footer around the plugin's routes, its Quick Access
// panel, modals and toasts.
import { CSSProperties, ReactNode, useEffect, useReducer } from "react";
import { Glyph } from "./decky-ui";
import { hints, onFocusChange } from "./focus";
import { input } from "./input";
import { path, setQam, shell, useShell } from "./shell";

export interface Plugin {
  name: string;
  titleView?: ReactNode;
  content: ReactNode;
  icon: ReactNode;
}

// Steam's status bar, with its id and the opacities a page can override. Its universal search
// fills the free width and catches taps there; the icons keep the right 282px.
function Header() {
  const now = new Date();
  const opacities = { "--gamepadui-header-opacity": 1, "--gamepadui-header-background-opacity": 1 };
  return (
    <div id="header" className="dv-header" style={opacities as CSSProperties}>
      <div className="dv-usearch">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="5" /><path d="M10.5 10.5 15 15" />
        </svg>
      </div>
      <span className="dv-hicon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0Z" />
        </svg>
      </span>
      <span className="dv-hicon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M4 14a6 6 0 0 1 6 6M4 9a11 11 0 0 1 11 11M4 4a16 16 0 0 1 16 16" />
        </svg>
      </span>
      <span className="dv-hbattery"><span className="dv-battery" /></span>
      <span className="dv-clock">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
      <span className="dv-qambutton" onClick={() => setQam(!shell.qam)}>•••</span>
    </div>
  );
}

function Footer() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onFocusChange(bump), []);
  return (
    <div className="dv-footer">
      <span className="dv-hint"><Glyph name="sc_button_steam" label="Steam" className="dv-button" />Menu</span>
      <span className="dv-fill" />
      {hints().map(([b, label]) => (
        <span key={b} className="dv-hint" onClick={() => input(b)}>
          <Glyph name={`shared_button_${b.toLowerCase()}`} label={b} className="dv-button" />{label}
        </span>
      ))}
    </div>
  );
}

function Library() {
  return (
    <div className="dv-library">
      <div className="dv-libtitle">Library</div>
      <p>Press Q or the ••• button for the Quick Access menu.</p>
    </div>
  );
}

// Decky's view of an open plugin: its back button and the plugin's title in a row of Steam's Title
// class, then the plugin's content. The tab column holds the plugin's tab alone. The back button
// takes no focus here.
function Qam({ plugin }: { plugin: Plugin }) {
  return (
    <div className="dv-qam" data-layer="">
      <div className="dv-qamtabs"><span className="dv-qamtab">{plugin.icon}</span></div>
      <div className="dv-qampanel">
        <div className="dv-qamtitle dv-static-Title">
          <span className="DialogButton _DialogLayout Secondary Focusable dv-qamback">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 8H2M8 2 2 8l6 6" />
            </svg>
          </span>
          {plugin.titleView ?? <div className="dv-static-Title">{plugin.name}</div>}
        </div>
        <div className="dv-qamcontent">{plugin.content}</div>
      </div>
    </div>
  );
}

export function App({ plugin }: { plugin: Plugin }) {
  const s = useShell();
  const Route = s.routes.get(path());
  return (
    <div className="dv-screen">
      <div className="dv-route" data-layer="">{Route ? <Route /> : <Library />}</div>
      {/* Steam veils the page under the open Quick Access menu. A click on the veil closes the menu. */}
      <div className={s.qam ? "dv-veil dv-on" : "dv-veil"} onClick={() => setQam(false)} />
      <Header />
      <Footer />
      {s.qam && <Qam plugin={plugin} />}
      {s.modals.map((m) => <div key={m.id} className="dv-modalhost" data-layer="">{m.element}</div>)}
      <div className="dv-toasts">
        {s.toasts.map((t) => (
          <div key={t.id} className="dv-toast"><b>{t.title}</b><div>{t.body}</div></div>
        ))}
      </div>
    </div>
  );
}
