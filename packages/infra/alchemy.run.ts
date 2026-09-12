import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { config } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

export const db = Cloudflare.D1.Database("database", {
	migrations: "../../packages/db/src/migrations",
});

// Production klikapa database (revklik analytics worker) — adopted by name so
// the server worker can bind it. RETAINED: alchemy never calls delete on it,
// so a stack destroy, orphaning, or replacement can never delete production
// again (incident 2026-09-06: DEV-16).
export const klikapaDb = Cloudflare.D1.Database("klikapa-db", {
	name: "klikapa-db",
}).pipe(Alchemy.RemovalPolicy.retain());

export const server = Cloudflare.Worker("server", {
	compatibility: {
		flags: ["nodejs_compat"],
	},
	dev: {
		port: 3000,
	},
	env: {
		BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
		BETTER_AUTH_URL: Cloudflare.Worker.URL,
		CORS_ORIGIN: Config.string("CORS_ORIGIN"),
		DB: db,
		POLAR_ACCESS_TOKEN: Config.redacted("POLAR_ACCESS_TOKEN"),
		POLAR_SUCCESS_URL: Config.string("POLAR_SUCCESS_URL"),
		KLIKAPA_DB: klikapaDb,
	},
	main: "../../apps/server/src/index.ts",
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
	"revklik-new",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const serverWorker = yield* server;
		const webWorker = yield* Cloudflare.Website.Vite("web", {
			assets: {
				htmlHandling: "auto-trailing-slash",
				notFoundHandling: "single-page-application",
			},
			dev: {
				port: 3001,
			},
			env: {
				VITE_SERVER_URL: serverWorker.url.as<string>(),
			},
			rootDir: "../../apps/web",
		});

		return {
			server: serverWorker.url,
			web: webWorker.url,
		};
	}),
);
