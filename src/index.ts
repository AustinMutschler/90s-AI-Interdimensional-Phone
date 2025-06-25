import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { initializeCharacters } from "./CharacterService.js";
import { initDb } from "./db/databaseClient.js";
import phoneNetwork from "./PhoneNetwork.js";
import spotifyRoutes from './api/spotify/spotify.js';
import databaseRoutes from './api/database/routes.js';

const app: express.Application = express();

// This allows us to get the client IP using req.ip
app.set('trust proxy', true);

// parse body params and attach them to req.body
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const corsOptions = {
  origin: (origin, callback) => {
    return callback(null, true);
  },
  credentials: true,
};

app.use(cors(corsOptions));

console.log('<=== Starting Phone Application ===>');

let isShuttingDown = false;

async function initializeServices() {
  try {
    await initDb();
    await phoneNetwork.start();
    console.log('Phone Application started successfully.');

    // Initialize the Characters
    initializeCharacters();

  } catch (err) {
    console.error('Error starting Phone Application:', err);

    // Optional: Wait before retrying to avoid rapid restarts
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (!isShuttingDown) {
      console.log('Restarting Phone Application...');
      initializeServices();
    }
  }
}

initializeServices();

// API v1 Routes
app.use('/api', spotifyRoutes);

// Database route
app.use(databaseRoutes);

// listen to requests
app.listen(process.env.PORT, () => console.log(`Server started on port ${process.env.PORT} (${process.env.ENVIRONMENT})`));


process.on("SIGINT", async () => {
  isShuttingDown = true;
  console.log("Application Cleaned up and exiting.");
  if (phoneNetwork && typeof phoneNetwork.stop === "function") {
    await phoneNetwork.stop();
  }
  process.exit(0);
});
