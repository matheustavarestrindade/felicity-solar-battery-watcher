import { FelicitySolarAPI } from "./FelicitySolarAPI";
import { FelicityWorker } from "./FelicityWorker";
import http from "node:http";
import { loadEnvFile } from "node:process";

try {
    loadEnvFile(".env");
} catch (e) {
    console.warn("No .env file found, proceeding with existing environment variables.");
}

let worker: FelicityWorker;

async function init() {
    const api = new FelicitySolarAPI(process.env.FELICITY_USERNAME!, process.env.FELICITY_PASSWORD!);
    await api.initialize();
    worker = new FelicityWorker(api, 30_000);
}

const server = http.createServer(async (req, res) => {
    if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
    }
    if (!worker) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Service Unavailable");
        return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(worker.getDevicesData()));
});

server.listen(3000, async () => {
    await init();
    console.log("Server running at http://localhost:3000/");
});
