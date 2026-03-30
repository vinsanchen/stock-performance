import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3010;

  // API routes
  app.get("/api/stock-prices", async (req, res) => {
    try {
      // Fetch both TSE and OTC data in parallel
      const [tseRes, otcRes] = await Promise.all([
        fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'),
        fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes')
      ]);

      const tseData = tseRes.ok ? await tseRes.json() : [];
      const otcData = otcRes.ok ? await otcRes.json() : [];

      // Normalize TSE data: { Code, Name, ClosingPrice }
      const normalizedTse = Array.isArray(tseData) ? tseData.map((item: any) => ({
        Code: item.Code,
        Name: item.Name,
        Price: parseFloat(item.ClosingPrice) || 0
      })) : [];

      // Normalize OTC data: { SecuritiesCompanyCode, CompanyName, Close }
      const normalizedOtc = Array.isArray(otcData) ? otcData.map((item: any) => ({
        Code: item.SecuritiesCompanyCode,
        Name: item.CompanyName,
        Price: parseFloat(item.Close) || 0
      })) : [];

      res.json([...normalizedTse, ...normalizedOtc]);
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(500).json({ error: 'Failed to fetch stock prices' });
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
