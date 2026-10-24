/** Shared flag so one-off hints (speak.ts) don't talk over a running voice conversation. */
let speaking = false;
export const setConversationSpeaking = (v: boolean) => {
  speaking = v;
};
export const isConversationSpeaking = () => speaking;
