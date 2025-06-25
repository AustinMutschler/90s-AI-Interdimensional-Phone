import { ChannelEvent } from "@ipcom/asterisk-ari"
import phoneNetwork from "../PhoneNetwork.js";
import MediaSession from "../MediaSession.js";
import { markConditionCompleted } from "../db/databaseClient.js";

class ConditionNumber {

  phoneNumber: string
  conditionId: string

  constructor(
    phoneNumber: string,
    conditionId: string,
  ) {
    this.phoneNumber = phoneNumber;
    this.conditionId = conditionId;

    // Register the handler for the phone number if it exists
    if (this.phoneNumber) {
      phoneNetwork.registerHandlerByNumber(phoneNumber, this.handleCall);
    }
  }

  private handleCall = async (event: ChannelEvent, mediaSession: MediaSession): Promise<void> => {
    try {
      if (event.type !== "StasisStart") return;
      // Answer the call
      await event.instanceChannel.answer();

      // Set the condition in the database to true for this condition
      await markConditionCompleted(this.conditionId);

      // In the database, set the condition to true
      // Send the call audio to OpenAI
      await mediaSession.sendFile('./src/characterInterfaces/audio/success.mp3');
      await mediaSession.sendFile('./src/characterInterfaces/audio/success.mp3');
      await mediaSession.sendFile('./src/characterInterfaces/audio/success.mp3');
      // hangup
      await event.instanceChannel.hangup();

    }
    catch (e) {
      console.error("Error in CodeCharacter handler:", e);
    }
  }
}

export default ConditionNumber;