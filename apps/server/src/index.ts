import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerRoutes } from "./api.js";
import { listExperiments } from "./db.js";
import { runHeadless, snapshot, subscribe } from "./live.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });
await app.register(websocket);
await registerRoutes(app);

app.get("/ws/live", { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: "status", live: snapshot() }));
  const unsub = subscribe((payload) => {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      /* closed */
    }
  });
  socket.on("close", unsub);
});

await app.listen({ port, host });
if (!listExperiments().length) {
  console.log("Seeding a small baseline experiment so the dashboard is inspectable…");
  runHeadless({ name: "Seed baseline", mode: "baseline", hands: 40, seed: 42, accuracy: "fast" });
}
console.log(`Poker Lab API listening on http://${host}:${port}`);
console.log("Offline research mode — no real-money or client automation hooks.");
