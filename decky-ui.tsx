// Stands in for the @decky/ui components the plugin uses. They render plain elements with the
// class names Steam gives its own, and register their handlers with the focus engine.
import {
  CSSProperties, ForwardedRef, ReactNode, createContext, forwardRef, useCallback, useContext, useEffect, useRef,
  useState,
} from "react";
import { Dir, NodeProps, focus, focusFirst, focused, register, rendered } from "./focus";
import { back, navigate, openModal, path, replace, setQam } from "./shell";
import { runningApp } from "./steam";

function useNode<T extends HTMLElement>(p: NodeProps, outer?: ForwardedRef<T>, autoFocus?: boolean) {
  const latest = useRef(p);
  latest.current = p;
  const own = useRef<T | null>(null);
  useEffect(() => {
    if (autoFocus && own.current) focus(own.current);
  }, []);
  useEffect(() => rendered(own.current));
  return useCallback((el: T | null) => {
    own.current = el;
    if (el) register(el, latest);
    if (typeof outer === "function") outer(el);
    else if (outer) outer.current = el;
  }, []);
}

type Handlers = NodeProps & {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  focusable?: boolean;
  autoFocus?: boolean;
  // Steam focuses this element first when its layer takes the focus.
  preferredFocus?: boolean;
  noFocusRing?: boolean;
  focusRingSizeElementID?: string;
  "flow-children"?: string;
};

export const Focusable = forwardRef<HTMLDivElement, Handlers>(function Focusable(p, outer) {
  const target = p.focusable ?? !!(p.onActivate || p.onClick);
  const ref = useNode(p, outer, p.autoFocus);
  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    focus(e.currentTarget);
    (p.onClick ?? p.onActivate)?.(e);
  };
  return (
    <div ref={ref} className={p.className} style={p.style} data-focusable={target ? "" : undefined}
      tabIndex={target ? -1 : undefined} data-ring={target && !p.noFocusRing ? p.focusRingSizeElementID ?? "" : undefined}
      data-preferred={p.preferredFocus ? "" : undefined}
      data-flow={p["flow-children"]} onClick={target ? click : undefined}>
      {p.children}
    </div>
  );
});

type ButtonProps = Handlers & { disabled?: boolean };

// Steam's dialog button. A Primary one turns blue on focus, a Secondary one white.
function dialogButton(kind: "Primary" | "Secondary") {
  return forwardRef<HTMLButtonElement, ButtonProps>(function DialogButton(p, outer) {
    const ref = useNode(p, outer, p.autoFocus);
    return (
      <button ref={ref} type="button" disabled={p.disabled} style={p.style} data-focusable=""
        data-preferred={p.preferredFocus ? "" : undefined}
        className={`DialogButton _DialogLayout ${kind} Focusable${p.className ? ` ${p.className}` : ""}`}
        onClick={(e) => {
          focus(e.currentTarget);
          p.onClick?.(e);
        }}>
        {p.children}
      </button>
    );
  });
}

export const DialogButton = dialogButton("Secondary");
export const DialogButtonSecondary = DialogButton;
export const DialogButtonPrimary = dialogButton("Primary");

// The parts of Steam's dialogs.
export function DialogHeader({ children }: { children?: ReactNode }) {
  return <div className="dv-dialogtitle">{children}</div>;
}

export function DialogBody({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

export function DialogBodyText({ children }: { children?: ReactNode }) {
  return <div className="dv-dialogtext">{children}</div>;
}

export function DialogFooter({ children }: { children?: ReactNode }) {
  return <div className="dv-dialogfooter">{children}</div>;
}

export function TextField(p: {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  label?: ReactNode;
  disabled?: boolean;
}) {
  const ref = useNode<HTMLInputElement>({});
  const field = (
    <div className="DialogInput_Wrapper _DialogLayout Panel">
      <input ref={ref} className="DialogInput DialogTextInputBase Focusable" data-focusable="" value={p.value}
        onChange={p.onChange} placeholder={p.placeholder} disabled={p.disabled} spellCheck={false}
        onClick={(e) => focus(e.currentTarget)} />
    </div>
  );
  // Steam wraps the field in a group only to put a label over it.
  if (!p.label) return field;
  return (
    <div className="DialogInputLabelGroup _DialogLayout">
      <div className="DialogLabel">{p.label}</div>
      {field}
    </div>
  );
}

// Steam's button numbers, as @decky/ui gives them.
export const GamepadButton = {
  INVALID: 0, OK: 1, CANCEL: 2, SECONDARY: 3, OPTIONS: 4, BUMPER_LEFT: 5, BUMPER_RIGHT: 6, TRIGGER_LEFT: 7,
  TRIGGER_RIGHT: 8, DIR_UP: 9, DIR_DOWN: 10, DIR_LEFT: 11, DIR_RIGHT: 12, SELECT: 13, START: 14,
} as const;

export function SteamSpinner() {
  return <div className="dv-spinner"><div className="dv-throbber" /></div>;
}

// The Tabs on screen, newest last. L1 and R1 switch the tabs of the last one.
const tabSets: { current: (step: number) => void }[] = [];

export function stepTab(step: number) {
  tabSets[tabSets.length - 1]?.current(step);
}

interface Tab {
  id: string;
  title: ReactNode;
  content: ReactNode;
}

// Draws a Steam controller glyph from steam/, or its letter until fetch-assets has run.
export function Glyph({ name, label, className }: { name: string; label: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className={`dv-glyphtext ${className ?? ""}`}>{label}</span>;
  return <img className={className} src={`/steam/${name}.svg`} alt={label} onError={() => setMissing(true)} />;
}

function TabTitle({ title, active, onShow }: { title: ReactNode; active: boolean; onShow: () => void }) {
  // Steam shows a tab when its title takes the focus.
  const ref = useNode<HTMLDivElement>({ onGamepadFocus: onShow });
  return (
    <div ref={ref} className={active ? "dv-tabtitle dv-active" : "dv-tabtitle"} data-focusable=""
      onClick={(e) => focus(e.currentTarget)}>
      <span>{title}</span>
    </div>
  );
}

// The titles sit over the top of the scrolling content, as in Steam.
export function Tabs({ tabs, activeTab, onShowTab, autoFocusContents }:
  { tabs: Tab[]; activeTab: string; onShowTab: (id: string) => void; autoFocusContents?: boolean }) {
  const index = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
  const step = useRef((n: number) => void n);
  step.current = (n: number) => {
    const t = tabs[index + n];
    if (t) onShowTab(t.id);
  };
  const row = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabSets.push(step);
    return () => {
      tabSets.splice(tabSets.indexOf(step), 1);
    };
  }, []);
  useEffect(() => {
    const active = row.current?.querySelector<HTMLElement>(".dv-active");
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
    if (row.current?.contains(focused())) return focus(active ?? null);
    if (autoFocusContents) requestAnimationFrame(() => focusFirst(content.current));
  }, [activeTab]);
  return (
    <div className="dv-tabs">
      <div className="dv-tabcontent" ref={content} data-autofocus={autoFocusContents ? "" : undefined}>
        {tabs[index]?.content}
      </div>
      <div className="dv-tabrow">
        <Glyph name="sd_l1" label="L1" className="dv-glyph" />
        <div className="dv-tabtitles" ref={row} data-entry=".dv-active">
          {tabs.map((t) => (
            <TabTitle key={t.id} title={t.title} active={t.id === tabs[index].id} onShow={() => onShowTab(t.id)} />
          ))}
        </div>
        <Glyph name="sd_r1" label="R1" className="dv-glyph" />
      </div>
    </div>
  );
}

export function ModalRoot({ children, onCancel, closeModal, bAllowFullSize, className }: {
  children?: ReactNode; onCancel?: () => void; closeModal?: () => void; bAllowFullSize?: boolean; className?: string;
}) {
  const ref = useNode<HTMLDivElement>({ onCancel: onCancel ?? closeModal, onCancelActionDescription: "Close" });
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => focusFirst(box.current));
  }, []);
  return (
    <div className="dv-modalwrap" onClick={(e) => e.target === e.currentTarget && (onCancel ?? closeModal)?.()}>
      <div className={`dv-modal${bAllowFullSize ? " dv-full" : ""}${className ? ` ${className}` : ""}`}
        ref={(el) => {
          box.current = el;
          ref(el);
        }}>
        {children}
      </div>
    </div>
  );
}

// Steam's two-button dialog: OK, then Cancel. Both close it.
export function ConfirmModal(p: {
  strTitle?: ReactNode; strDescription?: ReactNode; strOKButtonText?: ReactNode; strCancelButtonText?: ReactNode;
  onOK?: () => void; onCancel?: () => void; closeModal?: () => void; bOKDisabled?: boolean;
  bDestructiveWarning?: boolean; children?: ReactNode;
}) {
  const ok = () => {
    p.onOK?.();
    p.closeModal?.();
  };
  const cancel = () => {
    p.onCancel?.();
    p.closeModal?.();
  };
  return (
    <ModalRoot onCancel={cancel}>
      {p.strTitle && <div className="dv-dialogtitle">{p.strTitle}</div>}
      {p.strDescription && <div className="dv-dialogtext">{p.strDescription}</div>}
      {p.children}
      <Focusable className="dv-dialogbuttons" flow-children="row">
        <DialogButton onClick={ok} disabled={p.bOKDisabled}>{p.strOKButtonText ?? "Confirm"}</DialogButton>
        <DialogButton onClick={cancel}>{p.strCancelButtonText ?? "Cancel"}</DialogButton>
      </Focusable>
    </ModalRoot>
  );
}

// Closes the context menu an item sits in.
const CloseMenu = createContext<() => void>(() => undefined);

// Steam's context menu: a panel under the element that opened it, or over it near the bottom.
function MenuLayer({ at, children, closeModal }: { at: DOMRect | null; children?: ReactNode; closeModal?: () => void }) {
  const close = closeModal ?? (() => undefined);
  const ref = useNode<HTMLDivElement>({ onCancel: close, onCancelActionDescription: "Close" });
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    requestAnimationFrame(() => focusFirst(box.current));
  }, []);
  const style: CSSProperties = !at ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" } : {
    ...(at.left > innerWidth / 2 ? { right: innerWidth - at.right } : { left: at.left }),
    ...(at.bottom > innerHeight * 0.6 ? { bottom: innerHeight - at.top + 8 } : { top: at.bottom + 8 }),
  };
  return (
    <div className="dv-menuwrap" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dv-menu" style={style} ref={(el) => {
        box.current = el;
        ref(el);
      }}>
        <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
      </div>
    </div>
  );
}

export function showContextMenu(children: ReactNode, parent?: EventTarget) {
  const at = parent instanceof Element ? parent.getBoundingClientRect() : null;
  const menu = openModal(<MenuLayer at={at}>{children}</MenuLayer>);
  return { Hide: menu.Close, Show: () => undefined };
}

export function Menu({ children }: { label: string; onCancel?: () => void; cancelText?: string; children?: ReactNode }) {
  return <>{children}</>;
}

export function MenuItem(p: {
  onSelected?: (e: Event) => void; onClick?: (e: Event) => void; disabled?: boolean;
  tone?: "positive" | "emphasis" | "destructive"; children?: ReactNode;
}) {
  const close = useContext(CloseMenu);
  const select = () => {
    close();
    const e = new Event("select");
    p.onClick?.(e);
    p.onSelected?.(e);
  };
  const ref = useNode<HTMLDivElement>({ onActivate: select });
  return (
    <div ref={ref} className={`dv-menuitem${p.tone ? ` dv-${p.tone}` : ""}${p.disabled ? " dv-disabled" : ""}`}
      data-focusable={p.disabled ? undefined : ""} onClick={p.disabled ? undefined : select}>
      {p.children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="dv-menusep" />;
}

export function showModal(element: ReactNode) {
  return openModal(element);
}

// Steam's Router: the route of the main window, and the game that runs.
export const Router = {
  get MainRunningApp() {
    return runningApp();
  },
  get RunningApps() {
    const app = runningApp();
    return app ? [app] : [];
  },
  WindowStore: {
    GamepadUIMainWindowInstance: { m_history: { get location() { return { pathname: path() }; }, replace } },
  },
  Navigate: navigate,
  NavigateBack: back,
  CloseSideMenus: () => setQam(false),
};

export const Navigation = {
  Navigate: navigate,
  NavigateBack: back,
  CloseSideMenus: () => setQam(false),
  OpenQuickAccessMenu: () => setQam(true),
};

export function PanelSection({ title, spinner, children }: { title?: ReactNode; spinner?: boolean; children?: ReactNode }) {
  return (
    <div className="dv-section">
      {title && <div className="dv-sectiontitle">{title}{spinner && <Spinner className="dv-titlespin" />}</div>}
      {children}
    </div>
  );
}

export function PanelSectionRow({ children }: { children?: ReactNode }) {
  return <div className="dv-row">{children}</div>;
}

// Steam's spinning icon.
export function Spinner({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={`dv-spin${className ? ` ${className}` : ""}`} style={style} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 1-9 9" />
    </svg>
  );
}

// The props of Steam's rows that the fakes draw.
type ItemProps = {
  label?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  indentLevel?: number;
  bottomSeparator?: "standard" | "thick" | "none";
  highlightOnFocus?: boolean;
  padding?: "none" | "standard" | "compact";
};

// Steam's ButtonItem puts the button on the label's line unless the layout is "below".
export function ButtonItem(p: ItemProps & {
  children?: ReactNode; onClick?: (e?: unknown) => void; disabled?: boolean; layout?: "below" | "inline";
}) {
  if (p.layout !== "below") {
    return (
      <Field {...p} onClick={undefined}>
        <DialogButton onClick={p.onClick} disabled={p.disabled}>{p.children}</DialogButton>
      </Field>
    );
  }
  return (
    <div className="dv-field" data-sep={p.bottomSeparator}>
      {p.label && <div className="dv-label">{p.label}</div>}
      <DialogButton className="dv-wide" onClick={p.onClick} disabled={p.disabled}>{p.children}</DialogButton>
      {p.description && <div className="dv-desc">{p.description}</div>}
    </div>
  );
}

// An indent level moves the row 16px to the right.
function indent(level?: number): CSSProperties | undefined {
  return level ? { paddingLeft: 16 + 16 * level } : undefined;
}

export function Field(p: Handlers & ItemProps & { childrenLayout?: "below" | "inline" }) {
  const target = p.focusable ?? !!p.onActivate;
  const ref = useNode<HTMLDivElement>(p);
  return (
    <div ref={ref} className="dv-field dv-focusrow" data-focusable={target ? "" : undefined}
      data-sep={p.bottomSeparator} data-padding={p.padding} style={indent(p.indentLevel)}
      onClick={target ? (e) => {
        focus(e.currentTarget);
        (p.onClick ?? p.onActivate)?.(e);
      } : undefined}>
      <div className={p.childrenLayout === "below" ? "dv-fieldrow dv-below" : "dv-fieldrow"}>
        {p.icon && <div className="dv-icon">{p.icon}</div>}
        <div className="dv-label">{p.label}</div>
        {p.children && <div className="dv-control">{p.children}</div>}
      </div>
      {p.description && <div className="dv-desc">{p.description}</div>}
    </div>
  );
}

export function ToggleField(p: ItemProps & {
  checked: boolean; disabled?: boolean; onChange?: (checked: boolean) => void;
}) {
  return (
    <Field {...p} onActivate={() => !p.disabled && p.onChange?.(!p.checked)}>
      <div className={`dv-toggle${p.checked ? " dv-on" : ""}${p.disabled ? " dv-disabled" : ""}`} />
    </Field>
  );
}

// Steam's slider row: the label and the value, then the track. Left and right move the value by a
// step while the row has the focus.
export function SliderField(p: ItemProps & {
  value: number; min?: number; max?: number; step?: number; notchCount?: number;
  notchLabels?: { notchIndex: number; label: string; value?: number }[]; notchTicksVisible?: boolean;
  showValue?: boolean; valueSuffix?: string; disabled?: boolean; onChange?: (value: number) => void;
}) {
  const min = p.min ?? 0;
  const max = p.max ?? 100;
  const step = p.step ?? 1;
  const set = (v: number) => {
    const next = Math.min(max, Math.max(min, min + Math.round((v - min) / step) * step));
    if (!p.disabled && next !== p.value) p.onChange?.(next);
  };
  const ref = useNode<HTMLDivElement>({
    onDirection: (dir: Dir) => {
      if (dir !== "left" && dir !== "right") return false;
      set(p.value + (dir === "left" ? -step : step));
      return true;
    },
  });
  const at = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  const notches = p.notchCount && p.notchCount > 1 ? p.notchCount : 0;
  const notchAt = (i: number) => `${(i / (notches - 1)) * 100}%`;
  return (
    <div ref={ref} className="dv-field dv-focusrow" data-focusable="" data-sep={p.bottomSeparator}
      style={indent(p.indentLevel)} onClick={(e) => focus(e.currentTarget)}>
      <div className="dv-fieldrow">
        {p.icon && <div className="dv-icon">{p.icon}</div>}
        <div className="dv-label">{p.label}</div>
        {p.showValue && <div className="dv-control">{p.value}{p.valueSuffix}</div>}
      </div>
      <div className={`dv-track${p.disabled ? " dv-disabled" : ""}`} onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        set(min + ((e.clientX - box.left) / box.width) * (max - min));
      }}>
        <div className="dv-trackfill" style={{ width: at(p.value) }} />
        {p.notchTicksVisible && Array.from({ length: notches }, (_, i) => (
          <div key={i} className="dv-tick" style={{ left: notchAt(i) }} />
        ))}
        <div className="dv-knob" style={{ left: at(p.value) }} />
      </div>
      {notches > 0 && p.notchLabels && (
        <div className="dv-notchlabels">
          {p.notchLabels.map((n) => <span key={n.notchIndex} style={{ left: notchAt(n.notchIndex) }}>{n.label}</span>)}
        </div>
      )}
      {p.description && <div className="dv-desc">{p.description}</div>}
    </div>
  );
}

export function ProgressBar({ nProgress, indeterminate }: { nProgress?: number; indeterminate?: boolean }) {
  return (
    <div className={indeterminate ? "dv-progress dv-indeterminate" : "dv-progress"}>
      <div className="dv-progressfill" style={indeterminate ? undefined : { width: `${nProgress ?? 0}%` }} />
    </div>
  );
}

export function ProgressBarItem(p: ItemProps & { nProgress?: number; indeterminate?: boolean }) {
  return (
    <div className="dv-field" data-sep={p.bottomSeparator} style={indent(p.indentLevel)}>
      {p.label && <div className="dv-label">{p.label}</div>}
      <ProgressBar nProgress={p.nProgress} indeterminate={p.indeterminate} />
      {p.description && <div className="dv-desc">{p.description}</div>}
    </div>
  );
}

// The bar of ProgressBarItem with the operation under it on the left and the time left on the right.
export function ProgressBarWithInfo(p: ItemProps & {
  nProgress?: number; indeterminate?: boolean; sOperationText?: ReactNode; sTimeRemaining?: ReactNode;
}) {
  return (
    <div className="dv-field" data-sep={p.bottomSeparator} style={indent(p.indentLevel)}>
      {p.label && <div className="dv-label">{p.label}</div>}
      <ProgressBar nProgress={p.nProgress} indeterminate={p.indeterminate} />
      <div className="dv-progressinfo"><span>{p.sOperationText}</span><span>{p.sTimeRemaining}</span></div>
      {p.description && <div className="dv-desc">{p.description}</div>}
    </div>
  );
}

interface DropdownOption {
  data: unknown;
  label: ReactNode;
}

// Steam's dropdown row: the button shows the chosen option and opens the options in a context menu.
export function DropdownItem(p: {
  label?: ReactNode; description?: ReactNode; rgOptions: DropdownOption[]; selectedOption: unknown;
  onChange?: (option: DropdownOption) => void; disabled?: boolean; strDefaultLabel?: string; menuLabel?: string;
}) {
  const chosen = p.rgOptions.find((o) => o.data === p.selectedOption);
  const open = (e?: unknown) => showContextMenu(
    <Menu label={p.menuLabel ?? ""}>
      {p.rgOptions.map((o, i) => <MenuItem key={i} onSelected={() => p.onChange?.(o)}>{o.label}</MenuItem>)}
    </Menu>,
    (e as React.MouseEvent | undefined)?.currentTarget,
  );
  return (
    <Field label={p.label} description={p.description}>
      <DialogButton className="dv-dropdown" onClick={open} disabled={p.disabled}>
        <span className="dv-dropdownlabel">{chosen?.label ?? p.strDefaultLabel}</span>
        <svg viewBox="0 0 12 6" fill="currentColor"><path d="M0 0h12L6 6z" /></svg>
      </DialogButton>
    </Field>
  );
}

interface SidebarPage {
  title: ReactNode;
  content: ReactNode;
  visible?: boolean;
  hideTitle?: boolean;
  identifier?: string;
  route?: string;
}

function PageItem({ title, active, onShow }: { title: ReactNode; active: boolean; onShow: () => void }) {
  // Steam shows a page when its title takes the focus.
  const ref = useNode<HTMLDivElement>({ onGamepadFocus: onShow });
  return (
    <div ref={ref} className={active ? "dv-pageitem dv-active" : "dv-pageitem"} data-focusable=""
      onClick={(e) => focus(e.currentTarget)}>
      {title}
    </div>
  );
}

// Steam's page of settings, as in a game's Properties: the titles of the pages in a 240px column,
// the shown page on the right. B on the right goes back to the column.
export function SidebarNavigation({ title, showTitle, pages, page, onPageRequested }: {
  title?: ReactNode; showTitle?: boolean; pages: (SidebarPage | "separator")[]; page?: string;
  onPageRequested?: (page: string) => void; disableRouteReporting?: boolean;
}) {
  const shown = pages.map((p, i) => (p === "separator" ? p : { ...p, key: p.identifier ?? p.route ?? String(i) }))
    .filter((p) => p === "separator" || p.visible !== false);
  const [own, setOwn] = useState<string | undefined>(undefined);
  const active = shown.find((p) => p !== "separator" && p.key === (page ?? own))
    ?? shown.find((p) => p !== "separator");
  const list = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const bodyRef = useNode<HTMLDivElement>({
    onCancel: () => focus(list.current?.querySelector<HTMLElement>(".dv-active") ?? null),
    onCancelActionDescription: "Back",
  });
  const key = active && active !== "separator" ? active.key : "";
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [key]);
  return (
    <div className="dv-sidebar">
      <div className="dv-pagelist" ref={list} data-entry=".dv-active">
        {showTitle && title && <div className="dv-pagelisttitle">{title}</div>}
        {shown.map((p, i) => p === "separator" ? <div key={i} className="dv-pagesep" /> : (
          <PageItem key={p.key} title={p.title} active={p.key === key} onShow={() => {
            setOwn(p.key);
            onPageRequested?.(p.key);
          }} />
        ))}
      </div>
      <div className="dv-pagebody" ref={(el) => {
        body.current = el;
        bodyRef(el);
      }}>
        {active && active !== "separator" && (
          <>
            {!active.hideTitle && <div className="DialogHeader">{active.title}</div>}
            {active.content}
          </>
        )}
      </div>
    </div>
  );
}

export const staticClasses = new Proxy({} as Record<string, string>, {
  get: (_, key) => `dv-static-${String(key)}`,
});

// The classes of Steam's tabbed page that the fake Tabs draws, for a page that styles them.
export const gamepadTabbedPageClasses: Record<string, string> = {
  TabHeaderRowWrapper: "dv-tabrow", TabRow: "dv-tabrow", TabsRowScroll: "dv-tabtitles", Tab: "dv-tabtitle",
  Selected: "dv-active", TabContentsScroll: "dv-tabcontent", Glyphs: "dv-glyph",
};

// The classes of Steam's dialog rows that the fake fields draw.
export const gamepadDialogClasses: Record<string, string> = {
  Field: "dv-field", FieldLabel: "dv-label", FieldDescription: "dv-desc", FieldChildren: "dv-control", Toggle: "dv-toggle",
  StandaloneFieldSeparator: "dv-separator",
};
