import express from 'express';
import axios from "axios";
import { addSongToQueueByTitle } from './service.js';

const router = express.Router();

const {
  SPOTIFY_CLIENT_ID: client_id,
  SPOTIFY_CLIENT_SECRET: client_secret,
  SOPTIFY_REDIRECT_URI: redirect_uri,
} = process.env;

// Auth endpoint
router.get('/spotify/auth', (req, res) => {

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
  return res.status(200).json({
    message: "Authorization URL generated. Check console for details.",
    authUrl
  });
});

// Token endpoint
router.post('/spotify/token', async (req, res) => {
  const { code } = req.body;
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
    return res.status(200).json({
      refresh_token,
      access_token,
      expires_in
    });
  } catch (e: any) {
    console.error("Failed to get tokens:", e.response?.data || e.message);
  }

});

router.get('/spotify/song/play', async (req, res) => {
  try {
    // Pull the songTitle from the url query
    const { songTitle } = req.query;

    if (!songTitle) {
      return res.status(400).json({ error: "Song title is required" });
    }

    const songAdded = await addSongToQueueByTitle(songTitle);

    return res.status(200).json({ songAdded });
  } catch (error) {
    console.error("Error playing song:", error);
    return res.status(500).json({ error: "Failed to play song" });
  }
})

export default router;