import dgram, { Socket } from 'node:dgram';
import { Channel, ChannelInstance } from '@ipcom/asterisk-ari';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { once } from 'node:events';
import ariClient from './clients/asteriskClient.js';

export default class MediaSession {
  private sendSocket: Socket;
  private recvSocket: Socket;
  private recordSocket: Socket;
  private extensionSendPort: number;
  private channel: ChannelInstance;
  private ffmpegStream: ChildProcessWithoutNullStreams;
  private rtpSequenceNumber: number;
  private rtpTimestamp: number;
  private rtpSSRC: number;
  private firstPacketThisTalkspurt: boolean;
  public sendQueue: Buffer[] = [];
  private sendInterval: NodeJS.Timeout | null = null;

  /*
    Example of sending RTP packet back to Asterisk Phone
    this.sendSocket.send(
      buffer,
      0,
      buffer.length,
      this.extensionSendPort,
      '127.0.0.1',
      err => { if (err) console.error('send error:', err); }
    ); */

  constructor(channel: ChannelInstance) {
    this.channel = channel;
    this.sendSocket;
    this.recvSocket;
    this.recordSocket;
    this.extensionSendPort;
    this.ffmpegStream = spawn('ffmpeg', [
      '-f', 'mulaw',       // input format
      '-ar', '8000',       // input sample rate
      '-ac', '1',          // mono
      '-i', 'pipe:0',      // read raw from stdin
      '-af', 'volume=26dB', // ← boost by 12 dB
      '-y',                // overwrite output
      'record.wav'         // output file
    ]);
    this.rtpSequenceNumber = 0;
    this.rtpTimestamp = 0;
    this.rtpSSRC = Math.floor(Math.random() * 0xffffffff);
    this.firstPacketThisTalkspurt = true;
    this.sendQueue = [];
  }

  public async setup(): Promise<void> {
    // socket where Asterisk will send us audio
    this.recvSocket = dgram.createSocket('udp4');
    this.recvSocket.bind(0, '127.0.0.1');
    await once(this.recvSocket, 'listening');
    const portRecv = (this.recvSocket.address() as any).port;

    // socket from which we'll send media _to_ Asterisk
    this.sendSocket = dgram.createSocket('udp4');
    this.sendSocket.bind(0, '127.0.0.1');
    await once(this.sendSocket, 'listening');

    // Transmit ExternalMedia leg
    const extSend: Channel = await ariClient.channels.createExternalMedia({
      app: 'phone-app',
      external_host: `127.0.0.1:${portRecv}`,
      format: 'ulaw',
      direction: 'outbound'
    });

    // This is the RTP port that we need to send audio to
    this.extensionSendPort = extSend['channelvars']['UNICASTRTP_LOCAL_PORT'];

    // Initializes error and close handlers
    this.initializeSocketErrorHandlers();

    // Create bridge that combines the original call channel with the external media legs
    const bridge = await ariClient.bridges.createBridge({ type: 'mixing' });
    await ariClient.bridges.addChannels(bridge.id, { channel: [this.channel.id, extSend.id] });
  }

  private initializeSocketErrorHandlers(): void {
    // Listen for closing, and error events on the send socket
    this.recvSocket.on('close', () => {
      console.log('recvSocket closed');
      this.ffmpegStream.stdin.end();
    });

    this.sendSocket.on('close', () => {
      console.log('sendSocket closed');
    });

    this.sendSocket.on('error', (err: Error) => {
      console.error('Error on send socket:', err);
    });
    this.recvSocket.on('error', (err: Error) => {
      console.error('Error on recv socket:', err);
    })
  }

  public audioOutput(callback): void {
    // Listen to audio coming from the phone and send it to the callback
    this.recvSocket.on('message', (buffer: Buffer) => {
      const payload = this.stripRTPHeader(buffer);
      callback(payload);
    });

    // Handle closing the socket
    this.recvSocket.on('close', () => {
      console.log('recvSocket closed');
    });
  }

  public sendMedia(buffer: Buffer): void {
    // Chop into 160-byte frames
    for (let off = 0; off < buffer.length; off += 160) {
      this.sendQueue.push(buffer.subarray(off, off + 160));
    }
    // If we have enough to pre-buffer and the interval isn’t running, start it
    if (!this.sendInterval && this.sendQueue.length >= 3) {
      this.startSender();
    }
  }

  private startSender(): void {
    // Marker for the start of talkspurt
    this.firstPacketThisTalkspurt = true;

    this.sendInterval = setInterval(() => {
      const chunk = this.sendQueue.shift();
      if (!chunk) {
        // no more data—stop until we refill
        clearInterval(this.sendInterval!);
        this.sendInterval = null;
        return;
      }
      const packet = this._buildRtpPacket(chunk, this.firstPacketThisTalkspurt);
      this.firstPacketThisTalkspurt = false;

      // If the socket is closed, stop sending
      try {
        this.sendSocket.send(
          packet, 0, packet.length,
          this.extensionSendPort, '127.0.0.1',
          err => { if (err) console.error('send error', err); }
        );
      }
      catch (err) {
        console.error('Send Socket may be closed');
      }
    }, 20);
  }

  /**
   * Builds an RTP packet for one μ-law chunk.
   */
  private _buildRtpPacket(chunk: Buffer, mark: boolean): Buffer {
    const HEADER_LEN = 12;
    const rtpHeader = Buffer.alloc(HEADER_LEN);

    // V=2, P=0, X=0, CC=0
    rtpHeader[0] = 2 << 6;
    // M bit + PT=0 (PCMU)
    rtpHeader[1] = (mark ? 0x80 : 0) | 0;

    // Sequence number
    rtpHeader.writeUInt16BE(this.rtpSequenceNumber++, 2);
    this.rtpSequenceNumber &= 0xffff;

    // Timestamp: one sample per byte
    rtpHeader.writeUInt32BE(this.rtpTimestamp, 4);
    this.rtpTimestamp = (this.rtpTimestamp + chunk.length) >>> 0;

    // SSRC
    rtpHeader.writeUInt32BE(this.rtpSSRC, 8);

    return Buffer.concat([rtpHeader, chunk]);
  }

  // Plays an audio file into the call
  // Note, the audio file is an MP3 and needs to 
  public async sendFile(filePath: string): Promise<void> {
    // Spawn ffmpeg to read the MP3 and output μ-law RTP in real time
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-re',                  // read input at native rate
      '-i', filePath,         // your MP3
      '-af', 'volume=4dB',     // boost the audio
      '-acodec', 'pcm_mulaw', // G.711 μ-law
      '-ar', '8000',          // 8 kHz
      '-ac', '1',             // mono
      '-f', 'rtp',            // RTP output
      '-payload_type', '0',   // PT=0 for PCMU
      `rtp://127.0.0.1:${this.extensionSendPort}`
    ]);

    // Wait until the file has finished streaming
    await once(ffmpeg, 'close');
    console.log(`Finished streaming ${filePath} to port ${this.extensionSendPort}`);
  }

  public recordToFile(payload: Buffer): void {
    this.ffmpegStream.stdin.write(payload);
  }

  public stripRTPHeader(buffer: Buffer): Buffer {
    const csrcCount = buffer[0] & 0x0F;       // low 4 bits of first byte
    const headerLen = 12 + 4 * csrcCount;     // base header + CSRCs
    return buffer.subarray(headerLen);        // strip header
  }

  // Clean up
  public close(): void {
    try {
      this.sendQueue = [];
      this.sendSocket.close();
      this.recvSocket.close();
    }
    catch (err) {
      console.error('Sockets already closed');
    }
  }
}