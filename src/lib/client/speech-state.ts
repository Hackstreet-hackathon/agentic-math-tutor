/** Shared flags so one-off hints (speak.ts) don't talk over a running voice conversation. */
let speaking = false;
let active = false;
export const setConversationSpeaking = (v: boolean) => {
  speaking = v;
};
export const isConversationSpeaking = () => speaking;
/** True while the tutor panel's voice conversation is on: study events are then raised inside the conversation. */
export const setConversationActive = (v: boolean) => {
  active = v;
};
export const isConversationActive = () => active;
