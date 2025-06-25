
// This is an object that provides a schedule of calls that a character will make to the phone. They are all time based
// The start date time is the earliest time it can call. Things that can delay the call are, users using the phone or conditions not being met
export interface OutboundCallSchedule {
  id: string;
  character_name: string;
  prompt: string;
  start_date_time: Date;
  condition_id: string;
  completed: number;
}