import spotifyClient from "../../clients/spotifyClient.js";

export const addSongToQueueByTitle = async (songTitle: string): Promise<boolean> => {
  try {
    console.log('[SPOTIFY] Attempting to add song to queue:', songTitle);
    // TODO: Update this to accept artists name as well
    const searchResponse = await spotifyClient.get('/search', {
      params: {
        q: `track:${songTitle}`,
        type: 'track',
        limit: 1
      }
    });

    const track = searchResponse.data.tracks.items[0];

    if (!track) {
      console.log('[SPOTIFY] No track found for:', songTitle);
      return false;
    }

    // Add song to personal queue
    await spotifyClient.post('/me/player/queue', null, {
      params: {
        uri: track.uri
      }
    });
    console.log('[SPOTIFY] Song added to queue:', track.name);
  } catch (error) {
    return false;
  }
  return true;
}