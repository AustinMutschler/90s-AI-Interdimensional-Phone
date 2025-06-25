// PhoneNetwork.ts
import * as dgram from 'node:dgram';
import { Channel, ChannelEvent, ChannelInstance } from '@ipcom/asterisk-ari';
import ariClient from './clients/asteriskClient.js';
import MediaSession from './MediaSession.js';

/**
 * PhoneNetwork manages incoming/outgoing SIP calls via ARI,
 * routing by phone number or originate intents to AI handlers,
 * and sets up separate send/receive RTP sockets for media.
 */
class PhoneNetwork {
  // Handlers for inbound numbers, keyed by dialed number
  private inboundHandlers = new Map<
    string,
    (event: ChannelEvent, mediaSessoion: MediaSession) => Promise<void>
  >();

  // Handlers for outbound calls, keyed by channelId
  private outboundHandlers = new Map<
    string,
    (event: ChannelEvent, mediaSessoion: MediaSession) => Promise<void>
  >();

  // Store paired RTP sockets per channel
  private rtpSockets = new Map<
    string,
    { send: dgram.Socket; recv: dgram.Socket }
  >();
  public started: boolean = false;

  /** ARI StasisStart event handler */
  private handleStasisStart = async (event: ChannelEvent): Promise<void> => {
    if (event.type !== 'StasisStart') return;
    console.log(`StasisStart event for channel ${event.channel.id}`);
    const mode = event.args[0] || '';
    if (mode === 'outgoing') {
      await this.handleOutgoing(event);
    } else if (event.channel.name.includes('UnicastRTP') || event.channel.name.includes('Snoop')) {
      return; // Ignore RTP-only channels. These are for listening only.
    } else {
      await this.handleInbound(event);
    }
  };

  /** Initialize ARI listeners */
  public async start(): Promise<void> {
    await this.cleanupOldItems();
    await ariClient.connectWebSocket(['phone-app']);
    ariClient.on('StasisStart', this.handleStasisStart);
    this.started = true;
  }

  /** Cleanup old bridges and channels */
  private async cleanupOldItems(): Promise<void> {
    // Destroy all bridges
    const allBridges = await ariClient.bridges.list();
    if (allBridges.length > 0) {
      await Promise.all(allBridges.map(bridge => ariClient.bridges.destroy(bridge.id)));
    }
    // Destroy all channels
    const allChannels = await ariClient.channels.list();
    if (allChannels.length > 0) {
      await Promise.all(allChannels.map(channel => ariClient.channels.hangup(channel.id)));
    }
  }


  /** Tear down ARI listeners and sockets */
  public async stop(): Promise<void> {
    ariClient.off('StasisStart', this.handleStasisStart);
    for (const { send, recv } of this.rtpSockets.values()) {
      send.close();
      recv.close();
    }
    // Destroy all bridges
    const allBridges = await ariClient.bridges.list();
    if (allBridges.length > 0) {
      await Promise.all(allBridges.map(bridge => ariClient.bridges.destroy(bridge.id)));
    }

    // Close the WebSocket connection
    await ariClient.closeWebSocket();
    this.started = false;
  }

  /** Handle an inbound call event */
  private async handleInbound(event: ChannelEvent): Promise<void> {
    if (event.type !== 'StasisStart') return;
    const dialed = event.channel?.dialplan?.exten || '';
    const handler = this.inboundHandlers.get(dialed);
    if (!handler) {
      console.warn(`No handler for inbound number ${dialed}`);
      // TODO: Play an asterisk message to the caller like, "Sorry, this number is not in service."
      const playback = await event.instanceChannel.play({ media: 'sound:ss-noservice' });
      // Wait for PlaybackFinished event for this playback
      await new Promise((resolve) => {
        const onPlaybackFinished = (playbackEvent) => {
          if (playbackEvent.playback.id === playback.id) {
            ariClient.off('PlaybackFinished', onPlaybackFinished);
            resolve(true);
          }
        };
        ariClient.on('PlaybackFinished', onPlaybackFinished);
      });
      try {
        await event.instanceChannel.hangup();
      }
      catch (error) {
        console.error('Caller likely hung up before we could hangup the call');
      }

      return;
    }

    const mediaSession = await this.setupExternalMedia(event.instanceChannel);
    await handler(event, mediaSession);
  }

  /** Handle an answered outbound call */
  private async handleOutgoing(event: ChannelEvent): Promise<void> {
    const handler = this.outboundHandlers.get(event.channel.id);
    if (!handler) {
      console.warn(`No outbound handler for channel ${event.channel.id}`);
      await event.instanceChannel.hangup();
      return;
    }
    const mediaSession = await this.setupExternalMedia(event.instanceChannel);
    // Remove handler from map
    this.outboundHandlers.delete(event.channel.id);
    await handler(event, mediaSession);
  }

  /** Check if a line is busy */
  public async isLineBusy(
    number: string = process.env.DEFAULT_OUTGOING_NUMBER
  ): Promise<boolean> {
    const channels = await ariClient.channels.list();
    return channels.some(
      c => c.state === 'Up' && c.name.startsWith(`PJSIP/${number}`)
    );
  }

  /** Initiate an outbound call to `number`. Handler invoked when answered. */
  public async makeCall(
    number: string = process.env.DEFAULT_OUTGOING_NUMBER,
    handler: (
      event: ChannelEvent,
      mediaSession: MediaSession
    ) => Promise<void>
  ): Promise<boolean> {
    console.log(`Originating call to ${number}`);
    // Create a local channel and then originate to the external phone number
    const localChannel = await ariClient.Channel()

    const channel: Channel = await localChannel.originate({
      endpoint: `PJSIP/${number}`,
      app: 'phone-app',
      context: 'ari-outbound',
      appArgs: 'outgoing',
      timeout: 20000,
      variables: {
        SKIP_STASIS: 'true'
      },
    });

    // Store handler by channel.id
    this.outboundHandlers.set(channel.id, handler);
    // Outgoing StasisStart will fire and call handleOutgoing

    // If the outboundHandler still exists after 70 seconds, remove it and throw a no answer error. Do not return until the call is answered.
    // Need a promise so that the function does not return until the call is answered
    const callWasAnswered: Promise<boolean> = new Promise((resolve) => {
      setTimeout(async () => {
        if (this.outboundHandlers.has(channel.id)) {
          this.outboundHandlers.delete(channel.id);
          return resolve(false);
        }
        return resolve(true);
      }, 70000);
    });

    return await callWasAnswered;
  }

  // Register an inbound handler for a specific dialed number
  public registerHandlerByNumber(
    number: string,
    handler: (event: ChannelEvent, mediaSession: MediaSession) => Promise<void>
  ) {
    this.inboundHandlers.set(number, handler);
  }

  /** Unregister an inbound handler */
  public unregisterHandlerByNumber(number: string) {
    this.inboundHandlers.delete(number);
  }

  private async setupExternalMedia(
    channel: ChannelInstance
  ): Promise<MediaSession> {
    const mediaSession = new MediaSession(channel);
    await mediaSession.setup();
    return mediaSession;
  }
}

const phoneNetwork: PhoneNetwork = new PhoneNetwork();
export default phoneNetwork;
