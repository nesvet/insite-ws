import path from "node:path";
import { Conveyer, ESBuild } from "@nesvet/conveyer/stages";
import { Packages } from "@nesvet/conveyer/Packages";


const { NODE_ENV } = process.env;

const distDir = "dist";

const common = {
	external: new Packages().external().asNames(),
	format: "esm",
	sourcemap: true,
	define: {
		"process.env.NODE_ENV": JSON.stringify(NODE_ENV)
	}
};


new Conveyer([
	
	new ESBuild({
		title: "Server",
		entryPoints: [ "src/server/index.js" ],
		outfile: path.resolve(distDir, "server.js"),
		platform: "node",
		target: "node20",
		...common
	}),
	
	new ESBuild({
		title: "Client",
		entryPoints: [ "src/client/index.js" ],
		outfile: path.resolve(distDir, "client.js"),
		platform: "neutral",
		target: "es2020",
		...common
	})
	
], {
	initialCleanup: distDir,
	bumpVersions: { ignored: [ path.resolve(distDir, "**") ] }
});
