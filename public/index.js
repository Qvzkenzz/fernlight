"use strict";
const $ = (id) => document.getElementById(id);

/* ---------------- settings & storage ---------------- */
const ENGINES = {
	google: "https://www.google.com/search?q=%s",
	duckduckgo: "https://duckduckgo.com/?q=%s",
	bing: "https://www.bing.com/search?q=%s",
	brave: "https://search.brave.com/search?q=%s",
};
const store = {
	get(k, d) { try { const v = localStorage.getItem("fl_" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
	set(k, v) { try { localStorage.setItem("fl_" + k, JSON.stringify(v)); } catch {} },
};
const settings = Object.assign({ engine: "google", fireflies: true, saveHistory: true }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
let history = store.get("history", []);

/* ---------------- proxy setup ---------------- */
const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});
scramjet.init();
const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
let ready = false;

async function ensureReady() {
	if (ready) return;
	await registerSW();
	const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
	}
	ready = true;
}

/* ---------------- tabs ---------------- */
let tabs = [];
let active = null;
let nextId = 1;

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }

async function openUrl(input, newTab = false) {
	const url = search(input.trim(), ENGINES[settings.engine]);
	try {
		await ensureReady();
	} catch (err) {
		$("error").textContent = "Couldn't start the proxy: " + err.message;
		return;
	}
	$("error").textContent = "";
	if (!active || newTab) createTab(url);
	else active.frame.go(url);
	showBrowser();
}

function createTab(url) {
	const frame = scramjet.createFrame();
	const tab = { id: nextId++, frame, url, title: hostOf(url) };
	frame.addEventListener("urlchange", (e) => {
		tab.url = e.url;
		tab.title = hostOf(e.url);
		try { const t = frame.frame.contentDocument?.title; if (t) tab.title = t; } catch {}
		addHistory(e.url);
		if (tab === active) $("addr").value = e.url;
		renderTabs();
	});
	frame.frame.addEventListener("load", () => {
		try { const t = frame.frame.contentDocument?.title; if (t) { tab.title = t; renderTabs(); } } catch {}
	});
	$("frames").appendChild(frame.frame);
	tabs.push(tab);
	frame.go(url);
	switchTab(tab);
}

function switchTab(tab) {
	active = tab;
	tabs.forEach((t) => (t.frame.frame.style.display = t === tab ? "block" : "none"));
	$("addr").value = tab.url;
	renderTabs();
}

function closeTab(tab) {
	tab.frame.frame.remove();
	tabs = tabs.filter((t) => t !== tab);
	if (active === tab) {
		active = null;
		if (tabs.length) switchTab(tabs[tabs.length - 1]);
		else showHome();
	}
	renderTabs();
}

function renderTabs() {
	$("tab-count").textContent = tabs.length || "";
	const list = $("tab-list");
	list.innerHTML = "";
	if (!tabs.length) {
		list.innerHTML = '<p class="empty">no tabs open</p>';
		return;
	}
	tabs.forEach((t) => {
		const el = document.createElement("div");
		el.className = "tab" + (t === active ? " active" : "");
		const span = document.createElement("span");
		span.textContent = t.title;
		const x = document.createElement("button");
		x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
		x.onclick = (e) => { e.stopPropagation(); closeTab(t); };
		el.onclick = () => { switchTab(t); showBrowser(); closeDrawer(); };
		el.append(span, x);
		list.appendChild(el);
	});
}

function addHistory(url) {
	if (!settings.saveHistory) return;
	if (history[0] === url) return;
	history = [url, ...history.filter((h) => h !== url)].slice(0, 50);
	store.set("history", history);
}

/* ---------------- views ---------------- */
function showBrowser() { $("browser").classList.remove("hidden"); $("home").classList.add("hidden"); }
function showHome() {
	$("browser").classList.add("hidden");
	$("home").classList.remove("hidden");
	if (document.fullscreenElement) document.exitFullscreen();
	setTimeout(() => $("search-input").focus(), 50);
}
function openDrawer() { renderTabs(); $("drawer").classList.add("open"); }
function closeDrawer() { $("drawer").classList.remove("open"); }

/* ---------------- panels ---------------- */
const APPS = [
	["YouTube", "youtube.com"], ["Wikipedia", "wikipedia.org"], ["Reddit", "reddit.com"],
	["GitHub", "github.com"], ["Discord", "discord.com/app"], ["Twitch", "twitch.tv"],
	["Pinterest", "pinterest.com"], ["Google", "google.com"], ["Netlify", "app.netlify.com"],
];
const MUSIC = [
	["Spotify", "open.spotify.com"], ["YouTube Music", "music.youtube.com"],
	["SoundCloud", "soundcloud.com"], ["Lofi Girl", "youtube.com/@LofiGirl/streams"],
];

function tiles(list) {
	const g = document.createElement("div");
	g.className = "grid";
	list.forEach(([name, url]) => {
		const b = document.createElement("button");
		b.className = "tile";
		b.innerHTML = `<div class="ic"></div><span></span>`;
		b.querySelector(".ic").textContent = name[0];
		b.querySelector("span").textContent = name;
		b.onclick = () => { closePanel(); openUrl("https://" + url, true); };
		g.appendChild(b);
	});
	return g;
}

const PANELS = {
	apps: () => tiles(APPS),
	music: () => tiles(MUSIC),
	history: () => {
		const wrap = document.createElement("div");
		if (!history.length) { wrap.innerHTML = '<p class="empty">nothing here yet</p>'; return wrap; }
		history.forEach((h) => {
			const b = document.createElement("button");
			b.className = "hist";
			b.textContent = h;
			b.onclick = () => { closePanel(); openUrl(h, true); };
			wrap.appendChild(b);
		});
		const clear = document.createElement("button");
		clear.className = "small-btn";
		clear.style.marginTop = "12px";
		clear.textContent = "clear history";
		clear.onclick = () => { history = []; store.set("history", history); openPanel("history"); };
		wrap.appendChild(clear);
		return wrap;
	},
	settings: () => {
		const wrap = document.createElement("div");
		wrap.innerHTML = `
			<div class="row"><div>search engine<small>used when you type words instead of a url</small></div>
				<select id="s-engine">${Object.keys(ENGINES).map((k) => `<option value="${k}">${k}</option>`).join("")}</select></div>
			<div class="row"><div>fireflies<small>floating lights in the background</small></div>
				<input type="checkbox" id="s-ff"></div>
			<div class="row"><div>save history<small>stored only in this browser</small></div>
				<input type="checkbox" id="s-hist"></div>`;
		const eng = wrap.querySelector("#s-engine");
		eng.value = settings.engine;
		eng.onchange = () => { settings.engine = eng.value; saveSettings(); };
		const ff = wrap.querySelector("#s-ff");
		ff.checked = settings.fireflies;
		ff.onchange = () => { settings.fireflies = ff.checked; saveSettings(); };
		const hi = wrap.querySelector("#s-hist");
		hi.checked = settings.saveHistory;
		hi.onchange = () => { settings.saveHistory = hi.checked; saveSettings(); };
		return wrap;
	},
};

function openPanel(name) {
	$("panel-title").textContent = name;
	const body = $("panel-body");
	body.innerHTML = "";
	body.appendChild(PANELS[name]());
	$("overlay").classList.remove("hidden");
}
function closePanel() { $("overlay").classList.add("hidden"); }

/* ---------------- wiring ---------------- */
$("search-form").addEventListener("submit", (e) => {
	e.preventDefault();
	const v = $("search-input").value;
	if (!v.trim()) return;
	openUrl(v, true);
	$("search-input").value = "";
});
$("addr-form").addEventListener("submit", (e) => {
	e.preventDefault();
	openUrl($("addr").value);
	$("addr").blur();
});
$("addr").addEventListener("focus", () => $("addr").select());
$("b-back").onclick = () => active?.frame.back();
$("b-fwd").onclick = () => active?.frame.forward();
$("b-reload").onclick = () => active?.frame.reload();
$("b-home").onclick = showHome;
$("b-tabs").onclick = openDrawer;
$("b-full").onclick = () => document.fullscreenElement ? document.exitFullscreen() : $("browser").requestFullscreen?.();
$("drawer-toggle").onclick = openDrawer;
$("drawer-close").onclick = closeDrawer;
$("drawer-new").onclick = () => { closeDrawer(); showHome(); };
document.querySelectorAll(".chip[data-panel]").forEach((c) => (c.onclick = () => openPanel(c.dataset.panel)));
$("panel-close").onclick = closePanel;
$("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closePanel(); });
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") { closePanel(); closeDrawer(); }
});
document.addEventListener("click", (e) => {
	if ($("drawer").classList.contains("open") && !$("drawer").contains(e.target) && !e.target.closest("#drawer-toggle,#b-tabs")) closeDrawer();
});
renderTabs();

/* ---------------- online users (real count from the server) ---------------- */
(function presence() {
	try {
		const ws = new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/presence/");
		ws.onmessage = (e) => { const n = parseInt(e.data); if (!isNaN(n)) $("online").textContent = n; };
		ws.onclose = () => setTimeout(presence, 5000);
	} catch {}
})();

/* ---------------- fireflies ---------------- */
(function fireflies() {
	const c = $("fireflies");
	const ctx = c.getContext("2d");
	let w, h, flies;
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	function resize() {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		w = innerWidth; h = innerHeight;
		c.width = w * dpr; c.height = h * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const n = Math.round((w * h) / 18000);
		flies = Array.from({ length: n }, () => ({
			x: Math.random() * w, y: Math.random() * h,
			r: Math.random() * 1.6 + 0.6,
			vx: (Math.random() - 0.5) * 0.25, vy: -Math.random() * 0.25 - 0.05,
			p: Math.random() * Math.PI * 2, s: Math.random() * 0.02 + 0.008,
		}));
	}
	function frame() {
		ctx.clearRect(0, 0, w, h);
		if (settings.fireflies && !$("home").classList.contains("hidden")) {
			for (const f of flies) {
				if (!reduce) {
					f.p += f.s;
					f.x += f.vx + Math.sin(f.p) * 0.15;
					f.y += f.vy;
					if (f.y < -10) { f.y = h + 10; f.x = Math.random() * w; }
					if (f.x < -10) f.x = w + 10; else if (f.x > w + 10) f.x = -10;
				}
				const a = 0.35 + Math.sin(f.p * 1.7) * 0.3;
				const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 5);
				g.addColorStop(0, `rgba(190,240,205,${a})`);
				g.addColorStop(1, "rgba(190,240,205,0)");
				ctx.fillStyle = g;
				ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 5, 0, Math.PI * 2); ctx.fill();
			}
		}
		requestAnimationFrame(frame);
	}
	addEventListener("resize", resize);
	resize();
	frame();
})();
