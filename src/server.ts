import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT) || 3000;

// 0.0.0.0 so phones on the same Wi-Fi can open the QR-code links.
createApp().listen(port, "0.0.0.0", () => {
  console.log(`AeDispatch running on http://localhost:${port}`);
});
