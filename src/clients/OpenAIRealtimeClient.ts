import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface ClientOptions {
  model: string;
  instructions?: string;
  voice?: string;
  turnDetection?: 'none' | 'server_vad';
  inputTranscriptionModel?: string;
  projectId?: string;
  tools?: OpenAIFunctionDefinition[];
  inputAudioFormat?: string;
  outputAudioFormat?: string;
}

export interface OpenAIFunctionEvent {
  name: string;
  arguments: Record<string, any>;
  callId: string;
}

export interface OpenAIFunctionCallEvent {
  type: string;
  event_id: string;
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  name: string;
  arguments: string;
}

export interface OpenAIFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;  // JSON Schema
}


export interface TranscriptEvent {
  transcript: string;
  isFinal: boolean;
}

export class OpenAIRealtimeClient extends EventEmitter {
  public ws!: WebSocket;
  private sessionConfig: ClientOptions;
  private apiKey: string;
  private project?: string;
  public lastAudioSentAt: Date;

  constructor(apiKey: string, opts: ClientOptions) {
    super();
    this.apiKey = apiKey;
    this.project = opts.projectId ?? process.env.OPENAI_PROJECT_ID;
    this.sessionConfig = {
      //model: opts.model ?? 'gpt-4o-realtime-preview-2024-12-17',
      model: opts.model ?? 'gpt-4o-mini-realtime-preview',
      instructions: opts.instructions ?? '',
      voice: opts.voice ?? 'alloy',
      turnDetection: opts.turnDetection ?? 'server_vad',
      inputTranscriptionModel: opts.inputTranscriptionModel ?? 'whisper-1',
      tools: opts.tools ?? [],
      inputAudioFormat: 'g711_ulaw',
      outputAudioFormat: 'g711_ulaw',
    };
    this.lastAudioSentAt;

    // Connect to the OpenAI Realtime API
    this.connect().catch((err) => {
      console.error('[OPENAI-AUDIO] Error connecting to OpenAI Realtime:', err);
      this.emit('error', err);
    });
  }

  async connect(): Promise<void> {
    try {
      const url = `wss://api.openai.com/v1/realtime?model=${this.sessionConfig.model}`;
      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
          ...(this.project ? { 'OpenAI-Project': this.project } : {})
        }
      });

      this.ws.on('open', () => {
        console.log('[OPENAI-AUDIO] Connected to OpenAI Realtime');
        this.emit('open');
        // configure the session
        const update: any = {
          type: 'session.update',
          session: {
            turn_detection: { type: this.sessionConfig.turnDetection, threshold: 0.8, },
            input_audio_transcription: {
              model: this.sessionConfig.inputTranscriptionModel
            },
            input_audio_format: this.sessionConfig.inputAudioFormat,
            output_audio_format: this.sessionConfig.outputAudioFormat,
            tools: this.sessionConfig.tools,
            tool_choice: 'auto',
          }
        };
        if (this.sessionConfig.instructions) {
          update.session.instructions = this.sessionConfig.instructions;
        }
        if (this.sessionConfig.voice) {
          update.session.voice = this.sessionConfig.voice;
        }

        // If functions are provided, add them to the session
        if (this.sessionConfig.tools) {
          update.session.tools = this.sessionConfig.tools.map(f => ({
            type: 'function',
            name: f.name,
            description: f.description,
            parameters: f.parameters
          }));
          update.session.tool_choice = 'auto';
        }
        this.ws.send(JSON.stringify(update));  // :contentReference[oaicite:0]{index=0}
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        let msg: any;
        try {
          msg = JSON.parse(data.toString());
        } catch (e) {
          this.emit('error', e);
          return;
        }
        switch (msg.type) {
          case 'session.created':
            this.emit('session_created', msg.session);
            break;
          case 'input_audio_buffer.committed':
            // user audio committed, conversation item created next
            break;
          case 'conversation.item.created':
            break;
          case 'conversation.item.input_audio_transcription.delta':
            console.log('[OPENAI-AUDIO] transcription delta:', msg.delta);
            this.emit('transcript', { transcript: msg.delta.text, isFinal: false });
            break;
          case 'conversation.item.input_audio_transcription.completed':
            console.log('[OPENAI-AUDIO] transcription completed:', msg);
            this.emit('transcript', { transcript: msg.transcription, isFinal: true });
            break;
          case 'response.audio.delta':
            // streamed audio chunk
            const buf = Buffer.from(msg.delta, 'base64');
            this.lastAudioSentAt = new Date();
            this.emit('audio', buf);
            break;

          case 'response.output_item.done':
            const item = msg.item;
            if (item.type === 'function_call') {
              const args = JSON.parse(item.arguments);
              this.emit('function_call', {
                name: item.name,
                arguments: args,
                callId: item.call_id
              });
            }
            break;
          case 'input_audio_buffer.speech_started':
            this.emit('character_cutoff');
            break;
          case 'response.done':
            this.emit('done');
            break;
          case 'response.function_call_arguments.done':
            this.emit('tool_call', msg);
            break;
          case 'error':
            console.error('[OPENAI-AUDIO] Error from OpenAI:', msg.error?.message);
            this.emit('error', msg.error?.message);
            break;
          case 'session.updated':
            this.emit('ready', msg.session);
            break;
          default:
            console.warn('[OPENAI-AUDIO] Unknown message type:', msg.type);
            break;
        }
      });

      this.ws.on('error', (err) => this.emit('error', err));
    } catch (err) {
      console.error('[OPENAI-AUDIO] Error connecting to OpenAI Realtime:', err);
      this.emit('error', err);
    }
  }

  // Gets PCM audio
  public sendAudio(frame: Buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const b64 = frame.toString('base64');
      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: b64
      }));
      //console.log('[OPENAI-AUDIO] Sent audio frame of', frame.length, 'bytes');

    } catch (e) {
      console.log('[OPENAI-AUDIO] Error sending audio to OpenAI:', e);
    }
  }

  /** Commit whatever's in the buffer as the user's message. */
  public commitUserAudio() {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));

    } catch (e) {
      console.log('[OPENAI-AUDIO] Error committing user audio:', e);
    }
  }

  /** Tell the model to start generating a response. */
  public initiateAiAnswer(modalities: ('text' | 'audio')[] = ['audio', 'text']) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities,
        instructions: this.sessionConfig.instructions,
      }
    }));
  }

  public sendMessageFunctionCallResponse(
    toolCall: OpenAIFunctionCallEvent,
    result: any,
  ) {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      // 1. Relay the function result
      this.ws.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          // OpenAI expects a JSON‐stringified value here
          output: JSON.stringify(result),
        }
      }));

      // 2. Tell the API “OK, send me the next response”
      this.ws.send(JSON.stringify({
        type: 'response.create'
      }));
    } catch (e) {
      console.log('[OPENAI-AUDIO] Error sending function call response:', e);
      this.emit('error', e);
    }
  }

  /** Gracefully tear down the connection. */
  close() {
    console.log('[OPENAI-AUDIO] Closing OpenAI Realtime connection');
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.ws.close();
    } catch (e) {
      console.log('[OPENAI-AUDIO] Error closing OpenAI Realtime connection.');
    }
  }
}
