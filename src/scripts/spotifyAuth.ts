import axios from "axios";
import dotenv from "dotenv";
import readline from "node:readline";

dotenv.config();

const {
  SPOTIFY_CLIENT_ID: client_id,
  SPOTIFY_CLIENT_SECRET: client_secret,
  SOPTIFY_REDIRECT_URI: redirect_uri,
} = process.env;

if (!client_id || !client_secret || !redirect_uri) {
  throw new Error("Missing SPOTIFY_CLIENT_ID/SECRET or REDIRECT_URI in .env");
}

const scopes = [
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

const authUrl =
  "https://accounts.spotify.com/authorize" +
  `?client_id=${encodeURIComponent(client_id)}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
  `&scope=${encodeURIComponent(scopes)}`;

console.log("1) Open this URL in your browser:\n\n", authUrl, "\n");
console.log(
  "2) After approving you'll be redirected to:\n" +
  `${redirect_uri}?code=YOUR_CODE\n` +
  "(it'll 404, but copy the “code” query-param)\n"
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the "code" from the URL: ', async (code) => {
  rl.close();
  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code.trim());
    params.append("redirect_uri", redirect_uri);
    params.append("client_id", client_id);
    params.append("client_secret", client_secret);

    const resp = await axios.post(
      "https://accounts.spotify.com/api/token",
      params.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = resp.data;
    console.log("\n✔ Success! Add this to your .env:\n");
    console.log("REFRESH_TOKEN=" + refresh_token);
    console.log("OPTIONAL_ACCESS_TOKEN=" + access_token);
    console.log("EXPIRES_IN=" + expires_in + "  # seconds\n");
    process.exit(0);
  } catch (e: any) {
    console.error("Failed to get tokens:", e.response?.data || e.message);
    process.exit(1);
  }
});
