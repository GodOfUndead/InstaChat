import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route for uploading and sharing
  app.post("/api/share", async (req, res) => {
    try {
      const { data } = req.body;
      const id = crypto.randomBytes(8).toString("hex");
      const uploadsDir = path.join(__dirname, "uploads");
      
      await fs.mkdir(uploadsDir, { recursive: true });
      await fs.writeFile(path.join(uploadsDir, `${id}.json`), JSON.stringify(data));
      
      res.json({ id });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to share archive" });
    }
  });

  app.get("/api/chat/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const filePath = path.join(__dirname, "uploads", `${id}.json`);
      const fileContent = await fs.readFile(filePath, "utf-8");
      res.json(JSON.parse(fileContent));
    } catch (error) {
       res.status(404).json({ error: "Archive not found" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
