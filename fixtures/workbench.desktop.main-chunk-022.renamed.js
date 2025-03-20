var A1o = {};
var dLo = "webviewId";
var v1t = class extends V {
  get c() {
    if (typeof this.b == "number") {
      return NI(this.b)?.window;
    } else {
      return undefined;
    }
  }
  get h() {
    return "browser";
  }
  get n() {
    return this.m;
  }
  get isFocused() {
    return (
      !!this.q &&
      !!this.c &&
      (!this.c.document.activeElement ||
        this.c.document.activeElement === this.n)
    );
  }
  constructor(e, t, s, n, r, o, a, l, c, u, h, d, g) {
    super();
    this.N = t;
    this.O = o;
    this.P = a;
    this.Q = l;
    this.R = c;
    this.S = u;
    this.U = h;
    this.W = g;
    this.a = Mt();
    this.b = undefined;
    this.j = 4;
    this.r = new b1t.Initializing([]);
    this.u = this.D(new Hi());
    this.C = this.D(new kp(50));
    this.F = this.D(new $());
    this.G = this.F.event;
    this.I = new Map();
    this.checkImeCompletionState = true;
    this.L = false;
    this.X = this.D(new $());
    this.onMissingCsp = this.X.event;
    this.Y = this.D(new $());
    this.onDidClickLink = this.Y.event;
    this.Z = this.D(new $());
    this.onDidReload = this.Z.event;
    this.$ = this.D(new $());
    this.onMessage = this.$.event;
    this.ab = this.D(new $());
    this.onDidScroll = this.ab.event;
    this.bb = this.D(new $());
    this.onDidWheel = this.bb.event;
    this.cb = this.D(new $());
    this.onDidUpdateState = this.cb.event;
    this.db = this.D(new $());
    this.onDidFocus = this.db.event;
    this.eb = this.D(new $());
    this.onDidBlur = this.eb.event;
    this.fb = this.D(new $());
    this.onFatalError = this.fb.event;
    this.gb = this.D(new $());
    this.onDidDispose = this.gb.event;
    this.rb = false;
    this.Db = this.D(new $());
    this.hasFindResult = this.Db.event;
    this.Eb = this.D(new $());
    this.onDidStopFind = this.Eb.event;
    this.providedViewType = e.providedViewType;
    this.origin = e.origin ?? this.a;
    this.M = e.options;
    this.extension = e.extension;
    this.s = {
      html: "",
      title: e.title,
      options: e.contentOptions,
      state: undefined,
    };
    this.t = this.D(
      new rLo(
        () => this.extension?.location,
        () => this.s.options.portMapping || [],
        this.U,
      ),
    );
    this.m = this.ib(e.options, e.contentOptions);
    this.D(
      this.qb("no-csp-found", () => {
        this.sb();
      }),
    );
    this.D(
      this.qb("did-click-link", ({ uri: p }) => {
        this.Y.fire(p);
      }),
    );
    this.D(
      this.qb("onmessage", ({ message: p, transfer: m }) => {
        this.$.fire({
          message: p,
          transfer: m,
        });
      }),
    );
    this.D(
      this.qb("did-scroll", ({ scrollYPercentage: p }) => {
        this.ab.fire({
          scrollYPercentage: p,
        });
      }),
    );
    this.D(
      this.qb("do-reload", () => {
        this.reload();
      }),
    );
    this.D(
      this.qb("do-update-state", (p) => {
        this.state = p;
        this.cb.fire(p);
      }),
    );
    this.D(
      this.qb("did-focus", () => {
        this.vb(true);
      }),
    );
    this.D(
      this.qb("did-blur", () => {
        this.vb(false);
      }),
    );
    this.D(
      this.qb("did-scroll-wheel", (p) => {
        this.bb.fire(p);
      }),
    );
    this.D(
      this.qb("did-find", ({ didFind: p }) => {
        this.Db.fire(p);
      }),
    );
    this.D(
      this.qb("fatal-error", (p) => {
        r.error(f(11877, null, p.message));
        this.fb.fire({
          message: p.message,
        });
      }),
    );
    this.D(
      this.qb("did-keydown", (p) => {
        this.wb("keydown", p);
      }),
    );
    this.D(
      this.qb("did-keyup", (p) => {
        this.wb("keyup", p);
      }),
    );
    this.D(
      this.qb("did-context-menu", (p) => {
        if (!this.n || !this.w) {
          return;
        }
        const m = this.n.getBoundingClientRect();
        const v = this.w.createOverlay([
          ...Object.entries(p.context),
          [dLo, this.providedViewType],
        ]);
        n.showContextMenu({
          menuId: M.WebviewContext,
          menuActionOptions: {
            shouldForwardArgs: true,
          },
          contextKeyService: v,
          getActionsContext: () => ({
            ...p.context,
            webview: this.providedViewType,
          }),
          getAnchor: () => ({
            x: m.x + p.clientX,
            y: m.y + p.clientY,
          }),
        });
        this.hb("set-context-menu-visible", {
          visible: true,
        });
      }),
    );
    this.D(
      this.qb("load-resource", async (p) => {
        try {
          const m = kJr(p.authority);
          const v = H.from({
            scheme: p.scheme,
            authority: m,
            path: decodeURIComponent(p.path),
            query: p.query ? decodeURIComponent(p.query) : p.query,
          });
          this.zb(p.id, v, p.ifNoneMatch);
        } catch {
          this.hb("did-load-resource", {
            id: p.id,
            status: 404,
            path: p.path,
          });
        }
      }),
    );
    this.D(
      this.qb("load-localhost", (p) => {
        this.Bb(p.id, p.origin);
      }),
    );
    this.D(ce.runAndSubscribe(t.onThemeDataChanged, () => this.ub()));
    this.D(g.onDidChangeReducedMotion(() => this.ub()));
    this.D(g.onDidChangeScreenReaderOptimized(() => this.ub()));
    this.D(
      n.onDidHideContextMenu(() =>
        this.hb("set-context-menu-visible", {
          visible: false,
        }),
      ),
    );
    this.z = s.getValue("window.confirmBeforeClose");
    this.D(
      s.onDidChangeConfiguration((p) => {
        if (p.affectsConfiguration("window.confirmBeforeClose")) {
          this.z = s.getValue("window.confirmBeforeClose");
          this.hb("set-confirm-before-close", this.z);
        }
      }),
    );
    this.D(
      this.qb("drag-start", () => {
        this.lb();
      }),
    );
    this.D(
      this.qb("drag", (p) => {
        this.xb("drag", p);
      }),
    );
    if (e.options.enableFindWidget) {
      this.J = this.D(d.createInstance(cIi, this));
    }
  }
  dispose() {
    this.L = true;
    this.n?.remove();
    this.m = undefined;
    this.H = undefined;
    if (this.r.type === 0) {
      for (const e of this.r.pendingMessages) {
        e.resolve(false);
      }
      this.r.pendingMessages = [];
    }
    this.gb.fire();
    this.u.dispose(true);
    super.dispose();
  }
  setContextKeyService(e) {
    this.w = e;
  }
  postMessage(e, t) {
    return this.hb("message", {
      message: e,
      transfer: t,
    });
  }
  async hb(e, t, s = []) {
    if (this.r.type === 0) {
      const { promise: n, resolve: r } = fM();
      this.r.pendingMessages.push({
        channel: e,
        data: t,
        transferable: s,
        resolve: r,
      });
      return n;
    } else {
      return this.pb(e, t, s);
    }
  }
  ib(e, t) {
    const s = document.createElement("iframe");
    s.name = this.a;
    s.className = `webview ${e.customClasses || ""}`;
    s.sandbox.add(
      "allow-scripts",
      "allow-same-origin",
      "allow-forms",
      "allow-pointer-lock",
      "allow-downloads",
    );
    const n = ["cross-origin-isolated", "autoplay"];
    if (!bb) {
      n.push("clipboard-read", "clipboard-write");
    }
    s.setAttribute("allow", n.join("; "));
    s.style.border = "none";
    s.style.width = "100%";
    s.style.height = "100%";
    s.focus = () => {
      this.Cb();
    };
    return s;
  }
  jb(e, t, s, n) {
    const r = {
      id: this.a,
      origin: this.origin,
      swVersion: String(this.j),
      extensionId: t?.id.value ?? "",
      platform: this.h,
      "vscode-resource-base-authority": GVs,
      parentOrigin: n.origin,
    };
    if (this.M.disableServiceWorker) {
      r.disableServiceWorker = "true";
    }
    if (this.O.remoteAuthority) {
      r.remoteAuthority = this.O.remoteAuthority;
    }
    if (s.purpose) {
      r.purpose = s.purpose;
    }
    sle.addSearchParam(r, true, true);
    const o = new URLSearchParams(r).toString();
    const a = bb ? "index-no-csp.html" : "index.html";
    this.n.setAttribute("src", `${this.nb(e)}/${a}?${o}`);
  }
  mountTo(e, t) {
    if (this.n) {
      this.b = t.vscodeWindowId;
      this.f = S$i(t.origin, this.origin).then((s) => (this.g = s));
      this.f.then((s) => {
        if (!this.L) {
          this.jb(s, this.extension, this.M, t);
        }
      });
      this.kb(t);
      if (this.J) {
        e.appendChild(this.J.getDomNode());
      }
      for (const s of [_e.MOUSE_DOWN, _e.MOUSE_MOVE, _e.DROP]) {
        this.D(
          Ce(e, s, () => {
            this.mb();
          }),
        );
      }
      for (const s of [e, t]) {
        this.D(
          Ce(s, _e.DRAG_END, () => {
            this.mb();
          }),
        );
      }
      e.id = this.a;
      e.appendChild(this.n);
    }
  }
  kb(e) {
    const t = this.D(
      Ce(e, "message", (s) => {
        if (!!this.g && s?.data?.target === this.a) {
          if (s.origin !== this.ob(this.g)) {
            console.log(
              `Skipped renderer receiving message due to mismatched origins: ${s.origin} ${this.ob}`,
            );
            return;
          }
          if (s.data.channel === "webview-ready") {
            if (this.H) {
              return;
            }
            this.Q.debug(`Webview(${this.a}): webview ready`);
            this.H = s.ports[0];
            this.H.onmessage = (n) => {
              const r = this.I.get(n.data.channel);
              if (!r) {
                console.log(`No handlers found for '${n.data.channel}'`);
                return;
              }
              r?.forEach((o) => o(n.data.data, n));
            };
            this.n?.classList.add("ready");
            if (this.r.type === 0) {
              this.r.pendingMessages.forEach(
                ({ channel: n, data: r, resolve: o }) => o(this.pb(n, r)),
              );
            }
            this.r = b1t.Ready;
            t.dispose();
          }
        }
      }),
    );
  }
  lb() {
    if (this.n) {
      this.n.style.pointerEvents = "none";
    }
  }
  mb() {
    if (this.n) {
      this.n.style.pointerEvents = "auto";
    }
  }
  nb(e) {
    const t = this.O.webviewExternalEndpoint;
    if (!t) {
      throw new Error(
        "'webviewExternalEndpoint' has not been configured. Webviews will not work!",
      );
    }
    const s = t.replace("{{uuid}}", e);
    if (s[s.length - 1] === "/") {
      return s.slice(0, s.length - 1);
    } else {
      return s;
    }
  }
  ob(e) {
    const t = H.parse(this.nb(e));
    return t.scheme + "://" + t.authority.toLowerCase();
  }
  pb(e, t, s = []) {
    if (this.n && this.H) {
      this.H.postMessage(
        {
          channel: e,
          args: t,
        },
        s,
      );
      return true;
    } else {
      return false;
    }
  }
  qb(e, t) {
    let s = this.I.get(e);
    if (!s) {
      s = new Set();
      this.I.set(e, s);
    }
    s.add(t);
    return He(() => {
      this.I.get(e)?.delete(t);
    });
  }
  sb() {
    if (!this.rb && ((this.rb = true), this.extension?.id)) {
      if (this.O.isExtensionDevelopment) {
        this.X.fire(this.extension.id);
      }
      const e = {
        extension: this.extension.id.value,
      };
      this.S.publicLog2("webviewMissingCsp", e);
    }
  }
  reload() {
    this.tb(this.s);
    const e = this.D(
      this.qb("did-load", () => {
        this.Z.fire();
        e.dispose();
      }),
    );
  }
  setHtml(e) {
    this.tb({
      ...this.s,
      html: e,
    });
    this.F.fire(e);
  }
  setTitle(e) {
    this.s = {
      ...this.s,
      title: e,
    };
    this.hb("set-title", e);
  }
  set contentOptions(e) {
    this.Q.debug(`Webview(${this.a}): will update content options`);
    if (FEr(e, this.s.options)) {
      this.Q.debug(`Webview(${this.a}): skipping content options update`);
      return;
    }
    this.tb({
      ...this.s,
      options: e,
    });
  }
  set localResourcesRoot(e) {
    this.s = {
      ...this.s,
      options: {
        ...this.s.options,
        localResourceRoots: e,
      },
    };
  }
  set state(e) {
    this.s = {
      ...this.s,
      state: e,
    };
  }
  set initialScrollProgress(e) {
    this.hb("initial-scroll-position", e);
  }
  tb(e) {
    this.Q.debug(`Webview(${this.a}): will update content`);
    this.s = e;
    const t = !!this.s.options.allowScripts;
    this.hb("content", {
      contents: this.s.html,
      title: this.s.title,
      options: {
        allowMultipleAPIAcquire: !!this.s.options.allowMultipleAPIAcquire,
        allowScripts: t,
        allowForms: this.s.options.allowForms ?? t,
      },
      state: this.s.state,
      cspSource: bCe,
      confirmBeforeClose: this.z,
    });
  }
  ub() {
    let {
      styles: e,
      activeTheme: t,
      themeLabel: s,
      themeId: n,
    } = this.N.getWebviewThemeData();
    if (this.M.transformCssVariables) {
      e = this.M.transformCssVariables(e);
    }
    const r = this.W.isMotionReduced();
    const o = this.W.isScreenReaderOptimized();
    this.hb("styles", {
      styles: e,
      activeTheme: t,
      themeId: n,
      themeLabel: s,
      reduceMotion: r,
      screenReader: o,
    });
  }
  vb(e) {
    this.q = e;
    if (e) {
      this.db.fire();
    } else {
      this.eb.fire();
    }
  }
  wb(e, t) {
    const s = new KeyboardEvent(e, t);
    Object.defineProperty(s, "target", {
      get: () => this.n,
    });
    this.c?.dispatchEvent(s);
  }
  xb(e, t) {
    const s = new DragEvent(e, t);
    Object.defineProperty(s, "target", {
      get: () => this.n,
    });
    this.c?.dispatchEvent(s);
  }
  windowDidDragStart() {
    this.lb();
  }
  windowDidDragEnd() {
    this.mb();
  }
  selectAll() {
    this.yb("selectAll");
  }
  copy() {
    this.yb("copy");
  }
  paste() {
    this.yb("paste");
  }
  cut() {
    this.yb("cut");
  }
  undo() {
    this.yb("undo");
  }
  redo() {
    this.yb("redo");
  }
  yb(e) {
    if (this.n) {
      this.hb("execCommand", e);
    }
  }
  async zb(e, t, s) {
    try {
      const n = await lLo(
        t,
        {
          ifNoneMatch: s,
          roots: this.s.options.localResourceRoots || [],
        },
        this.P,
        this.Q,
        this.u.token,
      );
      switch (n.type) {
        case k5.Type.Success: {
          const r = await this.Ab(n.stream);
          return this.hb(
            "did-load-resource",
            {
              id: e,
              status: 200,
              path: t.path,
              mime: n.mimeType,
              data: r,
              etag: n.etag,
              mtime: n.mtime,
            },
            [r],
          );
        }
        case k5.Type.NotModified:
          return this.hb("did-load-resource", {
            id: e,
            status: 304,
            path: t.path,
            mime: n.mimeType,
            mtime: n.mtime,
          });
        case k5.Type.AccessDenied:
          return this.hb("did-load-resource", {
            id: e,
            status: 401,
            path: t.path,
          });
      }
    } catch {}
    return this.hb("did-load-resource", {
      id: e,
      status: 404,
      path: t.path,
    });
  }
  async Ab(e) {
    return (await LI(e)).buffer.buffer;
  }
  async Bb(e, t) {
    const s = this.O.remoteAuthority;
    const n = s ? await this.R.resolveAuthority(s) : undefined;
    const r = n ? await this.t.getRedirect(n.authority, t) : undefined;
    return this.hb("did-load-localhost", {
      id: e,
      origin: t,
      location: r,
    });
  }
  focus() {
    this.Cb();
    this.vb(true);
  }
  Cb() {
    if (this.n) {
      try {
        this.n.contentWindow?.focus();
      } catch {}
      this.C.trigger(async () => {
        if (
          !!this.isFocused &&
          !!this.n &&
          (!this.c?.document.activeElement ||
            this.c.document.activeElement === this.n ||
            this.c.document.activeElement?.tagName === "BODY")
        ) {
          this.c?.document.body?.focus();
          this.hb("focus", undefined);
        }
      });
    }
  }
  find(e, t) {
    if (this.n) {
      this.hb("find", {
        value: e,
        previous: t,
      });
    }
  }
  updateFind(e) {
    if (!!e && !!this.n) {
      this.hb("find", {
        value: e,
      });
    }
  }
  stopFind(e) {
    if (this.n) {
      this.hb("find-stop", {
        clearSelection: !e,
      });
      this.Eb.fire();
    }
  }
  showFind(e = true) {
    this.J?.reveal(undefined, e);
  }
  hideFind(e = true) {
    this.J?.hide(e);
  }
  runFindAction(e) {
    this.J?.find(e);
  }
};
v1t = __decorate(
  [
    __param(2, be),
    __param(3, Qi),
    __param(4, bi),
    __param(5, In),
    __param(6, xt),
    __param(7, _t),
    __param(8, Ym),
    __param(9, At),
    __param(10, zb),
    __param(11, se),
    __param(12, wo),
  ],
  v1t,
);
Se();
fe();
q();
Ds();
Ee();
var uIi = class extends V {
  get y() {
    return NI(this.w, true).window;
  }
  constructor(e, t, s, n) {
    super();
    this.I = t;
    this.J = s;
    this.L = n;
    this.a = true;
    this.b = new Set();
    this.c = this.D(new ki());
    this.g = this.D(new X());
    this.h = "";
    this.m = 0;
    this.n = undefined;
    this.u = undefined;
    this.w = undefined;
    this.z = this.D(new ki());
    this.G = false;
    this.M = false;
    this.N = this.D(new $());
    this.onDidDispose = this.N.event;
    this.Q = this.D(new $());
    this.onDidFocus = this.Q.event;
    this.R = this.D(new $());
    this.onDidBlur = this.R.event;
    this.S = this.D(new $());
    this.onDidClickLink = this.S.event;
    this.U = this.D(new $());
    this.onDidReload = this.U.event;
    this.W = this.D(new $());
    this.onDidScroll = this.W.event;
    this.X = this.D(new $());
    this.onDidUpdateState = this.X.event;
    this.Y = this.D(new $());
    this.onMessage = this.Y.event;
    this.Z = this.D(new $());
    this.onMissingCsp = this.Z.event;
    this.$ = this.D(new $());
    this.onDidWheel = this.$.event;
    this.ab = this.D(new $());
    this.onFatalError = this.ab.event;
    this.providedViewType = e.providedViewType;
    this.origin = e.origin ?? Mt();
    this.j = e.title;
    this.q = e.extension;
    this.t = e.options;
    this.s = e.contentOptions;
  }
  get isFocused() {
    return !!this.c.value?.isFocused;
  }
  dispose() {
    this.M = true;
    this.H?.domNode.remove();
    this.H = undefined;
    for (const e of this.b) {
      e.resolve(false);
    }
    this.b.clear();
    this.N.fire();
    super.dispose();
  }
  get container() {
    if (this.M) {
      throw new Error("OverlayWebview has been disposed");
    }
    if (!this.H) {
      const e = document.createElement("div");
      e.style.position = "absolute";
      e.style.overflow = "hidden";
      this.H = new Cw(e);
      this.H.setVisibility("hidden");
      this.I.getContainer(this.y).appendChild(e);
    }
    return this.H.domNode;
  }
  claim(e, t, s) {
    if (this.M) {
      return;
    }
    const n = this.u;
    if (this.w !== t.vscodeWindowId) {
      this.release(n);
      this.c.clear();
      this.g.clear();
      this.H?.domNode.remove();
      this.H = undefined;
    }
    this.u = e;
    this.w = t.vscodeWindowId;
    this.P(t);
    if (n !== e) {
      const r = s || this.L;
      this.z.clear();
      this.z.value = r.createScoped(this.container);
      const o = this.C?.get();
      this.C?.reset();
      this.C = A$s.bindTo(r);
      this.C.set(!!o);
      this.F?.reset();
      this.F = M$s.bindTo(r);
      this.F.set(!!this.options.enableFindWidget);
      this.c.value?.setContextKeyService(this.z.value);
    }
  }
  release(e) {
    if (this.u === e) {
      this.z.clear();
      this.u = undefined;
      if (this.H) {
        this.H.setVisibility("hidden");
      }
      if (this.t.retainContextWhenHidden) {
        this.G = !!this.C?.get();
        this.hideFind(false);
      } else {
        this.c.clear();
        this.g.clear();
      }
    }
  }
  layoutWebviewOverElement(e, t, s) {
    if (!this.H || !this.H.domNode.parentElement) {
      return;
    }
    const n = this.I.whenContainerStylesLoaded(this.y);
    if (n) {
      n.then(() => this.O(e, t, s));
    } else {
      this.O(e, t, s);
    }
  }
  O(e, t, s) {
    if (!this.H || !this.H.domNode.parentElement) {
      return;
    }
    const n = e.getBoundingClientRect();
    const r = this.H.domNode.parentElement.getBoundingClientRect();
    const o = (r.height - this.H.domNode.parentElement.clientHeight) / 2;
    const a = (r.width - this.H.domNode.parentElement.clientWidth) / 2;
    this.H.setTop(n.top - r.top - o);
    this.H.setLeft(n.left - r.left - a);
    this.H.setWidth(t ? t.width : n.width);
    this.H.setHeight(t ? t.height : n.height);
    if (s) {
      const { top: l, left: c, right: u, bottom: h } = fLo(n, s);
      this.H.domNode.style.clipPath = `polygon(${c}px ${l}px, ${u}px ${l}px, ${u}px ${h}px, ${c}px ${h}px)`;
    }
  }
  P(e) {
    if (this.M) {
      throw new Error("OverlayWebview is disposed");
    }
    if (!this.c.value) {
      const t = this.J.createWebviewElement({
        providedViewType: this.providedViewType,
        origin: this.origin,
        title: this.j,
        options: this.t,
        contentOptions: this.s,
        extension: this.extension,
      });
      this.c.value = t;
      t.state = this.n;
      if (this.z.value) {
        this.c.value.setContextKeyService(this.z.value);
      }
      if (this.h) {
        t.setHtml(this.h);
      }
      if (this.t.tryRestoreScrollPosition) {
        t.initialScrollProgress = this.m;
      }
      this.F?.set(!!this.options.enableFindWidget);
      t.mountTo(this.container, e);
      this.g.clear();
      this.g.add(
        t.onDidFocus(() => {
          this.Q.fire();
        }),
      );
      this.g.add(
        t.onDidBlur(() => {
          this.R.fire();
        }),
      );
      this.g.add(
        t.onDidClickLink((s) => {
          this.S.fire(s);
        }),
      );
      this.g.add(
        t.onMessage((s) => {
          this.Y.fire(s);
        }),
      );
      this.g.add(
        t.onMissingCsp((s) => {
          this.Z.fire(s);
        }),
      );
      this.g.add(
        t.onDidWheel((s) => {
          this.$.fire(s);
        }),
      );
      this.g.add(
        t.onDidReload(() => {
          this.U.fire();
        }),
      );
      this.g.add(
        t.onFatalError((s) => {
          this.ab.fire(s);
        }),
      );
      this.g.add(
        t.onDidScroll((s) => {
          this.m = s.scrollYPercentage;
          this.W.fire(s);
        }),
      );
      this.g.add(
        t.onDidUpdateState((s) => {
          this.n = s;
          this.X.fire(s);
        }),
      );
      if (this.a) {
        this.b.forEach(async (s) => {
          s.resolve(await t.postMessage(s.message, s.transfer));
        });
      }
      this.a = false;
      this.b.clear();
    }
    if (this.options.retainContextWhenHidden && this.G) {
      this.showFind(false);
      this.G = false;
    }
    this.H?.setVisibility("visible");
  }
  setHtml(e) {
    this.h = e;
    this.bb((t) => t.setHtml(e));
  }
  setTitle(e) {
    this.j = e;
    this.bb((t) => t.setTitle(e));
  }
  get initialScrollProgress() {
    return this.m;
  }
  set initialScrollProgress(e) {
    this.m = e;
    this.bb((t) => (t.initialScrollProgress = e));
  }
  get state() {
    return this.n;
  }
  set state(e) {
    this.n = e;
    this.bb((t) => (t.state = e));
  }
  get extension() {
    return this.q;
  }
  set extension(e) {
    this.q = e;
    this.bb((t) => (t.extension = e));
  }
  get options() {
    return this.t;
  }
  set options(e) {
    this.t = {
      customClasses: this.t.customClasses,
      ...e,
    };
  }
  get contentOptions() {
    return this.s;
  }
  set contentOptions(e) {
    this.s = e;
    this.bb((t) => (t.contentOptions = e));
  }
  set localResourcesRoot(e) {
    this.bb((t) => (t.localResourcesRoot = e));
  }
  async postMessage(e, t) {
    if (this.c.value) {
      return this.c.value.postMessage(e, t);
    }
    if (this.a) {
      let s;
      const n = new Promise((r) => (s = r));
      this.b.add({
        message: e,
        transfer: t,
        resolve: s,
      });
      return n;
    }
    return false;
  }
  focus() {
    this.c.value?.focus();
  }
  reload() {
    this.c.value?.reload();
  }
  selectAll() {
    this.c.value?.selectAll();
  }
  copy() {
    this.c.value?.copy();
  }
  paste() {
    this.c.value?.paste();
  }
  cut() {
    this.c.value?.cut();
  }
  undo() {
    this.c.value?.undo();
  }
  redo() {
    this.c.value?.redo();
  }
  showFind(e = true) {
    if (this.c.value) {
      this.c.value.showFind(e);
      this.C?.set(true);
    }
  }
  hideFind(e = true) {
    this.C?.reset();
    this.c.value?.hideFind(e);
  }
  runFindAction(e) {
    this.c.value?.runFindAction(e);
  }
  bb(e) {
    if (this.c.value) {
      e(this.c.value);
    }
  }
  windowDidDragStart() {
    this.c.value?.windowDidDragStart();
  }
  windowDidDragEnd() {
    this.c.value?.windowDidDragEnd();
  }
  setContextKeyService(e) {
    this.c.value?.setContextKeyService(e);
  }
};
uIi = __decorate([__param(1, jn), __param(2, hL), __param(3, Re)], uIi);
function fLo(i, e) {
  const t = e.getBoundingClientRect();
  const s = Math.max(t.top - i.top, 0);
  const n = Math.max(i.width - (i.right - t.right), 0);
  const r = Math.max(i.height - (i.bottom - t.bottom), 0);
  const o = Math.max(t.left - i.left, 0);
  return {
    top: s,
    right: n,
    bottom: r,
    left: o,
  };
}
var hIi = class extends V {
  constructor(e) {
    super();
    this.b = e;
    this.g = new Set();
    this.h = this.D(new $());
    this.onDidChangeActiveWebview = this.h.event;
    this.a = this.b.createInstance(lIi);
  }
  get activeWebview() {
    return this.c;
  }
  f(e) {
    if (e !== this.c) {
      this.c = e;
      this.h.fire(e);
    }
  }
  get webviews() {
    return this.g.values();
  }
  createWebviewElement(e) {
    const t = this.b.createInstance(v1t, e, this.a);
    this.j(t);
    return t;
  }
  createWebviewOverlay(e) {
    const t = this.b.createInstance(uIi, e);
    this.j(t);
    return t;
  }
  j(e) {
    this.g.add(e);
    const t = new X();
    t.add(
      e.onDidFocus(() => {
        this.f(e);
      }),
    );
    const s = () => {
      if (this.c === e) {
        this.f(undefined);
      }
    };
    t.add(e.onDidBlur(s));
    t.add(
      e.onDidDispose(() => {
        s();
        t.dispose();
        this.g.delete(e);
      }),
    );
  }
};
hIi = __decorate([__param(0, se)], hIi);
it();
Ft();
WT();
Me();
$t();
ee();
ri();
ui();
nr();
var dIi = class extends v1t {
  get h() {
    return "electron";
  }
  constructor(e, t, s, n, r, o, a, l, c, u, h, d, g, p, m) {
    super(e, t, u, s, d, a, r, c, l, o, n, p, m);
    this.Lb = g;
    this.Gb = false;
    this.Jb = this.D(new Ea(200));
    this.Fb = new Yan(u, h, g);
    this.Ib = GE.toService(h.getChannel("webview"));
    if (e.options.enableFindWidget) {
      this.D(
        this.G((v) => {
          if (this.Gb && this.Hb !== v) {
            this.stopFind(false);
            this.Hb = v;
          }
        }),
      );
      this.D(
        this.Ib.onFoundInFrame((v) => {
          this.Db.fire(v.matches > 0);
        }),
      );
    }
  }
  dispose() {
    this.Fb.didBlur();
    super.dispose();
  }
  nb(e) {
    return `${me.vscodeWebview}://${e}`;
  }
  Ab(e) {
    return Bze(e, (t) => {
      const s = t.reduce((a, l) => a + l.byteLength, 0);
      const n = new ArrayBuffer(s);
      const r = new Uint8Array(n);
      let o = 0;
      for (const a of t) {
        r.set(a.buffer, o);
        o += a.byteLength;
      }
      return n;
    });
  }
  find(e, t) {
    if (this.n) {
      if (!this.Gb) {
        this.updateFind(e);
      } else {
        const s = {
          forward: !t,
          findNext: false,
          matchCase: false,
        };
        this.Ib.findInFrame(
          {
            windowId: this.Lb.windowId,
          },
          this.a,
          e,
          s,
        );
      }
    }
  }
  updateFind(e) {
    if (!e || !this.n) {
      return;
    }
    const t = {
      forward: true,
      findNext: true,
      matchCase: false,
    };
    this.Jb.trigger(() => {
      this.Gb = true;
      this.Ib.findInFrame(
        {
          windowId: this.Lb.windowId,
        },
        this.a,
        e,
        t,
      );
    });
  }
  stopFind(e) {
    if (this.n) {
      this.Jb.cancel();
      this.Gb = false;
      this.Ib.stopFindInFrame(
        {
          windowId: this.Lb.windowId,
        },
        this.a,
        {
          keepSelection: e,
        },
      );
      this.Eb.fire();
    }
  }
  vb(e) {
    super.vb(e);
    if (e) {
      this.Fb.didFocus();
    } else {
      this.Fb.didBlur();
    }
  }
};
dIi = __decorate(
  [
    __param(2, Qi),
    __param(3, zb),
    __param(4, xt),
    __param(5, At),
    __param(6, In),
    __param(7, Ym),
    __param(8, _t),
    __param(9, be),
    __param(10, bI),
    __param(11, bi),
    __param(12, Wr),
    __param(13, se),
    __param(14, wo),
  ],
  dIi,
);
var gLo = class extends hIi {
  createWebviewElement(i) {
    const e = this.b.createInstance(dIi, i, this.a);
    this.j(e);
    return e;
  }
};
st(hL, gLo, 1);
J(sLo);
J(nLo);
ee();
var Xan = Ve("ISplashStorageService");
Lt();
yc();
Se();
fe();
q();
nr();
_n();
Me();
Qp();
qt();
er();
No();
var fIi;
var y1t = class {
  static {
    fIi = this;
  }
  static {
    this.ID = "workbench.contrib.partsSplash";
  }
  static {
    this.a = "monaco-parts-splash";
  }
  constructor(e, t, s, n, r, o, a) {
    this.d = e;
    this.f = t;
    this.g = s;
    this.h = n;
    this.i = r;
    this.b = new X();
    ce.once(t.onDidLayoutMainContainer)(
      () => {
        this.l();
        Xn("code/didRemovePartsSplash");
      },
      undefined,
      this.b,
    );
    const l = this.b.add(new ki());
    const c = () => {
      l.value = rx(Bt, () => this.j(), 2500);
    };
    a.when(3).then(() => {
      ce.any(
        ce.filter(pW, (u) => u === Bt.vscodeWindowId),
        o.mainPart.onDidLayout,
        e.onDidColorThemeChange,
      )(c, undefined, this.b);
      c();
    });
    n.onDidChangeConfiguration(
      (u) => {
        if (u.affectsConfiguration("window.titleBarStyle")) {
          this.c = true;
          this.j();
        }
      },
      this,
      this.b,
    );
  }
  dispose() {
    this.b.dispose();
  }
  j() {
    const e = this.d.getColorTheme();
    this.i.saveWindowSplash({
      zoomLevel: this.h.getValue("window.zoomLevel"),
      baseTheme: Lfe(e.type),
      colorInfo: {
        foreground: e.getColor(rr)?.toString(),
        background: ct.Format.CSS.formatHex(e.getColor(zr) || Hee(e)),
        editorBackground: e.getColor(zr)?.toString(),
        titleBarBackground: e.getColor(Pme)?.toString(),
        titleBarBorder: e.getColor(sSs)?.toString(),
        activityBarBackground: e.getColor(GCs)?.toString(),
        activityBarBorder: e.getColor(KCs)?.toString(),
        sideBarBackground: e.getColor(bg)?.toString(),
        sideBarBorder: e.getColor(d2)?.toString(),
        statusBarBackground: e.getColor(jCs)?.toString(),
        statusBarBorder: e.getColor(Rnt)?.toString(),
        statusBarNoFolderBackground: e.getColor(zCs)?.toString(),
        windowBorder:
          e.getColor(oSs)?.toString() ?? e.getColor(aSs)?.toString(),
      },
      layoutInfo: this.k()
        ? {
            sideBarSide: this.f.getSideBarPosition() === 1 ? "right" : "left",
            editorPartMinWidth: _R.width,
            titleBarHeight: this.f.isVisible("workbench.parts.titlebar", Bt)
              ? ow(an(this.f.getContainer(Bt, "workbench.parts.titlebar")))
              : 0,
            activityBarWidth:
              this.f.activityBarDirection === "vertical" &&
              this.f.isVisible("workbench.parts.activitybar")
                ? Pg(an(this.f.getContainer(Bt, "workbench.parts.activitybar")))
                : 0,
            sideBarWidth: this.f.isVisible("workbench.parts.sidebar")
              ? Pg(an(this.f.getContainer(Bt, "workbench.parts.sidebar")))
              : 0,
            statusBarHeight: this.f.isVisible("workbench.parts.statusbar", Bt)
              ? ow(an(this.f.getContainer(Bt, "workbench.parts.statusbar")))
              : 0,
            windowBorder: this.f.hasMainWindowBorder(),
            windowBorderRadius: this.f.getMainWindowBorderRadius(),
          }
        : undefined,
    });
  }
  k() {
    return !mM(Bt) && !this.g.isExtensionDevelopment && !this.c;
  }
  l() {
    const e = Bt.document.getElementById(fIi.a);
    if (e) {
      e.style.display = "none";
    }
    Bt.document.head.getElementsByClassName("initialShellColors")[0]?.remove();
  }
};
y1t = fIi = __decorate(
  [
    __param(0, li),
    __param(1, jn),
    __param(2, In),
    __param(3, be),
    __param(4, Xan),
    __param(5, _i),
    __param(6, vo),
  ],
  y1t,
);
var gIi = class {
  constructor(e) {
    this.saveWindowSplash = e.saveWindowSplash.bind(e);
  }
};
gIi = __decorate([__param(0, Wr)], gIi);
st(Xan, gIi, 1);
$n(y1t.ID, y1t, 1);
K();
Je();
rt();
Ee();
Ft();
J(
  class extends ne {
    constructor() {
      super({
        id: "workbench.action.localHistory.revealInOS",
        title: Gs
          ? U(7794, "Reveal in File Explorer")
          : Jt
            ? U(7795, "Reveal in Finder")
            : U(7796, "Open Containing Folder"),
        menu: {
          id: M.TimelineItemContext,
          group: "4_reveal",
          order: 1,
          when: T.and(b5, Uo.Scheme.isEqualTo(me.file)),
        },
      });
    }
    async run(i, e) {
      const t = i.get(vk);
      const s = i.get(Wr);
      const { entry: n } = await NF(t, e);
      if (n) {
        await s.showItemInFolder(
          n.location.with({
            scheme: me.file,
          }).fsPath,
        );
      }
    }
  },
);
Je();
zn();
Ge();
mb();
Te();
K();
Je();
na();
$t();
pt();
var Qan = U(8109, "Merge Editor (Dev)");
var Zan = class extends ne {
  constructor() {
    super({
      id: "merge.dev.openContentsJson",
      category: Qan,
      title: U(8110, "Open Merge Editor State from JSON"),
      icon: A.layoutCentered,
      f1: true,
    });
  }
  async run(i, e) {
    const t = i.get(Ji);
    const s = i.get(Fr);
    const n = i.get(De);
    const r = i.get(Ls);
    const o = i.get(SO);
    const a = i.get(xt);
    e ||= {};
    let l;
    if (e.data) {
      l = e.data;
    } else {
      const C = await t.input({
        prompt: f(8108, null),
        value: await s.readText(),
      });
      if (C === undefined) {
        return;
      }
      if (C !== "") {
        l = JSON.parse(C);
      } else {
        l = {
          base: "",
          input1: "",
          input2: "",
          result: "",
          languageId: "plaintext",
        };
      }
    }
    const c = H.joinPath(o.tmpDir, yIt());
    const u = r.getExtensions(l.languageId)[0] || "";
    const h = H.joinPath(c, `/base${u}`);
    const d = H.joinPath(c, `/input1${u}`);
    const g = H.joinPath(c, `/input2${u}`);
    const p = H.joinPath(c, `/result${u}`);
    const m = H.joinPath(c, `/initialResult${u}`);
    async function v(C, S) {
      await a.writeFile(C, Di.fromString(S));
    }
    const y = await pLo(t, e.resultState);
    await Promise.all([
      v(h, l.base),
      v(d, l.input1),
      v(g, l.input2),
      v(p, y ? l.initialResult || "" : l.result),
      v(m, l.initialResult || ""),
    ]);
    const w = {
      base: {
        resource: h,
      },
      input1: {
        resource: d,
        label: "Input 1",
        description: "Input 1",
        detail: "(from JSON)",
      },
      input2: {
        resource: g,
        label: "Input 2",
        description: "Input 2",
        detail: "(from JSON)",
      },
      result: {
        resource: p,
      },
    };
    n.openEditor(w);
  }
};
async function pLo(i, e) {
  if (e) {
    return e === "initial";
  } else {
    return (
      await i.pick(
        [
          {
            label: "result",
            result: false,
          },
          {
            label: "initial result",
            result: true,
          },
        ],
        {
          canPickMany: false,
        },
      )
    )?.result;
  }
}
var mLo = class extends ne {
  constructor(i) {
    super(i);
  }
  run(i) {
    const { activeEditorPane: e } = i.get(De);
    if (e instanceof J1) {
      const t = e.viewModel.get();
      if (!t) {
        return;
      }
      this.runWithViewModel(t, i);
    }
  }
};
var bLo = class extends mLo {
  constructor() {
    super({
      id: "merge.dev.openSelectionInTemporaryMergeEditor",
      category: Qan,
      title: U(8111, "Open Selection In Temporary Merge Editor"),
      icon: A.layoutCentered,
      f1: true,
    });
  }
  async runWithViewModel(i, e) {
    const t = i.selectionInBase.get()?.rangesInBase;
    if (!t || t.length === 0) {
      return;
    }
    const s = t.map((a) => i.model.base.getValueInRange(a)).join(`
`);
    const n = t.map((a) =>
      i.inputCodeEditorView1.editor
        .getModel()
        .getValueInRange(i.model.translateBaseRangeToInput(1, a)),
    ).join(`
`);
    const r = t.map((a) =>
      i.inputCodeEditorView2.editor
        .getModel()
        .getValueInRange(i.model.translateBaseRangeToInput(2, a)),
    ).join(`
`);
    const o = t.map((a) =>
      i.resultCodeEditorView.editor
        .getModel()
        .getValueInRange(i.model.translateBaseRangeToResult(a)),
    ).join(`
`);
    new Zan().run(e, {
      data: {
        base: s,
        input1: n,
        input2: r,
        result: o,
        languageId: i.resultCodeEditorView.editor.getModel().getLanguageId(),
      },
    });
  }
};
J(Zan);
J(bLo);
Is();
q();
Ft();
Dt();
qt();
Te();
K();
Je();
Gt();
xr();
Ee();
Ys();
na();
ri();
ss();
rn();
ei();
Yt();
ai();
Ws();
var CU = U(9404, "Remote Tunnels");
var YA = "remoteTunnelConnection";
var vLo = new de(YA, "disconnected");
var pIi = "remoteTunnelServiceUsed";
var eln = "remoteTunnelServicePromptedPreview";
var tln = "remoteTunnelExtensionRecommended";
var iln = "remoteTunnelHasUsed";
var yLo = 240000;
var wLo = 2;
var tv;
(function (i) {
  i.turnOn = "workbench.remoteTunnel.actions.turnOn";
  i.turnOff = "workbench.remoteTunnel.actions.turnOff";
  i.connecting = "workbench.remoteTunnel.actions.connecting";
  i.manage = "workbench.remoteTunnel.actions.manage";
  i.showLog = "workbench.remoteTunnel.actions.showLog";
  i.configure = "workbench.remoteTunnel.actions.configure";
  i.copyToClipboard = "workbench.remoteTunnel.actions.copyToClipboard";
  i.learnMore = "workbench.remoteTunnel.actions.learnMore";
})((tv ||= {}));
var XA;
(function (i) {
  i.turnOn = f(9364, null);
  i.turnOff = f(9365, null);
  i.showLog = f(9366, null);
  i.configure = f(9367, null);
  i.copyToClipboard = f(9368, null);
  i.learnMore = f(9369, null);
})((XA ||= {}));
var mIi = class extends V {
  constructor(e, t, s, n, r, o, a, l, c, u, h, d, g, p) {
    super();
    this.j = e;
    this.m = t;
    this.n = s;
    this.q = n;
    this.r = o;
    this.t = l;
    this.u = c;
    this.w = u;
    this.y = h;
    this.z = d;
    this.C = g;
    this.F = p;
    this.h = new Set();
    this.g = this.D(
      a.createLogger(Ti(c.logsHome, `${Gxi}.log`), {
        id: Gxi,
        name: Zxo,
      }),
    );
    this.a = vLo.bindTo(this.q);
    const m = r.tunnelApplicationConfig;
    if (!m || !r.tunnelApplicationName) {
      this.g.error(
        "Missing 'tunnelApplicationConfig' or 'tunnelApplicationName' in product.json. Remote tunneling is not available.",
      );
      this.b = {
        authenticationProviders: {},
        editorWebUrl: "",
        extension: {
          extensionId: "",
          friendlyName: "",
        },
      };
      return;
    }
    this.b = m;
    this.D(this.w.onDidChangeTunnelStatus((v) => this.G(v)));
    this.S();
    this.I();
    this.H();
  }
  G(e) {
    this.f = undefined;
    if (e.type === "disconnected") {
      if (e.onTokenFailed) {
        this.h.add(e.onTokenFailed.sessionId);
      }
      this.a.set("disconnected");
    } else if (e.type === "connecting") {
      this.a.set("connecting");
    } else if (e.type === "connected") {
      this.f = e.info;
      this.a.set("connected");
    }
  }
  async H() {
    await this.n.whenInstalledExtensionsRegistered();
    const e = this.b.extension;
    const t = async () => {
      if (
        this.r.getBoolean(tln, -1) ||
        (await this.n.getExtension(e.extensionId))
      ) {
        return false;
      }
      const n = this.r.get(pIi, -1);
      if (!n) {
        return false;
      }
      let r;
      try {
        const a = JSON.parse(n);
        if (!Gr(a)) {
          return false;
        }
        const { hostName: l, timeStamp: c } = a;
        if (!yi(l) || !Pu(c) || new Date().getTime() > c + yLo) {
          return false;
        }
        r = l;
      } catch {
        return false;
      }
      const o = await this.w.getTunnelName();
      if (!o || o === r) {
        return false;
      } else {
        return r;
      }
    };
    const s = async () => {
      const n = await t();
      if (n) {
        this.F.notify({
          severity: es.Info,
          message: f(9370, null, n, e.friendlyName),
          actions: {
            primary: [
              new Qt("showExtension", f(9371, null), undefined, true, () =>
                this.y.executeCommand(
                  "workbench.extensions.action.showExtensionsWithIds",
                  [e.extensionId],
                ),
              ),
              new Qt("doNotShowAgain", f(9372, null), undefined, true, () => {
                this.r.store(tln, true, -1, 0);
              }),
            ],
          },
        });
        return true;
      } else {
        return false;
      }
    };
    if (await t()) {
      const n = this.D(new X());
      n.add(
        this.r.onDidChangeValue(
          -1,
          pIi,
          n,
        )(async () => {
          if (await s()) {
            n.dispose();
          }
        }),
      );
    }
  }
  async I() {
    const [e, t] = await Promise.all([
      this.w.getMode(),
      this.w.getTunnelStatus(),
    ]);
    this.G(t);
    if (e.active && e.session.token) {
      return;
    }
    const s = async (r) => {
      const o =
        r &&
        this.w.onDidChangeTunnelStatus((c) => {
          switch (c.type) {
            case "connecting":
              if (c.progress) {
                r.report({
                  message: c.progress,
                });
              }
              break;
          }
        });
      let a;
      if (e.active) {
        const c = await this.Q(e.session);
        if (c) {
          a = {
            ...e.session,
            token: c,
          };
        }
      }
      const l = await this.w.initialize(
        e.active && a
          ? {
              ...e,
              session: a,
            }
          : Yxo,
      );
      o?.dispose();
      if (l.type === "connected") {
        this.f = l.info;
        this.a.set("connected");
        return;
      }
    };
    if (this.r.getBoolean(iln, -1, false)) {
      await this.C.withProgress(
        {
          location: 10,
          title: f(9373, null, tv.showLog),
        },
        s,
      );
    } else {
      s(undefined);
    }
  }
  J(e) {
    return e.session.accessToken || e.session.idToken;
  }
  async L(e) {
    if (this.f) {
      return this.f;
    }
    this.r.store(iln, true, -1, 1);
    let t = false;
    for (let s = 0; s < wLo; s++) {
      t = false;
      const n = await this.M();
      if (n === undefined) {
        this.g.info("No authentication session available, not starting tunnel");
        return;
      }
      const r = await this.C.withProgress(
        {
          location: 15,
          title: f(9374, null, tv.showLog),
        },
        (o) =>
          new Promise((a, l) => {
            let c = false;
            const u = this.w.onDidChangeTunnelStatus((g) => {
              switch (g.type) {
                case "connecting":
                  if (g.progress) {
                    o.report({
                      message: g.progress,
                    });
                  }
                  break;
                case "connected":
                  u.dispose();
                  c = true;
                  a(g.info);
                  if (g.serviceInstallFailed) {
                    this.F.notify({
                      severity: es.Warning,
                      message: f(9375, null, tv.showLog),
                    });
                  }
                  break;
                case "disconnected":
                  u.dispose();
                  c = true;
                  t = !!g.onTokenFailed;
                  a(undefined);
                  break;
              }
            });
            const h = this.J(n);
            const d = {
              sessionId: n.session.id,
              token: h,
              providerId: n.providerId,
              accountLabel: n.session.account.label,
            };
            this.w
              .startTunnel({
                active: true,
                asService: e,
                session: d,
              })
              .then((g) => {
                if (
                  !c &&
                  (g.type === "connected" || g.type === "disconnected")
                ) {
                  u.dispose();
                  if (g.type === "connected") {
                    a(g.info);
                  } else {
                    t = !!g.onTokenFailed;
                    a(undefined);
                  }
                }
              });
          }),
      );
      if (r || !t) {
        return r;
      }
    }
  }
  async M() {
    const e = await this.P();
    const t = new X();
    const s = t.add(
      this.t.createQuickPick({
        useSeparators: true,
      }),
    );
    s.ok = false;
    s.placeholder = f(9376, null);
    s.ignoreFocusOut = true;
    s.items = await this.O(e);
    return new Promise((n, r) => {
      t.add(
        s.onDidHide((o) => {
          n(undefined);
          t.dispose();
        }),
      );
      t.add(
        s.onDidAccept(async (o) => {
          const a = s.selectedItems[0];
          if ("provider" in a) {
            const l = await this.j.createSession(
              a.provider.id,
              a.provider.scopes,
            );
            n(this.N(l, a.provider.id));
          } else if ("session" in a) {
            n(a);
          } else {
            n(undefined);
          }
          s.hide();
        }),
      );
      s.show();
    });
  }
  N(e, t) {
    return {
      label: e.account.label,
      description: this.j.getProvider(t).label,
      session: e,
      providerId: t,
    };
  }
  async O(e) {
    const t = [];
    if (e.length) {
      t.push({
        type: "separator",
        label: f(9377, null),
      });
      t.push(...e);
      t.push({
        type: "separator",
        label: f(9378, null),
      });
    }
    for (const s of await this.R()) {
      const n = e.some((o) => o.providerId === s.id);
      const r = this.j.getProvider(s.id);
      if (!n || r.supportsMultipleAccounts) {
        t.push({
          label: f(9379, null, r.label),
          provider: s,
        });
      }
    }
    return t;
  }
  async P() {
    const e = await this.R();
    const t = new Map();
    const s = await this.w.getMode();
    let n;
    for (const r of e) {
      const o = await this.j.getSessions(r.id, r.scopes);
      for (const a of o) {
        if (!this.h.has(a.id)) {
          const l = this.N(a, r.id);
          t.set(l.session.account.id, l);
          if (s.active && s.session.sessionId === a.id) {
            n = l;
          }
        }
      }
    }
    if (n !== undefined) {
      t.set(n.session.account.id, n);
    }
    return [...t.values()];
  }
  async Q(e) {
    if (e) {
      const t = (await this.P()).find((s) => s.session.id === e.sessionId);
      if (t) {
        return this.J(t);
      }
    }
  }
  async R() {
    const e = this.b.authenticationProviders;
    const t = Object.keys(e).reduce((n, r) => {
      n.push({
        id: r,
        scopes: e[r].scopes,
      });
      return n;
    }, []);
    const s = this.j.declaredProviders;
    return t.filter(({ id: n }) => s.some((r) => r.id === n));
  }
  S() {
    const e = this;
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.turnOn,
              title: XA.turnOn,
              category: CU,
              precondition: T.equals(YA, "disconnected"),
              menu: [
                {
                  id: M.CommandPalette,
                },
                {
                  id: M.AccountsContext,
                  group: "2_remoteTunnel",
                  when: T.equals(YA, "disconnected"),
                },
              ],
            });
          }
          async run(t) {
            const s = t.get(bi);
            const n = t.get(Fr);
            const r = t.get(St);
            const o = t.get(gt);
            const a = t.get(As);
            const l = t.get(Ji);
            const c = t.get(as);
            if (!o.getBoolean(eln, -1, false)) {
              const { confirmed: m } = await a.confirm({
                message: f(9380, null),
                primaryButton: f(9381, null),
              });
              if (!m) {
                return;
              }
              o.store(eln, true, -1, 0);
            }
            const h = new X();
            const d = l.createQuickPick();
            d.placeholder = f(9382, null);
            d.items = [
              {
                service: false,
                label: f(9383, null),
                description: f(9384, null, c.nameShort),
              },
              {
                service: true,
                label: f(9385, null),
                description: f(9386, null),
              },
            ];
            const g = await new Promise((m) => {
              h.add(d.onDidAccept(() => m(d.selectedItems[0]?.service)));
              h.add(d.onDidHide(() => m(undefined)));
              d.show();
            });
            d.dispose();
            if (g === undefined) {
              return;
            }
            const p = await e.L(g);
            if (p) {
              const m = e.U(p);
              const v = e.b.extension;
              const y = m.toString(false).replace(/\)/g, "%29");
              s.notify({
                severity: es.Info,
                message: f(
                  9387,
                  null,
                  p.tunnelName,
                  p.domain,
                  y,
                  tv.manage,
                  tv.configure,
                  tv.turnOff,
                  v.friendlyName,
                  "https://code.visualstudio.com/docs/remote/tunnels",
                ),
                actions: {
                  primary: [
                    new Qt(
                      "copyToClipboard",
                      f(9388, null),
                      undefined,
                      true,
                      () => n.writeText(m.toString(true)),
                    ),
                    new Qt(
                      "showExtension",
                      f(9389, null),
                      undefined,
                      true,
                      () =>
                        r.executeCommand(
                          "workbench.extensions.action.showExtensionsWithIds",
                          [v.extensionId],
                        ),
                    ),
                  ],
                },
              });
              const w = {
                hostName: p.tunnelName,
                timeStamp: new Date().getTime(),
              };
              o.store(pIi, JSON.stringify(w), -1, 0);
            } else {
              s.notify({
                severity: es.Info,
                message: f(9390, null),
              });
              await r.executeCommand(tv.showLog);
            }
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.manage,
              title: f(9391, null),
              category: CU,
              menu: [
                {
                  id: M.AccountsContext,
                  group: "2_remoteTunnel",
                  when: T.equals(YA, "connected"),
                },
              ],
            });
          }
          async run() {
            e.W();
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.connecting,
              title: f(9392, null),
              category: CU,
              menu: [
                {
                  id: M.AccountsContext,
                  group: "2_remoteTunnel",
                  when: T.equals(YA, "connecting"),
                },
              ],
            });
          }
          async run() {
            e.W();
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.turnOff,
              title: XA.turnOff,
              category: CU,
              precondition: T.notEquals(YA, "disconnected"),
              menu: [
                {
                  id: M.CommandPalette,
                  when: T.notEquals(YA, ""),
                },
              ],
            });
          }
          async run() {
            const t = e.f?.isAttached ? f(9393, null) : f(9394, null);
            const { confirmed: s } = await e.m.confirm({
              message: t,
            });
            if (s) {
              e.w.stopTunnel();
            }
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.showLog,
              title: XA.showLog,
              category: CU,
              menu: [
                {
                  id: M.CommandPalette,
                  when: T.notEquals(YA, ""),
                },
              ],
            });
          }
          async run(t) {
            t.get(Xw).showChannel(Gxi);
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.configure,
              title: XA.configure,
              category: CU,
              menu: [
                {
                  id: M.CommandPalette,
                  when: T.notEquals(YA, ""),
                },
              ],
            });
          }
          async run(t) {
            t.get(To).openSettings({
              query: Jxi,
            });
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.copyToClipboard,
              title: XA.copyToClipboard,
              category: CU,
              precondition: T.equals(YA, "connected"),
              menu: [
                {
                  id: M.CommandPalette,
                  when: T.equals(YA, "connected"),
                },
              ],
            });
          }
          async run(t) {
            const s = t.get(Fr);
            if (e.f) {
              const n = e.U(e.f);
              s.writeText(n.toString(true));
            }
          }
        },
      ),
    );
    this.D(
      J(
        class extends ne {
          constructor() {
            super({
              id: tv.learnMore,
              title: XA.learnMore,
              category: CU,
              menu: [],
            });
          }
          async run(t) {
            await t.get(is).open("https://aka.ms/vscode-server-doc");
          }
        },
      ),
    );
  }
  U(e) {
    const t = this.z.getWorkspace();
    const s = t.folders;
    let n;
    if (s.length === 1) {
      n = s[0].uri;
    } else if (t.configuration && !x6(t.configuration, this.u)) {
      n = t.configuration;
    }
    const r = H.parse(e.link);
    if (n?.scheme === me.file) {
      return Ti(r, n.path);
    } else {
      return Ti(r, this.u.userHome.path);
    }
  }
  async W() {
    const e = await this.w.getMode();
    return new Promise((t, s) => {
      const n = new X();
      const r = this.t.createQuickPick({
        useSeparators: true,
      });
      r.placeholder = f(9395, null);
      n.add(r);
      const o = [];
      o.push({
        id: tv.learnMore,
        label: XA.learnMore,
      });
      if (this.f) {
        r.title = this.f.isAttached
          ? f(9396, null, this.f.tunnelName)
          : f(9397, null, this.f.tunnelName);
        o.push({
          id: tv.copyToClipboard,
          label: XA.copyToClipboard,
          description: this.f.domain,
        });
      } else {
        r.title = f(9398, null);
      }
      o.push({
        id: tv.showLog,
        label: f(9399, null),
      });
      o.push({
        type: "separator",
      });
      o.push({
        id: tv.configure,
        label: f(9400, null),
        description: this.f?.tunnelName,
      });
      o.push({
        id: tv.turnOff,
        label: XA.turnOff,
        description: e.active
          ? `${e.session.accountLabel} (${e.session.providerId})`
          : undefined,
      });
      r.items = o;
      n.add(
        r.onDidAccept(() => {
          if (r.selectedItems[0] && r.selectedItems[0].id) {
            this.y.executeCommand(r.selectedItems[0].id);
          }
          r.hide();
        }),
      );
      n.add(
        r.onDidHide(() => {
          n.dispose();
          t();
        }),
      );
      r.show();
    });
  }
};
mIi = __decorate(
  [
    __param(0, Vv),
    __param(1, As),
    __param(2, Rs),
    __param(3, Re),
    __param(4, as),
    __param(5, gt),
    __param(6, Ep),
    __param(7, Ji),
    __param(8, SO),
    __param(9, jrn),
    __param(10, St),
    __param(11, Tt),
    __param(12, Go),
    __param(13, bi),
  ],
  mIi,
);
var CLo = Ae.as(ir.Workbench);
CLo.registerWorkbenchContribution(mIi, 3);
Ae.as(On.Configuration).registerConfiguration({
  type: "object",
  properties: {
    [Xxo]: {
      description: f(9401, null),
      type: "string",
      scope: 1,
      ignoreSync: true,
      pattern: "^(\\w[\\w-]*)?$",
      patternErrorMessage: f(9402, null),
      maxLength: 20,
      default: "",
    },
    [Qxo]: {
      description: f(9403, null),
      type: "boolean",
      scope: 1,
      default: false,
    },
  },
});
it();
oi();
Ge();
fe();
q();
qt();
Bo();
K();
Je();
Gt();
Me();
xr();
Ee();
ee();
ei();
pt();
Ch();
var uoe;
var hoe;
var OF;
var E5;
var SLo = ["view", "inline", "quick", "editor"];
var SU = T.and(Pt.enabled, xee);
var bIi = T.or(m1, Pt.inChatInput);
var xLo = Pt.requestInProgress;
var sln = new de("scopedVoiceChatGettingReady", false, {
  type: "boolean",
  description: f(5143, null),
});
var nln = new de("scopedVoiceChatInProgress", undefined, {
  type: "string",
  description: f(5144, null),
});
var Oxe = T.or(...SLo.map((i) => nln.isEqualTo(i)));
var xU;
(function (i) {
  i[(i.Stopped = 1)] = "Stopped";
  i[(i.GettingReady = 2)] = "GettingReady";
  i[(i.Started = 3)] = "Started";
})((xU ||= {}));
var rln = class $U {
  static async create(e, t) {
    const s = e.get(vl);
    const n = e.get(i4);
    const r = e.get(jn);
    const o = e.get(De);
    const a = e.get(Es);
    switch (t) {
      case "focused":
        return $U.a(s, r) ?? $U.create(e, "view");
      case "view": {
        const l = await VP(a);
        if (l) {
          return $U.c("view", l);
        }
        break;
      }
      case "inline": {
        const l = em(o.activeTextEditorControl);
        if (l) {
          const c = W0.get(l);
          if (c) {
            if (!c.joinCurrentRun()) {
              c.run();
            }
            return $U.c("inline", c.chatWidget);
          }
        }
        break;
      }
      case "quick":
        n.open();
        return $U.create(e, "focused");
    }
  }
  static a(e, t) {
    const s = e.lastFocusedWidget;
    if (s?.hasInputFocus()) {
      let n;
      if (t.hasFocus("workbench.parts.editor")) {
        if (s.location === os.Panel) {
          n = "editor";
        } else {
          n = "inline";
        }
      } else if (
        [
          "workbench.parts.sidebar",
          "workbench.parts.panel",
          "workbench.parts.auxiliarybar",
          "workbench.parts.titlebar",
          "workbench.parts.statusbar",
          "workbench.parts.banner",
          "workbench.parts.activitybar",
        ].some((r) => t.hasFocus(r))
      ) {
        n = "view";
      } else {
        n = "quick";
      }
      return $U.c(n, s);
    }
  }
  static b(e, t) {
    const s = sln.bindTo(e);
    const n = nln.bindTo(e);
    return (r) => {
      switch (r) {
        case xU.GettingReady:
          s.set(true);
          n.reset();
          break;
        case xU.Started:
          s.reset();
          n.set(t);
          break;
        case xU.Stopped:
          s.reset();
          n.reset();
          break;
      }
    };
  }
  static c(e, t) {
    return {
      context: e,
      scopedContextKeyService: t.scopedContextKeyService,
      onDidAcceptInput: t.onDidAcceptInput,
      onDidHideInput: t.onDidHide,
      focusInput: () => t.focusInput(),
      acceptInput: () =>
        t.acceptInput(undefined, {
          isVoiceInput: true,
        }),
      updateInput: (s) => t.setInput(s),
      getInput: () => t.getInput(),
      setInputPlaceholder: (s) => t.setInputPlaceholder(s),
      clearInputPlaceholder: () => t.resetInputPlaceholder(),
      updateState: $U.b(t.scopedContextKeyService, e),
    };
  }
};
var BG = class {
  static {
    uoe = this;
  }
  static {
    this.a = undefined;
  }
  static getInstance(e) {
    uoe.a ||= e.createInstance(uoe);
    return uoe.a;
  }
  constructor(e, t, s, n) {
    this.d = e;
    this.f = t;
    this.g = s;
    this.h = n;
    this.b = undefined;
    this.c = 0;
  }
  async start(e, t) {
    this.stop();
    UG.getInstance(this.g).stop();
    let s = false;
    const n = ++this.c;
    const r = (this.b = {
      id: n,
      controller: e,
      hasRecognizedInput: false,
      disposables: new X(),
      setTimeoutDisabled: (h) => {
        s = h;
      },
      accept: () => this.accept(n),
      stop: () => this.stop(n, e.context),
    });
    const o = new Hi();
    r.disposables.add(He(() => o.dispose(true)));
    r.disposables.add(e.onDidAcceptInput(() => this.stop(n, e.context)));
    r.disposables.add(e.onDidHideInput(() => this.stop(n, e.context)));
    e.focusInput();
    e.updateState(xU.GettingReady);
    const a = await this.d.createVoiceChatSession(o.token, {
      usesAgents: e.context !== "inline",
      model: t?.widget?.viewModel?.model,
    });
    let l = e.getInput();
    let c = this.f.getValue("accessibility.voice.speechTimeout");
    if (!Pu(c) || c < 0) {
      c = Gws;
    }
    const u = r.disposables.add(new kn(() => this.accept(n), c));
    r.disposables.add(
      a.onDidChange(({ status: h, text: d, waitingForInput: g }) => {
        if (!o.token.isCancellationRequested) {
          switch (h) {
            case Jm.Started:
              this.j(e, r.disposables);
              break;
            case Jm.Recognizing:
              if (d) {
                r.hasRecognizedInput = true;
                r.controller.updateInput(l ? [l, d].join(" ") : d);
                if (c > 0 && t?.voice?.disableTimeout !== true && !s) {
                  u.cancel();
                }
              }
              break;
            case Jm.Recognized:
              if (d) {
                r.hasRecognizedInput = true;
                if (l) {
                  l = [l, d].join(" ");
                } else {
                  l = d;
                }
                r.controller.updateInput(l);
                if (c > 0 && t?.voice?.disableTimeout !== true && !g && !s) {
                  u.schedule();
                }
              }
              break;
            case Jm.Stopped:
              this.stop(r.id, e.context);
              break;
          }
        }
      }),
    );
    return r;
  }
  j(e, t) {
    e.updateState(xU.Started);
    let s = 0;
    const n = () => {
      s = (s + 1) % 4;
      e.setInputPlaceholder(`${f(5145, null)}${".".repeat(s)}`);
      r.schedule();
    };
    const r = t.add(new kn(n, 500));
    n();
  }
  stop(e = this.c, t) {
    if (!!this.b && this.c === e && (!t || this.b.controller.context === t)) {
      this.b.controller.clearInputPlaceholder();
      this.b.controller.updateState(xU.Stopped);
      this.b.disposables.dispose();
      this.b = undefined;
    }
  }
  async accept(e = this.c) {
    if (!this.b || this.c !== e) {
      return;
    }
    if (!this.b.hasRecognizedInput) {
      this.stop(e, this.b.controller.context);
      return;
    }
    const t = this.b.controller;
    const s = await t.acceptInput();
    if (!s) {
      return;
    }
    const n = this.f.getValue("accessibility.voice.autoSynthesize");
    if (n === "on" || (n === "auto" && !this.h.isScreenReaderOptimized())) {
      let r;
      if (t.context === "inline") {
        r = "focused";
      } else {
        r = t;
      }
      UG.getInstance(this.g).start(
        this.g.invokeFunction((o) => uln.create(o, r, s)),
      );
    }
  }
};
BG = uoe = __decorate(
  [__param(0, dzs), __param(1, be), __param(2, se), __param(3, wo)],
  BG,
);
var oln = 500;
async function aln(i, e, t, s) {
  const n = e.get(se);
  const o = e.get(di).enableKeybindingHoldMode(i);
  const a = await rln.create(e, t);
  if (!a) {
    return;
  }
  const l = await BG.getInstance(n).start(a, s);
  let c = false;
  const u = Nu(() => {
    c = true;
    l?.setTimeoutDisabled(true);
  }, oln);
  await o;
  u.dispose();
  if (c) {
    l.accept();
  }
}
var vIi = class extends ne {
  constructor(i, e) {
    super(i);
    this.a = e;
  }
  run(i, e) {
    return aln(this.desc.id, i, this.a, e);
  }
};
var lln = class Xmn extends vIi {
  static {
    this.ID = "workbench.action.chat.voiceChatInChatView";
  }
  constructor() {
    super(
      {
        id: Xmn.ID,
        title: U(5157, "Voice Chat in Chat View"),
        category: Do,
        precondition: T.and(SU, Pt.requestInProgress.negate()),
        f1: true,
      },
      "view",
    );
  }
};
var kLo = class jPi extends ne {
  static {
    this.ID = "workbench.action.chat.holdToVoiceChatInChatView";
  }
  constructor() {
    super({
      id: jPi.ID,
      title: U(5158, "Hold to Voice Chat in Chat View"),
      keybinding: {
        weight: 200,
        when: T.and(
          SU,
          Pt.requestInProgress.negate(),
          bIi?.negate(),
          ke.focus.negate(),
          ea.negate(),
        ),
        primary: 2087,
      },
    });
  }
  async run(e, t) {
    const s = e.get(se);
    const n = e.get(di);
    const r = e.get(Es);
    const o = n.enableKeybindingHoldMode(jPi.ID);
    let a;
    const l = Nu(async () => {
      const c = await rln.create(e, "view");
      if (c) {
        a = await BG.getInstance(s).start(c, t);
        a.setTimeoutDisabled(true);
      }
    }, oln);
    (await VP(r))?.focusInput();
    await o;
    l.dispose();
    if (a) {
      a.accept();
    }
  }
};
var yIi = class Qmn extends vIi {
  static {
    this.ID = "workbench.action.chat.inlineVoiceChat";
  }
  constructor() {
    super(
      {
        id: Qmn.ID,
        title: U(5159, "Inline Voice Chat"),
        category: Do,
        precondition: T.and(SU, hl, Pt.requestInProgress.negate()),
        f1: true,
      },
      "inline",
    );
  }
};
var cln = class Zmn extends vIi {
  static {
    this.ID = "workbench.action.chat.quickVoiceChat";
  }
  constructor() {
    super(
      {
        id: Zmn.ID,
        title: U(5160, "Quick Voice Chat"),
        category: Do,
        precondition: T.and(SU, Pt.requestInProgress.negate()),
        f1: true,
      },
      "quick",
    );
  }
};
var ELo = class ebn extends ne {
  static {
    this.ID = "workbench.action.chat.startVoiceChat";
  }
  constructor() {
    const e = T.and(xee, _F.negate(), Oxe?.negate());
    super({
      id: ebn.ID,
      title: U(5161, "Start Voice Chat"),
      category: Do,
      f1: true,
      keybinding: {
        weight: 200,
        when: T.and(bIi, ke.focus.negate(), ea.negate()),
        primary: 2087,
      },
      icon: A.mic,
      precondition: T.and(SU, sln.negate(), xLo?.negate(), c9t.negate()),
      menu: [
        {
          id: M.ChatInput,
          when: T.and(
            T.or(
              Pt.location.isEqualTo(os.Panel),
              Pt.location.isEqualTo(os.EditingSession),
            ),
            e,
          ),
          group: "navigation",
          order: 3,
        },
        {
          id: M.ChatExecute,
          when: T.and(
            Pt.location.isEqualTo(os.Panel).negate(),
            Pt.location.isEqualTo(os.EditingSession).negate(),
            e,
          ),
          group: "navigation",
          order: 2,
        },
      ],
    });
  }
  async run(e, t) {
    const s = t?.widget;
    if (s) {
      s.focusInput();
    }
    return aln(this.desc.id, e, "focused", t);
  }
};
var ILo = class tbn extends ne {
  static {
    this.ID = "workbench.action.chat.stopListening";
  }
  constructor() {
    super({
      id: tbn.ID,
      title: U(5162, "Stop Listening"),
      category: Do,
      f1: true,
      keybinding: {
        weight: 300,
        primary: 9,
        when: Oxe,
      },
      icon: pZ,
      precondition: Rci,
      menu: [
        {
          id: M.ChatInput,
          when: T.and(Pt.location.isEqualTo(os.Panel), Oxe),
          group: "navigation",
          order: 3,
        },
        {
          id: M.ChatExecute,
          when: T.and(Pt.location.isEqualTo(os.Panel).negate(), Oxe),
          group: "navigation",
          order: 2,
        },
      ],
    });
  }
  async run(e) {
    BG.getInstance(e.get(se)).stop();
  }
};
var DLo = class ibn extends ne {
  static {
    this.ID = "workbench.action.chat.stopListeningAndSubmit";
  }
  constructor() {
    super({
      id: ibn.ID,
      title: U(5163, "Stop Listening and Submit"),
      category: Do,
      f1: true,
      keybinding: {
        weight: 200,
        when: T.and(bIi, Oxe),
        primary: 2087,
      },
      precondition: Rci,
    });
  }
  run(e) {
    BG.getInstance(e.get(se)).accept();
  }
};
var _F = new de("scopedChatSynthesisInProgress", false, {
  type: "boolean",
  description: f(5146, null),
});
var uln = class sbn {
  static create(e, t, s) {
    if (t === "focused") {
      return sbn.a(e, s);
    } else {
      return {
        onDidHideChat: t.onDidHideInput,
        contextKeyService: t.scopedContextKeyService,
        response: s,
      };
    }
  }
  static a(e, t) {
    const s = e.get(vl);
    const n = e.get(Re);
    let r = s.getWidgetBySessionId(t.session.sessionId);
    if (r?.location === os.Editor) {
      r = s.lastFocusedWidget;
    }
    return {
      onDidHideChat: r?.onDidHide ?? ce.None,
      contextKeyService: r?.scopedContextKeyService ?? n,
      response: t,
    };
  }
};
var UG = class {
  static {
    hoe = this;
  }
  static {
    this.a = undefined;
  }
  static getInstance(e) {
    hoe.a ||= e.createInstance(hoe);
    return hoe.a;
  }
  constructor(e, t) {
    this.c = e;
    this.d = t;
    this.b = undefined;
  }
  async start(e) {
    this.stop();
    BG.getInstance(this.d).stop();
    const t = (this.b = new Hi());
    const s = new X();
    t.token.onCancellationRequested(() => s.dispose());
    const n = await this.c.createTextToSpeechSession(t.token, "chat");
    if (t.token.isCancellationRequested) {
      return;
    }
    s.add(e.onDidHideChat(() => this.stop()));
    const r = _F.bindTo(e.contextKeyService);
    s.add(He(() => r.reset()));
    s.add(
      n.onDidChange((o) => {
        switch (o.status) {
          case F3.Started:
            r.set(true);
            break;
          case F3.Stopped:
            r.reset();
            break;
        }
      }),
    );
    for await (const o of this.f(e.response, t.token)) {
      if (t.token.isCancellationRequested) {
        return;
      }
      await tp(n.synthesize(o), t.token);
    }
  }
  async *f(e, t) {
    let s = 0;
    let n = false;
    do {
      const r = e.response.toString().length;
      const { chunk: o, offset: a } = this.g(e, s);
      s = a;
      n = e.isComplete;
      if (o) {
        yield o;
      }
      if (t.isCancellationRequested) {
        return;
      }
      if (!n && r === e.response.toString().length) {
        await tp(ce.toPromise(e.onDidChange), t);
      }
    } while (!t.isCancellationRequested && !n);
  }
  g(e, t) {
    let s;
    const n = e.response.toString();
    if (e.isComplete) {
      s = n.substring(t);
      t = n.length + 1;
    } else {
      const r = NLo(n, t);
      s = r.chunk;
      t = r.offset;
    }
    return {
      chunk:
        s &&
        XV({
          value: s,
        }),
      offset: t,
    };
  }
  stop() {
    this.b?.dispose(true);
    this.b = undefined;
  }
};
UG = hoe = __decorate([__param(0, Z_), __param(1, se)], UG);
var TLo = [".", "!", "?", ":"];
var PLo = `
`;
var LLo = " ";
function NLo(i, e) {
  let t;
  for (let s = i.length - 1; s >= e; s--) {
    const n = i[s];
    const r = i[s + 1];
    if ((TLo.includes(n) && r === LLo) || PLo === n) {
      t = i.substring(e, s + 1).trim();
      e = s + 1;
      break;
    }
  }
  return {
    chunk: t,
    offset: e,
  };
}
var RLo = class extends ne {
  constructor() {
    super({
      id: "workbench.action.chat.readChatResponseAloud",
      title: U(5164, "Read Aloud"),
      icon: A.unmute,
      precondition: SU,
      menu: [
        {
          id: M.ChatMessageFooter,
          when: T.and(
            SU,
            Pt.isResponse,
            _F.negate(),
            Pt.responseIsFiltered.negate(),
          ),
          group: "navigation",
          order: -10,
        },
        {
          id: jq,
          when: T.and(
            SU,
            Pt.isResponse,
            _F.negate(),
            Pt.responseIsFiltered.negate(),
          ),
          group: "navigation",
          order: -10,
        },
      ],
    });
  }
  run(i, ...e) {
    const t = i.get(se);
    const s = i.get(vl);
    let n;
    if (e.length > 0) {
      const o = e[0];
      if (Zr(o)) {
        n = o;
      }
    } else {
      const o = s.lastFocusedWidget;
      if (o) {
        const a = o.getFocus();
        if (a instanceof Lee) {
          n = a;
        } else {
          const l = o.viewModel;
          if (l) {
            const c = l.getItems();
            for (let u = c.length - 1; u >= 0; u--) {
              const h = c[u];
              if (Zr(h)) {
                n = h;
                break;
              }
            }
          }
        }
      }
    }
    if (!n) {
      return;
    }
    const r = uln.create(i, "focused", n.model);
    UG.getInstance(t).start(r);
  }
};
var ALo = class nbn extends ne {
  static {
    this.ID = "workbench.action.speech.stopReadAloud";
  }
  constructor() {
    super({
      id: nbn.ID,
      icon: A4t,
      title: U(5165, "Stop Reading Aloud"),
      f1: true,
      category: Do,
      precondition: Uws,
      keybinding: {
        weight: 300,
        primary: 9,
        when: _F,
      },
      menu: [
        {
          id: M.ChatInput,
          when: T.and(Pt.location.isEqualTo(os.Panel), _F),
          group: "navigation",
          order: 3,
        },
        {
          id: M.ChatExecute,
          when: T.and(Pt.location.isEqualTo(os.Panel).negate(), _F),
          group: "navigation",
          order: 2,
        },
      ],
    });
  }
  async run(e) {
    UG.getInstance(e.get(se)).stop();
  }
};
var MLo = class rbn extends ne {
  static {
    this.ID = "workbench.action.chat.stopReadChatItemAloud";
  }
  constructor() {
    super({
      id: rbn.ID,
      icon: A.mute,
      title: U(5166, "Stop Reading Aloud"),
      precondition: _F,
      keybinding: {
        weight: 300,
        primary: 9,
      },
      menu: [
        {
          id: M.ChatMessageFooter,
          when: T.and(_F, Pt.isResponse, Pt.responseIsFiltered.negate()),
          group: "navigation",
          order: -10,
        },
        {
          id: jq,
          when: T.and(_F, Pt.isResponse, Pt.responseIsFiltered.negate()),
          group: "navigation",
          order: -10,
        },
      ],
    });
  }
  async run(e, ...t) {
    UG.getInstance(e.get(se)).stop();
  }
};
function hln(i, e, t) {
  if (!e.hasSpeechProvider || !t.getDefaultAgent(os.Panel)) {
    return false;
  }
  const s = i.getValue(Vq);
  return typeof s == "string" && s !== _xe.SETTINGS_VALUE.OFF;
}
var _xe = class extends V {
  static {
    OF = this;
  }
  static {
    this.ID = "workbench.contrib.keywordActivation";
  }
  static {
    this.SETTINGS_VALUE = {
      OFF: "off",
      INLINE_CHAT: "inlineChat",
      QUICK_CHAT: "quickChat",
      VIEW_CHAT: "chatInView",
      CHAT_IN_CONTEXT: "chatInContext",
    };
  }
  constructor(e, t, s, n, r, o, a) {
    super();
    this.b = e;
    this.c = t;
    this.f = s;
    this.g = r;
    this.h = o;
    this.j = a;
    this.a = undefined;
    this.D(n.createInstance(wIi));
    this.m();
  }
  m() {
    this.D(
      ce.runAndSubscribe(this.b.onDidChangeHasSpeechProvider, () => {
        this.n();
        this.q();
      }),
    );
    const e = this.D(
      this.j.onDidChangeAgents(() => {
        if (this.j.getDefaultAgent(os.Panel)) {
          this.n();
          this.q();
          e.dispose();
        }
      }),
    );
    this.D(this.b.onDidStartSpeechToTextSession(() => this.q()));
    this.D(this.b.onDidEndSpeechToTextSession(() => this.q()));
    this.D(
      this.c.onDidChangeConfiguration((t) => {
        if (t.affectsConfiguration(Vq)) {
          this.q();
        }
      }),
    );
  }
  n() {
    if (!this.b.hasSpeechProvider || !this.j.getDefaultAgent(os.Panel)) {
      return;
    }
    Ae.as(On.Configuration).registerConfiguration({
      ...p9t,
      properties: {
        [Vq]: {
          type: "string",
          enum: [
            OF.SETTINGS_VALUE.OFF,
            OF.SETTINGS_VALUE.VIEW_CHAT,
            OF.SETTINGS_VALUE.QUICK_CHAT,
            OF.SETTINGS_VALUE.INLINE_CHAT,
            OF.SETTINGS_VALUE.CHAT_IN_CONTEXT,
          ],
          enumDescriptions: [
            f(5147, null),
            f(5148, null),
            f(5149, null),
            f(5150, null),
            f(5151, null),
          ],
          description: f(5152, null),
          default: "off",
          tags: ["accessibility"],
        },
      },
    });
  }
  q() {
    const e =
      hln(this.c, this.b, this.j) && !this.b.hasActiveSpeechToTextSession;
    if ((!e || !this.a) && (!!e || !!this.a)) {
      if (e) {
        this.r();
      } else {
        this.t();
      }
    }
  }
  async r() {
    const e = (this.a = new Hi());
    const t = await this.b.recognizeKeyword(e.token);
    if (!e.token.isCancellationRequested && e === this.a) {
      this.a = undefined;
      if (t === kee.Recognized) {
        if (this.h.hasFocus) {
          this.f.executeCommand(this.s());
        }
        this.q();
      }
    }
  }
  s() {
    switch (this.c.getValue(Vq)) {
      case OF.SETTINGS_VALUE.INLINE_CHAT:
        return yIi.ID;
      case OF.SETTINGS_VALUE.QUICK_CHAT:
        return cln.ID;
      case OF.SETTINGS_VALUE.CHAT_IN_CONTEXT:
        if (em(this.g.activeTextEditorControl)?.hasWidgetFocus()) {
          return yIi.ID;
        }
      default:
        return lln.ID;
    }
  }
  t() {
    this.a?.dispose(true);
    this.a = undefined;
  }
  dispose() {
    this.a?.dispose();
    super.dispose();
  }
};
_xe = OF = __decorate(
  [
    __param(0, Z_),
    __param(1, be),
    __param(2, St),
    __param(3, se),
    __param(4, De),
    __param(5, Zn),
    __param(6, Zu),
  ],
  _xe,
);
var wIi = class extends V {
  static {
    E5 = this;
  }
  static {
    this.b = f(5153, null);
  }
  static {
    this.c = "keywordActivation.status.command";
  }
  static {
    this.f = f(5154, null);
  }
  static {
    this.g = f(5155, null);
  }
  constructor(e, t, s, n, r) {
    super();
    this.h = e;
    this.j = t;
    this.m = s;
    this.n = n;
    this.q = r;
    this.a = this.D(new ki());
    this.D(
      ni.registerCommand(E5.c, () =>
        this.m.executeCommand("workbench.action.openSettings", Vq),
      ),
    );
    this.r();
    this.s();
  }
  r() {
    this.D(this.h.onDidStartKeywordRecognition(() => this.s()));
    this.D(this.h.onDidEndKeywordRecognition(() => this.s()));
    this.D(
      this.n.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(Vq)) {
          this.s();
        }
      }),
    );
  }
  s() {
    if (hln(this.n, this.h, this.q)) {
      if (!this.a.value) {
        this.t();
      }
      this.w();
    } else {
      this.a.clear();
    }
  }
  t() {
    this.a.value = this.j.addEntry(
      this.u(),
      "status.voiceKeywordActivation",
      1,
      103,
    );
  }
  u() {
    return {
      name: E5.b,
      text: this.h.hasActiveKeywordRecognition ? "$(mic-filled)" : "$(mic)",
      tooltip: this.h.hasActiveKeywordRecognition ? E5.f : E5.g,
      ariaLabel: this.h.hasActiveKeywordRecognition ? E5.f : E5.g,
      command: E5.c,
      kind: "prominent",
      showInAllWindows: true,
    };
  }
  w() {
    this.a.value?.update(this.u());
  }
};
wIi = E5 = __decorate(
  [
    __param(0, Z_),
    __param(1, Ac),
    __param(2, St),
    __param(3, be),
    __param(4, Zu),
  ],
  wIi,
);
var CIi = new de("installingSpeechProvider", false, true);
var $Lo = class obn extends ne {
  static {
    this.a = "ms-vscode.vscode-speech";
  }
  async run(e) {
    const t = e.get(Re);
    const s = e.get(hr);
    try {
      CIi.bindTo(t).set(true);
      await s.install(
        obn.a,
        {
          justification: this.b(),
          enable: true,
        },
        15,
      );
    } finally {
      CIi.bindTo(t).reset();
    }
  }
};
var FLo = class abn extends $Lo {
  static {
    this.ID = "workbench.action.chat.installProviderForVoiceChat";
  }
  constructor() {
    super({
      id: abn.ID,
      title: U(5167, "Start Voice Chat"),
      icon: A.mic,
      precondition: CIi.negate(),
      menu: [
        {
          id: M.ChatInput,
          when: T.and(
            xee.negate(),
            T.or(
              Pt.location.isEqualTo(os.Panel),
              Pt.location.isEqualTo(os.EditingSession),
            ),
          ),
          group: "navigation",
          order: 3,
        },
        {
          id: M.ChatExecute,
          when: T.and(
            xee.negate(),
            Pt.location.isEqualTo(os.Panel).negate(),
            Pt.location.isEqualTo(os.EditingSession).negate(),
          ),
          group: "navigation",
          order: 2,
        },
      ],
    });
  }
  b() {
    return f(5156, null);
  }
};
ad((i, e) => {
  let t;
  let s;
  if (i.type === ga.LIGHT || i.type === ga.DARK) {
    t = i.getColor(K3) ?? i.getColor(_g);
    s = t?.transparent(0.38);
  } else {
    t = i.getColor(Vs);
    s = i.getColor(Vs);
  }
  e.addRule(`
		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-sync.codicon-modifier-spin:not(.disabled),
		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-loading.codicon-modifier-spin:not(.disabled) {
			color: ${t};
			outline: 1px solid ${t};
			outline-offset: -1px;
			animation: pulseAnimation 1s infinite;
			border-radius: 50%;
		}

		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-sync.codicon-modifier-spin:not(.disabled)::before,
		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-loading.codicon-modifier-spin:not(.disabled)::before {
			position: absolute;
			outline: 1px solid ${t};
			outline-offset: 2px;
			border-radius: 50%;
			width: 16px;
			height: 16px;
		}

		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-sync.codicon-modifier-spin:not(.disabled)::after,
		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-loading.codicon-modifier-spin:not(.disabled)::after {
			outline: 2px solid ${t};
			outline-offset: -1px;
			animation: pulseAnimation 1500ms cubic-bezier(0.75, 0, 0.25, 1) infinite;
		}

		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-sync.codicon-modifier-spin:not(.disabled)::before,
		.monaco-workbench:not(.reduce-motion) .interactive-input-part .monaco-action-bar .action-label.codicon-loading.codicon-modifier-spin:not(.disabled)::before {
			position: absolute;
			outline: 1px solid ${t};
			outline-offset: 2px;
			border-radius: 50%;
			width: 16px;
			height: 16px;
		}

		@keyframes pulseAnimation {
			0% {
				outline-width: 2px;
			}
			62% {
				outline-width: 5px;
				outline-color: ${s};
			}
			100% {
				outline-width: 2px;
			}
		}
	`);
});
Je();
J(ELo);
J(FLo);
J(lln);
J(kLo);
J(cln);
J(yIi);
J(ILo);
J(DLo);
J(RLo);
J(MLo);
J(ALo);
$n(_xe.ID, _xe, 3);
rt();
na();
$t();
ei();
Yt();
var SIi = class {
  constructor(e, t, s, n) {
    this.a = e;
    this.b = t;
    this.c = s;
    this.d = n;
    this.e();
  }
  async e() {
    if (
      !!xa &&
      !this.d.getBoolean("encryption.migratedToGnomeLibsecret", -1, false)
    ) {
      try {
        const e = await this.c.readFile(this.b.argvResource);
        const t = Brn(e.value.toString());
        if (
          t["password-store"] === "gnome" ||
          t["password-store"] === "gnome-keyring"
        ) {
          this.a.write(
            this.b.argvResource,
            [
              {
                path: ["password-store"],
                value: "gnome-libsecret",
              },
            ],
            true,
          );
        }
        this.d.store("encryption.migratedToGnomeLibsecret", true, -1, 0);
      } catch (e) {
        console.error(e);
      }
    }
  }
};
SIi = __decorate(
  [__param(0, RE), __param(1, Lo), __param(2, xt), __param(3, gt)],
  SIi,
);
Ae.as(ir.Workbench).registerWorkbenchContribution(SIi, 4);
rn();
oi();
ri();
Ge();
IS();
var xIi = class {
  static {
    this.ID = "workbench.contrib.emergencyAlert";
  }
  constructor(e, t, s, n) {
    this.a = e;
    this.b = t;
    this.c = s;
    this.d = n;
    if (s.quality !== "insider") {
      return;
    }
    const r = s.emergencyAlertUrl;
    if (r) {
      this.f(r);
    }
  }
  async f(e) {
    try {
      await this.g(e);
    } catch (t) {
      this.d.error(t);
    }
  }
  async g(e) {
    const t = await this.b.request(
      {
        type: "GET",
        url: e,
      },
      mt.None,
    );
    if (t.res.statusCode !== 200) {
      throw new Error(
        `Failed to fetch emergency alerts: HTTP ${t.res.statusCode}`,
      );
    }
    const s = await t4(t);
    if (s) {
      for (const n of s.alerts) {
        if (
          n.commit !== this.c.commit ||
          (n.platform && n.platform !== Z5) ||
          (n.arch && n.arch !== fze)
        ) {
          return;
        }
        this.a.show({
          id: "emergencyAlert.banner",
          icon: A.warning,
          message: n.message,
          actions: n.actions,
        });
        break;
      }
    }
  }
};
xIi = __decorate(
  [__param(0, IB), __param(1, F0), __param(2, as), __param(3, _t)],
  xIi,
);
$n("workbench.emergencyAlert", xIi, 4);
K();
K();
Je();
Ys();
ai();
Uf();
J(
  class extends ne {
    constructor() {
      super({
        id: "workbench.action.developer.captureAndSendDebuggingData",
        title: U(11522, "Capture and Send Debugging Data"),
        category: kt.Developer,
        f1: true,
      });
    }
    async run(e) {
      const t = e.get(iSt);
      const s = e.get(Sh);
      const n = e.get(As);
      const r = e.get(Swe);
      const o = e.get(Go);
      const a = e.get(Tt);
      if (s.reactivePrivacyMode()) {
        n.error(f(11509, null));
        return;
      }
      if (
        !(
          await n.confirm({
            message: f(11510, null),
            detail: f(11511, null),
            primaryButton: f(11512, null),
            cancelButton: f(11513, null),
          })
        ).confirmed
      ) {
        return;
      }
      const c = await t.getDebuggingDataUploadUrl();
      if (c.url !== "") {
        await o.withProgress(
          {
            location: 10,
            title: f(11514, null),
          },
          async () => {
            await r.captureAndSendDebuggingData(YI.pid, {
              rendererHeapStatistics: YI.getHeapStatistics(),
              uploadUrl: c.url,
              workspaceId: a.getWorkspace().id,
            });
          },
        );
      }
    }
  },
);
J(
  class extends ne {
    constructor() {
      super({
        id: "workbench.action.developer.toggleWatchForCrashes",
        title: U(11523, "Toggle Watch for Crashes"),
        category: kt.Developer,
        f1: true,
      });
    }
    async run(e) {
      const t = e.get(Sh);
      const s = e.get(As);
      const n = e.get(bi);
      const r = e.get(Swe);
      if (t.reactivePrivacyMode()) {
        s.error(f(11515, null));
        return;
      }
      if (
        !(await r.getIsWatchingForCrashes()) &&
        !(
          await s.confirm({
            message: f(11516, null),
            detail: f(11517, null),
            primaryButton: f(11518, null),
            cancelButton: f(11519, null),
          })
        ).confirmed
      ) {
        return;
      }
      const o = await r.toggleWatchForCrashes();
      n.info(f(o ? 11520 : 11521, null));
    }
  },
);
st(n0e, new Os(_2r, [[]], true));
export { A1o as main }; /*! @license DOMPurify 3.1.7 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.1.7/LICENSE */
