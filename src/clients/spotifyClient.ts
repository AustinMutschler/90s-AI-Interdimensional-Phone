// src/spotifyClient.ts
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
} from "axios";

const client_id = process.env.SPOTIFY_CLIENT_ID!;
const client_secret = process.env.SPOTIFY_CLIENT_SECRET!;
const refresh_token = process.env.REFRESH_TOKEN!;

if (!client_id || !client_secret || !refresh_token) {
  throw new Error(
    "Missing one of SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET or REFRESH_TOKEN in .env"
  );
}

// In‐memory token + expiry
let accessToken = "";
let expiresAt = 0; // ms since epoch

/**
 * Refreshes the Spotify access token using the refresh token.
 */
async function refreshAccessToken(): Promise<void> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id,
    client_secret,
  });

  const resp = await axios.post(
    "https://accounts.spotify.com/api/token",
    params.toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  const data = resp.data as {
    access_token: string;
    expires_in: number;
  };

  accessToken = data.access_token;
  // set expiry slightly before actual expiry to avoid edge races
  expiresAt = Date.now() + data.expires_in * 1000;
  console.log(
    "Refreshed access token; expires in",
    data.expires_in,
    "seconds"
  );
}

// Create an Axios instance for all /v1 calls
const spotifyClient: AxiosInstance = axios.create({
  baseURL: "https://api.spotify.com/v1",
});

// REQUEST interceptor: ensure we have a valid token before each request
spotifyClient.interceptors.request.use(async (config) => {
  if (!accessToken || Date.now() >= expiresAt - 60_000) {
    await refreshAccessToken();
  }
  config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// RESPONSE interceptor: retry once on expired‐token 401
spotifyClient.interceptors.response.use(
  (res) => res,
  async (error: AxiosError & { config?: AxiosRequestConfig & { _retry?: boolean } }) => {
    const cfg = error.config;
    console.log('[SPOTIFY] Error:', error.response?.status, error);
    if (
      cfg &&
      !cfg._retry &&
      error.response?.status === 401
    ) {
      cfg._retry = true;
      await refreshAccessToken();
      cfg.headers.Authorization = `Bearer ${accessToken}`;
      return spotifyClient(cfg);
    }
    return Promise.reject(error);
  }
);

export default spotifyClient;
