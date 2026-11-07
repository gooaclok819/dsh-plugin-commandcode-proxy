window.__ModuleLoader__.load({
	id: "@local/dsh-commandcode-proxy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** Dictionary namespace owned by this plugin. */
		const NS = "commandcode-proxy";
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale"];
		/** Endpoint served by the host half. */
		const USAGE_API = "/api/dsh-commandcode-proxy/usage";

		const en = {
			nav: "Command-Code",
			title: "Command-Code usage",
			intro: "Token usage recorded by the Harness for the command provider, plus the live state of the local reverse proxy.",
			refresh: "Refresh",
			loading: "Loading…",
			failed: "Could not read usage",
			today: "Today",
			total: "All time",
			calls: "Calls",
			proxy: "Proxy",
			running: "running",
			down: "down",
			model: "Model",
			input: "Input",
			output: "Output",
			cache: "Cache read",
			recent: "Recent days",
			date: "Date",
			empty: "No usage recorded for this provider yet.",
			ledger: "Ledger",
			models: "By model",
			pid: "PID",
			uptime: "Uptime",
			baseUrl: "Base URL",
			noModels: "No models yet.",
		};

		const zh = {
			nav: "Command-Code",
			title: "Command-Code 使用量",
			intro: "Harness 记录的 command 供应商 token 用量，以及本地反代服务的实时状态。",
			refresh: "刷新",
			loading: "加载中…",
			failed: "读取用量失败",
			today: "今日",
			total: "累计",
			calls: "调用次数",
			proxy: "代理状态",
			running: "运行中",
			down: "未运行",
			model: "模型",
			input: "输入",
			output: "输出",
			cache: "缓存读取",
			recent: "最近几天",
			date: "日期",
			empty: "该供应商还没有用量记录。",
			ledger: "账本",
			models: "按模型",
			pid: "进程号",
			uptime: "运行时长",
			baseUrl: "接口地址",
			noModels: "暂无模型记录。",
		};

		const num = (value) => Number(value || 0).toLocaleString("en-US");
		const compact = (value) => {
			const n = Number(value || 0);
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
			return String(n);
		};
		const duration = (ms) => {
			if (ms == null) return "—";
			const s = Math.max(0, Math.floor(ms / 1000));
			if (s < 60) return s + "s";
			const m = Math.floor(s / 60);
			if (m < 60) return m + "m " + (s % 60) + "s";
			const hrs = Math.floor(m / 60);
			return hrs + "h " + (m % 60) + "m";
		};

		const S = {
			root: { padding: "4px 0 32px", color: "inherit", fontSize: 13, lineHeight: 1.6 },
			head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
			title: { margin: 0, fontSize: 18, fontWeight: 600 },
			intro: { margin: "6px 0 0", opacity: 0.72, maxWidth: 720 },
			btn: {
				appearance: "none", border: "1px solid rgba(128,128,128,0.4)", background: "transparent",
				color: "inherit", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer",
			},
			cards: { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", margin: "18px 0" },
			card: { border: "1px solid rgba(128,128,128,0.28)", borderRadius: 8, padding: "10px 14px" },
			cardLabel: { fontSize: 12, opacity: 0.68, marginBottom: 4 },
			cardValue: { fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
			cardSub: { fontSize: 11, opacity: 0.6, marginTop: 2 },
			pill: {
				display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999,
				padding: "2px 10px", fontSize: 12, border: "1px solid rgba(128,128,128,0.35)",
			},
			dotOn: { width: 7, height: 7, borderRadius: "50%", background: "#2ea043" },
			dotOff: { width: 7, height: 7, borderRadius: "50%", background: "#da3633" },
			h2: { fontSize: 13, fontWeight: 600, margin: "20px 0 8px", opacity: 0.85 },
			table: { width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" },
			th: { textAlign: "right", fontSize: 11, fontWeight: 600, opacity: 0.66, padding: "6px 8px", borderBottom: "1px solid rgba(128,128,128,0.28)" },
			thLeft: { textAlign: "left", fontSize: 11, fontWeight: 600, opacity: 0.66, padding: "6px 8px", borderBottom: "1px solid rgba(128,128,128,0.28)" },
			td: { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid rgba(128,128,128,0.14)" },
			tdLeft: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(128,128,128,0.14)" },
			muted: { opacity: 0.62, fontSize: 12 },
			mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 11.5, opacity: 0.75 },
			err: { color: "#da3633", fontSize: 12, marginTop: 10 },
		};

		function Stat(props) {
			return h("div", { style: S.card },
				h("div", { style: S.cardLabel }, props.label),
				h("div", { style: S.cardValue }, props.value),
				props.sub ? h("div", { style: S.cardSub }, props.sub) : null,
			);
		}

		function UsageSection() {
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState("");
			const [busy, setBusy] = react.useState(true);
			const t = react.useCallback((key) => props_t(key), []);

			const load = react.useCallback(async () => {
				setBusy(true);
				try {
					const res = await fetch(USAGE_API, { headers: { accept: "application/json" }, cache: "no-store" });
					if (!res.ok) throw new Error("HTTP " + res.status);
					setData(await res.json());
					setError("");
				} catch (e) {
					setError(String((e && e.message) || e));
				} finally {
					setBusy(false);
				}
			}, []);

			react.useEffect(() => {
				load();
				const timer = setInterval(load, 30000);
				return () => clearInterval(timer);
			}, [load]);

			if (!data) {
				return h("div", { style: S.root },
					h("h1", { style: S.title }, t("title")),
					h("p", { style: S.intro }, t("intro")),
					h("p", { style: S.muted }, busy ? t("loading") : t("failed")),
					error ? h("p", { style: S.err }, error) : null,
				);
			}

			const proxy = data.proxy || {};
			const running = proxy.health === "ok";
			const total = data.total || {};
			const today = data.today || {};

			const head = h("div", { style: S.head },
				h("div", null,
					h("h1", { style: S.title }, t("title")),
					h("p", { style: S.intro }, t("intro")),
				),
				h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
					h("span", { style: S.pill },
						h("span", { style: running ? S.dotOn : S.dotOff }),
						t("proxy") + " " + (running ? t("running") : t("down")),
					),
					h("button", { style: S.btn, onClick: load, disabled: busy }, t("refresh")),
				),
			);

			const cards = h("div", { style: S.cards },
				h(Stat, {
					label: t("today"),
					value: compact((today.inputTokens || 0) + (today.outputTokens || 0)),
					sub: num(today.calls) + " " + t("calls"),
				}),
				h(Stat, {
					label: t("total"),
					value: compact((total.inputTokens || 0) + (total.outputTokens || 0)),
					sub: num(total.calls) + " " + t("calls"),
				}),
				h(Stat, { label: t("input"), value: compact(total.inputTokens) }),
				h(Stat, { label: t("output"), value: compact(total.outputTokens) }),
				h(Stat, { label: t("cache"), value: compact(total.cacheReadTokens) }),
			);

			const modelRows = (data.models || []).map((m) => h("tr", { key: m.model },
				h("td", { style: S.tdLeft }, m.model),
				h("td", { style: S.td }, num(m.calls)),
				h("td", { style: S.td }, num(m.inputTokens)),
				h("td", { style: S.td }, num(m.outputTokens)),
				h("td", { style: S.td }, num(m.cacheReadTokens)),
			));

			const models = h("div", null,
				h("h2", { style: S.h2 }, t("models")),
				modelRows.length === 0
					? h("p", { style: S.muted }, t("noModels"))
					: h("table", { style: S.table },
						h("thead", null, h("tr", null,
							h("th", { style: S.thLeft }, t("model")),
							h("th", { style: S.th }, t("calls")),
							h("th", { style: S.th }, t("input")),
							h("th", { style: S.th }, t("output")),
							h("th", { style: S.th }, t("cache")),
						)),
						h("tbody", null, modelRows),
					),
			);

			const recentRows = (data.recent || []).map((d) => h("tr", { key: d.date },
				h("td", { style: S.tdLeft }, d.date),
				h("td", { style: S.td }, num(d.calls)),
				h("td", { style: S.td }, num(d.inputTokens)),
				h("td", { style: S.td }, num(d.outputTokens)),
				h("td", { style: S.td }, num(d.cacheReadTokens)),
			));

			const recent = h("div", null,
				h("h2", { style: S.h2 }, t("recent")),
				recentRows.length === 0
					? h("p", { style: S.muted }, t("empty"))
					: h("table", { style: S.table },
						h("thead", null, h("tr", null,
							h("th", { style: S.thLeft }, t("date")),
							h("th", { style: S.th }, t("calls")),
							h("th", { style: S.th }, t("input")),
							h("th", { style: S.th }, t("output")),
							h("th", { style: S.th }, t("cache")),
						)),
						h("tbody", null, recentRows),
					),
			);

			const meta = h("div", { style: { marginTop: 18 } },
				h("div", { style: S.muted },
					t("baseUrl") + ": " + (proxy.baseUrl || "—") +
					" · " + t("pid") + ": " + (proxy.pid == null ? "—" : proxy.pid) +
					" · " + t("uptime") + ": " + duration(proxy.uptimeMs),
				),
				h("div", { style: S.mono }, t("ledger") + ": " + (data.ledgerFile || "—") +
					" · provider: " + (data.provider || "—") +
					(data.firstDay ? " · " + data.firstDay + " → " + (data.lastDay || data.firstDay) : ""),
				),
				data.ledgerError ? h("div", { style: S.err }, data.ledgerError) : null,
			);

			return h("div", { style: S.root }, head, cards, models, recent, meta);
		}

		/** Translation bound at mount time; kept module-local for the component. */
		let props_t = (key) => key;

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			props_t = (key) => t(key);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "commandcode-proxy: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "commandcode-usage",
				order: 40,
				label: () => t("nav"),
				locale: NS,
			}, UsageSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
