import { ChannelEvent } from "@ipcom/asterisk-ari";
import phoneNetwork from "../PhoneNetwork.js";
import MediaSession from "../MediaSession.js";
import { OpenAIFunctionCallEvent, OpenAIFunctionDefinition, OpenAIRealtimeClient } from "../clients/OpenAIRealtimeClient.js";
import { OutboundCallSchedule } from "./characterTypes.d.js";
import { getCountOfScheduleByCharacterName, getScheduleByCharacter, isConditionMet, markCompleted, uploadCharacterSchedule } from "../db/databaseClient.js";
import { addSongToQueueByTitle } from "../api/spotify/service.js";

class Character {
  private characterName: string;
  // The prompt for the character if someone calls the phone number
  private inboundPrompt: string;
  private phoneNumber: string;
  private outboundCallSchedule: OutboundCallSchedule[];
  private voice: string;
  private lastCallEnded: Date | null;
  private characterCallInProgress: boolean;
  private tools: OpenAIFunctionDefinition[];
  private hangupInProgress: boolean;

  constructor(characterName: string, inboundPrompt: string, voice: string = 'alloy', phoneNumber: string = undefined, outboundCallSchedule: OutboundCallSchedule[] = [], tools: OpenAIFunctionDefinition[] = []) {
    this.characterName = characterName;
    this.inboundPrompt = inboundPrompt;
    this.voice = voice;
    this.phoneNumber = phoneNumber;
    this.outboundCallSchedule = outboundCallSchedule;
    this.lastCallEnded = null;
    this.characterCallInProgress = false;
    this.hangupInProgress = false;
    // All characters have a default tool to hang up the phone
    this.tools = [
      {
        "name": "hangup",
        "description": "Hangs up the phone.",
        "parameters": {}
      }
      , ...tools
    ]

    // Register the handler for the phone number if it exists
    if (this.phoneNumber) {
      phoneNetwork.registerHandlerByNumber(phoneNumber, this.handleCall);
    }

    // If there is an outbound call schedule, start the scheduler
    if (this.outboundCallSchedule.length > 0) {
      this.startCallScheduler();
    }
  }

  private startCallScheduler = async (): Promise<void> => {
    console.log(`[Character ${this.characterName}] Starting call scheduler`);
    // Sort outboundCallSchedule by start_date_time
    // We will load the outboundCallSchedule from the database and then start the scheduler.
    // If there are no records yet, we will upload the local schedule to the database
    // Check if there are any schedules in the database by the character name
    if (await getCountOfScheduleByCharacterName(this.characterName) === 0) {
      console.log(`[Character ${this.characterName}] No schedules found in the database, uploading local schedule`);
      this.outboundCallSchedule.sort((a, b) => a.start_date_time.getTime() - b.start_date_time.getTime());
      // We will upload the local schedule to the database
      await uploadCharacterSchedule(this.outboundCallSchedule);
    }

    // Get only the not completed schedules from the database
    console.log(`[Character ${this.characterName}] Loading schedules from the database`);
    this.outboundCallSchedule = await getScheduleByCharacter(this.characterName, false);
    this.outboundCallSchedule.sort((a, b) => a.start_date_time.getTime() - b.start_date_time.getTime());


    while (this.outboundCallSchedule.length > 0) {
      try {
        const nextCall = this.outboundCallSchedule[0];
        const now = Date.now();
        // Wait until the scheduled time
        // The start_date_time is in America/Phoenix timezone, we need to convert it to UTC
        if (now < nextCall.start_date_time.getTime()) {
          await this.delay(nextCall.start_date_time.getTime() - now);
        }

        // 2) Enforce 5-minute gap since last call
        if (this.lastCallEnded) {
          const msSinceLast = Date.now() - this.lastCallEnded.getTime();
          const minGap = 5 * 60 * 1000;
          if (msSinceLast < minGap) {
            await this.delay(minGap - msSinceLast);
          }
        }

        // 3) If line is busy or a call already in progress, retry in 5 min
        if (this.characterCallInProgress || await phoneNetwork.isLineBusy()) {
          console.log(`[CHARACTER: ${this.characterName}] Line busy, retrying in 5 min`);
          await this.delay(5 * 60 * 1000);
          continue;
        }

        // 4) If there is a condition and it is not met, retry in 5 min
        if (nextCall.condition_id) {
          const conditionMet = await isConditionMet(nextCall.condition_id);
          if (!conditionMet) {
            console.log(`[CHARACTER: ${this.characterName}] Condition not met, retrying in 5 min`);
            await this.delay(5 * 60 * 1000);
            continue;
          }
        }

        // Make the call
        console.log(`[Character ${this.characterName}] Making scheduled call`);

        const callAnswered = await phoneNetwork.makeCall('1000', (event: ChannelEvent, mediaSession: MediaSession) => this.handleCall(event, mediaSession, nextCall));

        // If the call was not answered, retry in 1 minute
        if (!callAnswered) {
          console.log(`[Character ${this.characterName}] Call not answered, retrying in 1 min`);
          await this.delay(1 * 60 * 1000);
          continue;
        }

        console.log(`[Character ${this.characterName}] Moving to the next call in schedule`);
        this.outboundCallSchedule.shift();

      } catch (error) {
        console.error(`[Character ${this.characterName}] Error making scheduled call:`, error);
        // on error, retry this same item in 1 min
        await this.delay(1 * 60 * 1000);
        continue;
      }
    }
    console.log(`[Character ${this.characterName}] All scheduled calls completed`);
  }

  // This handles the inbound call. It sets up a connection to the AI service and listens for the caller to speak
  private handleCall = async (event: ChannelEvent, mediaSession: MediaSession, outboundConfig?: OutboundCallSchedule): Promise<void> => {
    try {
      if (event.type !== "StasisStart") return;
      console.log(`Inbound call from ${event.channel.caller.number} to ${this.characterName} (${this.phoneNumber})`);
      this.characterCallInProgress = true;
      this.hangupInProgress = false;
      const prompt = outboundConfig?.prompt;

      // Waits a random number of milliseconds before answering the call
      try {
        // If this is an inbound call, we wait to answer the phone to simulate a real phone call
        if (!outboundConfig) {
          await this.waitToAnswer(event);
        }
      } catch (error) {
        console.error(`[Character Error ${this.characterName}] Call may have ended before answering`);
        return;
      }

      // OpenAI Realtime Client
      const openai = new OpenAIRealtimeClient(
        process.env.OPENAI_API_KEY!,
        {
          model: 'gpt-4o-realtime-preview-2025-06-03',
          instructions: prompt ? prompt.trim() : this.inboundPrompt.trim(),
          voice: this.voice,
          tools: this.tools
        },
      );

      // Waits for openai web socket to be ready
      openai.on('ready', () => {
        // If no outboundConfig is passed in, it means someone is calling this character, we want the character to talk first
        if (!outboundConfig) {
          console.log(`[Character ${this.characterName}] Sending initial message to OpenAI`);
          openai.initiateAiAnswer();
        }

        // Sends audio from OpenAI to the call
        // We setup openai to send audio back in ulaw format
        openai.on('audio', (ulawBuffer: Buffer) => {
          console.log(`[Character ${this.characterName}] Sending audio to call`);
          mediaSession.sendMedia(ulawBuffer);
        });

        // Send the call audio to OpenAI
        mediaSession.audioOutput(async (ulawBuffer: Buffer) => {
          //mediaSession.recordToFile(ulawBuffer);
          openai.sendAudio(ulawBuffer);
        });

        // Listen for user to cut off the character
        openai.on('character_cutoff', async () => {
          // Clear the media session send queue
          console.log(`[Character ${this.characterName}] User cut off character`);
          // If the hangup function has been called, we need to wait for the audio to finish
          if (this.hangupInProgress) {
            return;
          }
          mediaSession.sendQueue = [];
        });

        // Listen to openai tool calls
        openai.on('tool_call', async (toolCall: OpenAIFunctionCallEvent) => {
          console.log(`[Character ${this.characterName}] Tool call received:`, toolCall);
          // Hangup tool
          if (toolCall.name === 'hangup') {
            try {
              this.hangupInProgress = true;
              // The character might send the hangup before they are done talking, we need to wait for the audio to finish
              while (mediaSession.sendQueue.length > 0) {
                await this.delay(250);
              }
              this.hangupInProgress = false;
              await event.instanceChannel.hangup();
            } catch (error) {
              console.error(`[Character ${this.characterName}] Error hanging up call.`);
              this.hangupInProgress = false;
            }

          } else if (toolCall.name === 'play_song_by_title') {
            try {
              // Get the song name from the tool call arguments
              const toolArgs = JSON.parse(toolCall.arguments);
              const success = await addSongToQueueByTitle(toolArgs?.song_name);
              await openai.sendMessageFunctionCallResponse(toolCall, success);
            } catch (error) {
              await openai.sendMessageFunctionCallResponse(toolCall, false);
            }
          }
        });
      });

      // Cleanup when the call hangs up
      event.instanceChannel.on('StasisEnd', async () => {
        try {
          console.log(`[Character ${this.characterName}] Call ended. Cleaning up.`);
          mediaSession.close();
          openai.close();
          this.characterCallInProgress = false;
          this.lastCallEnded = new Date();
          this.hangupInProgress = false;
          if (outboundConfig) {
            // Set scheuled call as completed in DB
            await markCompleted(outboundConfig.id);
          }
          console.log(`${event.channel.id} cleaned up`);
        } catch (error) {
          console.error(`[Character ${this.characterName}] Error cleaning up call:`, error);
        }
      });
    }
    catch (error) {
      console.error(`[Character ${this.characterName}] Error handling call:`, error);
      this.characterCallInProgress = false;
      this.hangupInProgress = false;
      this.lastCallEnded = new Date();
    }
  }

  private waitToAnswer = async (event: ChannelEvent): Promise<void> => {
    // Get a random number between 3000 and 5000, this is the wait time before answering the call
    // This is 4-10 seconds
    const randomNumber = Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
    // Wait for the random number of milliseconds before answering the call
    await new Promise((resolve) => setTimeout(resolve, randomNumber));

    // Answer the call
    await event.instanceChannel.answer();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}

export default Character;